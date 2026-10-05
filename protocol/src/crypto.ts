// End-to-end encryption shared by the Mac agent and phone clients.
//
// Scheme (also implementable with Apple CryptoKit for the native iOS app):
//   key agreement  X25519
//   key derivation HKDF-SHA256(shared secret, salt = room id, info = "errand/v1/aes-256-gcm") -> 32 bytes
//   encryption     AES-256-GCM, random 12-byte nonce, 16-byte tag appended to the ciphertext
//
// Both sides derive the same symmetric key, so either side can seal and open.

import { x25519 } from "@noble/curves/ed25519";
import { gcm } from "@noble/ciphers/aes";
import { randomBytes } from "@noble/ciphers/webcrypto";
import { hkdf } from "@noble/hashes/hkdf";
import { hmac } from "@noble/hashes/hmac";
import { sha256 } from "@noble/hashes/sha256";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function b64uEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function b64uDecode(text: string): Uint8Array {
  const base64 = text.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64 + "===".slice((base64.length + 3) % 4);
  const binary = atob(padded);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

export function randomId(byteLength = 16): string {
  return b64uEncode(randomBytes(byteLength));
}

export interface KeyPair {
  secretKey: string; // base64url
  publicKey: string; // base64url
}

export function generateKeyPair(): KeyPair {
  const secret = x25519.utils.randomPrivateKey();
  return { secretKey: b64uEncode(secret), publicKey: b64uEncode(x25519.getPublicKey(secret)) };
}

/** Short, stable identifier for a device, derived from its public key. */
export function keyId(publicKey: string): string {
  const digest = sha256(b64uDecode(publicKey));
  return Array.from(digest.slice(0, 8), (b) => b.toString(16).padStart(2, "0")).join("");
}

export function deriveSessionKey(mySecretKey: string, peerPublicKey: string, roomId: string): Uint8Array {
  const shared = x25519.getSharedSecret(b64uDecode(mySecretKey), b64uDecode(peerPublicKey));
  return hkdf(sha256, shared, encoder.encode(roomId), encoder.encode("errand/v1/aes-256-gcm"), 32);
}

export interface Sealed {
  n: string; // nonce, base64url
  c: string; // ciphertext + tag, base64url
}

export function seal(key: Uint8Array, value: unknown): Sealed {
  const nonce = randomBytes(12);
  const ciphertext = gcm(key, nonce).encrypt(encoder.encode(JSON.stringify(value)));
  return { n: b64uEncode(nonce), c: b64uEncode(ciphertext) };
}

/** Throws if the message was tampered with or sealed with a different key. */
export function open<T = unknown>(key: Uint8Array, sealed: Sealed): T {
  const plaintext = gcm(key, b64uDecode(sealed.n)).decrypt(b64uDecode(sealed.c));
  return JSON.parse(decoder.decode(plaintext)) as T;
}

/** Proof that a phone saw the pairing QR code: HMAC(pair secret, phone public key). */
export function pairingProof(pairSecret: string, phonePublicKey: string): string {
  return b64uEncode(hmac(sha256, b64uDecode(pairSecret), b64uDecode(phonePublicKey)));
}

/**
 * Six-digit code both devices compute on their own from the two public keys.
 * The person checks the phone and Mac show the same code before approving, which
 * also proves no one in the middle (including the relay) swapped a key.
 */
export function pairingCode(macPublicKey: string, phonePublicKey: string, roomId: string): string {
  const mac = b64uDecode(macPublicKey);
  const phone = b64uDecode(phonePublicKey);
  const label = encoder.encode(`errand/v1/pairing-code/${roomId}`);
  const input = new Uint8Array(label.length + mac.length + phone.length);
  input.set(label, 0);
  input.set(mac, label.length);
  input.set(phone, label.length + mac.length);
  const digest = sha256(input);
  const value = ((digest[0]! << 24) | (digest[1]! << 16) | (digest[2]! << 8) | digest[3]!) >>> 0;
  const digits = String(value % 1_000_000).padStart(6, "0");
  return `${digits.slice(0, 3)} ${digits.slice(3)}`;
}

export function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
