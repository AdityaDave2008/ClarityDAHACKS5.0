import { mountCamera, exposeCamera } from './camera.js';
import { createBackendDetector } from './backend-detector.js';

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
  if (event.key === 'clearpath-alert-repeat-count') window.clearPathCamera?.setRepeatCount(Number(event.newValue));
});

const feature = mountCamera(document.querySelector('#camera-feature'));
feature.registerDetector(createBackendDetector());
feature.setRepeatCount(Number(localStorage.getItem('clearpath-alert-repeat-count')) || 1);
exposeCamera(feature);
