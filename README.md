# ⛳ GolfRoyale

Minigolf **multijugador online** en tiempo real. **3 mapas y 30 hoyos** con arena, agua, hielo, rampas, bumpers y laberintos. Salas privadas con sala de espera, rondas sincronizadas con tiempo límite, colisión entre bolas, chat, emotes y marcador en vivo. Sin frameworks: HTML5 Canvas + Node.js + Socket.IO.

![Node](https://img.shields.io/badge/node-%3E%3D18-green) ![License](https://img.shields.io/badge/license-MIT-blue)

## 🎮 Cómo se juega

- Crea una sala (o entra con un código) y espera a tus amigos en la **sala de espera**. El anfitrión 👑 elige **mapa** (Clásico ⛳ 12 hoyos · Tropical 🏝️ 9 · Caos 🌀 9), **tiempo por hoyo** (30 s – 3 min o sin límite) y si hay **colisión entre bolas**.
- **Arrastra desde la bola hacia atrás** (tirachinas) y suelta para golpear. Cuanto más arrastres, más fuerte.
- Todos juegan el mismo hoyo a la vez: se pasa al siguiente cuando **todos embocan o se acaba el tiempo** (quien no terminó recibe par+2).
- Verde = césped · Beis = arena (frena) · Azul = agua (+1 golpe de penalización) · Celeste = hielo (resbala) · Flechas = rampas · Círculos amarillos = bumpers.
- ¡Las bolas chocan entre sí! Puedes desviar (o ayudar) a tus rivales.
- Gana quien complete el recorrido con **menos golpes**.

## 🚀 Ejecutar en local

```bash
npm install
npm start
# abre http://localhost:3000
```

## ☁️ Desplegar gratis (Render)

El juego usa WebSockets persistentes, así que necesita un servidor Node siempre activo (Vercel serverless no soporta Socket.IO; ver nota abajo).

1. Sube el repo a GitHub.
2. En [render.com](https://render.com) → **New → Web Service** → conecta el repo.
3. Render detecta `render.yaml` automáticamente (plan gratuito, `npm start`). ¡Listo!

También funciona igual en **Railway**, **Fly.io** o cualquier VPS con Node 18+.

> **Nota sobre Vercel/Neon:** Vercel no mantiene conexiones WebSocket en funciones serverless, por eso se recomienda Render. No hace falta base de datos (el estado de las salas vive en memoria); si algún día quieres rankings históricos persistentes, Neon (Postgres) sería el complemento perfecto.

## 🛠️ Estructura

```
server.js              Servidor Express + Socket.IO (salas, rondas, marcador, chat)
public/index.html      Lobby, sala de espera, HUD, chat y pantalla final
public/style.css       Estilos
public/courses.js      Los 3 mapas (30 hoyos) definidos como rejillas ASCII de tiles
public/game.js         Física, render canvas, entrada y red (cliente)
tools/validate-courses.js  Validador de mapas
tools/test-bot.js      Bot de pruebas multijugador (node tools/test-bot.js SALA Nombre)
```

### Crear tus propios hoyos

Edita `public/courses.js` (puedes añadir hoyos a un mapa o crear un set nuevo en `SETS`). Cada hoyo es una rejilla de 24×15 caracteres (tiles de 40 px):

| Tile | Significado |
|------|-------------|
| `#`  | Muro |
| `.`  | Césped |
| `S`  | Salida |
| `H`  | Hoyo |
| `s`  | Arena |
| `w`  | Agua |
| `i`  | Hielo |
| `B`  | Bumper |
| `>` `<` `^` `v` | Rampas |

Valida tus mapas con: `node tools/validate-courses.js`

## 📄 Licencia

MIT — haz lo que quieras con él.
