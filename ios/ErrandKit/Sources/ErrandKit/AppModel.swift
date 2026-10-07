// The app's live state, shared by all screens.

import Foundation
import SwiftUI

@MainActor
public final class AppModel: ObservableObject {
    @Published public private(set) var pairing: Pairing?
    @Published public private(set) var link: LinkStatus = .connecting
    @Published public private(set) var awaitingMac = false
    @Published public private(set) var mac: MacStatus?
    @Published public private(set) var tasks: [ErrandTask] = []
    @Published public private(set) var approvals: [Approval] = []
    @Published public var openApproval: Approval?
    @Published public var toast: String?
    /// Why the last pairing ended (declined, expired, removed), shown on the pairing screen.
    @Published public private(set) var pairingError: String?

    private var connection: Connection?
    private let deviceName: String

    public init(deviceName: String) {
        self.deviceName = deviceName
        pairing = PairingStore.load()
    }

    public var isPaired: Bool { pairing?.paired == true }
    public var isOnline: Bool { link == .online }

    // MARK: Pairing

    /// Starts pairing from a scanned QR code or pasted link. Returns false if it isn't one.
    @discardableResult
    public func pair(with link: String) -> Bool {
        guard let fresh = Pairing.from(link: link) else { return false }
        disconnect()
        pairingError = nil
        PairingStore.save(fresh)
        pairing = fresh
        connect()
        return true
    }

    public func unpair(reason: String? = nil) {
        disconnect()
        PairingStore.clear()
        pairing = nil
        mac = nil
        tasks = []
        approvals = []
        awaitingMac = false
        pairingError = reason
    }

    // MARK: Connection lifecycle (call from scenePhase changes)

    public func connect() {
        guard let pairing, connection == nil else { return }
        guard let conn = try? Connection(pairing: pairing, deviceName: deviceName) else {
            unpair(reason: "This pairing is damaged. Scan a new code from your Mac.")
            return
        }
        conn.onStatus = { [weak self] status in
            guard let self else { return }
            if case .rejected(let reason) = status {
                self.unpair(reason: reason)
            } else {
                self.link = status
            }
        }
        conn.onPaired = { [weak self] confirmed in
            PairingStore.save(confirmed)
            self?.pairing = confirmed
        }
        conn.onMessage = { [weak self] message in self?.handle(message) }
        connection = conn
        conn.start()
    }

    public func disconnect() {
        connection?.stop()
        connection = nil
    }

    @discardableResult
    public func send(_ message: PhoneToMac) -> Bool {
        let ok = connection?.send(message) ?? false
        if !ok { toast = "Not connected to your Mac right now." }
        return ok
    }

    // MARK: Messages

    private func handle(_ message: MacToPhone) {
        switch message {
        case .pairPending:
            awaitingMac = true
        case .paired:
            awaitingMac = false
        case .state(let mac, let tasks, let approvals):
            self.mac = mac
            self.tasks = tasks.sorted { $0.createdAt > $1.createdAt }
            self.approvals = approvals
        case .mac(let mac):
            self.mac = mac
        case .task(let task):
            tasks.removeAll { $0.id == task.id }
            tasks.insert(task, at: 0)
            tasks.sort { $0.createdAt > $1.createdAt }
        case .approval(let approval):
            approvals.removeAll { $0.id == approval.id }
            approvals.append(approval)
        case .approvalResolved(let id):
            approvals.removeAll { $0.id == id }
            if openApproval?.id == id { openApproval = nil }
        case .error(let text):
            toast = text
        case .unknown:
            break
        }
    }

    public func task(_ id: String) -> ErrandTask? { tasks.first { $0.id == id } }
}
