/** Send an OS notification when the user has already granted notification access. */
export async function notifyPhone(message, platform = globalThis) {
  const NotificationApi = platform?.Notification;
  if (!NotificationApi || NotificationApi.permission !== 'granted') return false;

  const title = 'Clarity: object nearby';
  const options = {
    body: message || 'An object may be in your path. Check your surroundings.',
    icon: new URL('icons/logo-orange.svg', document.baseURI).href,
    badge: new URL('icons/logo-orange.svg', document.baseURI).href,
    tag: `myeyes-obstacle-${Date.now()}`,
    renotify: true,
    vibrate: [220, 100, 220],
    data: { url: '/#camera' },
  };

  try {
    if (platform.navigator?.serviceWorker) {
      const registration = await platform.navigator.serviceWorker.getRegistration();
      if (registration?.showNotification) {
        await registration.showNotification(title, options);
        return true;
      }
    }
    new NotificationApi(title, options);
    return true;
  } catch {
    try {
      new NotificationApi(title, options);
      return true;
    } catch {
      return false;
    }
  }
}
