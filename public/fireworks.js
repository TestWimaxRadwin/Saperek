'use strict';
// Pixelowe fajerwerki na canvasie dla zwycięzcy.
window.Fireworks = (() => {
  const cv = document.getElementById('fw');
  const ctx = cv.getContext('2d');
  const COLORS = ['#ffcd75', '#ef7d57', '#b13e53', '#a7f070', '#73eff7', '#41a6f6', '#f4f4f4'];
  const PX = 4;
  let parts = [], rockets = [], raf = 0, running = false, nextLaunch = 0;

  function resize() { cv.width = Math.ceil(innerWidth / PX); cv.height = Math.ceil(innerHeight / PX); }
  function launch() {
    rockets.push({ x: cv.width * (0.15 + Math.random() * 0.7), y: cv.height, vy: -(cv.height * (0.018 + Math.random() * 0.008)), top: cv.height * (0.15 + Math.random() * 0.35), c: COLORS[(Math.random() * COLORS.length) | 0] });
  }
  function burst(x, y, c) {
    const n = 40 + ((Math.random() * 30) | 0);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, v = 0.3 + Math.random() * 1.1;
      parts.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 40 + Math.random() * 30, c: Math.random() < 0.3 ? '#f4f4f4' : c });
    }
  }
  function frame(t) {
    if (!running) return;
    ctx.clearRect(0, 0, cv.width, cv.height);
    if (t > nextLaunch) { launch(); if (Math.random() < 0.4) launch(); nextLaunch = t + 350 + Math.random() * 500; }
    rockets = rockets.filter(r => {
      r.y += r.vy;
      ctx.fillStyle = '#f4f4f4'; ctx.fillRect(r.x | 0, r.y | 0, 1, 2);
      if (r.y <= r.top) { burst(r.x, r.y, r.c); return false; }
      return true;
    });
    parts = parts.filter(p => {
      p.x += p.vx; p.y += p.vy; p.vy += 0.018; p.vx *= 0.99; p.life--;
      ctx.globalAlpha = Math.min(1, p.life / 20);
      ctx.fillStyle = p.c; ctx.fillRect(p.x | 0, p.y | 0, 1, 1);
      return p.life > 0;
    });
    ctx.globalAlpha = 1;
    raf = requestAnimationFrame(frame);
  }
  function start() {
    if (running) return;
    running = true; resize(); cv.classList.remove('hidden');
    cv.style.imageRendering = 'pixelated';
    parts = []; rockets = []; nextLaunch = 0;
    raf = requestAnimationFrame(frame);
  }
  function stop() {
    if (!running) return;
    running = false; cancelAnimationFrame(raf); cv.classList.add('hidden');
  }
  window.addEventListener('resize', () => { if (running) resize(); });
  return { start, stop };
})();
