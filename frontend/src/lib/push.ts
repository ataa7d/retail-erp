import { apiRequest } from "./api";

export function isPushSupported(): boolean {
  return "serviceWorker" in navigator && "PushManager" in window;
}

function urlBase64ToUint8Array(base64: string): ArrayBuffer {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const base64Safe = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64Safe);
  return Uint8Array.from([...rawData].map((c) => c.charCodeAt(0))).buffer;
}

export async function subscribeToPush(token: string | null, companyId: string | null): Promise<void> {
  if (!isPushSupported()) throw new Error("Push notifications aren't supported in this browser");

  const registration = await navigator.serviceWorker.register("/sw.js");
  const { publicKey } = await apiRequest<{ publicKey: string | null }>("/api/push/public-key", { token, companyId });
  if (!publicKey) throw new Error("Push notifications aren't configured on the server yet");

  const subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(publicKey),
  });

  const raw = subscription.toJSON();
  await apiRequest("/api/push/subscribe", {
    method: "POST",
    token,
    companyId,
    body: { endpoint: raw.endpoint, keys: raw.keys },
  });
}

export async function unsubscribeFromPush(token: string | null, companyId: string | null): Promise<void> {
  const registration = await navigator.serviceWorker.getRegistration();
  const subscription = await registration?.pushManager.getSubscription();
  if (!subscription) return;
  await apiRequest("/api/push/unsubscribe", { method: "POST", token, companyId, body: { endpoint: subscription.endpoint } });
  await subscription.unsubscribe();
}
