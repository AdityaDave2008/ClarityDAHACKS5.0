/** Post an OS notification only when it is enabled and already authorized. */
export async function notifyPhone(message, platform = globalThis, {
  enabled = () => true,
  vibration = () => false,
  signal,
  title = 'Clarity: object ahead',
  tag = 'clarity-object-ahead',
} = {}) {
  const NotificationApi = platform?.Notification;
  const allowed = () => !signal?.aborted && enabled() && NotificationApi?.permission === 'granted';
  if (!allowed()) return false;

  const options = () => {
    const pattern = vibration();
    return {
      body: message || 'An object was detected in the camera alert zone. Check your surroundings.',
      icon: '/icons/logo-orange.svg',
      badge: '/icons/logo-orange.svg',
      tag,
      silent: !pattern,
      ...(pattern ? { vibrate: pattern, renotify: true } : {}),
      data: { url: '/#camera' },
    };
  };

  try {
    const registration = await platform.navigator?.serviceWorker?.getRegistration?.();
    if (!allowed()) return false;
    if (registration?.showNotification) {
      await registration.showNotification(title, options());
      return true;
    }
  } catch { /* Fall back to the browser notification API when available. */ }

  if (!allowed()) return false;
  try {
    new NotificationApi(title, options());
    return true;
  } catch { return false; }
}
