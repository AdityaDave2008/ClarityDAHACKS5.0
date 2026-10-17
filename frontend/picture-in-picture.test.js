import test from 'node:test';
import assert from 'node:assert/strict';
import { createPictureInPicture } from './picture-in-picture.js';
import { cameraFrameAvailable, createVideoFrameGate } from './video-frames.js';

function fixture() {
  const listeners = {}, tasks = new Map(), states = [];
  let id = 0, hiddenExits = 0, requested = 0;
  const doc = { hidden: false, pictureInPictureElement: null, pictureInPictureEnabled: true,
    async exitPictureInPicture() { this.pictureInPictureElement = null; listeners.leavepictureinpicture?.(); } };
  const video = { addEventListener(type, fn) { listeners[type] = fn; }, removeEventListener() {},
    requestPictureInPicture() { requested++; doc.pictureInPictureElement = video; listeners.enterpictureinpicture?.(); return Promise.resolve(); } };
  const controller = createPictureInPicture({ video, doc, onChange: state => states.push(state), onHiddenExit: () => hiddenExits++,
    schedule: fn => { tasks.set(++id, fn); return id; }, unschedule: id => tasks.delete(id), platform: { navigator: { standalone: true } } });
  return { video, doc, controller, listeners, tasks, states, hiddenExits: () => hiddenExits, requested: () => requested };
}

test('user gesture enters PiP, closing while hidden requests a stop, and foreground closure does not', async () => {
  const f = fixture();
  f.controller.open();
  assert.equal(f.requested(), 1, 'Native API must run synchronously');
  await Promise.resolve();
  assert.equal(f.controller.isActive(), true);
  assert.equal(f.tasks.size, 0);
  f.controller.close();
  assert.equal(f.hiddenExits(), 0);
  f.controller.open(); await Promise.resolve();
  f.doc.hidden = true;
  f.controller.close();
  assert.equal(f.hiddenExits(), 1);
  assert.equal(f.controller.isActive(), false);
});

test('silent unsupported Home Screen PiP times out without claiming success', async () => {
  const f = fixture();
  f.video.requestPictureInPicture = () => Promise.resolve();
  f.controller.open(); await Promise.resolve();
  assert.equal(f.controller.snapshot().opening, true);
  [...f.tasks.values()][0]();
  assert.equal(f.controller.snapshot().opening, false);
  assert.match(f.controller.snapshot().message, /Home Screen.*Safari/);
  assert.equal(f.controller.isActive(), false);
});

test('a failed PiP request leaves scanning available in the foreground', async () => {
  const f = fixture();
  f.video.requestPictureInPicture = () => Promise.reject(new Error('Not supported'));
  f.controller.open(); await Promise.resolve(); await Promise.resolve();
  assert.match(f.controller.snapshot().message, /Not supported/);
  assert.equal(f.controller.snapshot().opening, false);
  assert.equal(f.hiddenExits(), 0);
});

test('a paused video is played in the original tap without delaying the PiP request', async () => {
  const f = fixture(), order = [];
  f.video.paused = true;
  f.video.play = () => { order.push('play'); return new Promise(() => {}); };
  const request = f.video.requestPictureInPicture;
  f.video.requestPictureInPicture = () => { order.push('pip'); return request(); };
  f.controller.open();
  assert.deepEqual(order, ['play', 'pip']);
  await Promise.resolve();
  assert.equal(f.controller.snapshot().playback, 'paused');
  assert.equal(f.controller.snapshot().canResume, true);
});

test('paused playback is reported and resumes only on an explicit tap', async () => {
  const f = fixture(); let plays = 0;
  f.video.play = async () => { plays++; f.video.paused = false; f.listeners.playing(); };
  f.controller.open(); await Promise.resolve();
  f.video.paused = true; f.listeners.pause();
  assert.equal(plays, 0, 'Respect pauses; no automatic playback loop');
  assert.match(f.states.at(-1).message, /playback is paused/);
  f.controller.resume(); await Promise.resolve();
  assert.equal(plays, 1);
  assert.equal(f.controller.snapshot().playback, 'playing');
  assert.equal(f.controller.snapshot().canResume, false);
});

test('an interrupted or stopped camera source is distinguished from paused playback', async () => {
  const f = fixture(), events = {};
  const track = { readyState: 'live', muted: false,
    addEventListener(type, fn) { events[type] = fn; }, removeEventListener(type) { delete events[type]; } };
  f.video.srcObject = { getVideoTracks: () => [track] };
  f.video.paused = true; f.video.play = async () => {};
  f.controller.open(); await Promise.resolve();
  track.muted = true; events.mute();
  assert.equal(f.states.at(-1).playback, 'interrupted');
  assert.match(f.states.at(-1).message, /browser interrupted/);
  assert.equal(f.controller.snapshot().canResume, false);
  track.readyState = 'ended'; events.ended();
  assert.equal(f.controller.snapshot().playback, 'ended');
  f.controller.close();
  assert.deepEqual(events, {});
});

