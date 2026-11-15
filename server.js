'use strict';
// Saper dla dwóch — serwer gry (Node.js, bez zewnętrznych zależności).
// Komunikacja: Server-Sent Events (GET /events) + POST /api.
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const PUB = path.join(__dirname, 'public');

const BOMBS = { 10: 10, 15: 22, 20: 40 }; // rozmiar planszy -> liczba bomb
const ROUNDS = 3;
const PLACE_LIMIT = 15000;   // czas drugiego gracza na ustawienie bomb
const WINS_NEEDED = 2;       // kto pierwszy wygra 2 rundy, wygrywa grę
const RESULT_MS = 7000;      // pauza po rundzie
const RECONNECT_MS = 5000;   // po zamknięciu karty gra kończy się po tylu ms (zapas na odświeżenie strony)

let room;
let timer = null, timerEnd = 0, timerKind = null;
const streams = new Map(); // token -> Set<res>

function resetRoom() {
  clearTimer();
  room = {
    phase: 'lobby', // lobby | placing | playing | roundover | gameover
    size: 10, players: [], round: 0, history: [], turn: 0,
    deadlineFor: null, result: null, opponentLeft: false, leftName: null,
  };
}
function clearTimer() { if (timer) clearTimeout(timer); timer = null; timerKind = null; }
function setTimer(kind, ms, fn) {
  clearTimer();
  timerKind = kind; timerEnd = Date.now() + ms;
  timer = setTimeout(() => { timer = null; timerKind = null; fn(); broadcast(); }, ms);
}
resetRoom();

const bombCount = () => BOMBS[room.size];

function forEachNeighbor(i, n, cb) {
  const x = i % n, y = (i / n) | 0;
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    if (!dx && !dy) continue;
    const nx = x + dx, ny = y + dy;
    if (nx >= 0 && ny >= 0 && nx < n && ny < n) cb(ny * n + nx);
  }
}
function num(bombs, i, n) { let c = 0; forEachNeighbor(i, n, j => { if (bombs.has(j)) c++; }); return c; }

function newPlayer(token, name) {
  return { token, name, ready: false, rematch: false, wins: 0, disc: null, ...blank() };
}
function blank() {
  return { bombs: new Set(), draft: [], placed: false, revealed: new Set(), flags: new Set(), boom: null, last: null };
}

// ---------- przebieg gry ----------
function startRound() {
  room.round++;
  room.phase = 'placing';
  room.result = null;
  room.deadlineFor = null;
  room.players.forEach(p => Object.assign(p, blank()));
  clearTimer();
}
function randomFill(set, n, count) {
  while (set.size < count) set.add((Math.random() * n * n) | 0);
  return set;
}
function onPlaced(p) {
  const o = other(p);
  if (o.placed) return beginPlay();
  if (!timerKind) {
    room.deadlineFor = o.token;
    setTimer('place', PLACE_LIMIT, () => {
      for (const q of room.players) if (!q.placed) {
        q.bombs = randomFill(new Set(q.draft), room.size, bombCount());
        q.draft = [...q.bombs]; q.placed = true;
      }
      beginPlay();
    });
  }
}
function floodReveal(p, o, i) {
  const n = room.size, stack = [i];
  while (stack.length) {
    const c = stack.pop();
    if (p.revealed.has(c) || p.flags.has(c)) continue;
    p.revealed.add(c);
    if (num(o.bombs, c, n) === 0) forEachNeighbor(c, n, j => { if (!p.revealed.has(j)) stack.push(j); });
  }
}
// Pole startowe: losowe bezpieczne pole (najchętniej puste "0", które otwiera obszar).
function giveFreeCell(p, o) {
  const n = room.size, safe = [], zeros = [];
  for (let i = 0; i < n * n; i++) if (!o.bombs.has(i)) { safe.push(i); if (num(o.bombs, i, n) === 0) zeros.push(i); }
  const pool = zeros.length ? zeros : safe;
  floodReveal(p, o, pool[(Math.random() * pool.length) | 0]);
}
function beginPlay() {
  room.phase = 'playing';
  room.players.forEach(p => giveFreeCell(p, other(p)));
  room.deadlineFor = null;
  clearTimer(); // wszyscy grają jednocześnie, we własnym tempie — bez limitu czasu
}
function endRound(winnerIdx, reason) {
  const w = room.players[winnerIdx];
  w.wins++;
  room.history.push(winnerIdx);
  room.result = { winner: winnerIdx, reason };
  room.phase = 'roundover';
  setTimer('next', RESULT_MS, () => {
    if (room.round >= ROUNDS || room.players.some(p => p.wins >= WINS_NEEDED)) { room.phase = 'gameover'; room.players.forEach(p => p.rematch = false); }
    else startRound();
  });
}
const other = p => room.players.find(q => q !== p);

