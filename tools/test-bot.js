// Bot de prueba: se une a una sala, escucha eventos y emboca cada hoyo
// tras unos segundos. Uso: node tools/test-bot.js [SALA] [NOMBRE] [DELAY_MS]
const { io } = require('socket.io-client');

const ROOM = process.argv[2] || 'TEST';
const NAME = process.argv[3] || 'Bot';
const SINK_DELAY = parseInt(process.argv[4] || '4000', 10);

const socket = io('http://localhost:3000');
const log = (...a) => console.log(`[${NAME}]`, ...a);

socket.on('connect', () => {
  socket.emit('join', { name: NAME, room: ROOM }, (res) => {
    if (res.error) { log('ERROR:', res.error); process.exit(1); }
    log(`unido a ${res.room} | estado=${res.state} | anfitrión=${res.host === socket.id ? 'yo' : res.host} | jugadores=${res.players.map(p => p.name).join(',')}`);
  });
});

socket.on('playerJoined', (p) => log('se unió:', p.name));
socket.on('playerLeft', () => log('alguien se fue'));
socket.on('settings', (s) => log('ajustes:', JSON.stringify(s)));

socket.on('holeStart', (d) => {
  log(`>> HOYO ${d.hole + 1} empieza (límite: ${d.remainingMs ? d.remainingMs / 1000 + 's' : 'sin límite'})`);
  // simula dos golpes y emboca
  setTimeout(() => socket.emit('stroke', {}), SINK_DELAY / 2);
  setTimeout(() => { socket.emit('stroke', {}); socket.emit('sunk'); log('he embocado'); }, SINK_DELAY);
});

socket.on('sunkP', (d) => log(`sunkP: ${d.id === socket.id ? 'yo' : d.id.slice(0, 5)} con ${d.strokes} golpes (hoyo ${d.hole + 1})`));
socket.on('holeEnd', (d) => log(`<< FIN HOYO ${d.hole + 1}:`, d.results.map(r => `${r.id.slice(0, 5)}=${r.strokes}${r.sunk ? '✓' : '⏱'}`).join(' ')));
socket.on('gameOver', (d) => {
  log('GAME OVER:', d.ranking.map((p, i) => `${i + 1}º ${p.name}(${p.total})`).join(' '));
});
socket.on('backToLobby', () => log('de vuelta a la sala de espera'));

setTimeout(() => { log('saliendo'); process.exit(0); }, 600000);
