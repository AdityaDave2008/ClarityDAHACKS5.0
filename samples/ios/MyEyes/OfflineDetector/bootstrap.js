'use strict';
window.addEventListener('error', event => {
  window.webkit.messageHandlers.detector.postMessage({ id: 'ready', error: event.message + ' at ' + event.filename + ':' + event.lineno });
});
window.addEventListener('unhandledrejection', event => {
  window.webkit.messageHandlers.detector.postMessage({ id: 'ready', error: String(event.reason) });
});
window.offlineDiagnostics = [];
for (const level of ['warn', 'error']) {
  const original = console[level];
  console[level] = (...args) => { window.offlineDiagnostics.push(args.map(String).join(' ')); original.apply(console, args); };
}