function leavePlayer(token) {
  const i = room.players.findIndex(p => p.token === token);
  if (i < 0) return;
  const p = room.players[i];
  clearTimeout(p.disc);
  room.players.splice(i, 1);
  if (!room.players.length) return resetRoom();
  if (room.phase === 'lobby') { room.players.forEach(x => x.ready = false); return; }
  clearTimer();
  room.forfeit = room.phase !== 'gameover'; // wyjście w trakcie gry = walkower dla gracza, który został
  room.phase = 'gameover'; room.opponentLeft = true; room.leftName = p.name;
  room.players[0].rematch = false;
}
function toLobby() {
  clearTimer();
  room.phase = 'lobby'; room.round = 0; room.history = []; room.result = null;
  room.opponentLeft = false; room.leftName = null; room.forfeit = false;
  room.players.forEach(p => { p.wins = 0; p.ready = false; p.rematch = false; Object.assign(p, blank()); });
}

// ---------- obsługa akcji ----------
const validList = (a, n, max, exact) =>
  Array.isArray(a) && a.length <= max && (!exact || a.length === max) &&
  a.every(v => Number.isInteger(v) && v >= 0 && v < n * n) && new Set(a).size === a.length;

function handle(token, msg) {
  const a = msg.action;
  const idx = room.players.findIndex(p => p.token === token);

  if (a === 'join') {
    if (idx >= 0) return { ok: true };
    if (room.players.length >= 2) return { error: 'Gra jest pełna (maks. 2 graczy).' };
    if (room.phase !== 'lobby') return { error: 'Gra właśnie trwa. Spróbuj za chwilę.' };
    let name = String(msg.name || '').replace(/\s+/g, ' ').trim().slice(0, 14);
    if (!name) return { error: 'Podaj imię.' };
    if (room.players[0] && room.players[0].name.toLowerCase() === name.toLowerCase()) name += ' 2';
    room.players.push(newPlayer(token, name));
    return { ok: true };
  }
  if (idx < 0) return { error: 'Nie jesteś w grze.' };
  const p = room.players[idx], o = room.players[1 - idx];
  const n = room.size;

  switch (a) {
    case 'leave': leavePlayer(token); return { ok: true };
    case 'setSize': {
      if (idx !== 0 || room.phase !== 'lobby' || p.ready) return { error: 'Nie można zmienić rozmiaru.' };
      const s = Number(msg.size);
      if (!BOMBS[s]) return { error: 'Zły rozmiar.' };
      room.size = s; return { ok: true };
    }
    case 'ready': {
      if (room.phase !== 'lobby') return { error: 'Zły etap.' };
      if (idx === 1 && !o.ready) return { error: 'Poczekaj aż pierwszy gracz utworzy grę.' };
      p.ready = true;
      if (room.players.length === 2 && room.players.every(x => x.ready)) {
        room.players.forEach(x => x.wins = 0); room.history = []; room.round = 0;
        startRound();
      }
      return { ok: true };
    }
    case 'rematch': {
      if (room.phase !== 'gameover') return { error: 'Zły etap.' };
      p.rematch = true;
      if (room.players.every(x => x.rematch)) toLobby();
      return { ok: true };
    }
    case 'draft': case 'place': {
      if (room.phase !== 'placing' || p.placed) return { error: 'Nie można teraz ustawiać bomb.' };
      const exact = a === 'place';
      if (!validList(msg.bombs, n, bombCount(), exact)) return { error: 'Niepoprawne ustawienie bomb.' };
      p.draft = msg.bombs.slice();
      if (exact) { p.bombs = new Set(p.draft); p.placed = true; onPlaced(p); }
      return { ok: true, quiet: !exact };
    }
    case 'reveal': case 'flag': {
      if (room.phase !== 'playing') return { error: 'Teraz nie można grać.' };
      const i = msg.i;
      if (!Number.isInteger(i) || i < 0 || i >= n * n) return { error: 'Złe pole.' };
      if (p.revealed.has(i)) {
        // "Chord": klik w odkryty numer, wokół którego jest tyle flag, ile wskazuje liczba
        if (a === 'flag') return { error: 'Pole jest już odkryte.' };
        const v = num(o.bombs, i, n);
        if (v === 0) return { error: 'Pole jest już odkryte.' };
        let fl = 0; const targets = [];
        forEachNeighbor(i, n, j => { if (p.flags.has(j)) fl++; else if (!p.revealed.has(j)) targets.push(j); });
        if (fl !== v) return { error: 'Liczba flag wokół pola musi być równa numerowi.' };
        if (!targets.length) return { error: 'Nie ma tu nic do odkrycia.' };
        p.last = i;
        const mine = targets.find(j => o.bombs.has(j));
        if (mine !== undefined) { p.boom = mine; endRound(1 - idx, 'boom'); return { ok: true }; }
        targets.forEach(j => floodReveal(p, o, j));
        if (p.revealed.size === n * n - bombCount()) endRound(idx, 'cleared');
        return { ok: true };
      }
      if (a === 'flag') {
        if (p.flags.has(i)) p.flags.delete(i);
        else {
          if (p.flags.size >= bombCount()) return { error: 'Wykorzystano wszystkie flagi.' };
          p.flags.add(i);
        }
        p.last = i;
        if (p.flags.size === bombCount() && [...p.flags].every(f => o.bombs.has(f))) endRound(idx, 'defused');
        return { ok: true };
      }
      if (p.flags.has(i)) return { error: 'Najpierw zdejmij flagę.' };
      p.last = i;
      if (o.bombs.has(i)) { p.boom = i; endRound(1 - idx, 'boom'); return { ok: true }; }
      floodReveal(p, o, i);
      if (p.revealed.size === n * n - bombCount()) endRound(idx, 'cleared');
      return { ok: true };
    }
  }
  return { error: 'Nieznana akcja.' };
}

