'use strict';
// Muzyka i efekty 8-bit generowane w locie (WebAudio) — bez plików dźwiękowych.
window.Sound = (() => {
  let ctx = null, master, musicBus, sfxBus, noiseBuf, sched = null, step = 0, nextT = 0;
  let muted = false;
  try { muted = localStorage.getItem('saper_mute') === '1'; } catch (e) {}

  const mf = m => 440 * Math.pow(2, (m - 69) / 12);
  const SP = 60 / 150 / 2; // ósemka przy 150 BPM
  const chords = [[57, 60, 64], [53, 57, 60], [60, 64, 67], [55, 59, 62]]; // Am F C G
  const roots = [45, 41, 48, 43];
  const arp = [0, 1, 2, 1, 0, 1, 2, 1];
  const mel = [
    76, 0, 74, 72, 0, 69, 0, 72,
    77, 0, 76, 74, 0, 72, 0, 69,
    79, 0, 76, 72, 0, 76, 0, 79,
    74, 0, 71, 0, 67, 0, 71, 74,
  ];

  function init() {
    if (ctx) return true;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    ctx = new AC();
    master = ctx.createGain(); master.gain.value = muted ? 0 : 1; master.connect(ctx.destination);
    musicBus = ctx.createGain(); musicBus.gain.value = 0.55; musicBus.connect(master);
    sfxBus = ctx.createGain(); sfxBus.gain.value = 0.9; sfxBus.connect(master);
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return true;
  }
  function tone(t, f, d, type, vol, bus, slide) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(f, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(slide, t + d);
    g.gain.setValueAtTime(vol, t);
    g.gain.setValueAtTime(vol, t + d * 0.6);
    g.gain.exponentialRampToValueAtTime(0.0001, t + d);
    o.connect(g); g.connect(bus); o.start(t); o.stop(t + d + 0.03);
  }
  function noise(t, d, vol, bus, f0, f1) {
    const s = ctx.createBufferSource(), g = ctx.createGain(), fl = ctx.createBiquadFilter();
    s.buffer = noiseBuf; fl.type = 'lowpass';
    fl.frequency.setValueAtTime(f0, t); fl.frequency.exponentialRampToValueAtTime(f1, t + d);
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + d);
    s.connect(fl); fl.connect(g); g.connect(bus); s.start(t); s.stop(t + d + 0.03);
  }

  function playStep(s, t) {
    const bar = (s >> 3) & 3, k = s & 7, ch = chords[bar];
    tone(t, mf(ch[arp[k]] + 12), SP * 0.9, 'square', 0.04, musicBus);
    if (mel[s]) tone(t, mf(mel[s]), SP * 1.6, 'square', 0.06, musicBus);
    if (!(k & 1)) tone(t, mf(roots[bar] + (k === 4 ? 7 : 0)), SP * 1.8, 'triangle', 0.2, musicBus);
    if (k === 0 || k === 4) tone(t, 140, 0.12, 'sine', 0.35, musicBus, 40);
    if (k === 2 || k === 6) noise(t, 0.09, 0.09, musicBus, 6000, 1500);
    else noise(t, 0.03, 0.025, musicBus, 9000, 6000);
  }
  function schedule() {
    while (nextT < ctx.currentTime + 0.3) { playStep(step % 32, nextT); nextT += SP; step++; }
  }

  function start() {
    if (!init()) return;
    if (ctx.state === 'suspended') ctx.resume();
    if (!sched) { nextT = ctx.currentTime + 0.1; sched = setInterval(schedule, 60); }
  }
  function setMuted(m) {
    muted = m;
    try { localStorage.setItem('saper_mute', m ? '1' : '0'); } catch (e) {}
    if (ctx) master.gain.setTargetAtTime(m ? 0 : 1, ctx.currentTime, 0.02);
    if (!m) start();
  }

  const fx = {
    click: t => tone(t, 520, 0.05, 'square', 0.15, sfxBus),
    reveal: t => { tone(t, 420, 0.06, 'square', 0.15, sfxBus); tone(t + 0.06, 640, 0.08, 'square', 0.15, sfxBus); },
    flag: t => tone(t, 300, 0.09, 'square', 0.18, sfxBus, 600),
    unflag: t => tone(t, 500, 0.09, 'square', 0.18, sfxBus, 250),
    place: t => tone(t, 200, 0.07, 'triangle', 0.3, sfxBus, 120),
    turn: t => { tone(t, 660, 0.08, 'square', 0.15, sfxBus); tone(t + 0.1, 880, 0.12, 'square', 0.15, sfxBus); },
    tick: t => tone(t, 1000, 0.04, 'square', 0.12, sfxBus),
    start: t => [392, 523, 659, 784].forEach((f, i) => tone(t + i * 0.09, f, 0.12, 'square', 0.15, sfxBus)),
    boom: t => { noise(t, 0.9, 0.7, sfxBus, 4000, 80); tone(t, 110, 0.7, 'sawtooth', 0.3, sfxBus, 30); },
    win: t => [523, 659, 784, 1047, 784, 1047].forEach((f, i) => tone(t + i * 0.12, f, 0.16, 'square', 0.16, sfxBus)),
    lose: t => [392, 330, 262, 196].forEach((f, i) => tone(t + i * 0.18, f, 0.22, 'triangle', 0.3, sfxBus)),
  };
  function sfx(name, delay) {
    if (muted || !init()) return;
    if (ctx.state === 'suspended') ctx.resume();
    if (fx[name]) fx[name](ctx.currentTime + (delay || 0));
  }

  return { start, sfx, setMuted, isMuted: () => muted };
})();
