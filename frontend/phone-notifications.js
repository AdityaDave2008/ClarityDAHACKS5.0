/** Send an OS notification when the user has already granted notification access. */
export async function notifyPhone(message, platform = globalThis, {
  enabled = () => true, vibration = () => false, signal,
  title = 'Clarity: object ahead', tag = 'clarity-object-ahead',
} = {}) {
  const NotificationApi = platform?.Notification;
  if (!NotificationApi || NotificationApi.permission !== 'granted') return false;

  const title = 'Clarity: object nearby';
  const options = {
    body: message || 'An object may be in your path. Check your surroundings.',
    icon: new URL('icons/logo-orange.svg', document.baseURI).href,
    badge: new URL('icons/logo-orange.svg', document.baseURI).href,
    tag: `myeyes-obstacle-${Date.now()}`,
    renotify: true,
    data: { url: '/#camera' },
  const allowed = () => !signal?.aborted && enabled() && NotificationApi?.permission === 'granted';
  if (!allowed()) return false;
  const options = () => {
    // Re-read preferences after registration lookup; a pending alert must not
    // ignore a switch being turned off. Silent notifications omit vibrate.
    const pattern = vibration();
    return {
      body: message || 'An object was detected in the camera alert zone. Check your surroundings.',
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      tag, silent: !pattern, ...(pattern ? { vibrate: pattern, renotify: true } : {}),
      data: { url: '/#camera' },
    };
  };

  // OS notifications can vibrate independently of the in-page alert. Respect
  // the current controls first (including unsaved changes), then saved prefs.
  const doc = platform.document || globalThis.document;
  const alertMode = doc?.getElementById('alert')?.value
    || platform.localStorage?.getItem('clearpath-alert')
    || 'vibration';
  const vibrationEnabled = doc?.getElementById('vibrate')?.checked
    ?? platform.localStorage?.getItem('clearpath-vibrate') !== 'false';
  if (vibrationEnabled && ['vibration', 'both'].includes(alertMode)) {
    const strength = Math.min(100, Math.max(0, Number(platform.localStorage?.getItem('clearpath-vibration-strength') ?? 65)));
    const pulse = Math.round(50 + strength * 1.8);
    const pause = Math.max(40, Math.round(130 - strength * 0.5));
    options.vibrate = [pulse, pause, pulse];
  }

  try {
    if (platform.navigator?.serviceWorker) {
      const registration = await platform.navigator.serviceWorker.getRegistration();
      if (!allowed()) return false;
      if (registration?.showNotification) {
        await registration.showNotification(title, options());
        return true;
      }
    }
  } catch { /* Desktop notifications may work without a service worker. */ }
  if (!allowed()) return false;
  try { new NotificationApi(title, options()); return true; }
  catch { return false; }
}
