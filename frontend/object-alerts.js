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
  let audioContext = null;
  let customSoundPromise = null;
  let customSoundBuffer = null;
  const activeAudio = new Set();
  const tones = {
    ping: [{ frequency: 880, start: 0, duration: .18, type: 'sine' }],
    double: [{ frequency: 660, start: 0, duration: .13, type: 'square' }, { frequency: 660, start: .23, duration: .13, type: 'square' }],
    rising: [{ frequency: 520, start: 0, duration: .16, type: 'sine' }, { frequency: 740, start: .14, duration: .18, type: 'sine' }, { frequency: 1040, start: .3, duration: .24, type: 'sine' }],
    pulse: [{ frequency: 440, start: 0, duration: .2, type: 'triangle' }, { frequency: 360, start: .27, duration: .2, type: 'triangle' }],
    soft: [{ frequency: 587, start: 0, duration: .22, type: 'sine' }, { frequency: 784, start: .17, duration: .3, type: 'sine' }],
  };
  function unlockSound() {
    const AudioContext = platform.AudioContext || platform.webkitAudioContext;
    if (!AudioContext) return;
    try {
      audioContext ||= new AudioContext();
      if (audioContext.state === 'suspended') void audioContext.resume().catch(() => {});
    } catch { /* Sound can be unavailable while vibration and visible alerts continue. */ }
  }
  async function loadCustomSound() {
    if (customSoundBuffer) return customSoundBuffer;
    if (!customSoundPromise) customSoundPromise = (async () => {
      if (!platform.indexedDB || !audioContext) return null;
      const file = await new Promise((resolve, reject) => {
        const request = platform.indexedDB.open('clearpath-audio', 1);
        request.onupgradeneeded = () => request.result.createObjectStore('sounds');
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result;
          if (!db.objectStoreNames.contains('sounds')) { db.close(); resolve(null); return; }
          const get = db.transaction('sounds', 'readonly').objectStore('sounds').get('custom-alert');
          get.onsuccess = () => { db.close(); resolve(get.result || null); };
          get.onerror = () => { db.close(); reject(get.error); };
        };
      });
      if (!file) return null;
      customSoundBuffer = await audioContext.decodeAudioData(await file.arrayBuffer());
      return customSoundBuffer;
    })().catch(() => { customSoundPromise = null; return null; });
    return customSoundPromise;
  }
  async function playSound(prefs, signal) {
    if (!prefs.sound || signal.aborted) return false;
    unlockSound();
    if (!audioContext || audioContext.state !== 'running') return false;
    const volume = Math.min(1, Math.max(0, Number(prefs.volume) / 100));
    if (!volume) return false;
    const repeats = Math.min(5, Math.max(1, Math.round(Number(prefs.repeatCount) || 1)));
    const sources = [];
    try {
      if (prefs.soundPreset === 'custom') {
        const buffer = await loadCustomSound();
        if (signal.aborted || audioContext.state !== 'running') return false;
        if (buffer) {
          for (let i = 0; i < repeats; i++) {
            const source = audioContext.createBufferSource();
            const gain = audioContext.createGain();
            source.buffer = buffer;
            gain.gain.value = volume;
            source.connect(gain); gain.connect(audioContext.destination);
            sources.push(source); activeAudio.add(source);
            source.onended = () => activeAudio.delete(source);
            source.start(audioContext.currentTime + i * (buffer.duration + .12));
          }
          return true;
        }
      }
      const schedule = tones[prefs.soundPreset] || tones.ping;
      const duration = Math.max(...schedule.map(tone => tone.start + tone.duration)) + .12;
      const now = audioContext.currentTime;
      for (let i = 0; i < repeats; i++) {
        for (const tone of schedule) {
          const oscillator = audioContext.createOscillator();
          const gain = audioContext.createGain();
          const begins = now + i * duration + tone.start;
          oscillator.type = tone.type;
          oscillator.frequency.value = tone.frequency;
          gain.gain.setValueAtTime(.001, begins);
          gain.gain.linearRampToValueAtTime(.12 * volume, begins + .015);
          gain.gain.exponentialRampToValueAtTime(.001, begins + tone.duration);
          oscillator.connect(gain); gain.connect(audioContext.destination);
          sources.push(oscillator); activeAudio.add(oscillator);
          oscillator.onended = () => activeAudio.delete(oscillator);
          oscillator.start(begins); oscillator.stop(begins + tone.duration + .02);
        }
      }
      return true;
    } catch { return false; }
  }
  const pattern = () => {
    const prefs = readPreferences();
    return prefs.vibration ? vibrationPattern(prefs.strength, prefs.repeatCount) : false;
  };
  function cancel() {
    controller.abort(); controller = new AbortController();
    for (const source of activeAudio) {
      try { source.stop(); } catch { /* The source may already have finished. */ }
      activeAudio.delete(source);
    }
    try { platform.navigator?.vibrate?.(0); } catch { /* Unsupported or interrupted device. */ }
  }
  async function send(message, { test = false } = {}) {
    const signal = controller.signal;
    const prefs = readPreferences();
    const notifications = () => readPreferences().notifications === true;
    const soundTask = playSound(prefs, signal);
    let notification = false, vibration = false;
    if (notifications()) {
      // Re-read the pattern when the notification is actually posted. The service
      // worker lookup is asynchronous, so a switch turned off while it was pending
      // must not still deliver a vibrating notification.
      notification = await notifyPhone(message, platform, { signal, enabled: notifications, vibration: pattern,
        ...(test ? { title: 'Clarity: test alert', tag: 'clarity-test-alert' } : {}) });
    }
    if (signal.aborted) return { notification: false, vibration: false, sound: false };
    const vibrationValue = pattern();
    // Avoid a double vibration: the notification owns its pattern when posted.
    // Otherwise use the page API, which some browsers block in the background.
    if (notification) vibration = Boolean(vibrationValue);
    else if (vibrationValue) {
      try { vibration = platform.navigator?.vibrate?.(vibrationValue) === true; } catch { /* Visible and spoken alerts remain. */ }
    }
    const sound = await soundTask;
    const delivery = { notification, vibration, sound };
    onDelivery(delivery);
    return delivery;
  }
  // unlockSound is exposed so the mount can arm audio from a real user gesture;
  // browsers only allow an AudioContext to resume inside one.
  return { send, cancel, unlockSound };
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
    sound: ['sound', 'both'].includes(get('alert')?.value),
    soundPreset: get('alertSound')?.value || stored('clearpath-alert-sound', 'ping'),
    volume: get('alertVolume')?.value || stored('clearpath-alert-volume', '70'),
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
    if (delivery.sound && delivery.vibration) status('Sound and vibration alert sent.');
    else if (delivery.sound) status('Sound alert sent.');
    else if (delivery.vibration) status('Vibration alert sent.');
    else if (delivery.notification) status('Phone notification sent. Its sound follows device settings.');
    else refresh();
  } });
  if (get('notifications')) get('notifications').checked = stored('clearpath-notifications', 'true') === 'true';
  if (get('vibrate')) get('vibrate').checked = stored('clearpath-vibrate', 'true') === 'true';
  doc.addEventListener('pointerdown', alerts.unlockSound, { capture: true, passive: true });
  doc.addEventListener('keydown', alerts.unlockSound, { capture: true });
  for (const [id, key] of [['notifications', 'clearpath-notifications'], ['vibrate', 'clearpath-vibrate']]) {
    get(id)?.addEventListener('change', () => { store(key, get(id).checked); alerts.cancel(); refresh(); });
  }
  get('alert')?.addEventListener('change', () => { alerts.cancel(); refresh(); });
  get('alertSound')?.addEventListener('change', () => { customSoundPromise = null; customSoundBuffer = null; });
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
