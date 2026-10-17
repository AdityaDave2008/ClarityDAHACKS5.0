import { notifyPhone } from './phone-notifications.js';

export function vibrationPattern(strength = 65, repeatCount = 1) {
  const level = Number(strength), count = Number(repeatCount);
  const amount = Number.isFinite(level) ? Math.min(100, Math.max(0, level)) : 65;
  if (amount === 0) return false;
  const repeats = Number.isFinite(count) ? Math.min(5, Math.max(1, Math.round(count))) : 1;
  const pulse = Math.round(50 + amount * 1.8), pause = Math.max(40, Math.round(130 - amount * .5));
  return Array.from({ length: repeats }, () => [pulse, pause, pulse, 200]).flat().slice(0, -1);
}

// Output only: proximity, confidence and cooldown remain with the detector.
export function createObjectAlerts({ platform = globalThis, readPreferences = () => ({}), onDelivery = () => {} } = {}) {
  let controller = new AbortController();
  const pattern = () => {
    const prefs = readPreferences();
    return prefs.vibration ? vibrationPattern(prefs.strength, prefs.repeatCount) : false;
  };
  function cancel() {
    controller.abort(); controller = new AbortController();
    try { platform.navigator?.vibrate?.(0); } catch { /* Unsupported or interrupted device. */ }
  }
  async function send(message, { test = false } = {}) {
    const signal = controller.signal;
    const notifications = () => readPreferences().notifications === true;
    let notification = false, vibration = false;
    if (notifications()) {
      notification = await notifyPhone(message, platform, { signal, enabled: notifications, vibration: pattern,
        ...(test ? { title: 'Clarity: test alert', tag: 'clarity-test-alert' } : {}) });
    }
    if (signal.aborted) return { notification: false, vibration: false };
    // Avoid a double vibration: the notification owns its pattern when posted.
    // Otherwise use the page API, which some browsers block in the background.
    if (!notification && pattern()) {
      try { vibration = platform.navigator?.vibrate?.(pattern()) === true; } catch { /* Visible and spoken alerts remain. */ }
    }
    const delivery = { notification, vibration };
    onDelivery(delivery);
    return delivery;
  }
  return { send, cancel };
}

export function mountObjectAlerts(doc, platform, feature) {
  const get = id => doc.getElementById(id);
  const stored = (key, fallback) => { try { return platform.localStorage.getItem(key) ?? fallback; } catch { return fallback; } };
  const store = (key, value) => { try { platform.localStorage.setItem(key, String(value)); } catch { /* Live controls still work. */ } };
  const supportedNotifications = () => !!platform.Notification && typeof platform.Notification.requestPermission === 'function';
  const supportedVibration = () => typeof platform.navigator?.vibrate === 'function';
  const preferences = () => ({
    notifications: get('notifications')?.checked === true,
    vibration: get('vibrate')?.checked === true && ['vibration', 'both'].includes(get('alert')?.value),
    strength: get('vibrationStrength')?.value ?? 65, repeatCount: get('alertRepeatCount')?.value ?? 1,
  });
  const status = message => { if (get('camera-alert-output-status')) get('camera-alert-output-status').textContent = message; };
  function refresh() {
    const permission = platform.Notification?.permission;
    const notificationText = !supportedNotifications() ? 'Phone notifications unavailable in this browser. Use spoken or on-screen alerts.'
      : permission === 'granted' ? 'Phone notifications allowed.'
      : permission === 'denied' ? 'Phone notifications blocked. Change permission in browser settings.'
      : 'Tap Enable phone notifications to allow system alerts.';
    const vibrationText = supportedVibration() ? 'Vibration follows your alert style and vibration switch; background support depends on your browser.'
      : 'Website vibration is unavailable in this browser.';
    status(`${notificationText} ${vibrationText}`);
    if (get('notificationPermissionSetting')) get('notificationPermissionSetting').textContent = notificationText;
    if (get('vibrationPermissionSetting')) get('vibrationPermissionSetting').textContent = vibrationText;
    for (const id of ['camera-notifications', 'requestNotifications', 'testNotifications']) {
      if (get(id)) get(id).disabled = !supportedNotifications();
    }
    if (get('camera-notifications')) get('camera-notifications').textContent = permission === 'granted' ? 'Test phone notification' : 'Enable phone notifications';
    if (get('notifications')) get('notifications').disabled = !supportedNotifications();
    if (get('vibrate')) get('vibrate').disabled = !supportedVibration();
    if (get('vibrationStrength')) get('vibrationStrength').disabled = !supportedVibration();
    if (get('testVibration')) get('testVibration').disabled = !supportedVibration();
  }
  const alerts = createObjectAlerts({ platform, readPreferences: preferences, onDelivery(delivery) {
    if (delivery.notification) status('Phone notification sent. Its sound and vibration follow your preferences and device settings.');
    else if (delivery.vibration) status('Vibration requested. Spoken and on-screen alerts remain available.');
    else refresh();
  } });
  if (get('notifications')) get('notifications').checked = stored('clearpath-notifications', 'true') === 'true';
  if (get('vibrate')) get('vibrate').checked = stored('clearpath-vibrate', 'true') === 'true';
  for (const [id, key] of [['notifications', 'clearpath-notifications'], ['vibrate', 'clearpath-vibrate']]) {
    get(id)?.addEventListener('change', () => { store(key, get(id).checked); alerts.cancel(); refresh(); });
  }
  get('alert')?.addEventListener('change', () => { alerts.cancel(); refresh(); });
  get('vibrationStrength')?.addEventListener('input', () => alerts.cancel());
  get('alertRepeatCount')?.addEventListener('change', () => alerts.cancel());
  platform.addEventListener('camera:obstacle', event => {
    const message = event.detail?.simulated ? 'Demo alert: object in the camera alert zone.'
      : 'Object detected in the camera alert zone. Check your surroundings.';
    void alerts.send(message);
  });
  platform.addEventListener('camera:stopped', () => alerts.cancel());
  platform.addEventListener('camera:detection-stopped', () => alerts.cancel());
  async function requestNotifications(sendTest = false) {
    if (!supportedNotifications()) { refresh(); return; }
    try {
      // Permission is invoked in the button tap, before any await.
      const permission = platform.Notification.permission === 'granted' ? 'granted' : await platform.Notification.requestPermission();
      if (permission === 'granted') {
        if (get('notifications')) get('notifications').checked = true;
        store('clearpath-notifications', true);
      }
      refresh();
      if (permission === 'granted' && sendTest) await alerts.send('Test alert. Object alerts are connected.', { test: true });
    } catch { status('Could not enable phone notifications. Check browser permissions; spoken and on-screen alerts remain available.'); }
  }
  get('camera-notifications')?.addEventListener('click', () => void requestNotifications(platform.Notification?.permission === 'granted'));
  get('requestNotifications')?.addEventListener('click', () => void requestNotifications());
  get('testNotifications')?.addEventListener('click', () => void requestNotifications(true));
  get('testVibration')?.addEventListener('click', () => {
    try {
      const pattern = vibrationPattern(preferences().strength, preferences().repeatCount);
      const sent = pattern && platform.navigator.vibrate(pattern);
      get('vibrationPermissionSetting').textContent = sent ? 'Test vibration requested.' : 'Vibration is off or blocked by this browser.';
    } catch { refresh(); }
  });
  get('voice')?.addEventListener('change', () => feature.enableSpeech(get('voice').checked));
  get('alert')?.addEventListener('change', () => feature.enableSpeech(get('alert').value === 'voice'));
  refresh();
  return alerts;
}
