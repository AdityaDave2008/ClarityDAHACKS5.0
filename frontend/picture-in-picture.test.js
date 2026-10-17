import test from 'node:test';
import assert from 'node:assert/strict';
import * as pipModule from './picture-in-picture.js';

function fixture({ supported = true, legacy = false } = {}) {
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
  const f = fixture();
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
  const f = fixture({ supported: false });
  assert.equal(f.button.disabled, true);
  assert.match(f.status.textContent, /not supported.*keep this page open/i);
  await f.pip.toggle();
  assert.deepEqual(f.counts(), { enters: 0, exits: 0 });
});

test('not-ready and stopped camera cannot request PiP', async () => {
  const f = fixture();
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
  const f = fixture();
  const stream = f.video.srcObject;
  f.video.requestPictureInPicture = async () => { throw new Error('unsupported source'); };
  await f.pip.toggle();
  assert.equal(f.pip.active, false);
  assert.match(f.status.textContent, /could not.*inline/i);
  assert.equal(f.video.srcObject, stream);
  assert.equal(f.button.disabled, false);
});

test('pending entry is serialized and late success after stop is closed', async () => {
  const f = fixture();
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
  const f = fixture();
  f.doc.pictureInPictureElement = {};
  await f.pip.stop();
  f.pip.destroy();
  assert.equal(f.counts().exits, 0);
});

test('external close updates pressed state and notifies lifecycle owner', async () => {
  const f = fixture();
  await f.pip.toggle();
  f.doc.pictureInPictureElement = null;
  f.video.dispatchEvent(new Event('leavepictureinpicture'));
  assert.equal(f.button.attrs['aria-pressed'], 'false');
  assert.deepEqual(f.changes, [true, false]);
});

test('legacy Safari presentation mode is used only when supported for this video', async () => {
  const f = fixture({ legacy: true });
  await f.pip.toggle();
  assert.equal(f.pip.active, true);
  await f.pip.stop();
  assert.equal(f.video.webkitPresentationMode, 'inline');
  assert.deepEqual(f.counts(), { enters: 1, exits: 1 });
});

test('failed exit is caught and does not claim the native window closed', async () => {
  const f = fixture();
  await f.pip.toggle();
  f.doc.exitPictureInPicture = async () => { throw new Error('denied'); };
  await f.pip.toggle();
  assert.equal(f.pip.active, true);
  assert.match(f.status.textContent, /close.*window/i);
});

test('per-frame camera updates do not repeat unchanged live-region announcements', () => {
  const f = fixture();
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
