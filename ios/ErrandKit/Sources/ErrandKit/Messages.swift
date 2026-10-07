// Mirrors protocol/src/messages.ts. Keep the two in step.

import Foundation

// MARK: - Relay frames

/// Any frame on the relay WebSocket. Only the fields for its `t` are present.
public struct Frame: Codable, Sendable {
    public var t: String
    public var kid: String?
    public var pub: String?
    public var proof: String?
    public var name: String?
    public var from: String?
    public var to: String?
    public var n: String?
    public var c: String?
    public var role: String?
    public var online: Bool?
    public var reason: String?

    public init(t: String) { self.t = t }

    public static func hello(kid: String, pub: String, proof: String?, name: String) -> Frame {
        var frame = Frame(t: "hello")
        frame.kid = kid
        frame.pub = pub
        frame.proof = proof
        frame.name = name
        return frame
    }

    public static func message(from: String, sealed: Sealed) -> Frame {
        var frame = Frame(t: "msg")
        frame.from = from
        frame.n = sealed.n
        frame.c = sealed.c
        return frame
    }

    public var sealed: Sealed? {
        guard let n, let c else { return nil }
        return Sealed(n: n, c: c)
    }
}

// MARK: - App data

public enum TaskStatus: String, Codable, Sendable {
    case queued, running, waiting, done, failed, stopped

    public var isActive: Bool { self == .queued || self == .running || self == .waiting }

    public var label: String {
        switch self {
        case .queued: "Queued"
        case .running: "Running"
        case .waiting: "Waiting on you"
        case .done: "Done"
        case .failed: "Failed"
        case .stopped: "Stopped"
        }
    }
}

public enum StepStatus: String, Codable, Sendable {
    case running, done, error, waiting, denied
}

public struct Step: Codable, Identifiable, Hashable, Sendable {
    public var id: String
    public var tool: String
    public var title: String
    public var detail: String?
    public var status: StepStatus
}

/// A task on the Mac. Named ErrandTask to stay clear of Swift's concurrency `Task`.
public struct ErrandTask: Codable, Identifiable, Hashable, Sendable {
    public var id: String
    public var prompt: String
    public var followups: [String]
    public var status: TaskStatus
    public var createdAt: Double
    public var updatedAt: Double
    public var steps: [Step]
    public var note: String?
    public var result: String?
    public var error: String?
    public var costUsd: Double?
    public var filesTouched: [String]

    public var created: Date { Date(timeIntervalSince1970: createdAt / 1000) }
    public var updated: Date { Date(timeIntervalSince1970: updatedAt / 1000) }
}

public enum ApprovalKind: String, Codable, Sendable {
    case email, command, file, other
}

public struct ApprovalPreview: Codable, Hashable, Sendable {
    public var to: [String]?
    public var subject: String?
    public var body: String?
    public var attachments: [String]?
    public var command: String?
    public var path: String?
    public var tool: String?
    public var input: String?
}

public struct Approval: Codable, Identifiable, Hashable, Sendable {
    public var id: String
    public var taskId: String
    public var stepId: String
    public var kind: ApprovalKind
    public var title: String
    public var reason: String
    public var preview: ApprovalPreview
    public var rememberLabel: String?
    public var createdAt: Double
}

public struct Battery: Codable, Hashable, Sendable {
    public var percent: Int
    public var charging: Bool
}

public struct MacStatus: Codable, Hashable, Sendable {
    public var name: String
    public var paused: Bool
    public var busy: Bool
    public var battery: Battery?
    public var allowedFolders: [String]
    public var model: String
    public var version: String
    public var pushKey: String
}

// MARK: - Phone → Mac

public enum PhoneToMac: Encodable, Sendable {
    case sync
    case createTask(prompt: String)
    case followup(taskId: String, prompt: String)
    case stopTask(taskId: String)
    case respond(approvalId: String, approve: Bool, remember: Bool)
    case pause(Bool)
    case stopAll

