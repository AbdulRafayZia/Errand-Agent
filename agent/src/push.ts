// Web push sent straight from the Mac to the phone's push service (Apple, Google, …).
// Payloads are encrypted to the phone (RFC 8291), so neither the relay nor the push
// service can read them. No server of ours is involved.

import webpush from "web-push";
import type { PushPayload, PushSubscriptionJSON } from "@errand/protocol";
import { saveConfig, type Config } from "./config";

// Only post to real push services, never to an arbitrary URL a phone sends us.
const PUSH_HOSTS = [
  /^web\.push\.apple\.com$/,
  /^fcm\.googleapis\.com$/,
  /^updates\.push\.services\.mozilla\.com$/,
  /\.notify\.windows\.com$/,
];

export function ensureVapidKeys(config: Config) {
  if (config.vapid) return;
  config.vapid = webpush.generateVAPIDKeys();
  saveConfig(config);
}

export function isValidSubscription(sub: PushSubscriptionJSON | undefined): sub is PushSubscriptionJSON {
  if (!sub || typeof sub.endpoint !== "string" || !sub.keys?.p256dh || !sub.keys?.auth) return false;
  try {
    const url = new URL(sub.endpoint);
    return url.protocol === "https:" && PUSH_HOSTS.some((host) => host.test(url.hostname));
  } catch {
    return false;
  }
}

/** Sends to one phone. Returns false if the subscription is gone and should be forgotten. */
export async function sendPush(config: Config, sub: PushSubscriptionJSON, payload: PushPayload): Promise<boolean> {
  try {
    await webpush.sendNotification(sub, JSON.stringify(payload), {
      vapidDetails: {
        subject: process.env.ERRAND_PUSH_CONTACT ?? "mailto:errand-agent@example.com",
        publicKey: config.vapid!.publicKey,
        privateKey: config.vapid!.privateKey,
      },
      TTL: 60 * 60,
      urgency: "high",
      topic: payload.tag.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 32) || undefined,
    });
    return true;
  } catch (error) {
    const status = (error as { statusCode?: number }).statusCode;
    if (status === 404 || status === 410) return false;
    console.error(`Push failed (${status ?? "network"}): ${(error as Error).message}`);
    return true;
  }
}
