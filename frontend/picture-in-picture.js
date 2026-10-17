// Native video PiP only. Browser/source support is checked at use time.
const NOTE = 'Picture in picture shows the camera preview only, without detection overlays. Detection pauses while this page is hidden and resumes when you return. Your browser may pause the camera too.';
const UNSUPPORTED = 'Floating live camera is not supported in this browser. Keep this page open for scanning.';

export function mountPictureInPicture({ video, button, status, doc, onChange = () => {} }) {
  let phase = 'off', pending = false, generation = 0, destroyed = false, previous = false;
  let message = '';
  const active = () => doc.pictureInPictureElement === video || video.webkitPresentationMode === 'picture-in-picture';
  function mode() {
    if (video.disablePictureInPicture) return null;
    if (typeof video.requestPictureInPicture === 'function') return doc.pictureInPictureEnabled ? 'standard' : null;
    try {
      if (video.webkitSupportsPresentationMode?.('picture-in-picture') && typeof video.webkitSetPresentationMode === 'function') return 'webkit';
    } catch { /* Unsupported MediaStream source. */ }
    return null;
  }
  const ready = () => phase === 'active' && video.readyState >= 2 && video.videoWidth > 0 && Boolean(video.srcObject);
  function render() {
    if (destroyed) return;
    const supported = mode();
    button.disabled = pending || !supported || (!active() && !ready());
    const label = active() ? 'Exit picture in picture' : 'Picture in picture';
    if (button.textContent !== label) button.textContent = label;
    button.setAttribute('aria-pressed', String(active()));
    const description = message || (supported ? NOTE : UNSUPPORTED);
    if (status.textContent !== description) status.textContent = description;
  }
  async function exit() {
    if (!active()) return;
    try {
      if (doc.pictureInPictureElement === video) await doc.exitPictureInPicture();
      else video.webkitSetPresentationMode('inline');
    } catch {
      message = 'Could not close picture in picture. Close the floating window using its browser controls.';
    }
    render();
  }
  function changed() {
    const value = active();
    if (value && (destroyed || phase !== 'active')) { void exit(); return; }
    if (value !== previous) {
      previous = value;
      onChange(value);
    }
    render();
  }
  async function toggle() {
    if (destroyed || pending) return;
    const selected = mode();
    if (!active() && (!selected || !ready())) { render(); return; }
    const run = generation;
    pending = true;
    message = '';
    render();
    try {
      if (active()) await exit();
      // Invoke before the first await to preserve the click's user activation.
      else if (selected === 'standard') await video.requestPictureInPicture();
      else video.webkitSetPresentationMode('picture-in-picture');
      if (run !== generation || destroyed || phase !== 'active') await exit();
    } catch {
      if (run === generation) message = 'Could not open live picture in picture for this camera. The preview remains inline. Keep this page open for scanning.';
    } finally {
      pending = false;
      changed();
    }
  }
  function stop() {
    generation++;
    phase = 'off';
    return exit();
  }
  const click = () => { void toggle(); };
  const events = ['enterpictureinpicture', 'leavepictureinpicture', 'webkitpresentationmodechanged'];
  events.forEach(name => video.addEventListener?.(name, changed));
  const readiness = ['loadeddata', 'emptied', 'playing'];
  readiness.forEach(name => video.addEventListener?.(name, render));
  button.addEventListener('click', click);
  render();
  return {
    get active() { return active(); },
    toggle, stop,
    update(state) { phase = state.phase; render(); },
    destroy() {
      destroyed = true;
      void stop();
      button.removeEventListener?.('click', click);
      events.forEach(name => video.removeEventListener?.(name, changed));
      readiness.forEach(name => video.removeEventListener?.(name, render));
    },
  };
}
