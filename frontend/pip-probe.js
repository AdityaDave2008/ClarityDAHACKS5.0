// Evidence for an isolated PiP experiment; never treats a floating video alone as
// proof that camera capture, inference, or audible alerts continue.
export { isPictureInPicture as pipActive, requestVideoPiP as enterPiP } from './picture-in-picture.js';

export function mayContinue(hidden, activePiP) { return !hidden || activePiP; }

export function createPiPProbe({ now = () => performance.now() } = {}) {
  const started = now();
  const events = [];
  const counts = { freshInputs: 0, results: 0, obstacleAlerts: 0, speechCompleted: 0,
    hiddenInputs: 0, hiddenResults: 0, hiddenObstacleAlerts: 0, hiddenSpeechCompleted: 0 };
  let lastVideoTime = -1;
  function record(type, { hidden = false, pip = false, detail = '' } = {}) {
    const key = { input: 'freshInputs', result: 'results', obstacle: 'obstacleAlerts', speech: 'speechCompleted' }[type];
    if (key) counts[key]++;
    const hiddenKey = { input: 'hiddenInputs', result: 'hiddenResults', obstacle: 'hiddenObstacleAlerts', speech: 'hiddenSpeechCompleted' }[type];
    if (hidden && pip && hiddenKey) counts[hiddenKey]++;
    events.push({ seconds: Math.round((now() - started) / 100) / 10, type, hidden, pip, detail });
    if (events.length > 120) events.shift();
  }
  function acceptInput({ currentTime, readyState, muted, trackState, hidden, pip }) {
    if (!mayContinue(hidden, pip) || muted || trackState !== 'live' || readyState < 2 ||
        !Number.isFinite(currentTime) || currentTime <= lastVideoTime) return false;
    lastVideoTime = currentTime;
    record('input', { hidden, pip, detail: `video time ${currentTime.toFixed(3)}` });
    return true;
  }
  return { record, acceptInput, snapshot: () => ({
    elapsedSeconds: Math.round((now() - started) / 1000), counts: { ...counts }, events: events.map(event => ({ ...event })),
    limitation: 'Counters do not prove physical scene accuracy or that a person heard/felt an alert. Confirm with a new physical object while another app is foregrounded.',
  }) };
}