    private enum Keys: String, CodingKey {
        case type, prompt, taskId, approvalId, decision, remember, paused
    }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: Keys.self)
        switch self {
        case .sync:
            try c.encode("sync", forKey: .type)
        case .createTask(let prompt):
            try c.encode("task.create", forKey: .type)
            try c.encode(prompt, forKey: .prompt)
        case .followup(let taskId, let prompt):
            try c.encode("task.followup", forKey: .type)
            try c.encode(taskId, forKey: .taskId)
            try c.encode(prompt, forKey: .prompt)
        case .stopTask(let taskId):
            try c.encode("task.stop", forKey: .type)
            try c.encode(taskId, forKey: .taskId)
        case .respond(let approvalId, let approve, let remember):
            try c.encode("approval.respond", forKey: .type)
            try c.encode(approvalId, forKey: .approvalId)
            try c.encode(approve ? "approve" : "deny", forKey: .decision)
            try c.encode(remember, forKey: .remember)
        case .pause(let paused):
            try c.encode("agent.pause", forKey: .type)
            try c.encode(paused, forKey: .paused)
        case .stopAll:
            try c.encode("stop.all", forKey: .type)
        }
    }
}

// MARK: - Mac → Phone

public enum MacToPhone: Decodable, Sendable {
    case pairPending
    case paired(macName: String)
    case state(mac: MacStatus, tasks: [ErrandTask], approvals: [Approval])
    case task(ErrandTask)
    case approval(Approval)
    case approvalResolved(approvalId: String)
    case mac(MacStatus)
    case error(String)
    case unknown(String)

    private enum Keys: String, CodingKey {
        case type, macName, mac, tasks, approvals, task, approval, approvalId, message
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: Keys.self)
        let type = try c.decode(String.self, forKey: .type)
        switch type {
        case "pair.pending": self = .pairPending
        case "paired": self = .paired(macName: try c.decode(String.self, forKey: .macName))
        case "state":
            self = .state(
                mac: try c.decode(MacStatus.self, forKey: .mac),
                tasks: try c.decode([ErrandTask].self, forKey: .tasks),
                approvals: try c.decode([Approval].self, forKey: .approvals)
            )
        case "task": self = .task(try c.decode(ErrandTask.self, forKey: .task))
        case "approval": self = .approval(try c.decode(Approval.self, forKey: .approval))
        case "approval.resolved": self = .approvalResolved(approvalId: try c.decode(String.self, forKey: .approvalId))
        case "mac": self = .mac(try c.decode(MacStatus.self, forKey: .mac))
        case "error": self = .error(try c.decode(String.self, forKey: .message))
        default: self = .unknown(type)
        }
    }
}

// MARK: - Pairing

/// What the QR code carries (base64url JSON after `#pair=`).
public struct PairingPayload: Codable, Sendable {
    public var v: Int
    public var u: String
    public var r: String
    public var k: String
    public var s: String
    public var m: String

    public init(v: Int, u: String, r: String, k: String, s: String, m: String) {
        self.v = v
        self.u = u
        self.r = r
        self.k = k
        self.s = s
        self.m = m
    }
}

/// Everything the phone keeps about its Mac. Stored in the Keychain on iPhone.
public struct Pairing: Codable, Equatable, Sendable {
    public var relayUrl: String
    public var roomId: String
    public var macPublicKey: String
    public var macName: String
    public var phone: KeyPair
    public var phoneKid: String
    /// Present until the Mac confirms the pairing.
    public var pairSecret: String?
    public var paired: Bool

    /// Accepts a full pairing link (…/#pair=…) or just the encoded part.
    public static func from(link: String) -> Pairing? {
        let encoded = link.components(separatedBy: "#pair=").last ?? link
        guard
            let data = try? Base64URL.decode(encoded.trimmingCharacters(in: .whitespacesAndNewlines)),
            let payload = try? JSONDecoder().decode(PairingPayload.self, from: data),
            payload.v == 1, !payload.r.isEmpty, !payload.k.isEmpty, !payload.s.isEmpty, !payload.u.isEmpty
        else { return nil }
        let phone = KeyPair.generate()
        guard let kid = try? ErrandCrypto.keyId(phone.publicKey) else { return nil }
        return Pairing(
            relayUrl: payload.u, roomId: payload.r, macPublicKey: payload.k, macName: payload.m,
            phone: phone, phoneKid: kid, pairSecret: payload.s, paired: false
        )
    }

    public var code: String {
        (try? ErrandCrypto.pairingCode(macPublicKey: macPublicKey, phonePublicKey: phone.publicKey, roomId: roomId)) ?? "––– –––"
    }

    public func webSocketURL() -> URL? {
        guard var components = URLComponents(string: relayUrl) else { return nil }
        components.scheme = components.scheme == "https" ? "wss" : "ws"
        components.path = "/ws"
        components.queryItems = [
            URLQueryItem(name: "room", value: roomId),
            URLQueryItem(name: "role", value: "phone"),
            URLQueryItem(name: "kid", value: phoneKid),
        ]
        return components.url
    }
}
