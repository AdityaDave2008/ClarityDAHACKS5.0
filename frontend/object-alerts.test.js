import test from 'node:test';
import assert from 'node:assert/strict';
import { notifyPhone } from './phone-notifications.js';
import { createObjectAlerts, vibrationPattern } from './object-alerts.js';

function fixture(permission = 'granted') {
  const notices = [], vibrations = [];
  class NotificationApi {
    static permission = permission;
    static requestPermission() { throw new Error('Detection must not request permission'); }
    constructor() { throw new Error('Mobile notifications require a service worker'); }
  }
  const registration = { async showNotification(title, options) { notices.push({ title, options }); } };
  const platform = { Notification: NotificationApi, navigator: {
    serviceWorker: { getRegistration: async () => registration },
    vibrate(pattern) { vibrations.push(pattern); return true; },
  } };
  const prefs = { notifications: true, vibration: true, strength: 65, repeatCount: 1 };
  const alerts = createObjectAlerts({ platform, readPreferences: () => prefs });
  return { platform, notices, vibrations, prefs, alerts, registration };
}

test('confirmed alert posts one replaceable notification with the chosen vibration and no second page vibration', async () => {
  const f = fixture();
  const delivered = await f.alerts.send('Object in the camera alert zone.');
  assert.equal(delivered.notification, true);
  assert.equal(f.notices.length, 1);
  assert.equal(f.notices[0].title, 'Clarity: object ahead');
  assert.deepEqual(f.notices[0].options.vibrate, [167, 98, 167]);
  assert.equal(f.notices[0].options.data.url, '/#camera');
  assert.deepEqual(f.vibrations, []);
  await f.alerts.send('Next confirmed alert.');
  assert.equal(f.notices[0].options.tag, f.notices[1].options.tag);
});

test('vibration off makes the notification silent and omits its vibration pattern', async () => {
  const f = fixture(); f.prefs.vibration = false;
  await f.alerts.send('Object ahead.');
  assert.equal(f.notices[0].options.silent, true);
  assert.equal('vibrate' in f.notices[0].options, false);
  assert.deepEqual(f.vibrations, []);
});

test('notifications off and unsupported or denied notifications use only selected page vibration without prompting', async () => {
  for (const permission of ['default', 'denied', 'granted']) {
    const f = fixture(permission); if (permission === 'granted') f.prefs.notifications = false;
    assert.deepEqual(await f.alerts.send('Object ahead.'), { notification: false, vibration: true });
    assert.deepEqual(f.notices, []);
    assert.deepEqual(f.vibrations, [[167, 98, 167]]);
  }
  const f = fixture(); delete f.platform.Notification; delete f.platform.navigator.vibrate;
  assert.deepEqual(await f.alerts.send('Object ahead.'), { notification: false, vibration: false });
});

test('Stop or detector failure cancels pending notification lookup and vibration without late delivery', async () => {
  const f = fixture(); let resolve;
  f.platform.navigator.serviceWorker.getRegistration = () => new Promise(yes => { resolve = yes; });
  const pending = f.alerts.send('Object ahead.');
  f.alerts.cancel(); resolve(f.registration);
  await pending;
  assert.deepEqual(f.notices, []);
  assert.deepEqual(f.vibrations, [0]);
});

test('live preferences are checked again after an asynchronous worker lookup', async () => {
  const f = fixture(); let resolve;
  f.platform.navigator.serviceWorker.getRegistration = () => new Promise(yes => { resolve = yes; });
  const pending = f.alerts.send('Object ahead.');
  f.prefs.vibration = false; resolve(f.registration); await pending;
  assert.equal(f.notices[0].options.silent, true);
  assert.equal('vibrate' in f.notices[0].options, false);
  const pendingOff = f.alerts.send('Object ahead.');
  f.prefs.notifications = false; resolve(f.registration); await pendingOff;
  assert.equal(f.notices.length, 1);
});

test('notification failure falls back to vibration; test alerts carry a separate label and tag', async () => {
  const f = fixture();
  await f.alerts.send('Test alert.', { test: true });
  assert.equal(f.notices[0].title, 'Clarity: test alert');
  assert.equal(f.notices[0].options.tag, 'clarity-test-alert');
  f.registration.showNotification = async () => { throw new Error('Unavailable'); };
  assert.equal((await f.alerts.send('Object ahead.')).vibration, true);
});

test('direct notification fallback remains silent unless explicitly supplied a vibration pattern', async () => {
  const sent = [];
  class NotificationApi { static permission = 'granted'; constructor(title, options) { sent.push({ title, options }); } }
  assert.equal(await notifyPhone('Object ahead.', { Notification: NotificationApi }), true);
  assert.equal(sent[0].options.silent, true);
  assert.equal('vibrate' in sent[0].options, false);
});

test('zero strength disables vibration; repeated patterns maintain alternating pulse and pause positions', () => {
  assert.equal(vibrationPattern(0, 5), false);
  const pattern = vibrationPattern(65, 2);
  assert.deepEqual(pattern, [167, 98, 167, 200, 167, 98, 167]);
  assert.equal(pattern.length % 2, 1);
  assert.equal(vibrationPattern(100, 99).length, 19);
});
