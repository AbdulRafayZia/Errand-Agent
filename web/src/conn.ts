// Phone side of the encrypted link to the Mac, through the relay.

import {
  b64uDecode,
  deriveSessionKey,
  generateKeyPair,
  keyId,
  open,
  pairingProof,
  seal,
  wsUrl,
  type Frame,
  type KeyPair,
  type MacToPhone,
  type PairingPayload,
  type PhoneToMac,
} from "@errand/protocol";

const STORAGE_KEY = "errand.pairing.v1";

export interface Pairing {
  relayUrl: string;
  roomId: string;
  macPublicKey: string;
  macName: string;
  phone: KeyPair;
  phoneKid: string;
  /** Present until the Mac confirms the pairing. */
  pairSecret?: string;
  paired: boolean;
}

export function loadPairing(): Pairing | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Pairing) : null;
  } catch {
    return null;
  }
}

export function savePairing(pairing: Pairing | null) {
  try {
    if (pairing) localStorage.setItem(STORAGE_KEY, JSON.stringify(pairing));
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Private mode: the pairing lasts for this session only.
  }
}

/** Accepts a full pairing link or just the part after `#pair=`. */
export function pairingFromLink(link: string): Pairing | null {
  const encoded = link.includes("#pair=") ? link.split("#pair=")[1]! : link.trim();
  try {
    const payload = JSON.parse(new TextDecoder().decode(b64uDecode(encoded))) as PairingPayload;
    if (payload.v !== 1 || !payload.r || !payload.k || !payload.s || !payload.u) return null;
    const phone = generateKeyPair();
    return {
      relayUrl: payload.u,
      roomId: payload.r,
      macPublicKey: payload.k,
      macName: payload.m,
      phone,
      phoneKid: keyId(phone.publicKey),
      pairSecret: payload.s,
      paired: false,
    };
  } catch {
    return null;
  }
}

export type LinkStatus = "connecting" | "online" | "mac-offline" | "offline" | "rejected";

export class Connection {
  private ws?: WebSocket;
  private key: Uint8Array;
  private macKid: string;
  private retryMs = 1000;
  private pingTimer?: ReturnType<typeof setInterval>;
  private stopped = false;

  constructor(
    private pairing: Pairing,
    private onMessage: (message: MacToPhone) => void,
    private onStatus: (status: LinkStatus, reason?: string) => void,
  ) {
    this.key = deriveSessionKey(pairing.phone.secretKey, pairing.macPublicKey, pairing.roomId);
    this.macKid = keyId(pairing.macPublicKey);
    document.addEventListener("visibilitychange", this.onVisible);
  }

  start() {
    this.stopped = false;
    this.connect();
  }

  stop() {
    this.stopped = true;
    document.removeEventListener("visibilitychange", this.onVisible);
    clearInterval(this.pingTimer);
    this.ws?.close();
  }

  send(message: PhoneToMac): boolean {
    if (this.ws?.readyState !== WebSocket.OPEN) return false;
    this.ws.send(JSON.stringify({ t: "msg", from: this.pairing.phoneKid, ...seal(this.key, message) } satisfies Frame));
    return true;
  }

  private onVisible = () => {
    // iOS suspends sockets in the background; reconnect as soon as the app is back.
    if (document.visibilityState !== "visible" || this.stopped) return;
    if (!this.ws || this.ws.readyState === WebSocket.CLOSED || this.ws.readyState === WebSocket.CLOSING) {
      this.retryMs = 1000;
      this.connect();
    } else {
      this.send({ type: "sync" });
    }
  };

  private hello() {
    this.ws?.send(
      JSON.stringify({
        t: "hello",
        kid: this.pairing.phoneKid,
        pub: this.pairing.phone.publicKey,
        proof: this.pairing.pairSecret ? pairingProof(this.pairing.pairSecret, this.pairing.phone.publicKey) : undefined,
        name: /iPhone/.test(navigator.userAgent) ? "iPhone" : "Phone",
      } satisfies Frame),
    );
  }

  private connect() {
    this.onStatus("connecting");
    const ws = new WebSocket(wsUrl(this.pairing.relayUrl, this.pairing.roomId, "phone", this.pairing.phoneKid));
    this.ws = ws;
    ws.addEventListener("open", () => {
      this.retryMs = 1000;
      this.hello();
      clearInterval(this.pingTimer);
      this.pingTimer = setInterval(() => ws.readyState === WebSocket.OPEN && ws.send("ping"), 25_000);
    });
    ws.addEventListener("message", (event) => this.handle(String(event.data)));
    ws.addEventListener("close", () => {
      clearInterval(this.pingTimer);
      if (this.ws !== ws || this.stopped) return;
      this.onStatus("offline");
      setTimeout(() => this.ws === ws && !this.stopped && this.connect(), this.retryMs);
      this.retryMs = Math.min(this.retryMs * 2, 15_000);
    });
  }

  private handle(raw: string) {
    if (raw === "pong") return;
    let frame: Frame;
    try {
      frame = JSON.parse(raw);
    } catch {
      return;
    }
    if (frame.t === "presence" && frame.role === "mac") {
      if (frame.online) this.hello();
      else this.onStatus("mac-offline");
    } else if (frame.t === "reject" && frame.to === this.pairing.phoneKid) {
      this.onStatus("rejected", frame.reason);
    } else if (frame.t === "msg" && frame.from === this.macKid) {
      let message: MacToPhone;
      try {
        message = open<MacToPhone>(this.key, frame);
      } catch {
        return;
      }
      if (message.type === "paired" || (!this.pairing.paired && message.type === "state")) {
        this.pairing.paired = true;
        delete this.pairing.pairSecret;
        savePairing(this.pairing);
      }
      this.onStatus("online");
      this.onMessage(message);
    }
  }
}
