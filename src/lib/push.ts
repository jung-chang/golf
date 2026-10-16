// Web push on this device: permission, the service-worker subscription, and the server copy.
import { api } from './api';

const standalone = () => window.matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true;
const onIphone = () => /iPhone|iPod|iPad/.test(navigator.userAgent);

/** On iPhone in Safari: must be added to the Home Screen before it can notify. */
export const needsInstall = () => onIphone() && !standalone();

/** iPhone only delivers push to an app added to the Home Screen. */
export const pushSupported = () =>
  typeof window !== 'undefined'
  && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
  && !(onIphone() && !standalone());

export async function pushEnabled(): Promise<boolean> {
  if (!pushSupported() || Notification.permission !== 'granted') return false;
  const reg = await navigator.serviceWorker.getRegistration();
  return !!(await reg?.pushManager.getSubscription());
}

const blocked = 'Notifications are blocked in settings';

export async function enablePush(): Promise<void> {
  if (!pushSupported()) throw new Error('Notifications are not supported on this device');
  // Ask first: browsers only show the permission prompt during a tap.
  const permission = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission();
  if (permission !== 'granted') throw new Error(blocked);

  const { key } = await api<{ key: string | null }>('/push/key');
  if (!key) throw new Error('Notifications are not set up yet');
  const reg = await navigator.serviceWorker.ready;
  const sub = (await reg.pushManager.getSubscription())
    ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: base64urlBytes(key) }));
  await api('/push', { body: sub.toJSON() });
}

export async function disablePush(): Promise<void> {
  if (!pushSupported()) return;
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  if (!sub) return;
  await api('/push', { method: 'DELETE', body: { endpoint: sub.endpoint } });
  await sub.unsubscribe();
}

function base64urlBytes(s: string): Uint8Array<ArrayBuffer> {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  return Uint8Array.from(bin, (ch) => ch.charCodeAt(0));
}
