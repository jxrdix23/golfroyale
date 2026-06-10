// Valida los mapas: dimensiones, una salida y un hoyo por mapa,
// y que ningún tile jugable toque el vacío (la bola no puede escapar).
const { COURSES, COLS, ROWS } = require('../public/courses.js');

const PLAYABLE = new Set(['.', 'S', 'H', 's', 'w', 'i', 'B', '>', '<', '^', 'v']);
let errors = 0;

COURSES.forEach((c, idx) => {
  const g = c.grid.map((row) => row.padEnd(COLS, ' '));
  if (g.length !== ROWS) {
    console.log(`Hoyo ${idx + 1} (${c.name}): tiene ${g.length} filas, esperaba ${ROWS}`);
    errors++;
  }
  let starts = 0, holes = 0, floors = 0;
  for (let y = 0; y < g.length; y++) {
    if (c.grid[y].length > COLS) {
      console.log(`Hoyo ${idx + 1} (${c.name}): fila ${y} mide ${c.grid[y].length} > ${COLS}`);
      errors++;
    }
    for (let x = 0; x < COLS; x++) {
      const t = g[y][x];
      if (t === 'S') starts++;
      if (t === 'H') holes++;
      if (PLAYABLE.has(t)) {
        floors++;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const ny = y + dy, nx = x + dx;
            const n = (ny < 0 || ny >= ROWS || nx < 0 || nx >= COLS) ? ' ' : g[ny][nx];
            if (n === ' ') {
              console.log(`Hoyo ${idx + 1} (${c.name}): fuga en (${x},${y}) '${t}' toca vacío en (${nx},${ny})`);
              errors++;
            }
          }
        }
      }
    }
  }
  if (starts !== 1) { console.log(`Hoyo ${idx + 1} (${c.name}): ${starts} salidas 'S'`); errors++; }
  if (holes !== 1) { console.log(`Hoyo ${idx + 1} (${c.name}): ${holes} hoyos 'H'`); errors++; }
  if (!errors) console.log(`Hoyo ${idx + 1} (${c.name}): OK (${floors} tiles jugables, par ${c.par})`);
});

console.log(errors ? `\n${errors} ERRORES` : '\nTodos los hoyos válidos ✔');
process.exit(errors ? 1 : 0);
