import { mountCamera, exposeCamera } from './camera.js';
import { createBackendDetector } from './backend-detector.js';

export function mountSite(doc = document, platform = window, detector = createBackendDetector()) {
  const get = id => doc.getElementById(id);
  const screens = [...doc.querySelectorAll('.screen')];
  const nav = [...doc.querySelectorAll('.nav-btn')];
  let currentScreen = 'home';
  let toastTimer;
  let audio;
  const oscillators = new Set();
  const feature = mountCamera(get('camera-panel'), platform, { onState(state) {
    get('voice').checked = state.speechEnabled;
    get('voice').disabled = !state.speechSupported;
    get('app-status').textContent = state.phase === 'active' ? 'Camera active' : state.phase === 'requesting' ? 'Camera starting' : 'Camera off';
    get('toast').setAttribute('aria-live', state.announcements === 'screen-reader' ? 'polite' : 'off');
  } });
  feature.registerDetector(detector);
  exposeCamera(feature, platform);
  feature.setRepeatCount(Number(stored('clearpath-alert-repeat-count', '1')) || 1);

  function stopCues() {
    for (const oscillator of oscillators) { try { oscillator.stop(); } catch { /* Already stopped. */ } }
    oscillators.clear();
    platform.navigator.vibrate?.(0);
  }
  // Unlock optional sound in the same user gesture as Start; never on load.
  get('camera-start').addEventListener('click', () => {
    if (!['sound', 'both'].includes(get('alert').value)) return;
    try {
      const Audio = platform.AudioContext || platform.webkitAudioContext;
      if (!Audio) return;
      audio ??= new Audio();
      void audio.resume().catch(() => {});
    } catch { /* Visible alerts and speech remain available. */ }
  });
  platform.addEventListener('camera:obstacle', () => {
    const mode = get('alert').value;
    const repeatCount = Math.min(5, Math.max(1, Number(stored('clearpath-alert-repeat-count', '1')) || 1));
    if (get('vibrate').checked && ['vibration', 'both'].includes(mode)) {
      const pattern = Array.from({ length: repeatCount }, () => [120, 70, 180]).flat();
      platform.navigator.vibrate?.(pattern);
    }
    if (['sound', 'both'].includes(mode) && audio?.state === 'running') {
      try {
        for (let index = 0; index < repeatCount; index++) {
          const oscillator = audio.createOscillator(), gain = audio.createGain();
          const startsAt = audio.currentTime + index * .38;
          oscillator.connect(gain);
          gain.connect(audio.destination);
          gain.gain.value = .12;
          oscillator.frequency.value = 660;
          oscillators.add(oscillator);
          oscillator.onended = () => { oscillators.delete(oscillator); oscillator.disconnect(); gain.disconnect(); };
          oscillator.start(startsAt);
          oscillator.stop(startsAt + .18);
        }
      } catch { /* Visible alerts and speech remain available. */ }
    }
  });
  platform.addEventListener('camera:stopped', stopCues);
  platform.addEventListener('camera:detection-stopped', stopCues);

  function stored(key, fallback) {
    try { return platform.localStorage.getItem(key) || fallback; } catch { return fallback; }
  }
  function store(key, value) {
    try { platform.localStorage.setItem(key, value); } catch { /* Controls still work without storage. */ }
  }
  function toast(message) {
    clearTimeout(toastTimer);
    get('toast').textContent = message;
    get('toast').classList.add('show');
    toastTimer = setTimeout(() => { get('toast').classList.remove('show'); get('toast').textContent = ''; }, 3000);
  }
  function showScreen(id, focus = true) {
    if (!screens.some(screen => screen.id === id)) return;
    if (currentScreen === 'camera' && id !== 'camera') feature.stop();
    if (currentScreen !== id) {
      clearTimeout(toastTimer);
      get('toast').textContent = '';
      get('toast').classList.remove('show');
    }
    currentScreen = id;
    for (const screen of screens) {
      const active = screen.id === id;
      screen.classList.toggle('active', active);
      screen.hidden = !active;
    }
    for (const button of nav) {
      const active = button.dataset.screen === id;
      button.classList.toggle('active', active);
      if (active) button.setAttribute('aria-current', 'page');
      else button.removeAttribute('aria-current');
    }
    doc.body.classList.toggle('camera-active', id === 'camera');
    const heading = get(id).querySelector('h1');
    if (focus && heading) { heading.tabIndex = -1; heading.focus(); }
    platform.scrollTo({ top: 0, behavior: 'auto' });
  }
  nav.forEach(button => button.addEventListener('click', () => showScreen(button.dataset.screen)));
  get('start').addEventListener('click', () => showScreen('camera'));
  get('test').addEventListener('click', () => {
    if (feature.speechSupported) feature.speak('Speech test. Object ahead.');
    else toast('Speech is unavailable in this browser. Use screen-reader announcements.');
  });

  const modeButtons = [...doc.querySelectorAll('[data-mode]')];
  function setMode(mode, userAction = false) {
    mode = mode === 'blindness' ? 'blindness' : 'normal';
    modeButtons.forEach(button => {
      const selected = button.dataset.mode === mode;
      button.classList.toggle('active', selected);
      button.setAttribute('aria-pressed', String(selected));
    });
    if (userAction) {
      store('clearpath-mode', mode);
      // An explicit click enables speech; a stored profile never starts audio.
      feature.enableSpeech(mode === 'blindness');
      if (mode === 'blindness') get('alert').value = 'voice';
      toast(mode === 'blindness' ? 'Spoken camera alerts selected. Open Camera, then Start.' : 'Normal mode selected. Spoken alerts off.');
    }
  }
  modeButtons.forEach(button => button.addEventListener('click', () => setMode(button.dataset.mode, true)));
  doc.querySelectorAll('[data-profile]').forEach(button => button.addEventListener('click', () => {
    doc.querySelectorAll('[data-profile]').forEach(profile => {
      const selected = profile === button;
      profile.classList.toggle('selected', selected);
      profile.setAttribute('aria-pressed', String(selected));
    });
    toast('Profile selected. Camera controls are accessible in either profile.');
  }));
  get('voice').addEventListener('change', event => {
    if (!event.target.checked && get('alert').value === 'voice') get('alert').value = 'vibration';
    feature.enableSpeech(event.target.checked);
  });
  get('alert').addEventListener('change', event => feature.enableSpeech(event.target.value === 'voice'));
  get('save').addEventListener('click', () => {
    store('clearpath-alert', get('alert').value);
    store('clearpath-vibrate', String(get('vibrate').checked));
    const repeatControl = get('alertRepeatCount');
    if (repeatControl) store('clearpath-alert-repeat-count', repeatControl.value);
    feature.enableSpeech(get('voice').checked || get('alert').value === 'voice');
    toast('Preferences saved. Speech and camera controls are connected.');
  });
  const alert = stored('clearpath-alert', 'vibration');
  if (['vibration', 'sound', 'voice', 'both'].includes(alert)) get('alert').value = alert;
  get('vibrate').checked = stored('clearpath-vibrate', 'true') === 'true';
  const repeatControl = get('alertRepeatCount');
  if (repeatControl) {
    repeatControl.value = String(Math.min(5, Math.max(1, Number(stored('clearpath-alert-repeat-count', '1')) || 1)));
    repeatControl.addEventListener('change', () => {
      store('clearpath-alert-repeat-count', repeatControl.value);
      feature.setRepeatCount(Number(repeatControl.value));
    });
  }
  setMode(stored('clearpath-mode', 'normal'));
  showScreen('home', false);
  return { feature, showScreen };
}

if (typeof document !== 'undefined') mountSite();
