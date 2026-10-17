/** Send an OS notification when the user has already granted notification access. */
export async function notifyPhone(message, platform = globalThis, {
  enabled = () => true, vibration = () => false, signal,
  title = 'Clarity: object ahead', tag = 'clarity-object-ahead',
} = {}) {
  const NotificationApi = platform?.Notification;
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
