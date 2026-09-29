# 🛡️ Justice League Chat

A Justice League themed real-time web chat app. Enter the Watchtower with the site password, create your hero name, pick an alias, and start chatting.

![Theme](https://img.shields.io/badge/theme-Justice%20League-d6273e) ![Stack](https://img.shields.io/badge/stack-Node.js%20%2B%20Socket.IO-339933)

## ⚡ Features

- **Password gate** — everyone who opens the site must enter the site password before they can enter
- **Username creation** — visitors create their own hero name (3–20 chars) and pick a Justice League alias with an avatar
- **Group chat** — themed channels (Hall of Justice, Watchtower Ops, Metropolis, Gotham, Atlantis) plus the ability to create new channels
- **Individual (direct) chat** — click any online member to open a private 1:1 conversation
- **Online presence** — see who's in the Hall in real time
- **Typing indicators**, unread badges and message history

## 🚀 Run it

Requires [Node.js](https://nodejs.org) 18+.

```bash
npm install
npm start
```

Then open **http://localhost:3000**.

### Default password

```
watchtower
```

Change it by setting the `SITE_PASSWORD` environment variable before starting:

```bash
# Linux / macOS
SITE_PASSWORD="my-secret" npm start

# Windows (PowerShell)
$env:SITE_PASSWORD="my-secret"; npm start
```

## 🧩 Tech

- **Backend:** Node.js, Express, Socket.IO
- **Frontend:** vanilla HTML/CSS/JS — no build step, served straight from `public/`
- **Storage:** in-memory (sessions, presence, last 200 messages per room/DM) — resets when the server restarts

## 📜 Notes

- One active connection per hero name; a name can't be used by two people at once.
- DMs only work between members who are currently online.
- For a persistent production deployment, swap the in-memory maps for a database and add proper authentication.
