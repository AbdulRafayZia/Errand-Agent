import { b64uDecode, type PushSubscriptionJSON } from "@errand/protocol";

export type PushSupport = "ok" | "needs-home-screen" | "needs-https" | "unsupported";

export function isStandalone(): boolean {
  return matchMedia("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true;
}

export function pushSupport(): PushSupport {
  if (!isSecureContext) return "needs-https";
  // iOS only allows web push for apps added to the Home Screen.
  if (/iPhone|iPad|iPod/.test(navigator.userAgent) && !isStandalone()) return "needs-home-screen";
  if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) return "unsupported";
  return "ok";
}

export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | undefined> {
  if (!("serviceWorker" in navigator) || !isSecureContext) return undefined;
  try {
    return await navigator.serviceWorker.register("/sw.js");
  } catch {
    return undefined;
  }
}

/** Must be called from a tap: iOS only shows the permission prompt for a user gesture. */
export async function subscribe(vapidPublicKey: string): Promise<PushSubscriptionJSON> {
  const permission = await Notification.requestPermission();
  if (permission !== "granted") throw new Error("Notifications are turned off for Errand in Settings.");
  const registration = (await registerServiceWorker()) ?? (await navigator.serviceWorker.ready);
  const existing = await registration.pushManager.getSubscription();
  const subscription =
    existing ??
    (await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: new Uint8Array(b64uDecode(vapidPublicKey)),
    }));
  return subscription.toJSON() as PushSubscriptionJSON;
}

export async function unsubscribe() {
  const registration = await navigator.serviceWorker?.getRegistration();
  const subscription = await registration?.pushManager.getSubscription();
  await subscription?.unsubscribe();
}
