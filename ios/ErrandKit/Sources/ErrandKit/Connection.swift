// Phone side of the encrypted link to the Mac through the relay.
// Same behaviour as web/src/conn.ts: hello on connect, ping every 25s, reconnect with backoff.

import CryptoKit
import Foundation

public enum LinkStatus: Equatable, Sendable {
    case connecting, online, macOffline, offline
    case rejected(String)
}

@MainActor
public final class Connection {
    public var onMessage: ((MacToPhone) -> Void)?
    public var onStatus: ((LinkStatus) -> Void)?
    /// Called once the Mac confirms the pairing, so the app can save it.
    public var onPaired: ((Pairing) -> Void)?

    private var pairing: Pairing
    private let key: SymmetricKey
    private let macKid: String
    private let session = URLSession(configuration: .default)
    private var socket: URLSessionWebSocketTask?
    private var pingTimer: Timer?
    private var retryDelay: TimeInterval = 1
    private var stopped = true
    private let deviceName: String

    public init(pairing: Pairing, deviceName: String) throws {
        self.pairing = pairing
        self.deviceName = deviceName
        key = try ErrandCrypto.sessionKey(
            mySecretKey: pairing.phone.secretKey,
            peerPublicKey: pairing.macPublicKey,
            roomId: pairing.roomId
        )
        macKid = try ErrandCrypto.keyId(pairing.macPublicKey)
    }

    public func start() {
        guard stopped else { return }
        stopped = false
        connect()
    }

    /// Disconnect, e.g. when the app goes to the background.
    public func stop() {
        stopped = true
        pingTimer?.invalidate()
        socket?.cancel(with: .goingAway, reason: nil)
        socket = nil
    }

    @discardableResult
    public func send(_ message: PhoneToMac) -> Bool {
        guard let socket, socket.state == .running,
              let sealed = try? ErrandCrypto.seal(message, key: key) else { return false }
        sendFrame(.message(from: pairing.phoneKid, sealed: sealed), on: socket)
        return true
    }

    // MARK: - Internals

    private func connect() {
        guard !stopped, let url = pairing.webSocketURL() else { return }
        onStatus?(.connecting)
        let task = session.webSocketTask(with: url)
        socket = task
        task.resume()
        hello(on: task)
        receive(on: task)
        pingTimer?.invalidate()
        pingTimer = Timer.scheduledTimer(withTimeInterval: 25, repeats: true) { [weak task] _ in
            task?.send(.string("ping")) { _ in }
        }
    }

    private func hello(on task: URLSessionWebSocketTask) {
        let proof = pairing.pairSecret.flatMap {
            try? ErrandCrypto.pairingProof(pairSecret: $0, phonePublicKey: pairing.phone.publicKey)
        }
        sendFrame(.hello(kid: pairing.phoneKid, pub: pairing.phone.publicKey, proof: proof, name: deviceName), on: task)
    }

    private func sendFrame(_ frame: Frame, on task: URLSessionWebSocketTask) {
        guard let data = try? JSONEncoder().encode(frame), let text = String(data: data, encoding: .utf8) else { return }
        task.send(.string(text)) { _ in }
    }

    private func receive(on task: URLSessionWebSocketTask) {
        task.receive { [weak self] result in
            Task { @MainActor in
                guard let self, self.socket === task else { return }
                switch result {
                case .success(.string(let text)):
                    self.retryDelay = 1
                    self.handle(text, on: task)
                    self.receive(on: task)
                case .success:
                    self.receive(on: task)
                case .failure:
                    self.scheduleReconnect()
                }
            }
        }
    }

    private func scheduleReconnect() {
        pingTimer?.invalidate()
        socket = nil
        guard !stopped else { return }
        onStatus?(.offline)
        let delay = retryDelay
        retryDelay = min(retryDelay * 2, 15)
        DispatchQueue.main.asyncAfter(deadline: .now() + delay) { [weak self] in
            Task { @MainActor in
                guard let self, !self.stopped, self.socket == nil else { return }
                self.connect()
            }
        }
    }

    private func handle(_ text: String, on task: URLSessionWebSocketTask) {
        guard text != "pong", let frame = try? JSONDecoder().decode(Frame.self, from: Data(text.utf8)) else { return }
        switch frame.t {
        case "presence" where frame.role == "mac":
            if frame.online == true { hello(on: task) } else { onStatus?(.macOffline) }
        case "reject" where frame.to == pairing.phoneKid:
            stop()
            onStatus?(.rejected(frame.reason ?? "The Mac declined this phone."))
        case "msg" where frame.from == macKid:
            guard let sealed = frame.sealed,
                  let message = try? ErrandCrypto.open(sealed, key: key, as: MacToPhone.self) else { return }
            var confirmed = false
            if case .paired = message { confirmed = true }
            if case .state = message { confirmed = true }
            if confirmed && !pairing.paired {
                pairing.paired = true
                pairing.pairSecret = nil
                onPaired?(pairing)
            }
            onStatus?(.online)
            onMessage?(message)
        default:
            break
        }
    }
}
