// End-to-end encryption, matching protocol/src/crypto.ts byte for byte:
//   X25519 key agreement → HKDF-SHA256(salt: room id, info: "errand/v1/aes-256-gcm") → AES-256-GCM
//   Sealed message = { n: 12-byte nonce, c: ciphertext + 16-byte tag }, both base64url.

import CryptoKit
import Foundation

public enum ErrandCryptoError: Error {
    case badBase64
    case badKey
    case badCiphertext
}

public enum Base64URL {
    public static func encode(_ data: Data) -> String {
        data.base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }

    public static func decode(_ text: String) throws -> Data {
        var base64 = text.replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
        base64 += String(repeating: "=", count: (4 - base64.count % 4) % 4)
        guard let data = Data(base64Encoded: base64) else { throw ErrandCryptoError.badBase64 }
        return data
    }
}

public struct KeyPair: Codable, Equatable, Sendable {
    public var secretKey: String
    public var publicKey: String

    public static func generate() -> KeyPair {
        let key = Curve25519.KeyAgreement.PrivateKey()
        return KeyPair(
            secretKey: Base64URL.encode(key.rawRepresentation),
            publicKey: Base64URL.encode(key.publicKey.rawRepresentation)
        )
    }
}

public struct Sealed: Codable, Sendable {
    public var n: String
    public var c: String
}

public enum ErrandCrypto {
    /// Short, stable device id: the first 8 bytes of SHA-256(public key), as hex.
    public static func keyId(_ publicKey: String) throws -> String {
        let digest = SHA256.hash(data: try Base64URL.decode(publicKey))
        return digest.prefix(8).map { String(format: "%02x", $0) }.joined()
    }

    public static func sessionKey(mySecretKey: String, peerPublicKey: String, roomId: String) throws -> SymmetricKey {
        do {
            let mine = try Curve25519.KeyAgreement.PrivateKey(rawRepresentation: Base64URL.decode(mySecretKey))
            let peer = try Curve25519.KeyAgreement.PublicKey(rawRepresentation: Base64URL.decode(peerPublicKey))
            let shared = try mine.sharedSecretFromKeyAgreement(with: peer)
            return shared.hkdfDerivedSymmetricKey(
                using: SHA256.self,
                salt: Data(roomId.utf8),
                sharedInfo: Data("errand/v1/aes-256-gcm".utf8),
                outputByteCount: 32
            )
        } catch let error as ErrandCryptoError {
            throw error
        } catch {
            throw ErrandCryptoError.badKey
        }
    }

    public static func seal<T: Encodable>(_ value: T, key: SymmetricKey) throws -> Sealed {
        let plaintext = try JSONEncoder().encode(value)
        let box = try AES.GCM.seal(plaintext, using: key, nonce: AES.GCM.Nonce())
        return Sealed(
            n: Base64URL.encode(Data(box.nonce)),
            c: Base64URL.encode(box.ciphertext + box.tag)
        )
    }

    /// Throws if the message was tampered with or sealed with a different key.
    public static func open<T: Decodable>(_ sealed: Sealed, key: SymmetricKey, as type: T.Type) throws -> T {
        let combined = try Base64URL.decode(sealed.c)
        guard combined.count >= 16 else { throw ErrandCryptoError.badCiphertext }
        do {
            let box = try AES.GCM.SealedBox(
                nonce: AES.GCM.Nonce(data: Base64URL.decode(sealed.n)),
                ciphertext: combined.dropLast(16),
                tag: combined.suffix(16)
            )
            let plaintext = try AES.GCM.open(box, using: key)
            return try JSONDecoder().decode(T.self, from: plaintext)
        } catch is DecodingError {
            throw ErrandCryptoError.badCiphertext
        } catch {
            throw ErrandCryptoError.badCiphertext
        }
    }

    /// Proof that this phone saw the pairing QR: HMAC-SHA256(pair secret, phone public key).
    public static func pairingProof(pairSecret: String, phonePublicKey: String) throws -> String {
        let mac = HMAC<SHA256>.authenticationCode(
            for: try Base64URL.decode(phonePublicKey),
            using: SymmetricKey(data: try Base64URL.decode(pairSecret))
        )
        return Base64URL.encode(Data(mac))
    }

    /// Six-digit code shown on both the phone and the Mac during pairing, e.g. "482 913".
    public static func pairingCode(macPublicKey: String, phonePublicKey: String, roomId: String) throws -> String {
        var input = Data("errand/v1/pairing-code/\(roomId)".utf8)
        input.append(try Base64URL.decode(macPublicKey))
        input.append(try Base64URL.decode(phonePublicKey))
        let digest = Array(SHA256.hash(data: input))
        let value = (UInt32(digest[0]) << 24) | (UInt32(digest[1]) << 16) | (UInt32(digest[2]) << 8) | UInt32(digest[3])
        let digits = String(format: "%06d", value % 1_000_000)
        return "\(digits.prefix(3)) \(digits.suffix(3))"
    }
}
