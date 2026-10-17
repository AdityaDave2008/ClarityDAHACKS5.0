const root = document.documentElement;
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const offscreen = { x: -1000, y: -1000 };
const current = { ...offscreen };
const target = { ...offscreen };
let animationFrame = 0;

function applyPosition() {
  root.style.setProperty('--cursor-x', `${current.x.toFixed(1)}px`);
  root.style.setProperty('--cursor-y', `${current.y.toFixed(1)}px`);
}

function animate() {
  animationFrame = 0;
  current.x += (target.x - current.x) * 0.18;
  current.y += (target.y - current.y) * 0.18;
  applyPosition();

  if (Math.abs(target.x - current.x) > 0.2 || Math.abs(target.y - current.y) > 0.2) {
    animationFrame = window.requestAnimationFrame(animate);
  }
}

function moveGlow(event) {
  target.x = event.clientX;
  target.y = event.clientY;

  if (reducedMotion) {
    current.x = target.x;
    current.y = target.y;
    applyPosition();
    return;
  }

  if (!animationFrame) animationFrame = window.requestAnimationFrame(animate);
}

function resetGlow() {
  target.x = offscreen.x;
  target.y = offscreen.y;
  if (reducedMotion) {
    current.x = target.x;
    current.y = target.y;
    applyPosition();
  } else if (!animationFrame) {
    animationFrame = window.requestAnimationFrame(animate);
  }
}

window.addEventListener('pointermove', moveGlow, { passive: true });
window.addEventListener('pointerdown', moveGlow, { passive: true });
window.addEventListener('blur', resetGlow);
