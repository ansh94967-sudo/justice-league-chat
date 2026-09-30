<div align="center">

# 🛡️ Justice League Chat

**A cinematic, real-time Watchtower chat. Speak the password, pick your hero, and join the League.**

[![Node.js](https://img.shields.io/badge/Node.js-18%2B-339933?logo=node.js&logoColor=white)](https://nodejs.org)
[![Socket.IO](https://img.shields.io/badge/Socket.IO-4.x-010101?logo=socket.io&logoColor=white)](https://socket.io)
[![License: MIT](https://img.shields.io/badge/License-MIT-e62945.svg)](LICENSE)

<img src="docs/screenshot-gate.png" width="380" alt="The password gate" />
<img src="docs/screenshot-chat.png" width="540" alt="The main chat" />

<img src="docs/screenshot-identity.png" width="380" alt="Picking your hero identity" />
<img src="docs/screenshot-dm.png" width="540" alt="A direct message conversation" />

<img src="docs/screenshot-landscape-gate.png" width="540" alt="Phone in landscape — the two-column login" />
<img src="docs/screenshot-landscape-chat.png" width="540" alt="Phone in landscape — the chat layout" />

*A fan-made project — not affiliated with DC Comics.*

</div>

---

## ⚡ Features

### Getting in
- **Password gate** — nobody enters the Watchtower without the site password (set your own via `SITE_PASSWORD`)
- **Hero identity** — every visitor creates a unique hero name and picks one of **16 League aliases** (Superman, Batman, Wonder Woman, The Flash, Aquaman, Cyborg, and more), each with a color-coded avatar
- **One hero, one connection** — duplicate names are blocked while active

### Talking
- **Group channels** — five themed channels by default (Hall of Justice, Watchtower Ops, Metropolis, Gotham, Atlantis) and anyone can open new ones
- **Direct messages** — click any online hero for a private 1:1 line
- **Emoji reactions** — hover any message and hit ⚡ 💥 🛡️ ❤️ 😂 👍
- **Delete your own messages** — gone for everyone, shown as *“transmission deleted”*
- **Smart message grouping** — consecutive messages from the same hero collapse into a block, with day dividers and auto-linkified URLs
- **Typing indicators** — per channel and per DM, multi-user aware
- **Live presence** — who's online, who's in the channel, join/leave announcements in the Hall
- **Unread badges** — sidebar badges, tab-title counter and a jump-to-latest button
- **Sound notifications** — a soft ping for new messages, with a mute toggle

### Under the hood
- **Reconnect-safe sessions** — session tokens rotate on every connection, so a flaky Wi-Fi never logs you out
- **Rate limiting** — a token bucket keeps speedsters from flooding the Hall
- **XSS-safe rendering** — all message text is rendered through text nodes; nothing is ever `innerHTML`-ed from user input
- **Fits every phone** — dedicated layouts for portrait *and* landscape (the drawer, compact header and two-column login respond to viewport **height** as well as width), safe-area insets for notches, and dynamic viewport height so Android browser chrome never clips the composer
- **Connection status** — a live "Link stable / Reconnecting…" pill

## 🚀 Quick start

Requires [Node.js](https://nodejs.org) 18 or newer.

```bash
git clone https://github.com/ansh94967-sudo/justice-league-chat.git
cd justice-league-chat
npm install
npm start
```

Open **http://localhost:3000** and enter the default password:

```
watchtower
```

> Open the app in two browser windows with different hero names to try the chat.

## 🔧 Configuration

| Environment variable | Default    | Description                          |
| -------------------- | ---------- | ------------------------------------ |
| `SITE_PASSWORD`      | `watchtower` | The password everyone must enter    |
| `PORT`               | `3000`     | Port the server listens on           |

```bash
# Linux / macOS
SITE_PASSWORD="my-secret" PORT=8080 npm start

# Windows (PowerShell)
$env:SITE_PASSWORD="my-secret"; npm start
```

## ✅ Testing

```bash
npm test        # 23 integration tests: gate, rooms, DMs, reactions, deletion,
                # rate limiting, session renewal, presence, system messages
node visual-qa.js      # optional: headless-browser visual QA + screenshots (needs puppeteer-core)
node responsive-qa.js  # optional: checks nothing is clipped on 6 phone sizes
                       # (portrait + landscape) and writes screenshots to docs/responsive/
```

## ☁️ Deployment

Any Node host works — [Render](https://render.com), [Railway](https://railway.app), [Fly.io](https://fly.io), or your own VPS.

- **Build command:** `npm install`
- **Start command:** `npm start`
- Set `SITE_PASSWORD` in the host's environment variables
- WebSocket support is built in (Socket.IO) — no extra config on the hosts above

## 📜 Project structure

```
├── server.js              # Express + Socket.IO backend
├── test-integration.js    # end-to-end integration tests
├── visual-qa.js           # headless-browser visual QA & screenshots
├── docs/                  # screenshots used in this README
└── public/
    ├── index.html         # gate + chat markup
    ├── style.css          # Watchtower theme (starfield, glass, glow)
    ├── app.js             # all client logic
    └── favicon.svg        # the shield
```

## ⚠️ Notes & roadmap

- State is **in-memory** (sessions, presence, last 300 messages per conversation) and resets on server restart. For a persistent deployment, back it with a database.
- The password gate is a shared passphrase, not per-user authentication — fine for a fun project, not for secrets.
- Ideas: private channels, message search, hero themes per user, image sharing, translation relay.

## 🛡️ License

[MIT](LICENSE) — © 2026 Ansh Singh
