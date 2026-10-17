import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const root = new URL('../MyEyes/OfflineDetector/', import.meta.url);

function runtime() {
  let completeLoad;
  const messages = [];
  const model = { inputNames: ['images'], outputNames: ['predictions'] };
  const context = vm.createContext({
    window: { webkit: { messageHandlers: { detector: { postMessage: value => messages.push(value) } } } },
    ort: { env: { wasm: {} }, InferenceSession: { create: () => new Promise(resolve => { completeLoad = () => resolve(model); }) } },
  });
  vm.runInContext(readFileSync(new URL('policy.js', root), 'utf8'), context);
  vm.runInContext(readFileSync(new URL('detector.js', root), 'utf8'), context);
  return { context, messages, completeLoad: async () => { completeLoad(); await new Promise(setImmediate); }, model };
}

test('ready waits for real session creation and reset rejects incomplete loading', async () => {
  const { context, messages, completeLoad } = runtime();
  assert.equal(messages.length, 0);
  assert.equal(typeof context.window.resetOffline, 'function');
  context.window.resetOffline('early');
  assert.match(messages.pop().error, /not ready/i);
  await completeLoad();
  assert.equal(messages[0].id, 'ready');
  assert.ok(messages[0].value.backend);
});

test('warm reset keeps loaded session but clears settings, confirmation and cooldown', async () => {
  const { context, messages, completeLoad, model } = runtime();
  await completeLoad();
  vm.runInContext(`
    settingsKey = 'previous preferences';
    policy = createAlertPolicy({ cooldownMs: 3000 });
    const items = [{ label: 'cat', confidence: 0.9, inZone: true, bbox: { x: 0.3, y: 0.3, width: 0.4, height: 0.6 } }];
    policy.update(items, 100);
    policy.update(items, 101);
  `, context);
  assert.equal(vm.runInContext('policy.update(items, 102).reason', context), 'cooldown');
  assert.equal(typeof context.window.resetOffline, 'function');
  context.window.resetOffline('warm');
  assert.equal(messages.at(-1).id, 'warm');
  assert.ok(messages.at(-1).value.zone.length);
  assert.equal(vm.runInContext('detector', context), model);
  assert.equal(vm.runInContext('settingsKey', context), undefined);
  assert.equal(vm.runInContext('policy', context), undefined);
});

test('reset refuses in-flight inference without clearing its policy', async () => {
  const { context, messages, completeLoad } = runtime();
  await completeLoad();
  vm.runInContext("busy = true; settingsKey = 'keep'; policy = createAlertPolicy();", context);
  assert.equal(typeof context.window.resetOffline, 'function');
  context.window.resetOffline('busy');
  assert.match(messages.at(-1).error, /processing/i);
  assert.equal(vm.runInContext('settingsKey', context), 'keep');
  assert.equal(vm.runInContext('busy', context), true);
});