// ---------- widok dla gracza ----------
function cellsView(owner, shooter) {
  const n = room.size, arr = new Array(n * n).fill(-1);
  for (const c of shooter.revealed) arr[c] = num(owner.bombs, c, n);
  return arr;
}
const isOnline = t => (streams.get(t) || new Set()).size > 0;

function snapshot(token) {
  const idx = room.players.findIndex(p => p.token === token);
  if (idx < 0) {
    const h = room.players[0];
    return {
      phase: 'visitor',
      visitor: { full: room.players.length >= 2 || room.phase !== 'lobby', hostName: h ? h.name : null, size: room.size },
    };
  }
  const p = room.players[idx], o = room.players[1 - idx];
  const n = room.size, ph = room.phase;
  const rel = i => (i === idx ? 'me' : 'opp');
  const live = ph === 'playing' || ph === 'roundover' || ph === 'gameover';
  const ended = ph === 'roundover' || ph === 'gameover';
  const pub = (x, you) => x && ({
    name: x.name, wins: x.wins, ready: x.ready, rematch: x.rematch, placed: x.placed,
    host: room.players[0] === x, online: isOnline(x.token) || you,
  });
  let tm = null;
  if (timerKind) {
    const who = timerKind === 'next' ? null : rel(room.players.findIndex(q => q.token === room.deadlineFor));
    tm = { kind: timerKind, who, ms: Math.max(0, timerEnd - Date.now()) };
  }
  return {
    phase: ph, size: n, bombCount: bombCount(), round: room.round, rounds: ROUNDS,
    me: pub(p, true), opp: pub(o, false),
    timer: tm,
    history: room.history.map(rel),
    result: room.result && { winner: rel(room.result.winner), reason: room.result.reason },
    opponentLeft: room.opponentLeft, leftName: room.leftName, forfeit: !!room.forfeit,
    own: {
      bombs: [...(p.placed ? p.bombs : p.draft)],
      cells: live && o ? cellsView(p, o) : [],
      flags: live && o ? [...o.flags] : [],
      boom: o ? o.boom : null, last: o ? o.last : null,
    },
    guess: live && o ? {
      cells: cellsView(o, p), flags: [...p.flags],
      bombs: ended ? [...o.bombs] : null, boom: p.boom, last: p.last,
    } : null,
  };
}

function send(res, token) {
  res.write('event: state\ndata: ' + JSON.stringify(snapshot(token)) + '\n\n');
}
function broadcast() {
  for (const [token, set] of streams) for (const res of set) send(res, token);
}

// ---------- HTTP ----------
const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
};

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');

  if (req.method === 'GET' && url.pathname === '/events') {
    const token = (url.searchParams.get('token') || '').slice(0, 100);
    if (token.length < 16) { res.writeHead(400); return res.end(); }
    res.writeHead(200, {
      'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive', 'X-Accel-Buffering': 'no',
    });
    res.write('retry: 1500\n\n');
    if (!streams.has(token)) streams.set(token, new Set());
    streams.get(token).add(res);
    const p = room.players.find(q => q.token === token);
    if (p) { clearTimeout(p.disc); p.disc = null; }
    broadcast();
    req.on('close', () => {
      const set = streams.get(token);
      if (set) { set.delete(res); if (!set.size) streams.delete(token); }
      const q = room.players.find(x => x.token === token);
      if (q && !isOnline(token)) {
        clearTimeout(q.disc);
        q.disc = setTimeout(() => { leavePlayer(token); broadcast(); }, RECONNECT_MS);
      }
      broadcast();
    });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api') {
    let body = '';
    req.on('data', d => { body += d; if (body.length > 20000) req.destroy(); });
    req.on('end', () => {
      let msg;
      try { msg = JSON.parse(body); } catch { res.writeHead(400); return res.end('{}'); }
      const token = String(msg.token || '');
      if (token.length < 16) { res.writeHead(400); return res.end('{}'); }
      const out = handle(token, msg);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(out));
      if (!out.quiet) broadcast();
    });
    return;
  }

  if (req.method !== 'GET') { res.writeHead(405); return res.end(); }
  let rel = decodeURIComponent(url.pathname);
  if (rel === '/') rel = '/index.html';
  const file = path.normalize(path.join(PUB, rel));
  if (!file.startsWith(PUB + path.sep)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end('404'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  });
});

setInterval(() => { for (const set of streams.values()) for (const r of set) r.write(': ping\n\n'); }, 15000);

server.listen(PORT, () => console.log('Saper dla dwóch działa na http://localhost:' + PORT));
