// GolfRoyale - servidor de minigolf multijugador en tiempo real
// Salas con anfitrión, rondas sincronizadas con tiempo límite y varios mapas.
const path = require('path');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { SETS } = require('./public/courses.js');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' },
  pingInterval: 10000,
  pingTimeout: 20000,
});

const PORT = process.env.PORT || 3000;
const MAX_PLAYERS_PER_ROOM = 12;
const TIME_LIMITS = [0, 30, 60, 90, 120, 180]; // 0 = sin límite
const INTERMISSION_MS = 3000;  // pausa entre hoyos
const LAST_SINK_GRACE_MS = 1700; // deja terminar la animación del último

app.use(express.static(path.join(__dirname, 'public')));
app.get('/healthz', (_req, res) => res.send('ok'));

const PALETTE = [
  '#ff5252', '#40c4ff', '#ffd740', '#69f0ae', '#ff6ec7',
  '#b388ff', '#ffab40', '#64ffda', '#ff8a80', '#82b1ff',
  '#f4ff81', '#ea80fc',
];

/** rooms: Map<code, Room> */
const rooms = new Map();

function getRoom(code) {
  if (!rooms.has(code)) {
    rooms.set(code, {
      code,
      players: new Map(),
      host: null,
      settings: { course: 'clasico', timeLimit: 60, collisions: true },
      state: 'lobby', // lobby | playing | over
      holeIdx: 0,
      holeEndsAt: null,
      timer: null,
      nextTimer: null,
    });
  }
  return rooms.get(code);
}

function destroyRoom(r) {
  clearTimeout(r.timer);
  clearTimeout(r.nextTimer);
  rooms.delete(r.code);
}

function holesOf(r) { return SETS[r.settings.course].holes; }

function cleanName(raw) {
  const s = String(raw || '').replace(/[<>]/g, '').trim().slice(0, 16);
  return s || 'Jugador';
}

