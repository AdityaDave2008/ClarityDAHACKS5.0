import { mountCamera, exposeCamera } from './camera.js';
import { createBackendDetector } from './backend-detector.js';
import { createLocalDetector } from './local-detector.js';

const colorVisionModes = ['standard', 'protanopia', 'deuteranopia', 'tritanopia', 'achromatopsia'];
const colorVisionDescriptions = {
  standard: 'Standard palette: teal and mint accents.',
  protanopia: 'Protanopia palette: blue and amber accents with a deep blue gradient.',
  deuteranopia: 'Deuteranopia palette: cyan and gold accents with a deep teal gradient.',
  tritanopia: 'Tritanopia palette: coral and rose accents with a warm plum gradient.',
  achromatopsia: 'Achromatopsia palette: high-contrast grayscale accents and gradient.',
};

function applyColorVision(mode) {
  const selected = colorVisionModes.includes(mode) ? mode : 'standard';
  document.documentElement.dataset.colorVision = selected;
  const settingsSelect = document.querySelector('#colorVision');
  if (settingsSelect) settingsSelect.value = selected;
  const settingsNote = document.querySelector('#colorVisionNote');
  if (settingsNote) settingsNote.textContent = colorVisionDescriptions[selected];
}

applyColorVision(localStorage.getItem('clearpath-color-vision'));
window.addEventListener('storage', (event) => {
  if (event.key === 'clearpath-color-vision') applyColorVision(event.newValue);
  if (event.key === 'clearpath-alert-repeat-count') window.myEyesCamera?.setRepeatCount(Number(event.newValue));
});

// Always use the bundled v1 model unless backend testing is explicitly requested.
async function chooseDetector() {
  return new URLSearchParams(location.search).get('detector') === 'backend'
    ? createBackendDetector()
    : createLocalDetector();
}

const feature = mountCamera(document.querySelector('#camera-feature'));
let depth = null;
let activeDepthContext = null;
// Optional module failures must not prevent mounting or starting v1.
import('./depth-ui.js').then(({ mountDepthUI }) => {
  depth = mountDepthUI(document.querySelector('#camera-feature'));
  if (activeDepthContext && !activeDepthContext.signal.aborted) depth?.start();
}).catch(() => {
  const status = document.querySelector('#depth-status');
  if (status) status.textContent = 'Depth unavailable. Object detection is unchanged.';
});
function depthOnly(action) { try { action(); } catch { /* Never enter v1 error handling. */ } }


// Registering happens before any camera start, because the camera feature rejects a
// detector once running. The lazy wrapper lets the page finish loading while the choice
// resolves, instead of leaving the Start button wired to nothing.
const detectorChoice = chooseDetector();
feature.registerDetector({
  async start(context) {
    const detector = await detectorChoice;
    if (context.signal.aborted) return () => {};
    activeDepthContext = context;
    depthOnly(() => depth?.start());
    const stopDepth = () => {
      if (activeDepthContext === context) {
        activeDepthContext = null;
        depthOnly(() => depth?.stop());
      }
    };
    context.signal.addEventListener('abort', stopDepth, { once: true });
    try {
      const stop = await detector.start({ ...context,
        onFrame: frame => depthOnly(() => depth?.onFrame(frame, context.video)),
      });
      return () => { stopDepth(); stop?.(); };
    } catch (error) { stopDepth(); throw error; }
  },
});
feature.setRepeatCount(Number(localStorage.getItem('clearpath-alert-repeat-count')) || 1);
exposeCamera(feature);
