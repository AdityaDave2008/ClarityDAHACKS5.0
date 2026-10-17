import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { mountSite } from './site.js';

function fixture(saved = {}) {
  function node(id) {
    const classes = new Set();
    const listeners = {};
    return { id, dataset: {}, hidden: false, checked: false, value: '', attrs: {}, textContent: '', listeners,
      classList: { add: value => classes.add(value), remove: value => classes.delete(value),
        toggle(value, active) { if (active) classes.add(value); else classes.delete(value); }, contains: value => classes.has(value) },
      addEventListener(name, fn) { (listeners[name] ??= []).push(fn); },
      fire(name) { for (const fn of listeners[name] || []) fn({ target: this }); },
      setAttribute(key, value) { this.attrs[key] = value; }, removeAttribute(key) { delete this.attrs[key]; },
      focus() { this.focused = true; }, querySelector() { return this.heading; }, async play() {}, pause() {} };
  }
  const nodes = new Map();
  const get = id => { if (!nodes.has(id)) nodes.set(id, node(id)); return nodes.get(id); };
  const screens = ['home', 'camera', 'settings'].map(id => { const screen = get(id); screen.heading = node(`${id}-heading`); return screen; });
  const nav = screens.map(screen => { const button = node(`nav-${screen.id}`); button.dataset.screen = screen.id; return button; });
  const modes = ['normal', 'blindness'].map(mode => { const button = node(mode); button.dataset.mode = mode; return button; });
  const profiles = [node('everyday'), node('accessibility')];
  const docListeners = {}, windowListeners = {};
  const doc = { getElementById: get, querySelectorAll: selector => ({ '.screen': screens, '.nav-btn': nav, '[data-mode]': modes, '[data-profile]': profiles }[selector]),
    body: node('body'), hidden: false, addEventListener(name, fn) { docListeners[name] = fn; } };
  get('camera-panel').querySelector = selector => get(selector.slice(1));
  get('camera-panel').ownerDocument = doc;
  const spoken = [], calls = [];
  const track = { stopped: false, stop() { this.stopped = true; }, addEventListener() {} };
  const platform = { navigator: { mediaDevices: { async getUserMedia() { calls.push('camera'); return { getTracks: () => [track] }; } } },
    isSecureContext: true, location: { search: '' }, scrollTo() {},
    speechSynthesis: { cancel() {}, getVoices: () => [], speak(value) { spoken.push(value.text); } },
    SpeechSynthesisUtterance: class { constructor(text) { this.text = text; } },
    localStorage: { getItem: key => saved[key], setItem: (key, value) => { saved[key] = value; } },
    addEventListener(name, fn) { (windowListeners[name] ??= []).push(fn); }, dispatchEvent(event) { for (const fn of windowListeners[event.type] || []) fn(event); } };
  let detectionContext;
  const detector = { async start(context) { detectionContext = context; } };
  const site = mountSite(doc, platform, detector);
  const cleanup = () => { site.feature.destroy(); }; // Timers below clear on navigation.
  return { ...site, doc, platform, get, nav, modes, calls, track, spoken, cleanup, context: () => detectionContext };
}

test('combined site preserves three tabs and opens camera without automatically requesting access', async () => {
  const f = fixture();
  assert.equal(f.get('home').hidden, false);
  assert.equal(f.get('camera').hidden, true);
  f.get('start').fire('click');
  assert.equal(f.get('camera').hidden, false);
  assert.equal(f.get('home').hidden, true);
  assert.equal(f.calls.length, 0);
  assert.equal(f.nav[1].attrs['aria-current'], 'page');
  assert.equal(f.get('camera').heading.focused, true);
  await f.feature.start();
  f.showScreen('settings');
  assert.equal(f.track.stopped, true);
  assert.equal(f.context().signal.aborted, true);
  f.showScreen('camera');
  assert.equal(f.feature.state.phase, 'off');
  f.cleanup();
});

test('existing blindness control explicitly enables speech; stored preference never speaks on load', () => {
  const f = fixture({ 'clearpath-mode': 'blindness', 'clearpath-alert': 'voice' });
  assert.equal(f.feature.state.speechEnabled, false);
  assert.equal(f.spoken.length, 0);
  assert.equal(f.modes[1].attrs['aria-pressed'], 'true');
  f.modes[1].fire('click');
  assert.equal(f.feature.state.speechEnabled, true);
  assert.equal(f.feature.state.announcements, 'app-voice');
  assert.equal(f.get('voice').checked, true);
  f.showScreen('camera');
  f.modes[0].fire('click');
  assert.equal(f.feature.state.speechEnabled, false);
  f.showScreen('settings');
  f.cleanup();
});

test('Settings and camera speech controls stay synchronized; storage failure is recoverable', () => {
  const f = fixture();
  f.platform.localStorage.setItem = () => { throw new Error('Storage blocked'); };
  f.get('voice').checked = true;
  f.get('voice').fire('change');
  assert.equal(f.feature.state.speechEnabled, true);
  f.feature.enableSpeech(false);
  assert.equal(f.get('voice').checked, false);
  f.get('alert').value = 'voice';
  f.get('alert').fire('change');
  assert.equal(f.feature.state.speechEnabled, true);
  f.get('voice').checked = false;
  f.get('voice').fire('change');
  assert.equal(f.get('alert').value, 'vibration');
  f.get('save').fire('click');
  assert.equal(f.feature.state.speechEnabled, false);
  f.showScreen('camera');
  f.cleanup();
});

test('combined HTML has one camera, unique IDs, camera labels, and the integrated module entry', async () => {
  const html = await readFile(new URL('./index.html', import.meta.url), 'utf8');
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
  assert.equal(new Set(ids).size, ids.length);
  assert.equal((html.match(/<video\b/g) || []).length, 1);
  assert.match(html, /Eyes up\./);
  assert.match(html, /data-mode="blindness"/);
  for (const id of ['camera-announcements', 'camera-cooldown']) assert.match(html, new RegExp(`label for="${id}"`));
  assert.match(html, /id="camera-feature"/);
  assert.match(html, /src="standalone.js"/);
  assert.match(html, /id="camera-start"[^>]*aria-describedby="permission-help"/);
});

test('Settings vibration cues use the shared obstacle handler and cancel on detection failure', async () => {
  const f = fixture();
  const vibration = [];
  f.platform.navigator.vibrate = pattern => vibration.push(pattern);
  f.get('alert').value = 'vibration';
  f.get('vibrate').checked = true;
  f.showScreen('camera');
  await f.feature.start();
  f.context().onObstacle();
  assert.deepEqual(vibration.at(-1), [120, 70, 180]);
  f.context().onError();
  assert.equal(vibration.at(-1), 0);
  assert.equal(f.feature.state.obstacle, '');
  assert.equal(f.feature.state.phase, 'active');
  f.cleanup();
});