test('a rejected resume reports a recovery message without claiming playback', async () => {
  const f = fixture();
  f.controller.open(); await Promise.resolve();
  f.video.paused = true;
  f.video.play = () => Promise.reject(new Error('NotAllowedError'));
  f.controller.resume(); await Promise.resolve(); await Promise.resolve();
  assert.equal(f.controller.snapshot().playback, 'paused');
  assert.match(f.controller.snapshot().message, /could not resume/);
});

test('a delayed PiP entry after the no-op timeout is accepted rather than closed', async () => {
  const f = fixture(); let resolve;
  f.video.requestPictureInPicture = () => new Promise(yes => { resolve = yes; });
  f.controller.open(); [...f.tasks.values()][0]();
  assert.match(f.controller.snapshot().message, /did not open/);
  f.doc.pictureInPictureElement = f.video;
  f.listeners.enterpictureinpicture(); resolve();
  await Promise.resolve(); await Promise.resolve();
  assert.equal(f.controller.isActive(), true);
  assert.equal(f.controller.snapshot().opening, false);
});

test('Stop cancels a pending PiP request and closes its late popup', async () => {
  const f = fixture(); let resolve;
  f.video.requestPictureInPicture = () => new Promise(yes => { resolve = yes; });
  f.controller.open(); f.controller.close();
  f.doc.pictureInPictureElement = f.video; resolve();
  await Promise.resolve(); await Promise.resolve();
  assert.equal(f.controller.isActive(), false);
});

test('a canceled earlier request cannot close a newer floating camera', async () => {
  const f = fixture(); let resolve;
  f.video.requestPictureInPicture = () => new Promise(yes => { resolve = yes; });
  f.controller.open(); f.controller.close();
  f.video.requestPictureInPicture = () => { f.doc.pictureInPictureElement = f.video; return Promise.resolve(); };
  f.controller.open(); await Promise.resolve(); resolve(); await Promise.resolve();
  assert.equal(f.controller.isActive(), true);
  f.controller.close();
});

test('camera freshness rejects repeated, muted, ended and unready frames and resets for a new source', () => {
  const track = { muted: false, readyState: 'live' };
  const video = { currentTime: 1, readyState: 4, srcObject: { getVideoTracks: () => [track] } };
  const fresh = createVideoFrameGate();
  assert.equal(fresh(video), true);
  assert.equal(fresh(video), false);
  video.currentTime = 2; track.muted = true; assert.equal(fresh(video), false);
  track.muted = false; assert.equal(fresh(video), true);
  track.readyState = 'ended'; assert.equal(cameraFrameAvailable(video), false);
  track.readyState = 'live'; video.readyState = 1; assert.equal(fresh(video), false);
  video.readyState = 4; video.srcObject = { getVideoTracks: () => [track] };
  assert.equal(fresh(video), true);
  video.currentTime = 3; video.paused = true; assert.equal(fresh(video), false);
  video.paused = false; assert.equal(fresh(video), true);
  video.ended = true; assert.equal(cameraFrameAvailable(video), false);
  video.ended = false; video.error = { code: 3 }; assert.equal(cameraFrameAvailable(video), false);
});

import * as pipModule from './picture-in-picture.js';

function previewFixture({ supported = true, legacy = false } = {}) {
  const video = new EventTarget();
  const button = new EventTarget();
  button.attrs = {};
  button.setAttribute = (key, value) => { button.attrs[key] = value; };
  const status = { textContent: '' };
  const doc = { pictureInPictureEnabled: supported && !legacy, pictureInPictureElement: null };
  let enters = 0, exits = 0;
  Object.assign(video, { readyState: 2, videoWidth: 640, srcObject: {}, webkitPresentationMode: 'inline' });
  if (supported && !legacy) video.requestPictureInPicture = async () => {
    enters++; doc.pictureInPictureElement = video; video.dispatchEvent(new Event('enterpictureinpicture'));
  };
  doc.exitPictureInPicture = async () => {
    exits++; doc.pictureInPictureElement = null; video.dispatchEvent(new Event('leavepictureinpicture'));
  };
  if (legacy) {
    video.webkitSupportsPresentationMode = mode => mode === 'picture-in-picture';
    video.webkitSetPresentationMode = mode => {
      if (mode === 'picture-in-picture') enters++; else exits++;
      video.webkitPresentationMode = mode;
      video.dispatchEvent(new Event('webkitpresentationmodechanged'));
    };
  }
  const changes = [];
  assert.equal(typeof pipModule.mountPictureInPicture, 'function');
  const pip = pipModule.mountPictureInPicture({ video, button, status, doc, onChange: active => changes.push(active) });
  pip.update({ phase: 'active' });
  return { pip, video, button, status, doc, changes, counts: () => ({ enters, exits }) };
}

