import { mountCamera, exposeCamera } from './camera.js';
import { createBackendDetector } from './backend-detector.js';

const feature = mountCamera(document.querySelector('#camera-feature'));
feature.registerDetector(createBackendDetector());
exposeCamera(feature);
