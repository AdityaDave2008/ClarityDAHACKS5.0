/** Send an OS notification when the user has already granted notification access. */
export async function notifyPhone(message, platform = globalThis) {
  const NotificationApi = platform?.Notification;
  if (!NotificationApi || NotificationApi.permission !== 'granted') return false;

  const title = 'ClearPath: object nearby';
  const options = {
    body: message || 'An object may be in your path. Check your surroundings.',
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    tag: `clearpath-obstacle-${Date.now()}`,
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