test('native PiP enters only on explicit action, reports browser state, and exits owned video', async () => {
  const f = previewFixture();
  assert.deepEqual(f.counts(), { enters: 0, exits: 0 });
  await f.pip.toggle();
  assert.equal(f.pip.active, true);
  assert.equal(f.button.attrs['aria-pressed'], 'true');
  assert.match(f.status.textContent, /preview only/i);
  await f.pip.toggle();
  assert.equal(f.pip.active, false);
  assert.deepEqual(f.counts(), { enters: 1, exits: 1 });
  f.pip.destroy();
});

test('unsupported live PiP remains inline with truthful fallback', async () => {
  const f = previewFixture({ supported: false });
  assert.equal(f.button.disabled, true);
  assert.match(f.status.textContent, /not supported.*keep this page open/i);
  await f.pip.toggle();
  assert.deepEqual(f.counts(), { enters: 0, exits: 0 });
});

test('not-ready and stopped camera cannot request PiP', async () => {
  const f = previewFixture();
  f.video.readyState = 0;
  f.pip.update({ phase: 'active' });
  await f.pip.toggle();
  assert.equal(f.button.disabled, true);
  f.video.readyState = 2;
  f.pip.update({ phase: 'off' });
  await f.pip.toggle();
  assert.deepEqual(f.counts(), { enters: 0, exits: 0 });
});

test('source rejection is nonfatal and can retry without changing camera stream', async () => {
  const f = previewFixture();
  const stream = f.video.srcObject;
  f.video.requestPictureInPicture = async () => { throw new Error('unsupported source'); };
  await f.pip.toggle();
  assert.equal(f.pip.active, false);
  assert.match(f.status.textContent, /could not.*inline/i);
  assert.equal(f.video.srcObject, stream);
  assert.equal(f.button.disabled, false);
});

test('pending entry is serialized and late success after stop is closed', async () => {
  const f = previewFixture();
  let finish;
  let requests = 0;
  f.video.requestPictureInPicture = () => { requests++; return new Promise(resolve => { finish = resolve; }); };
  const entering = f.pip.toggle();
  await f.pip.toggle();
  assert.equal(requests, 1);
  f.pip.stop();
  f.doc.pictureInPictureElement = f.video;
  finish();
  await entering;
  assert.equal(f.pip.active, false);
  assert.equal(f.counts().exits, 1);
});

test('stop and destroy never close another video PiP', async () => {
  const f = previewFixture();
  f.doc.pictureInPictureElement = {};
  await f.pip.stop();
  f.pip.destroy();
  assert.equal(f.counts().exits, 0);
});

test('external close updates pressed state and notifies lifecycle owner', async () => {
  const f = previewFixture();
  await f.pip.toggle();
  f.doc.pictureInPictureElement = null;
  f.video.dispatchEvent(new Event('leavepictureinpicture'));
  assert.equal(f.button.attrs['aria-pressed'], 'false');
  assert.deepEqual(f.changes, [true, false]);
});

test('legacy Safari presentation mode is used only when supported for this video', async () => {
  const f = previewFixture({ legacy: true });
  await f.pip.toggle();
  assert.equal(f.pip.active, true);
  await f.pip.stop();
  assert.equal(f.video.webkitPresentationMode, 'inline');
  assert.deepEqual(f.counts(), { enters: 1, exits: 1 });
});

test('failed exit is caught and does not claim the native window closed', async () => {
  const f = previewFixture();
  await f.pip.toggle();
  f.doc.exitPictureInPicture = async () => { throw new Error('denied'); };
  await f.pip.toggle();
  assert.equal(f.pip.active, true);
  assert.match(f.status.textContent, /close.*window/i);
});

test('per-frame camera updates do not repeat unchanged live-region announcements', () => {
  const f = previewFixture();
  let writes = 0;
  let text = f.status.textContent;
  Object.defineProperty(f.status, 'textContent', {
    get: () => text,
    set: value => { text = value; writes++; },
  });
  f.pip.update({ phase: 'active' });
  f.pip.update({ phase: 'active' });
  assert.equal(writes, 0);
});
