// GolfRoyale - cliente: física, render, entrada y red
(() => {
  'use strict';

  const { COURSES, TILE, COLS, ROWS } = window.GOLF_COURSES;
  const W = COLS * TILE;   // 960
  const H = ROWS * TILE;   // 600
  const TOTAL_HOLES = COURSES.length;

  const BALL_R = 8;
  const CUP_R = 14;
  const BUMPER_R = 13;
  const RESTITUTION = 0.8;
  const MAX_DRAG = 180;
  const MAX_SPEED = 950;
  const SINK_SPEED = 270;     // velocidad máx. para embocar
  const MAX_STROKES = 10;     // límite por hoyo

  // ---------- DOM ----------
  const $ = (id) => document.getElementById(id);
  const canvas = $('canvas');
  const ctx = canvas.getContext('2d');
  const lobby = $('lobby'), game = $('game'), finalScreen = $('finalScreen');
  const holeInfo = $('holeInfo'), strokeInfo = $('strokeInfo'), roomInfo = $('roomInfo');
  const holeBanner = $('holeBanner'), scoreList = $('scoreList');
  const chatLog = $('chatLog'), chatForm = $('chatForm'), chatInput = $('chatInput');

  // ---------- ESTADO ----------
  let socket = null, myId = null, myColor = '#fff', myName = '', roomCode = 'LOBBY';
  let holeIdx = 0;
  let myScores = new Array(TOTAL_HOLES).fill(0);
  let finished = false;
  let course = null;           // hoyo parseado
  const players = new Map();   // jugadores remotos

  const ball = { x: 0, y: 0, vx: 0, vy: 0, moving: false, sinking: 0, visible: true };
  let lastShotPos = { x: 0, y: 0 };
  let aiming = false, aimX = 0, aimY = 0;
  const particles = [];
  let bannerTimer = null, lastPosSent = 0, wasMoving = false;

  // ---------- PARSEO DE HOYO ----------
  function parseCourse(idx) {
    const c = COURSES[idx];
    const grid = c.grid.map((r) => r.padEnd(COLS, ' '));
    const bumpers = [], waterTiles = [], slopes = [];
    let start = null, cup = null;
    for (let y = 0; y < ROWS; y++) {
      for (let x = 0; x < COLS; x++) {
        const t = grid[y][x];
        const cx = x * TILE + TILE / 2, cy = y * TILE + TILE / 2;
        if (t === 'S') start = { x: cx, y: cy };
        if (t === 'H') cup = { x: cx, y: cy };
        if (t === 'B') bumpers.push({ x: cx, y: cy, flash: 0 });
        if (t === 'w') waterTiles.push({ x, y });
        if ('><^v'.includes(t)) slopes.push({ x, y, t });
      }
    }
    return { ...c, grid, start, cup, bumpers, waterTiles, slopes, prerender: prerenderCourse(grid, cup) };
  }

  function tileAt(px, py) {
    const x = Math.floor(px / TILE), y = Math.floor(py / TILE);
    if (x < 0 || x >= COLS || y < 0 || y >= ROWS) return '#';
    return course.grid[y][x];
  }

  // ---------- PRE-RENDER DEL CAMPO ----------
  function prerenderCourse(grid, cup) {
    const off = document.createElement('canvas');
    off.width = W; off.height = H;
    const o = off.getContext('2d');

    // fondo vacío
    const bg = o.createLinearGradient(0, 0, W, H);
    bg.addColorStop(0, '#0a160e'); bg.addColorStop(1, '#0d1f13');
    o.fillStyle = bg; o.fillRect(0, 0, W, H);

    for (let y = 0; y < ROWS; y++) {
      for (let x = 0; x < COLS; x++) {
        const t = grid[y][x];
        const px = x * TILE, py = y * TILE;
        if (t === ' ') continue;
        if (t === '#') {
          // muro con bisel
          o.fillStyle = '#7a5a3a'; o.fillRect(px, py, TILE, TILE);
          o.fillStyle = '#9b7449'; o.fillRect(px, py, TILE, 6);
          o.fillStyle = '#5d432a'; o.fillRect(px, py + TILE - 6, TILE, 6);
          continue;
        }
        // suelo base (damero de césped)
        const even = (x + y) % 2 === 0;
        o.fillStyle = even ? '#3f9d4f' : '#379146';
        o.fillRect(px, py, TILE, TILE);
        if (t === 's') {
          o.fillStyle = '#e0c178'; o.fillRect(px, py, TILE, TILE);
          o.fillStyle = 'rgba(160,120,60,.35)';
          o.beginPath(); o.arc(px + 12, py + 14, 2, 0, 7); o.arc(px + 28, py + 26, 2, 0, 7); o.fill();
        } else if (t === 'i') {
          o.fillStyle = even ? '#bfe6f5' : '#aedcef'; o.fillRect(px, py, TILE, TILE);
          o.strokeStyle = 'rgba(255,255,255,.5)'; o.lineWidth = 1.5;
          o.beginPath(); o.moveTo(px + 6, py + 30); o.lineTo(px + 18, py + 12); o.lineTo(px + 26, py + 22); o.stroke();
        } else if (t === 'w') {
          o.fillStyle = '#1d5d8f'; o.fillRect(px, py, TILE, TILE); // base; animación en vivo
        } else if ('><^v'.includes(t)) {
          o.fillStyle = even ? '#4aa85a' : '#429c51'; o.fillRect(px, py, TILE, TILE);
        }
      }
    }

    // copa (sombra del hoyo)
    if (cup) {
      o.fillStyle = 'rgba(0,0,0,.35)';
      o.beginPath(); o.ellipse(cup.x + 2, cup.y + 3, CUP_R + 3, CUP_R + 1, 0, 0, 7); o.fill();
      o.fillStyle = '#0c1a10';
      o.beginPath(); o.arc(cup.x, cup.y, CUP_R, 0, 7); o.fill();
      o.strokeStyle = 'rgba(255,255,255,.25)'; o.lineWidth = 2;
      o.beginPath(); o.arc(cup.x, cup.y, CUP_R, 0, 7); o.stroke();
    }
    return off;
  }

  // ---------- SONIDO (WebAudio sintetizado) ----------
  let audio = null;
  function initAudio() {
    if (!audio) { try { audio = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { /* sin audio */ } }
    if (audio && audio.state === 'suspended') audio.resume();
  }
  function tone(freq, dur, type = 'sine', vol = 0.12, delay = 0) {
    if (!audio) return;
    const t0 = audio.currentTime + delay;
    const osc = audio.createOscillator(), g = audio.createGain();
    osc.type = type; osc.frequency.value = freq;
    g.gain.setValueAtTime(vol, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g); g.connect(audio.destination);
    osc.start(t0); osc.stop(t0 + dur);
  }
  const sfx = {
    hit: (p) => tone(160 + p * 120, 0.12, 'triangle', 0.18),
    wall: () => tone(220, 0.06, 'square', 0.07),
    bumper: () => { tone(330, 0.09, 'square', 0.12); tone(495, 0.09, 'square', 0.08, 0.04); },
    sink: () => { tone(523, 0.14, 'sine', 0.16); tone(659, 0.14, 'sine', 0.16, 0.1); tone(784, 0.22, 'sine', 0.16, 0.2); },
    splash: () => { tone(300, 0.25, 'sawtooth', 0.06); tone(150, 0.3, 'sine', 0.12, 0.03); },
    emote: () => tone(880, 0.08, 'sine', 0.08),
  };

  // ---------- PARTÍCULAS ----------
  function spawnParticles(x, y, color, n, speed) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = speed * (0.4 + Math.random() * 0.6);
      particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 0.7, maxLife: 0.7, color, r: 2 + Math.random() * 2.5 });
    }
  }

  // ---------- FÍSICA ----------
  function frictionPerSec(t) {
    if (t === 's') return 0.0005;  // arena: frena muchísimo
    if (t === 'i') return 0.85;    // hielo: casi no frena
    return 0.32;                   // césped
  }

  function step(dt) {
    if (ball.sinking > 0) { ball.sinking -= dt; return; }
    if (!ball.moving) return;

    const speed0 = Math.hypot(ball.vx, ball.vy);
    const sub = Math.max(1, Math.ceil((speed0 * dt) / 4)); // sin túneles
    const sdt = dt / sub;

    for (let i = 0; i < sub; i++) {
      const t = tileAt(ball.x, ball.y);

      // rampas
      const SLOPE_A = 460;
      if (t === '>') ball.vx += SLOPE_A * sdt;
      else if (t === '<') ball.vx -= SLOPE_A * sdt;
      else if (t === '^') ball.vy -= SLOPE_A * sdt;
      else if (t === 'v') ball.vy += SLOPE_A * sdt;

      // fricción exponencial
      const f = Math.pow(frictionPerSec(t), sdt);
      ball.vx *= f; ball.vy *= f;

      ball.x += ball.vx * sdt;
      ball.y += ball.vy * sdt;

      collideWalls();
      collideBumpers();

      // agua
      if (tileAt(ball.x, ball.y) === 'w') { splash(); return; }

      // copa
      const cup = course.cup;
      const d = Math.hypot(ball.x - cup.x, ball.y - cup.y);
      const sp = Math.hypot(ball.vx, ball.vy);
      if (d < CUP_R + 2 && sp < SINK_SPEED * 2.2) {
        // atracción suave hacia la copa
        ball.vx += (cup.x - ball.x) * 14 * sdt;
        ball.vy += (cup.y - ball.y) * 14 * sdt;
      }
      if (d < CUP_R - 3 && sp < SINK_SPEED) { sink(); return; }
    }

    // parada
    if (Math.hypot(ball.vx, ball.vy) < 7) {
      ball.vx = 0; ball.vy = 0; ball.moving = false;
      // si queda parada al borde del agua no pasa nada; si sobre arena, ok
      sendPos(true);
    }
  }

  function collideWalls() {
    const tx0 = Math.floor((ball.x - BALL_R) / TILE), tx1 = Math.floor((ball.x + BALL_R) / TILE);
    const ty0 = Math.floor((ball.y - BALL_R) / TILE), ty1 = Math.floor((ball.y + BALL_R) / TILE);
    let bounced = false;
    for (let ty = ty0; ty <= ty1; ty++) {
      for (let tx = tx0; tx <= tx1; tx++) {
        const t = (tx < 0 || tx >= COLS || ty < 0 || ty >= ROWS) ? '#' : course.grid[ty][tx];
        if (t !== '#') continue;
        const rx = tx * TILE, ry = ty * TILE;
        const cx = Math.max(rx, Math.min(ball.x, rx + TILE));
        const cy = Math.max(ry, Math.min(ball.y, ry + TILE));
        let dx = ball.x - cx, dy = ball.y - cy;
        let d = Math.hypot(dx, dy);
        if (d >= BALL_R) continue;
        if (d === 0) { dx = ball.x - (rx + TILE / 2); dy = ball.y - (ry + TILE / 2); d = Math.hypot(dx, dy) || 1; }
        const nx = dx / d, ny = dy / d;
        ball.x += nx * (BALL_R - d);
        ball.y += ny * (BALL_R - d);
        const dot = ball.vx * nx + ball.vy * ny;
        if (dot < 0) {
          ball.vx -= (1 + RESTITUTION) * dot * nx;
          ball.vy -= (1 + RESTITUTION) * dot * ny;
          bounced = true;
        }
      }
    }
    if (bounced && Math.hypot(ball.vx, ball.vy) > 60) sfx.wall();
  }

  function collideBumpers() {
    for (const b of course.bumpers) {
      const dx = ball.x - b.x, dy = ball.y - b.y;
      const d = Math.hypot(dx, dy);
      const minD = BALL_R + BUMPER_R;
      if (d >= minD || d === 0) continue;
      const nx = dx / d, ny = dy / d;
      ball.x = b.x + nx * minD;
      ball.y = b.y + ny * minD;
      const dot = ball.vx * nx + ball.vy * ny;
      if (dot < 0) { ball.vx -= 2 * dot * nx; ball.vy -= 2 * dot * ny; }
      // los bumpers dan un empujón extra
      const sp = Math.max(Math.hypot(ball.vx, ball.vy) * 1.05, 330);
      const a = Math.atan2(ball.vy, ball.vx);
      ball.vx = Math.cos(a) * sp; ball.vy = Math.sin(a) * sp;
      b.flash = 0.25;
      sfx.bumper();
      spawnParticles(b.x + nx * BUMPER_R, b.y + ny * BUMPER_R, '#ffd740', 8, 160);
    }
  }

  function splash() {
    sfx.splash();
    spawnParticles(ball.x, ball.y, '#4fc3f7', 18, 200);
    showBanner('💦 ¡Al agua!', '+1 golpe de penalización');
    if (socket) socket.emit('penalty', { hole: holeIdx });
    myScores[holeIdx] = Math.min(99, myScores[holeIdx] + 1);
    ball.x = lastShotPos.x; ball.y = lastShotPos.y;
    ball.vx = 0; ball.vy = 0; ball.moving = false;
    updateHud(); renderScoreboard(); sendPos(true);
  }

  function sink() {
    ball.moving = false; ball.vx = 0; ball.vy = 0;
    ball.sinking = 0.45; // animación
    sfx.sink();
    spawnParticles(course.cup.x, course.cup.y, myColor, 22, 220);
    if (socket) socket.emit('sunk', { hole: holeIdx });

    const s = myScores[holeIdx], par = course.par;
    const diff = s - par;
    let msg;
    if (s === 1) msg = '⛳ ¡¡HOYO EN UNO!!';
    else if (diff <= -2) msg = '🦅 ¡Eagle!';
    else if (diff === -1) msg = '🐦 ¡Birdie!';
    else if (diff === 0) msg = '✅ Par';
    else if (diff === 1) msg = 'Bogey';
    else if (diff === 2) msg = 'Doble bogey';
    else msg = `+${diff} golpes`;
    showBanner(msg, `Hoyo ${holeIdx + 1} en ${s} golpe${s === 1 ? '' : 's'}`);

    setTimeout(() => {
      if (holeIdx >= TOTAL_HOLES - 1) { finishGame(); }
      else { loadHole(holeIdx + 1); }
    }, 1700);
  }

  // ---------- FLUJO DE HOYOS ----------
  function loadHole(idx) {
    holeIdx = idx;
    course = parseCourse(idx);
    ball.x = course.start.x; ball.y = course.start.y;
    ball.vx = 0; ball.vy = 0; ball.moving = false; ball.sinking = 0; ball.visible = true;
    lastShotPos = { x: ball.x, y: ball.y };
    updateHud(); renderScoreboard();
    showBanner(`Hoyo ${idx + 1} · ${course.name}`, `Par ${course.par}`);
    sendPos(true);
  }

  function finishGame() {
    finished = true;
    finalScreen.classList.remove('hidden');
    renderFinal();
  }

  function shoot(dx, dy, power) {
    initAudio();
    lastShotPos = { x: ball.x, y: ball.y };
    ball.vx = dx * power * MAX_SPEED;
    ball.vy = dy * power * MAX_SPEED;
    ball.moving = true;
    myScores[holeIdx] = Math.min(99, myScores[holeIdx] + 1);
    sfx.hit(power);
    spawnParticles(ball.x, ball.y, '#ffffff', 5, 60);
    if (socket) socket.emit('stroke', { hole: holeIdx });
    updateHud(); renderScoreboard();

    if (myScores[holeIdx] >= MAX_STROKES) {
      // límite de golpes: pasa al siguiente hoyo
      setTimeout(() => {
        if (ball.moving) { ball.moving = false; ball.vx = 0; ball.vy = 0; }
        showBanner('😅 Límite de golpes', `Máximo ${MAX_STROKES} por hoyo`);
        if (socket) socket.emit('sunk', { hole: holeIdx });
        setTimeout(() => {
          if (holeIdx >= TOTAL_HOLES - 1) finishGame();
          else loadHole(holeIdx + 1);
        }, 1400);
      }, 2500);
    }
  }

  // ---------- ENTRADA ----------
  function canvasPos(e) {
    const r = canvas.getBoundingClientRect();
    return { x: (e.clientX - r.left) * (W / r.width), y: (e.clientY - r.top) * (H / r.height) };
  }

  canvas.addEventListener('pointerdown', (e) => {
    initAudio();
    if (ball.moving || ball.sinking > 0 || finished) return;
    const p = canvasPos(e);
    aiming = true; aimX = p.x; aimY = p.y;
    canvas.setPointerCapture(e.pointerId);
    e.preventDefault();
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!aiming) return;
    const p = canvasPos(e);
    aimX = p.x; aimY = p.y;
    e.preventDefault();
  });
  canvas.addEventListener('pointerup', (e) => {
    if (!aiming) return;
    aiming = false;
    const p = canvasPos(e);
    const dx = ball.x - p.x, dy = ball.y - p.y; // tirachinas: arrastra hacia atrás
    const dist = Math.hypot(dx, dy);
    if (dist < 12) return; // toque accidental
    const power = Math.min(dist, MAX_DRAG) / MAX_DRAG;
    shoot(dx / dist, dy / dist, power);
    e.preventDefault();
  });

  // ---------- RED ----------
  function connect(name, room) {
    socket = io();
    let started = false;
    socket.on('connect', () => {
      // en reconexiones enviamos el progreso para restaurarlo
      socket.emit('join', { name, room, hole: holeIdx, scores: myScores, finished }, (res) => {
        if (res && res.error) { $('lobbyError').textContent = res.error; return; }
        myId = res.id; myColor = res.color; roomCode = res.room;
        players.clear();
        for (const p of res.players) {
          if (p.id !== myId) players.set(p.id, { ...p, tx: p.x, ty: p.y, emote: null, emoteT: 0 });
        }
        if (!started) { started = true; startGame(); }
        else { renderScoreboard(); sendPos(true); addChat(null, 'Reconectado ✔', myColor); }
      });
    });

    socket.on('playerJoined', (p) => {
      players.set(p.id, { ...p, tx: p.x, ty: p.y, emote: null, emoteT: 0 });
      addChat(null, `${p.name} se ha unido 👋`, p.color);
      renderScoreboard();
    });
    socket.on('playerLeft', ({ id }) => {
      const p = players.get(id);
      if (p) addChat(null, `${p.name} se ha ido`, p.color);
      players.delete(id);
      renderScoreboard(); renderFinal();
    });
    socket.on('pos', (d) => {
      const p = players.get(d.id);
      if (!p) return;
      p.tx = d.x; p.ty = d.y; p.hole = d.hole; p.moving = d.moving;
    });
    socket.on('stroke', (d) => {
      if (d.id === myId) return;
      const p = players.get(d.id);
      if (!p) return;
      p.scores[d.hole] = d.strokes;
      renderScoreboard();
    });
    socket.on('sunk', (d) => {
      if (d.id === myId) return;
      const p = players.get(d.id);
      if (!p) return;
      p.scores[d.hole] = d.strokes;
      if (d.hole === holeIdx) spawnParticles(course.cup.x, course.cup.y, p.color, 14, 180);
      renderScoreboard();
    });
    socket.on('holeChange', (d) => {
      const p = players.get(d.id);
      if (p) { p.hole = d.hole; renderScoreboard(); }
    });
    socket.on('finished', (d) => {
      const p = players.get(d.id);
      if (p) { p.finished = true; addChat(null, `🏁 ${d.name} ha terminado con ${d.total} golpes`, d.color); }
      renderScoreboard(); renderFinal();
    });
    socket.on('chat', (m) => addChat(m.name, m.text, m.color));
    socket.on('emote', (d) => {
      sfx.emote();
      const p = players.get(d.id);
      if (p) { p.emote = d.emote; p.emoteT = 1.6; }
    });
  }

  function sendPos(force) {
    if (!socket || !myId) return;
    const now = performance.now();
    if (!force && now - lastPosSent < 50) return;
    lastPosSent = now;
    socket.emit('pos', { x: Math.round(ball.x), y: Math.round(ball.y), m: ball.moving ? 1 : 0 });
  }

  // ---------- UI ----------
  function updateHud() {
    holeInfo.textContent = `Hoyo ${holeIdx + 1}/${TOTAL_HOLES} · Par ${course.par} · ${course.name}`;
    strokeInfo.textContent = `Golpes: ${myScores[holeIdx]} | Total: ${myScores.reduce((a, b) => a + b, 0)}`;
  }

  function showBanner(title, sub) {
    holeBanner.innerHTML = `${title}<small>${sub || ''}</small>`;
    holeBanner.classList.remove('hidden');
    clearTimeout(bannerTimer);
    bannerTimer = setTimeout(() => holeBanner.classList.add('hidden'), 1900);
  }

  function allPlayersList() {
    const list = [{ id: myId, name: myName + ' (tú)', color: myColor, hole: holeIdx, scores: myScores, finished, me: true }];
    for (const p of players.values()) list.push(p);
    return list;
  }

  function renderScoreboard() {
    const list = allPlayersList().map((p) => ({ ...p, total: p.scores.reduce((a, b) => a + b, 0) }));
    list.sort((a, b) => (b.finished - a.finished) || (b.hole - a.hole) || (a.total - b.total));
    scoreList.innerHTML = list.map((p) => `
      <div class="score-row${p.me ? ' me' : ''}">
        <span class="dot" style="background:${p.color}"></span>
        <span class="sname">${esc(p.name)}</span>
        <span class="shole">${p.finished ? '🏁' : 'H' + (p.hole + 1)}</span>
        <span class="stotal">${p.total}</span>
      </div>`).join('');
  }

  function renderFinal() {
    if (finalScreen.classList.contains('hidden')) return;
    const list = allPlayersList().map((p) => ({ ...p, total: p.scores.reduce((a, b) => a + b, 0) }));
    const done = list.filter((p) => p.finished).sort((a, b) => a.total - b.total);
    const playing = list.filter((p) => !p.finished);
    const medal = ['🥇', '🥈', '🥉'];
    $('finalRanking').innerHTML =
      done.map((p, i) => `
        <div class="final-row">
          <span class="pos">${medal[i] || (i + 1) + 'º'}</span>
          <span class="dot" style="background:${p.color}"></span>
          <span class="fname">${esc(p.name)}</span>
          <span class="ftotal">${p.total} golpes</span>
        </div>`).join('') +
      playing.map((p) => `
        <div class="final-row" style="opacity:.55">
          <span class="pos">…</span>
          <span class="dot" style="background:${p.color}"></span>
          <span class="fname">${esc(p.name)}</span>
          <span class="ftotal">en el hoyo ${p.hole + 1}</span>
        </div>`).join('');
  }

  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function addChat(name, text, color) {
    const div = document.createElement('div');
    if (name) div.innerHTML = `<b style="color:${color}">${esc(name)}:</b> ${esc(text)}`;
    else { div.className = 'sys'; div.innerHTML = `<span style="color:${color}">●</span> ${esc(text)}`; }
    chatLog.appendChild(div);
    while (chatLog.children.length > 80) chatLog.removeChild(chatLog.firstChild);
    chatLog.scrollTop = chatLog.scrollHeight;
  }

  chatForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const txt = chatInput.value.trim();
    if (txt && socket) socket.emit('chat', txt);
    chatInput.value = '';
  });

  document.querySelectorAll('.emote').forEach((b) => {
    b.addEventListener('click', () => { if (socket) socket.emit('emote', b.textContent); });
  });

  roomInfo.addEventListener('click', () => {
    const url = `${location.origin}${location.pathname}?room=${roomCode}`;
    navigator.clipboard.writeText(url).then(() => {
      roomInfo.textContent = '✅ ¡Enlace copiado!';
      setTimeout(() => { roomInfo.textContent = `🔗 Sala: ${roomCode}`; }, 1500);
    });
  });

  // ---------- RENDER ----------
  let lastT = performance.now();
  function frame(now) {
    const dt = Math.min(0.033, (now - lastT) / 1000);
    lastT = now;
    if (course) {
      step(dt);
      if (ball.moving) sendPos(false);
      draw(now / 1000, dt);
    }
    requestAnimationFrame(frame);
  }

  function draw(time, dt) {
    ctx.clearRect(0, 0, W, H);
    ctx.drawImage(course.prerender, 0, 0);

    // agua animada
    for (const wt of course.waterTiles) {
      const px = wt.x * TILE, py = wt.y * TILE;
      const ph = Math.sin(time * 2 + wt.x * 0.9 + wt.y * 1.3) * 0.5 + 0.5;
      ctx.fillStyle = `rgba(79,195,247,${0.10 + ph * 0.14})`;
      ctx.fillRect(px, py, TILE, TILE);
    }

    // flechas de rampa animadas
    for (const s of course.slopes) {
      const px = s.x * TILE + TILE / 2, py = s.y * TILE + TILE / 2;
      const pulse = (time * 1.6 + s.x * 0.4 + s.y * 0.4) % 1;
      ctx.save();
      ctx.translate(px, py);
      if (s.t === '<') ctx.rotate(Math.PI);
      else if (s.t === '^') ctx.rotate(-Math.PI / 2);
      else if (s.t === 'v') ctx.rotate(Math.PI / 2);
      ctx.globalAlpha = 0.35 + pulse * 0.4;
      ctx.fillStyle = '#eaffea';
      ctx.beginPath();
      ctx.moveTo(-8 + pulse * 6, -7); ctx.lineTo(2 + pulse * 6, 0); ctx.lineTo(-8 + pulse * 6, 7);
      ctx.closePath(); ctx.fill();
      ctx.restore();
    }

    // bandera
    drawFlag(course.cup.x, course.cup.y, time);

    // bumpers
    for (const b of course.bumpers) {
      if (b.flash > 0) b.flash -= dt;
      const g = ctx.createRadialGradient(b.x - 4, b.y - 4, 2, b.x, b.y, BUMPER_R);
      g.addColorStop(0, b.flash > 0 ? '#fff7c0' : '#ffe082');
      g.addColorStop(1, b.flash > 0 ? '#ffd740' : '#f59f00');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(b.x, b.y, BUMPER_R + (b.flash > 0 ? 2 : 0), 0, 7); ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,.3)'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(b.x, b.y, BUMPER_R, 0, 7); ctx.stroke();
    }

    // jugadores remotos (mismo hoyo)
    for (const p of players.values()) {
      p.x += (p.tx - p.x) * Math.min(1, dt * 14);
      p.y += (p.ty - p.y) * Math.min(1, dt * 14);
      if (p.emoteT > 0) p.emoteT -= dt;
      if (p.hole !== holeIdx || p.finished) continue;
      drawBall(p.x, p.y, p.color, 0.55, p.name);
      if (p.emote && p.emoteT > 0) {
        ctx.font = '22px serif'; ctx.textAlign = 'center';
        ctx.globalAlpha = Math.min(1, p.emoteT * 2);
        ctx.fillText(p.emote, p.x, p.y - 24 - (1.6 - p.emoteT) * 14);
        ctx.globalAlpha = 1;
      }
    }

    // mi bola
    if (ball.sinking > 0) {
      const k = Math.max(0, ball.sinking / 0.45);
      ctx.globalAlpha = k;
      drawBall(course.cup.x, course.cup.y, myColor, 1, null, k);
      ctx.globalAlpha = 1;
    } else if (ball.visible) {
      drawBall(ball.x, ball.y, myColor, 1, null);
    }

    // línea de apuntado
    if (aiming && !ball.moving) {
      const dx = ball.x - aimX, dy = ball.y - aimY;
      const dist = Math.hypot(dx, dy);
      if (dist > 12) {
        const power = Math.min(dist, MAX_DRAG) / MAX_DRAG;
        const nx = dx / dist, ny = dy / dist;
        const len = 30 + power * 90;
        // flecha de dirección
        ctx.strokeStyle = `rgba(255,255,255,.85)`;
        ctx.lineWidth = 3; ctx.setLineDash([7, 6]);
        ctx.beginPath();
        ctx.moveTo(ball.x, ball.y);
        ctx.lineTo(ball.x + nx * len, ball.y + ny * len);
        ctx.stroke(); ctx.setLineDash([]);
        // punta
        const tipX = ball.x + nx * len, tipY = ball.y + ny * len;
        const a = Math.atan2(ny, nx);
        ctx.fillStyle = power > 0.8 ? '#ff5252' : power > 0.45 ? '#ffd740' : '#69f0ae';
        ctx.beginPath();
        ctx.moveTo(tipX + Math.cos(a) * 12, tipY + Math.sin(a) * 12);
        ctx.lineTo(tipX + Math.cos(a + 2.5) * 9, tipY + Math.sin(a + 2.5) * 9);
        ctx.lineTo(tipX + Math.cos(a - 2.5) * 9, tipY + Math.sin(a - 2.5) * 9);
        ctx.closePath(); ctx.fill();
        // barra de potencia junto a la bola
        ctx.fillStyle = 'rgba(0,0,0,.5)';
        ctx.fillRect(ball.x - 24, ball.y + 18, 48, 7);
        ctx.fillStyle = power > 0.8 ? '#ff5252' : power > 0.45 ? '#ffd740' : '#69f0ae';
        ctx.fillRect(ball.x - 23, ball.y + 19, 46 * power, 5);
      }
    }

    // partículas
    for (let i = particles.length - 1; i >= 0; i--) {
      const pt = particles[i];
      pt.life -= dt;
      if (pt.life <= 0) { particles.splice(i, 1); continue; }
      pt.x += pt.vx * dt; pt.y += pt.vy * dt;
      pt.vx *= 0.96; pt.vy *= 0.96;
      ctx.globalAlpha = pt.life / pt.maxLife;
      ctx.fillStyle = pt.color;
      ctx.beginPath(); ctx.arc(pt.x, pt.y, pt.r, 0, 7); ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  function drawBall(x, y, color, alpha, label, scale = 1) {
    ctx.save();
    ctx.globalAlpha = alpha;
    // sombra
    ctx.fillStyle = 'rgba(0,0,0,.3)';
    ctx.beginPath(); ctx.ellipse(x + 2, y + 4, BALL_R * scale, BALL_R * 0.6 * scale, 0, 0, 7); ctx.fill();
    // bola
    const g = ctx.createRadialGradient(x - 3, y - 3, 1, x, y, BALL_R * scale);
    g.addColorStop(0, '#ffffff');
    g.addColorStop(0.35, color);
    g.addColorStop(1, shade(color, -35));
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(x, y, BALL_R * scale, 0, 7); ctx.fill();
    if (label) {
      ctx.font = 'bold 12px Segoe UI, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(0,0,0,.55)';
      const w = ctx.measureText(label).width + 10;
      ctx.fillRect(x - w / 2, y - 30, w, 16);
      ctx.fillStyle = '#fff';
      ctx.fillText(label, x, y - 18);
    }
    ctx.restore();
  }

  function shade(hex, amt) {
    const n = parseInt(hex.slice(1), 16);
    const r = Math.max(0, Math.min(255, (n >> 16) + amt));
    const g = Math.max(0, Math.min(255, ((n >> 8) & 255) + amt));
    const b = Math.max(0, Math.min(255, (n & 255) + amt));
    return `rgb(${r},${g},${b})`;
  }

  function drawFlag(x, y, time) {
    const wave = Math.sin(time * 3) * 3;
    ctx.strokeStyle = '#e8e8e8'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(x, y - 2); ctx.lineTo(x, y - 46); ctx.stroke();
    ctx.fillStyle = '#ff5252';
    ctx.beginPath();
    ctx.moveTo(x, y - 46);
    ctx.quadraticCurveTo(x + 14 + wave, y - 42, x + 26 + wave, y - 38);
    ctx.quadraticCurveTo(x + 14 + wave, y - 34, x, y - 30);
    ctx.closePath(); ctx.fill();
  }

  // ---------- ARRANQUE ----------
  function startGame() {
    lobby.classList.add('hidden');
    game.classList.remove('hidden');
    roomInfo.textContent = `🔗 Sala: ${roomCode}`;
    addChat(null, `Bienvenido a la sala ${roomCode}. ¡Arrastra desde la bola y suelta para golpear!`, myColor);
    loadHole(0);
    renderScoreboard();
  }

  $('playBtn').addEventListener('click', () => {
    initAudio();
    myName = $('nameInput').value.trim() || 'Jugador' + Math.floor(Math.random() * 99);
    const room = $('roomInput').value.trim();
    $('lobbyError').textContent = '';
    connect(myName, room);
  });
  $('nameInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('playBtn').click(); });
  $('roomInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('playBtn').click(); });

  // sala por URL (?room=ABCD)
  const urlRoom = new URLSearchParams(location.search).get('room');
  if (urlRoom) $('roomInput').value = urlRoom.toUpperCase();
  $('nameInput').focus();

  requestAnimationFrame(frame);
})();
