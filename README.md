# ⛳ GolfRoyale

Minigolf **multijugador online** en tiempo real. 12 hoyos con arena, agua, hielo, rampas, bumpers y laberintos. Salas privadas para jugar con amigos, chat, emotes y marcador en vivo. Sin frameworks: HTML5 Canvas + Node.js + Socket.IO.

![Node](https://img.shields.io/badge/node-%3E%3D18-green) ![License](https://img.shields.io/badge/license-MIT-blue)

## 🎮 Cómo se juega

- **Arrastra desde la bola hacia atrás** (tirachinas) y suelta para golpear. Cuanto más arrastres, más fuerte.
- Verde = césped · Beis = arena (frena) · Azul = agua (+1 golpe de penalización) · Celeste = hielo (resbala) · Flechas = rampas · Círculos amarillos = bumpers.
- Comparte el **código de sala** (o el enlace con el botón 🔗) para jugar con amigos en tiempo real: veréis las bolas de los demás, chat y emotes.
- Gana quien complete los 12 hoyos con **menos golpes**.

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
server.js              Servidor Express + Socket.IO (salas, marcador, chat)
public/index.html      Lobby, HUD, chat y pantalla final
public/style.css       Estilos
public/courses.js      Los 12 hoyos definidos como mapas ASCII de tiles
public/game.js         Física, render canvas, entrada y red (cliente)
tools/validate-courses.js  Validador de mapas (npm run, ver abajo)
```

### Crear tus propios hoyos

Edita `public/courses.js`. Cada hoyo es una rejilla de 24×15 caracteres (tiles de 40 px):

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
