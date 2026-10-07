// Checks the Swift crypto against vectors produced by the TypeScript protocol
// (scripts/interop-vectors.ts), and writes a message for TypeScript to open.
// Usage: swift run InteropCheck <vectors.json> <reply-out.json>

import ErrandKit
import Foundation

struct Vectors: Decodable {
    var room: String
    var mac: KeyPair
    var phone: KeyPair
    var pairSecret: String
    var expected: Expected
    var sealedByMac: Sealed

    struct Expected: Decodable {
        var macKid: String
        var phoneKid: String
        var proof: String
        var code: String
    }
}

func check(_ name: String, _ ok: Bool) {
    print("\(ok ? "PASS" : "FAIL")  \(name)")
    if !ok { exit(1) }
}

let args = CommandLine.arguments
let vectors = try JSONDecoder().decode(Vectors.self, from: Data(contentsOf: URL(fileURLWithPath: args[1])))

check("key id matches TypeScript", try ErrandCrypto.keyId(vectors.mac.publicKey) == vectors.expected.macKid
    && ErrandCrypto.keyId(vectors.phone.publicKey) == vectors.expected.phoneKid)
check("pairing proof matches", try ErrandCrypto.pairingProof(pairSecret: vectors.pairSecret, phonePublicKey: vectors.phone.publicKey) == vectors.expected.proof)
check("pairing code matches", try ErrandCrypto.pairingCode(macPublicKey: vectors.mac.publicKey, phonePublicKey: vectors.phone.publicKey, roomId: vectors.room) == vectors.expected.code)

let phoneKey = try ErrandCrypto.sessionKey(mySecretKey: vectors.phone.secretKey, peerPublicKey: vectors.mac.publicKey, roomId: vectors.room)
let fromMac = try ErrandCrypto.open(vectors.sealedByMac, key: phoneKey, as: MacToPhone.self)
if case .state(let mac, let tasks, let approvals) = fromMac {
    check("opens and decodes a state message sealed by the Mac", mac.name == "Test Mac" && tasks.first?.steps.first?.status == .done && approvals.first?.kind == .email)
} else {
    check("opens and decodes a state message sealed by the Mac", false)
}

let wrongRoom = try ErrandCrypto.sessionKey(mySecretKey: vectors.phone.secretKey, peerPublicKey: vectors.mac.publicKey, roomId: "another-room")
check("rejects a message opened with the wrong key", (try? ErrandCrypto.open(vectors.sealedByMac, key: wrongRoom, as: MacToPhone.self)) == nil)

let link = "https://relay.example/#pair=" + Base64URL.encode(try JSONEncoder().encode(
    PairingPayload(v: 1, u: "https://relay.example", r: vectors.room, k: vectors.mac.publicKey, s: vectors.pairSecret, m: "Test Mac")))
let parsed = Pairing.from(link: link)
check("parses a pairing link", parsed?.roomId == vectors.room && parsed?.webSocketURL()?.absoluteString.hasPrefix("wss://relay.example/ws?room=") == true)

let reply = try ErrandCrypto.seal(PhoneToMac.respond(approvalId: "appr-1", approve: true, remember: true), key: phoneKey)
try JSONEncoder().encode(reply).write(to: URL(fileURLWithPath: args[2]))
print("wrote a sealed approval reply for TypeScript to open")