function cleanRoomCode(raw) {
  const s = String(raw || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
  return s || 'LOBBY';
}

function publicPlayer(p) {
  return {
    id: p.id, name: p.name, color: p.color,
    scores: p.scores, sunk: p.sunk, x: p.x, y: p.y,
  };
}

function snapshot(r) {
  return {
    host: r.host,
    settings: r.settings,
    state: r.state,
    holeIdx: r.holeIdx,
    remainingMs: r.holeEndsAt ? Math.max(0, r.holeEndsAt - Date.now()) : null,
    players: [...r.players.values()].map(publicPlayer),
  };
}

function startHole(r, idx) {
  r.state = 'playing';
  r.holeIdx = idx;
  for (const p of r.players.values()) p.sunk = false;
  const limit = r.settings.timeLimit;
  r.holeEndsAt = limit ? Date.now() + limit * 1000 : null;
  clearTimeout(r.timer);
  if (limit) r.timer = setTimeout(() => endHole(r), limit * 1000 + 200);
  io.to(r.code).emit('holeStart', {
    hole: idx,
    remainingMs: limit ? limit * 1000 : null,
  });
}

function maybeEndHoleEarly(r) {
  if (r.state !== 'playing') return;
  const ps = [...r.players.values()];
  if (ps.length && ps.every((p) => p.sunk)) {
    clearTimeout(r.timer);
    clearTimeout(r.nextTimer);
    r.nextTimer = setTimeout(() => endHole(r), LAST_SINK_GRACE_MS);
  }
}

function endHole(r) {
  if (r.state !== 'playing') return;
  clearTimeout(r.timer);
  clearTimeout(r.nextTimer);
  const holes = holesOf(r);
  const h = r.holeIdx;
  const par = holes[h].par;
  // quien no embocó: penalización (mínimo par+2)
  for (const p of r.players.values()) {
    if (!p.sunk) p.scores[h] = Math.min(99, Math.max(p.scores[h] + 2, par + 2));
  }
  io.to(r.code).emit('holeEnd', {
    hole: h,
    results: [...r.players.values()].map((p) => ({ id: p.id, strokes: p.scores[h], sunk: p.sunk })),
  });

  if (h >= holes.length - 1) {
    r.state = 'over';
    r.holeEndsAt = null;
    const ranking = [...r.players.values()]
      .map((p) => ({ id: p.id, name: p.name, color: p.color, scores: p.scores, total: p.scores.reduce((a, b) => a + b, 0) }))
      .sort((a, b) => a.total - b.total);
    io.to(r.code).emit('gameOver', { ranking });
  } else {
    r.holeEndsAt = null;
    r.nextTimer = setTimeout(() => startHole(r, h + 1), INTERMISSION_MS);
  }
}

io.on('connection', (socket) => {
  let room = null;
  let me = null;
  let lastChat = 0;

  const r = () => rooms.get(room);

  socket.on('join', (data, ack) => {
    if (me) return;
    const code = cleanRoomCode(data && data.room);
    const rm = getRoom(code);
    if (rm.players.size >= MAX_PLAYERS_PER_ROOM) {
      if (typeof ack === 'function') ack({ error: 'Sala llena (máx. ' + MAX_PLAYERS_PER_ROOM + ')' });
      return;
    }
    const usedColors = new Set([...rm.players.values()].map((p) => p.color));
    const color = PALETTE.find((c) => !usedColors.has(c)) || PALETTE[Math.floor(Math.random() * PALETTE.length)];
    const holes = holesOf(rm);

    const scores = new Array(holes.length).fill(0);
    if (rm.state === 'playing') {
      // quien entra a mitad de partida: los hoyos pasados cuentan como par
      // (o restaura su progreso si es una reconexión)
      const restore = (data && Array.isArray(data.scores)) ? data.scores : null;
      for (let i = 0; i < rm.holeIdx; i++) {
        scores[i] = restore ? Math.max(0, Math.min(99, restore[i] | 0)) : holes[i].par;
      }
      if (restore) scores[rm.holeIdx] = Math.max(0, Math.min(99, restore[rm.holeIdx] | 0));
    }

    me = {
      id: socket.id,
      name: cleanName(data && data.name),
      color,
      scores,
      sunk: false,
      x: 0, y: 0,
    };
    room = code;
    rm.players.set(socket.id, me);
    if (!rm.host) rm.host = socket.id;
    socket.join(code);

    if (typeof ack === 'function') {
      ack({ id: socket.id, room: code, color, you: publicPlayer(me), ...snapshot(rm) });
    }
    socket.to(code).emit('playerJoined', publicPlayer(me));
  });

  // --- sala de espera ---
  socket.on('settings', (d) => {
    const rm = r();
    if (!rm || rm.host !== socket.id || rm.state === 'playing' || !d) return;
    if (typeof d.course === 'string' && SETS[d.course]) rm.settings.course = d.course;
    if (TIME_LIMITS.includes(d.timeLimit | 0)) rm.settings.timeLimit = d.timeLimit | 0;
    if (typeof d.collisions === 'boolean') rm.settings.collisions = d.collisions;
    // si cambia el mapa, redimensiona los marcadores
    const n = holesOf(rm).length;
    for (const p of rm.players.values()) p.scores = new Array(n).fill(0);
    io.to(rm.code).emit('settings', rm.settings);
  });

  socket.on('startGame', () => {
    const rm = r();
    if (!rm || rm.host !== socket.id || rm.state === 'playing') return;
    for (const p of rm.players.values()) {
      p.scores = new Array(holesOf(rm).length).fill(0);
      p.sunk = false;
    }
    startHole(rm, 0);
  });

  socket.on('playAgain', () => {
    const rm = r();
    if (!rm || rm.host !== socket.id || rm.state !== 'over') return;
    rm.state = 'lobby';
    rm.holeIdx = 0;
    for (const p of rm.players.values()) { p.scores = new Array(holesOf(rm).length).fill(0); p.sunk = false; }
    io.to(rm.code).emit('backToLobby', snapshot(rm));
  });

  // --- juego ---
  socket.on('pos', (d) => {
    const rm = r();
    if (!me || !rm || !d) return;
    me.x = +d.x || 0;
    me.y = +d.y || 0;
    socket.to(room).emit('pos', { id: me.id, x: me.x, y: me.y, moving: !!d.m });
  });

  socket.on('stroke', (d) => {
    const rm = r();
    if (!me || !rm || rm.state !== 'playing' || me.sunk) return;
    const h = rm.holeIdx;
    me.scores[h] = Math.min(99, (me.scores[h] || 0) + 1);
    io.to(room).emit('stroke', { id: me.id, hole: h, strokes: me.scores[h] });
  });

  socket.on('penalty', (d) => {
    const rm = r();
    if (!me || !rm || rm.state !== 'playing' || me.sunk) return;
    const h = rm.holeIdx;
    me.scores[h] = Math.min(99, (me.scores[h] || 0) + 1);
    io.to(room).emit('stroke', { id: me.id, hole: h, strokes: me.scores[h] });
  });

  socket.on('sunk', () => {
    const rm = r();
    if (!me || !rm || rm.state !== 'playing' || me.sunk) return;
    me.sunk = true;
    io.to(room).emit('sunkP', { id: me.id, hole: rm.holeIdx, strokes: me.scores[rm.holeIdx] });
    maybeEndHoleEarly(rm);
  });

  // --- social ---
  socket.on('chat', (text) => {
    if (!me) return;
    const now = Date.now();
    if (now - lastChat < 600) return;
    lastChat = now;
    const msg = String(text || '').replace(/[<>]/g, '').trim().slice(0, 140);
    if (!msg) return;
    io.to(room).emit('chat', { id: me.id, name: me.name, color: me.color, text: msg });
  });

  socket.on('emote', (e) => {
    if (!me) return;
    const allowed = ['😂', '🔥', '😭', '🎉', '😡', '👏', '🍀', '💀'];
    if (!allowed.includes(e)) return;
    io.to(room).emit('emote', { id: me.id, emote: e });
  });

  socket.on('disconnect', () => {
    const rm = r();
    if (!me || !rm) return;
    rm.players.delete(socket.id);
    socket.to(room).emit('playerLeft', { id: socket.id });
    if (rm.players.size === 0) { destroyRoom(rm); return; }
    if (rm.host === socket.id) {
      rm.host = rm.players.keys().next().value;
      io.to(room).emit('hostChange', { host: rm.host });
    }
    maybeEndHoleEarly(rm); // por si era el único que faltaba por embocar
  });
});

server.listen(PORT, () => {
  console.log(`⛳ GolfRoyale escuchando en http://localhost:${PORT}`);
});
