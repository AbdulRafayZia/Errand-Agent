// Errand relay: routes encrypted frames between one Mac and its paired phones.
//
// Each pairing "room" is a Durable Object. The Mac and phones connect outbound
// over WebSockets, so no one opens ports on their network. The relay reads only
// routing fields (t, from, to); message bodies are end-to-end encrypted.

interface Env {
  ROOMS: DurableObjectNamespace;
  ASSETS: Fetcher;
}

type Role = "mac" | "phone";

interface Attachment {
  role: Role;
  kid: string;
}

const ROOM_ID = /^[A-Za-z0-9_-]{16,64}$/;
const KEY_ID = /^[0-9a-f]{16}$/;
const MAX_FRAME_BYTES = 512 * 1024;

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/ws") {
      if (request.headers.get("Upgrade") !== "websocket") {
        return new Response("Expected a WebSocket upgrade", { status: 426 });
      }
      const room = url.searchParams.get("room") ?? "";
      const role = url.searchParams.get("role");
      const kid = url.searchParams.get("kid") ?? "";
      if (!ROOM_ID.test(room) || (role !== "mac" && role !== "phone") || !KEY_ID.test(kid)) {
        return new Response("Bad room, role or kid", { status: 400 });
      }
      const stub = env.ROOMS.get(env.ROOMS.idFromName(room));
      return stub.fetch(request);
    }
    if (url.pathname === "/health") return Response.json({ ok: true });
    return env.ASSETS.fetch(request);
  },
};

export class Room {
  constructor(private ctx: DurableObjectState, _env: Env) {
    // Keep connections alive cheaply: answer pings without waking the object.
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const role = url.searchParams.get("role") as Role;
    const kid = url.searchParams.get("kid")!;

    // One connection per device: a reconnect replaces the stale socket.
    for (const ws of this.ctx.getWebSockets(kid)) ws.close(4000, "Replaced by a newer connection");

    const { 0: client, 1: server } = new WebSocketPair();
    this.ctx.acceptWebSocket(server, [role, kid]);
    server.serializeAttachment({ role, kid } satisfies Attachment);

    // Tell the newcomer who is here, and everyone else that it arrived.
    for (const ws of this.peers(server)) {
      const peer = ws.deserializeAttachment() as Attachment;
      server.send(JSON.stringify({ t: "presence", role: peer.role, kid: peer.kid, online: true }));
      ws.send(JSON.stringify({ t: "presence", role, kid, online: true }));
    }
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
    if (typeof message !== "string" || message.length > MAX_FRAME_BYTES) return;
    const sender = ws.deserializeAttachment() as Attachment;
    let frame: { t?: string; to?: string; from?: string };
    try {
      frame = JSON.parse(message);
    } catch {
      return;
    }

    if (sender.role === "phone") {
      // Phones may only talk to the Mac, and only as themselves.
      if (frame.t !== "hello" && frame.t !== "msg") return;
      if (frame.t === "msg" && frame.from !== sender.kid) return;
      const macs = this.ctx.getWebSockets("mac");
      if (macs.length === 0) {
        ws.send(JSON.stringify({ t: "presence", role: "mac", online: false }));
        return;
      }
      for (const mac of macs) mac.send(message);
      return;
    }

    // From the Mac: deliver to one phone, or to all phones when `to` is absent.
    if (frame.to) {
      for (const phone of this.ctx.getWebSockets(frame.to)) phone.send(message);
    } else {
      for (const phone of this.ctx.getWebSockets("phone")) phone.send(message);
    }
  }

  async webSocketClose(ws: WebSocket, code: number) {
    this.announceGone(ws);
    try {
      ws.close(code === 1005 ? 1000 : code, "Closed");
    } catch {
      // Already closed.
    }
  }

  async webSocketError(ws: WebSocket) {
    this.announceGone(ws);
  }

  private announceGone(ws: WebSocket) {
    const gone = ws.deserializeAttachment() as Attachment | null;
    if (!gone) return;
    // A replaced socket shares its kid with the live one; don't report it offline.
    const stillHere = this.ctx.getWebSockets(gone.kid).some((other) => other !== ws);
    if (stillHere) return;
    for (const peer of this.peers(ws)) {
      peer.send(JSON.stringify({ t: "presence", role: gone.role, kid: gone.kid, online: false }));
    }
  }

  private peers(self: WebSocket): WebSocket[] {
    return this.ctx.getWebSockets().filter((ws) => ws !== self);
  }
}
