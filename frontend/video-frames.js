export function cameraFrameAvailable(video) {
  if (video.paused === true || video.ended === true || video.error) return false;
  if (Number.isFinite(video.readyState) && video.readyState < 2) return false;
  const track = video.srcObject?.getVideoTracks?.()[0];
  return !track || (!track.muted && track.readyState === 'live');
}

// A model may finish while the video clock is frozen. Never repeatedly analyze
// the last camera picture as new evidence for another obstacle alert.
export function createVideoFrameGate() {
  let lastTime = null, lastSource;
  return video => {
    if (!cameraFrameAvailable(video)) return false;
    if (video.srcObject !== lastSource) { lastSource = video.srcObject; lastTime = null; }
    // Non-DOM test/adaptor videos may omit the media clock entirely.
    if (video.currentTime === undefined) return true;
    const time = video.currentTime;
    if (!Number.isFinite(time) || time === lastTime) return false;
    lastTime = time;
    return true;
  };
}
