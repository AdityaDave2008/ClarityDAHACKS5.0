// Video PiP is requested in the original user gesture. Continued scanning is
// allowed only while the browser reports an active floating camera window.
export function isPictureInPicture(video, doc) {
  return doc.pictureInPictureElement === video || video.webkitPresentationMode === 'picture-in-picture';
}

export function requestVideoPiP(video, doc) {
  try {
    if (video.requestPictureInPicture && doc.pictureInPictureEnabled !== false) return Promise.resolve(video.requestPictureInPicture());
    if (video.webkitSupportsPresentationMode?.('picture-in-picture') && video.webkitSetPresentationMode) {
      video.webkitSetPresentationMode('picture-in-picture');
      return Promise.resolve();
    }
  } catch (error) { return Promise.reject(error); }
  return Promise.reject(new Error('This browser does not offer a floating camera. Try opening this website directly in Safari.'));
}

export function createPictureInPicture({ video, doc, platform = globalThis, onChange = () => {},
  onHiddenExit = () => {}, timeoutMs = 3000,
  schedule = (callback, ms) => setTimeout(callback, ms), unschedule = timer => clearTimeout(timer) }) {
  let generation = 0, lastOpenToken = 0, timer, opening = false;
  let track, resumeError = '';
  let message = 'Start scanning, enable spoken alerts, then open the floating camera before switching apps.';
  const isActive = () => isPictureInPicture(video, doc);
  const playback = () => {
    const source = video.srcObject?.getVideoTracks?.()[0];
    if (video.error) return 'error';
    if (video.srcObject === null || source?.readyState === 'ended') return 'ended';
    if (source?.muted) return 'interrupted';
    if (video.paused === true) return 'paused';
    if (Number.isFinite(video.readyState) && video.readyState < 2) return 'waiting';
    return 'playing';
  };
  const snapshot = () => {
    const active = isActive(), state = playback();
    let status = message;
    if (active) {
      status = state === 'paused' ? 'Floating window open, but camera playback is paused. Tap Resume camera below in Safari.'
        : state === 'interrupted' ? 'Floating window open, but the browser interrupted the camera feed. Return to Safari to resume scanning.'
        : state === 'ended' || state === 'error' ? 'Floating window open, but the camera source stopped. Return to Safari and restart scanning.'
        : state === 'waiting' ? 'Floating window open. Waiting for camera video; detection needs fresh frames.'
        : 'Floating camera open. Check that the picture moves and new alerts play before switching apps.';
      if (resumeError) status = resumeError;
    }
    return { active, opening, playback: state, canResume: active && state === 'paused', message: status };
  };
  const publish = () => onChange(snapshot());
  const mediaChanged = () => { resumeError = ''; publish(); };
  const trackEvents = ['mute', 'unmute', 'ended'];
  const watchTrack = source => {
    if (track === source) return;
    trackEvents.forEach(type => track?.removeEventListener?.(type, mediaChanged));
    track = source;
    trackEvents.forEach(type => track?.addEventListener?.(type, mediaChanged));
  };
  const modeChanged = () => {
    if (isActive()) {
      unschedule(timer); opening = false;
      watchTrack(video.srcObject?.getVideoTracks?.()[0]);
    } else {
      watchTrack(null);
      message = 'Floating camera closed. Keep this page visible to scan.';
    }
    publish();
    if (doc.hidden && !isActive()) onHiddenExit();
  };
  const eventTypes = ['enterpictureinpicture', 'leavepictureinpicture', 'webkitpresentationmodechanged'];
  eventTypes.forEach(type => video.addEventListener?.(type, modeChanged));
  const mediaEvents = ['pause', 'playing', 'waiting', 'loadeddata', 'error'];
  mediaEvents.forEach(type => video.addEventListener?.(type, mediaChanged));
  function close() {
    generation++; opening = false; unschedule(timer);
    resumeError = ''; watchTrack(null);
    message = 'Floating camera closed. Keep this page visible to scan.';
    try {
      if (doc.pictureInPictureElement === video) void Promise.resolve(doc.exitPictureInPicture()).catch(() => {});
      else if (video.webkitPresentationMode === 'picture-in-picture') video.webkitSetPresentationMode('inline');
    } catch { /* Stopping the source also releases the floating camera. */ }
    publish();
  }
  function resume() {
    if (!snapshot().canResume) return;
    const token = generation;
    resumeError = '';
    // An explicit tap can resume playback. Never loop play() on pause events:
    // they may be an intentional user pause or an OS camera interruption.
    try {
      void Promise.resolve(video.play()).then(() => {
        if (token === generation) publish();
      }).catch(() => {
        if (token !== generation) return;
        resumeError = 'The browser could not resume camera playback. Return to Safari and restart scanning.';
        publish();
      });
    } catch {
      resumeError = 'The browser could not resume camera playback. Return to Safari and restart scanning.';
      publish();
    }
  }
  function open() {
    if (opening || isActive()) return;
    const token = ++generation;
    lastOpenToken = token;
    opening = true;
    resumeError = '';
    watchTrack(video.srcObject?.getVideoTracks?.()[0]);
    message = 'Opening floating camera…';
    publish();
    timer = schedule(() => {
      if (token !== generation) return;
      opening = false;
      if (isActive()) modeChanged();
      else {
        const standalone = platform.navigator?.standalone === true || platform.matchMedia?.('(display-mode: standalone)').matches;
        message = standalone
          ? 'The floating camera did not open in this Home Screen app. Open the same URL directly in Safari.'
          : 'The floating camera did not open. Keep this page visible, or try Safari on a supported device.';
        publish();
      }
    }, timeoutMs);
    // Preserve the original tap for both APIs; awaiting play() first can lose
    // the user activation required by PiP. A delayed PiP entry is still valid.
    try { if (video.paused === true) void Promise.resolve(video.play()).catch(() => {}); } catch { /* Report actual playback state. */ }
    void requestVideoPiP(video, doc).then(() => {
      if (token !== generation) { if (token === lastOpenToken && isActive()) close(); return; }
      if (isActive()) modeChanged(); // Resolved API calls alone are not success.
    }).catch(error => {
      if (token !== generation) return;
      unschedule(timer); opening = false;
      message = `${error?.message || 'Floating camera unavailable.'} Keep this page visible, or open it directly in Safari.`;
      publish();
    });
  }
  return { isActive, snapshot, open, close, resume, destroy() {
    close(); eventTypes.forEach(type => video.removeEventListener?.(type, modeChanged));
    mediaEvents.forEach(type => video.removeEventListener?.(type, mediaChanged));
  } };
}

// Retain the preview-only binding API for existing consumers.
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
