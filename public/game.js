'use strict';
(() => {
  const $ = s => document.querySelector(s);
  const show = (el, on) => el.classList.toggle('hidden', !on);

  // ---------- pixel-art (sprity rysowane z tekstu) ----------
  function sprite(rows, pal) {
    let r = '';
    rows.forEach((row, y) => [...row].forEach((ch, x) => {
      if (pal[ch]) r += `<rect x="${x}" y="${y}" width="1" height="1" fill="${pal[ch]}"/>`;
    }));
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${rows[0].length} ${rows.length}" shape-rendering="crispEdges">${r}</svg>`;
    return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
  }
  const root = document.documentElement.style;
  root.setProperty('--spr-bomb', sprite([
    '.....y.y', '......y.', '..kkkk..', '.kkwkkk.', '.kwkkkk.', '.kkkkkk.', '.kkkkkk.', '..kkkk..',
  ], { k: '#1b1b1b', w: '#ffffff', y: '#ffd43b' }));
  root.setProperty('--spr-flag', sprite([
    '..kRR...', '..kRRR..', '..kRRRR.', '..kRRR..', '..kRR...', '..k.....', '.kkk....', 'kkkkk...',
  ], { k: '#1b1b1b', R: '#e03131' }));
  root.setProperty('--spr-dig', sprite([
    '....kkk.', '...kkkkk', '..kk..kk', '.kk...k.', 'bk......', 'bb......', 'b.......', '........',
  ], { k: '#f4f4f4', b: '#b8793c' }));

  // ---------- stan ----------
  const rnd = () => { const a = new Uint32Array(4); crypto.getRandomValues(a); return [...a].map(x => x.toString(36)).join(''); };
  let token;
  try { token = sessionStorage.getItem('saper_token'); if (!token) { token = rnd(); sessionStorage.setItem('saper_token', token); } }
  catch (e) { token = rnd(); }

  let S = null, prev = null;
  let mode = 'reveal';
  let draft = new Set();
  let draftKey = '';
  let deadlineAt = 0, deadlineTotal = 1, lastTick = -1;
  let toastT = null;

  async function api(action, data) {
    try {
      const r = await fetch('/api', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token, action, ...data }) });
      const j = await r.json();
      if (j.error) toast(j.error);
      return j;
    } catch (e) { toast('Błąd połączenia z serwerem'); return { error: 1 }; }
  }
  function toast(msg) {
    const t = $('#toast'); t.textContent = msg; show(t, true);
    clearTimeout(toastT); toastT = setTimeout(() => show(t, false), 2200);
  }

  // ---------- połączenie ----------
  function connect() {
    const es = new EventSource('/events?token=' + token);
    es.addEventListener('state', e => { show($('#conn'), false); onState(JSON.parse(e.data)); });
    es.onerror = () => show($('#conn'), true);
  }

  // ---------- plansze ----------
  function ensureBoard(el, n) {
    if (el.dataset.n === String(n)) return;
    el.dataset.n = n; el.innerHTML = '';
    const f = document.createDocumentFragment();
    for (let i = 0; i < n * n; i++) { const c = document.createElement('div'); c.className = 'cell hid'; c.dataset.i = i; f.appendChild(c); }
    el.appendChild(f);
    el.style.gridTemplateColumns = `repeat(${n}, var(--cs))`;
  }
  function paint(el, n, spec) {
    ensureBoard(el, n);
    const flags = new Set(spec.flags), bombs = new Set(spec.bombs || []);
    const kids = el.children;
    for (let i = 0; i < kids.length; i++) {
      const v = spec.cells[i] === undefined ? -1 : spec.cells[i];
      let cls = 'cell', txt = '';
      if (v >= 0) { cls += ' rev'; if (v > 0) { cls += ' n' + v; txt = v; } }
      else {
        cls += ' hid';
        const b = bombs.has(i), f = flags.has(i);
        if (spec.boom === i) cls += ' boom';
        else if (b && f) cls += ' defused';
        else if (b) cls += ' bomb';
        else if (f) cls += ' flag';
      }
      if (spec.last === i) cls += ' last';
      const c = kids[i];
      if (c._k !== cls) { c.className = cls; c._k = cls; }
      if (c._t !== txt) { c.textContent = txt; c._t = txt; }
    }
  }
  function fitCells(n) {
    const w = window.innerWidth;
    const per = w >= 900 ? (Math.min(w, 1400) - 120) / 2 : w - 70;
    const cs = Math.max(14, Math.min(38, Math.floor((per - 24) / n) - 1));
    root.setProperty('--cs', cs + 'px');
  }

  // ---------- ekrany ----------
  function onState(s) {
    prev = S; S = s;
    if (s.phase !== 'gameover') Fireworks.stop();
    if (s.phase === 'visitor') return renderVisitor(s);
    if (s.phase === 'lobby') return renderLobby(s);
    renderGame(s);
  }
  function screen(name) {
    ['name', 'lobby', 'game'].forEach(k => show($('#s-' + k), k === name));
    if (name !== 'game') show($('#modal'), false);
  }

  function renderVisitor(s) {
    screen('name');
    const v = s.visitor;
    $('#b-join').disabled = v.full;
    $('#room-info').textContent = v.full
      ? 'GRA PEŁNA — GRAJĄ JUŻ 2 OSOBY. SPRÓBUJ PÓŹNIEJ.'
      : v.hostName ? `${v.hostName.toUpperCase()} CZEKA W LOBBY (PLANSZA ${v.size}×${v.size}). DOŁĄCZ!` : 'NIKT JESZCZE NIE UTWORZYŁ GRY. BĄDŹ PIERWSZY!';
    try { const n = localStorage.getItem('saper_name'); if (n && !$('#name').value) $('#name').value = n; } catch (e) {}
  }

  const BOMBS = { 10: 10, 15: 22, 20: 40 };
  function renderLobby(s) {
    screen('lobby');
    const li = (p, label) => `<li class="${p.ready ? 'ok' : ''}"><span><i class="dot ${p.online ? '' : 'off'}"></i>${esc(p.name)}${label}</span><span class="st">${p.ready ? 'GOTOWY' : 'CZEKA'}</span></li>`;
    $('#players').innerHTML = li(s.me, ' (TY)') + (s.opp ? li(s.opp, '') : '<li><span>…</span><span class="st">SZUKAM GRACZA</span></li>');
    const host = s.me.host;
    show($('#lobby-host'), true);
    $('#sizes').innerHTML = [10, 15, 20].map(n =>
      `<button type="button" data-size="${n}" class="${s.size === n ? 'on' : ''}" ${host && !s.me.ready ? '' : 'disabled'}>${n}×${n} · ${BOMBS[n]} BOMB</button>`).join('');
    $('#lobby-host p').textContent = host ? 'WYBIERZ ROZMIAR PLANSZY:' : 'ROZMIAR PLANSZY (WYBIERA PIERWSZY GRACZ):';
    const b = $('#b-ready'), m = $('#lobby-msg');
    if (host) {
      b.textContent = 'ROZPOCZNIJ GRĘ'; b.disabled = s.me.ready;
      m.textContent = !s.me.ready ? 'Wybierz rozmiar i rozpocznij grę. Drugi gracz zobaczy zaproszenie.'
        : s.opp ? `Czekam aż ${s.opp.name} dołączy…` : 'Gra utworzona. Czekam na drugiego gracza…';
    } else {
      const started = s.opp && s.opp.ready;
      b.textContent = 'DOŁĄCZAM DO GRY'; b.disabled = !started || s.me.ready;
      m.textContent = started ? (s.me.ready ? 'Startujemy…' : `${s.opp.name} rozpoczął(-ęła) grę! Plansza ${s.size}×${s.size}. Kliknij, aby dołączyć.`)
        : `Czekam aż ${s.opp ? s.opp.name : 'pierwszy gracz'} rozpocznie grę…`;
    }
  }

  function esc(t) { return String(t).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

  function renderGame(s) {
    screen('game');
    const n = s.size, opp = s.opp, me = s.me;
    fitCells(n);

    // początek rundy -> nowy szkic bomb
    const key = s.round + ':placing';
    if (s.phase === 'placing' && !me.placed && draftKey !== key) { draftKey = key; draft = new Set(s.own.bombs); }

    // timer
    if (s.timer) {
      deadlineAt = performance.now() + s.timer.ms;
      deadlineTotal = { place: 15000, next: 7000 }[s.timer.kind];
    } else deadlineAt = 0;

    // HUD
    $('#round').textContent = `RUNDA ${Math.min(s.round, s.rounds)} · DO 2 WYGRANYCH`;
    $('#dots').innerHTML = Array.from({ length: s.rounds }, (_, i) => `<b class="${s.history[i] || ''}"></b>`).join('');
    $('#score').innerHTML = `${esc(me.name)} <span style="color:var(--gold)">${me.wins} : ${opp ? opp.wins : 0}</span> ${esc(opp ? opp.name : '?')}`;

    const st = $('#status');
    let text = '', cls = '';
    if (s.phase === 'placing') {
      if (!me.placed) { text = `USTAW BOMBY: ${draft.size}/${s.bombCount}`; cls = 'me'; }
      else text = `CZEKAM AŻ ${opp.name.toUpperCase()} USTAWI BOMBY…`;
    } else if (s.phase === 'playing') { text = baseStatus(); cls = 'me'; }
    else if (s.phase === 'roundover') text = 'KONIEC RUNDY';
    else text = 'KONIEC GRY';
    st.textContent = text; st.className = cls;

    // tytuły plansz (imię nad planszą, na której szukamy bomb)
    $('#own-title').textContent = `TWOJA PLANSZA — ${me.name.toUpperCase()}`;
    $('#guess-title').textContent = opp ? `PLANSZA GRACZA: ${opp.name.toUpperCase()}` : 'PLANSZA PRZECIWNIKA';

    const placing = s.phase === 'placing' && !me.placed;
    const myTurn = s.phase === 'playing'; // gramy jednocześnie — każdy w swoim tempie
    const safe = s.size * s.size - s.bombCount;
    const done = c => c.filter(v => v >= 0).length;

    // lewa: moja plansza
    paint($('#own'), n, { cells: s.own.cells, flags: s.own.flags, bombs: placing ? [...draft] : s.own.bombs, boom: s.own.boom, last: s.own.last });
    $('#own').classList.toggle('active', placing);
    $('#p-own').classList.toggle('active', placing);
    $('#own-sub').textContent = placing ? 'KLIKAJ POLA, ABY USTAWIĆ BOMBY' : s.phase === 'placing' ? 'BOMBY USTAWIONE' : `${opp.name.toUpperCase()} ODKRYŁ ${done(s.own.cells)}/${safe} BEZPIECZNYCH`;

    // prawa: plansza przeciwnika
    const g = $('#guess');
    if (s.guess) paint(g, n, s.guess);
    else paint(g, n, { cells: [], flags: [], bombs: [], boom: null, last: null });
    g.classList.add('guess');
    g.classList.toggle('active', myTurn);
    $('#p-guess').classList.toggle('active', myTurn);
    $('#p-guess').classList.toggle('dim', !s.guess);
    $('#guess-sub').textContent = s.guess ? `TY: ${done(s.guess.cells)}/${safe} BEZPIECZNYCH · FLAGI ${s.guess.flags.length}/${s.bombCount}` : 'JESZCZE NIEDOSTĘPNA';

    // sterowanie
    show($('#c-place'), s.phase === 'placing' && !me.placed);
    show($('#c-play'), s.phase === 'playing');
    $('#b-done').disabled = draft.size !== s.bombCount;
    $('#flags-left').textContent = s.guess ? `FLAGI: ${s.bombCount - s.guess.flags.length}/${s.bombCount}` : '';

    // baner wyniku rundy
    const bn = $('#banner');
    if (s.result && (s.phase === 'roundover' || s.phase === 'gameover')) {
      const win = s.result.winner === 'me', r = s.result.reason;
      bn.className = win ? 'win' : '';
      bn.textContent = r === 'boom'
        ? (win ? '💥 PRZECIWNIK TRAFIŁ NA BOMBĘ! WYGRYWASZ RUNDĘ!' : '💥 BUM! TRAFIŁEŚ NA BOMBĘ. PRZECIWNIK WYGRYWA RUNDĘ.')
        : (win ? '✔ ROZBROIŁEŚ WSZYSTKIE BOMBY! WYGRYWASZ RUNDĘ!' : '✖ PRZECIWNIK ROZBROIŁ WSZYSTKIE TWOJE BOMBY. PRZEGRYWASZ RUNDĘ.');
      show(bn, true);
    } else show(bn, false);

    renderModal(s);
    effects(s);
  }

  function renderModal(s) {
    const m = $('#modal');
    if (s.phase !== 'gameover') return show(m, false);
    const w = s.me.wins, l = s.opp ? s.opp.wins : 0;
    const title = s.opponentLeft ? 'PRZECIWNIK WYSZEDŁ — WYGRYWASZ WALKOWEREM!' : w > l ? '🏆 WYGRAŁEŚ GRĘ! 🏆' : 'PRZEGRAŁEŚ GRĘ';
    $('#modal-box').innerHTML = `<h2>KONIEC GRY</h2><div class="big">${title}</div>
      <p>${esc(s.me.name)} <b style="color:var(--gold)">${w} : ${l}</b> ${esc(s.opp ? s.opp.name : s.leftName || '?')}</p>
      <div class="row"><button class="btn" id="b-again" ${s.me.rematch ? 'disabled' : ''}>${s.me.rematch ? 'CZEKAM NA PRZECIWNIKA…' : 'ZAGRAJ JESZCZE RAZ'}</button>
      <button class="btn ghost" id="b-exit">WYJDŹ</button></div>`;
    show(m, true);
  }

  // ---------- dźwięki i animacje wg zmian stanu ----------
  function effects(s) {
    const p = prev && prev.phase !== 'visitor' && prev.phase !== 'lobby' ? prev : null;
    if (s.phase === 'placing' && (!p || p.round !== s.round || p.phase !== 'placing')) Sound.sfx('start');
    if (s.phase === 'playing' && (!p || p.phase !== 'playing')) Sound.sfx('turn');
    if (s.phase === 'gameover' && (!p || p.phase !== 'gameover')) {
      if (s.opponentLeft || s.me.wins > (s.opp ? s.opp.wins : 0)) { Fireworks.start(); Sound.sfx('win', 0.5); }
    }
    if (s.phase !== 'gameover') Fireworks.stop();
    if (s.phase === 'roundover' && (!p || p.phase !== 'roundover')) {
      if (s.result.reason === 'boom') {
        Sound.sfx('boom');
        const b = $('#boards'); b.classList.remove('shake'); void b.offsetWidth; b.classList.add('shake');
      }
      Sound.sfx(s.result.winner === 'me' ? 'win' : 'lose', s.result.reason === 'boom' ? 0.9 : 0);
    }
  }

  // ---------- licznik ----------
  setInterval(() => {
    const bar = $('#bar'), fill = bar.firstElementChild;
    if (!S || !deadlineAt || S.phase === 'lobby' || S.phase === 'visitor') { fill.style.width = '0'; return; }
    const rem = Math.max(0, deadlineAt - performance.now());
    const sec = Math.ceil(rem / 1000);
    fill.style.width = (rem / deadlineTotal * 100) + '%';
    bar.classList.toggle('warn', sec <= 5);
    const t = S.timer;
    let note = '';
    if (t.kind === 'place') note = t.who === 'me' ? `PRZECIWNIK SKOŃCZYŁ! MASZ ${sec} s — POTEM BOMBY ZOSTANĄ DOLOSOWANE` : `${S.opp.name.toUpperCase()} MA JESZCZE ${sec} s`;
    else if (t.kind === 'next') note = S.me.wins >= 2 || (S.opp && S.opp.wins >= 2) || S.round >= S.rounds ? `WYNIK KOŃCOWY ZA ${sec} s` : `NASTĘPNA RUNDA ZA ${sec} s`;
    if (note) $('#guess-sub').textContent = note;
    if (t.who === 'me' && t.kind !== 'next' && sec <= 5 && sec > 0 && sec !== lastTick) { lastTick = sec; Sound.sfx('tick'); }
  }, 250);
  function baseStatus() {
    const s = S;
    if (s.phase === 'placing') return s.me.placed ? `CZEKAM AŻ ${s.opp.name.toUpperCase()} USTAWI BOMBY…` : `USTAW BOMBY: ${draft.size}/${s.bombCount}`;
    if (s.phase === 'playing') return `GRAJ! ZNAJDŹ BOMBY ${s.opp.name.toUpperCase()} ZANIM ON ZNAJDZIE TWOJE`;
    return $('#status').textContent;
  }

  // ---------- zdarzenia UI ----------
  $('#f-name').addEventListener('submit', async e => {
    e.preventDefault();
    const name = $('#name').value.trim();
    if (!name) return;
    try { localStorage.setItem('saper_name', name); } catch (e2) {}
    Sound.start();
    await api('join', { name });
  });
  $('#sizes').addEventListener('click', e => {
    const b = e.target.closest('button[data-size]');
    if (b && !b.disabled) { Sound.sfx('click'); api('setSize', { size: +b.dataset.size }); }
  });
  $('#b-ready').addEventListener('click', () => { Sound.sfx('click'); api('ready'); });
  $('#b-leave').addEventListener('click', () => { api('leave'); });
  $('#modal').addEventListener('click', e => {
    if (e.target.id === 'b-again') { Sound.sfx('click'); Fireworks.stop(); api('rematch'); }
    if (e.target.id === 'b-exit') { Fireworks.stop(); api('leave'); }
  });
  $('#mute').addEventListener('click', () => {
    Sound.setMuted(!Sound.isMuted()); updateMute();
  });
  function updateMute() { $('#mute').textContent = Sound.isMuted() ? '♪ MUZYKA: NIE' : '♪ MUZYKA: TAK'; }
  updateMute();
  document.addEventListener('pointerdown', () => Sound.start(), { once: true });
  document.addEventListener('keydown', () => Sound.start(), { once: true });
  window.addEventListener('resize', () => { if (S && S.size) fitCells(S.size); });

  function setMode(m) {
    mode = m;
    $('#m-reveal').classList.toggle('on', m === 'reveal');
    $('#m-flag').classList.toggle('on', m === 'flag');
  }
  $('#m-reveal').addEventListener('click', () => setMode('reveal'));
  $('#m-flag').addEventListener('click', () => setMode('flag'));

  // ustawianie bomb
  function sendDraft() { api('draft', { bombs: [...draft] }); }
  $('#own').addEventListener('click', e => {
    const c = e.target.closest('.cell');
    if (!c || !S || S.phase !== 'placing' || S.me.placed) return;
    const i = +c.dataset.i;
    if (draft.has(i)) draft.delete(i);
    else if (draft.size < S.bombCount) draft.add(i);
    else return toast(`Masz już ${S.bombCount} bomb. Usuń którąś.`);
    Sound.sfx('place');
    renderGame(S); sendDraft();
  });
  $('#b-rand').addEventListener('click', () => {
    draft = new Set(); const t = S.size * S.size;
    while (draft.size < S.bombCount) draft.add((Math.random() * t) | 0);
    Sound.sfx('click'); renderGame(S); sendDraft();
  });
  $('#b-clear').addEventListener('click', () => { draft = new Set(); Sound.sfx('click'); renderGame(S); sendDraft(); });
  $('#b-done').addEventListener('click', async () => {
    if (draft.size !== S.bombCount) return;
    Sound.sfx('click');
    await api('place', { bombs: [...draft] });
  });

  // strzały i flagi na planszy przeciwnika
  function guessAction(i, action) {
    if (!S || S.phase !== 'playing') return;
    if (S.guess.cells[i] >= 0) {
      if (action !== 'reveal' || S.guess.cells[i] === 0) return;
      Sound.sfx('reveal'); api('reveal', { i }); // odkrycie sąsiadów (chord)
      return;
    }
    const has = S.guess.flags.includes(i);
    if (action === 'reveal' && has) return toast('Najpierw zdejmij flagę (PPM).');
    Sound.sfx(action === 'flag' ? (has ? 'unflag' : 'flag') : 'reveal');
    api(action, { i });
  }
  $('#guess').addEventListener('click', e => {
    const c = e.target.closest('.cell'); if (!c) return;
    guessAction(+c.dataset.i, mode === 'flag' ? 'flag' : 'reveal');
  });
  $('#guess').addEventListener('contextmenu', e => {
    e.preventDefault();
    const c = e.target.closest('.cell'); if (!c) return;
    guessAction(+c.dataset.i, 'flag');
  });

  connect();
})();
