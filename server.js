// GolfRoyale - servidor de minigolf multijugador en tiempo real
const path = require('path');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' },
  pingInterval: 10000,
  pingTimeout: 20000,
});

const PORT = process.env.PORT || 3000;
const TOTAL_HOLES = 12;
const MAX_PLAYERS_PER_ROOM = 12;

app.use(express.static(path.join(__dirname, 'public')));

// salud para hosting
app.get('/healthz', (_req, res) => res.send('ok'));

const PALETTE = [
  '#ff5252', '#40c4ff', '#ffd740', '#69f0ae', '#ff6ec7',
  '#b388ff', '#ffab40', '#64ffda', '#ff8a80', '#82b1ff',
  '#f4ff81', '#ea80fc',
];

/** rooms: Map<code, { players: Map<socketId, Player>, createdAt }> */
const rooms = new Map();

function getRoom(code) {
  if (!rooms.has(code)) {
    rooms.set(code, { players: new Map(), createdAt: Date.now() });
  }
  return rooms.get(code);
}

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
    id: p.id, name: p.name, color: p.color, hole: p.hole,
    scores: p.scores, x: p.x, y: p.y, finished: p.finished,
  };
}

io.on('connection', (socket) => {
  let room = null;
  let me = null;
  let lastChat = 0;

  socket.on('join', (data, ack) => {
    if (me) return; // ya unido
    const code = cleanRoomCode(data && data.room);
    const r = getRoom(code);
    if (r.players.size >= MAX_PLAYERS_PER_ROOM) {
      if (typeof ack === 'function') ack({ error: 'Sala llena (máx. ' + MAX_PLAYERS_PER_ROOM + ')' });
      return;
    }
    const usedColors = new Set([...r.players.values()].map((p) => p.color));
    const color = PALETTE.find((c) => !usedColors.has(c)) || PALETTE[Math.floor(Math.random() * PALETTE.length)];

    // si el cliente se reconecta puede restaurar su progreso
    const hole = Math.max(0, Math.min(TOTAL_HOLES - 1, (data && data.hole) | 0));
    const scores = new Array(TOTAL_HOLES).fill(0);
    if (data && Array.isArray(data.scores)) {
      for (let i = 0; i < TOTAL_HOLES; i++) scores[i] = Math.max(0, Math.min(99, data.scores[i] | 0));
    }
    me = {
      id: socket.id,
      name: cleanName(data && data.name),
      color,
      hole,
      scores,
      x: 0, y: 0,
      finished: !!(data && data.finished),
    };
    room = code;
    r.players.set(socket.id, me);
    socket.join(code);

    if (typeof ack === 'function') {
      ack({
        id: socket.id,
        room: code,
        color,
        players: [...r.players.values()].map(publicPlayer),
      });
    }
    socket.to(code).emit('playerJoined', publicPlayer(me));
  });

  // posición de la bola (alta frecuencia, solo relay)
  socket.on('pos', (d) => {
    if (!me || !d) return;
    me.x = +d.x || 0;
    me.y = +d.y || 0;
    socket.to(room).emit('pos', { id: me.id, x: me.x, y: me.y, hole: me.hole, moving: !!d.m });
  });

  // golpe dado
  socket.on('stroke', (d) => {
    if (!me || !d) return;
    const h = d.hole | 0;
    if (h < 0 || h >= TOTAL_HOLES || h !== me.hole) return;
    me.scores[h] = Math.min(99, (me.scores[h] || 0) + 1);
    io.to(room).emit('stroke', { id: me.id, hole: h, strokes: me.scores[h] });
  });

  // penalización (agua)
  socket.on('penalty', (d) => {
    if (!me || !d) return;
    const h = d.hole | 0;
    if (h !== me.hole) return;
    me.scores[h] = Math.min(99, (me.scores[h] || 0) + 1);
    io.to(room).emit('stroke', { id: me.id, hole: h, strokes: me.scores[h] });
  });

  // bola embocada
  socket.on('sunk', (d) => {
    if (!me || !d) return;
    const h = d.hole | 0;
    if (h !== me.hole) return;
    io.to(room).emit('sunk', { id: me.id, hole: h, strokes: me.scores[h] });
    if (h >= TOTAL_HOLES - 1) {
      me.finished = true;
      const total = me.scores.reduce((a, b) => a + b, 0);
      io.to(room).emit('finished', { id: me.id, name: me.name, color: me.color, total, scores: me.scores });
    } else {
      me.hole = h + 1;
      io.to(room).emit('holeChange', { id: me.id, hole: me.hole });
    }
  });

  socket.on('chat', (text) => {
    if (!me) return;
    const now = Date.now();
    if (now - lastChat < 600) return; // anti-spam
    lastChat = now;
    const msg = String(text || '').replace(/[<>]/g, '').trim().slice(0, 140);
    if (!msg) return;
    io.to(room).emit('chat', { id: me.id, name: me.name, color: me.color, text: msg });
  });

  // emotes rápidos (😂 🔥 😭 🎉 ...)
  socket.on('emote', (e) => {
    if (!me) return;
    const allowed = ['😂', '🔥', '😭', '🎉', '😡', '👏', '🍀', '💀'];
    if (!allowed.includes(e)) return;
    io.to(room).emit('emote', { id: me.id, emote: e });
  });

  socket.on('disconnect', () => {
    if (!me || !room) return;
    const r = rooms.get(room);
    if (r) {
      r.players.delete(socket.id);
      socket.to(room).emit('playerLeft', { id: socket.id });
      if (r.players.size === 0) rooms.delete(room);
    }
  });
});

server.listen(PORT, () => {
  console.log(`⛳ GolfRoyale escuchando en http://localhost:${PORT}`);
});
