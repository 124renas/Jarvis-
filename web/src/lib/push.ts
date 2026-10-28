import { api } from "./api";
import { isIOS, isStandalone } from "./format";

function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export function pushSupportMessage(): string | null {
  if (isIOS() && !isStandalone()) {
    return "On iPhone and iPad, notifications only work after you add JARVIS to your Home Screen (Share → Add to Home Screen) and open it from there. Requires iOS/iPadOS 16.4 or later.";
  }
  if (!("serviceWorker" in navigator) || !("PushManager" in window) || typeof Notification === "undefined") {
    return "Push notifications aren't supported in this browser.";
  }
  return null;
}

/** Must be called from a user gesture (button tap). */
export async function enablePush(vapidPublicKey: string) {
  const unsupported = pushSupportMessage();
  if (unsupported) throw new Error(unsupported);
  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    throw new Error("Notifications are blocked. Enable them in iOS Settings › Notifications › JARVIS.");
  }
  const reg = await navigator.serviceWorker.ready;
  const existing = await reg.pushManager.getSubscription();
  const sub = existing ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(vapidPublicKey) }));
  await api("/push/subscribe", { body: sub.toJSON() as Record<string, unknown> });
}

export async function disablePush() {
  if (!("serviceWorker" in navigator)) return;
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager?.getSubscription();
  if (sub) {
    await api("/push/unsubscribe", { body: { endpoint: sub.endpoint } }).catch(() => {});
    await sub.unsubscribe();
  }
}

export async function hasPushSubscription(): Promise<boolean> {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) return false;
  const reg = await navigator.serviceWorker.getRegistration();
  return !!(await reg?.pushManager.getSubscription());
}
