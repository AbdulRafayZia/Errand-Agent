export * from "./crypto";
export * from "./messages";

export function wsUrl(relayUrl: string, room: string, role: "mac" | "phone", kid: string): string {
  const url = new URL("/ws", relayUrl);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.searchParams.set("room", room);
  url.searchParams.set("role", role);
  url.searchParams.set("kid", kid);
  return url.toString();
}
