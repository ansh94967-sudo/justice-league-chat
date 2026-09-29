/* ============ Justice League Chat — client ============ */
(() => {
  const $ = sel => document.querySelector(sel);

  const gate = $('#gate');
  const chat = $('#chat');
  const passwordForm = $('#password-form');
  const identityForm = $('#identity-form');
  const passwordInput = $('#password');
  const passwordError = $('#password-error');
  const usernameInput = $('#username');
  const identityError = $('#identity-error');
  const heroGrid = $('#hero-grid');
  const roomListEl = $('#room-list');
  const memberListEl = $('#member-list');
  const onlineCountEl = $('#online-count');
  const messagesEl = $('#messages');
  const messageForm = $('#message-form');
  const messageInput = $('#message-input');
  const panelName = $('#panel-name');
  const panelDesc = $('#panel-desc');
  const panelIcon = $('#panel-icon');
  const typingEl = $('#typing');
  const unreadBanner = $('#unread-banner');
  const meName = $('#me-name');
  const meHero = $('#me-hero');
  const meAvatar = $('#me-avatar');
  const toastEl = $('#toast');
  const newRoomBtn = $('#new-room-btn');
  const logoutBtn = $('#logout-btn');

  const state = {
    me: null,           // { username, hero }
    heroes: [],
    socket: null,
    rooms: [],
    users: [],
    active: null,       // { kind: 'room'|'dm', id, name }  id = roomId or partner username
    openChats: [],      // list of { kind, id, name, unread }
    typingTimers: new Map()
  };

  /* ---------------- helpers ---------------- */
  const heroOf = id => state.heroes.find(h => h.id === id) || { emoji: '🛡️', name: 'Unknown', color: '#8b9bc4' };
  const fmtTime = ts => new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const chatId = c => c.kind === 'room' ? 'room:' + c.id : 'dm:' + c.id;

  let toastTimer;
  function toast(text) {
    toastEl.textContent = text;
    toastEl.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (toastEl.hidden = true), 3500);
  }

  async function api(path, body) {
    const res = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {})
    });
    return { ok: res.ok, data: await res.json().catch(() => ({})) };
  }

  /* ---------------- login flow ---------------- */
  let sitePassword = '';
  let chosenHero = null;

  passwordForm.addEventListener('submit', async e => {
    e.preventDefault();
    passwordError.hidden = true;
    const { ok, data } = await api('/api/verify-password', { password: passwordInput.value });
    if (!ok) {
      passwordError.textContent = data.error || 'Access denied.';
      passwordError.hidden = false;
      return;
    }
    sitePassword = passwordInput.value;
    passwordForm.hidden = true;
    identityForm.hidden = false;
    usernameInput.focus();
  });

  async function loadHeroes() {
    const res = await fetch('/api/heroes');
    const data = await res.json();
    state.heroes = data.heroes;
    heroGrid.innerHTML = '';
    for (const h of state.heroes) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'hero-option';
      b.dataset.hero = h.id;
      b.innerHTML = `<span class="hero-emoji">${h.emoji}</span><span>${h.name}</span>`;
      b.addEventListener('click', () => {
        chosenHero = h.id;
        heroGrid.querySelectorAll('.hero-option').forEach(x => x.classList.toggle('selected', x.dataset.hero === h.id));
      });
      heroGrid.appendChild(b);
    }
  }

  identityForm.addEventListener('submit', async e => {
    e.preventDefault();
    identityError.hidden = true;
    if (!chosenHero) {
      identityError.textContent = 'Pick your League alias first.';
      identityError.hidden = false;
      return;
    }
    const { ok, data } = await api('/api/login', {
      password: sitePassword,
      username: usernameInput.value.trim(),
      hero: chosenHero
    });
    if (!ok) {
      identityError.textContent = data.error || 'Could not assemble.';
      identityError.hidden = false;
      return;
    }
    localStorage.setItem('jl-token', data.token);
    enterChat({ username: data.username, hero: data.hero });
  });

  logoutBtn.addEventListener('click', () => {
    localStorage.removeItem('jl-token');
    location.reload();
  });

  /* ---------------- enter chat / connect ---------------- */
  function enterChat(me) {
    state.me = me;
    state.openChats = [];
    state.active = null;

    meName.textContent = me.username;
    const myHero = heroOf(me.hero);
    meHero.textContent = myHero.name;
    meAvatar.textContent = myHero.emoji;
    meAvatar.style.borderColor = myHero.color;

    gate.hidden = true;
    chat.hidden = false;

    const socket = io({ auth: { token: localStorage.getItem('jl-token') } });
    state.socket = socket;
    bindSocket(socket);

    // open the Hall of Justice by default
    const openDefault = () => {
      if (!state.active && state.rooms.length) openChat({ kind: 'room', id: 'hall-of-justice' });
    };
    socket.on('rooms', openDefault);
    socket.on('connect_error', err => {
      toast(err.message === 'unauthorized' ? 'Session expired — please sign in again.' : 'Connection trouble…');
      if (err.message === 'unauthorized') {
        localStorage.removeItem('jl-token');
        setTimeout(() => location.reload(), 1200);
      }
    });
  }

  /* ---------------- socket events ---------------- */
  function bindSocket(socket) {
    socket.on('rooms', ({ rooms }) => { state.rooms = rooms; renderRooms(); });
    socket.on('presence', ({ users }) => { state.users = users; renderMembers(); });

    socket.on('room:history', ({ roomId, messages }) => {
      if (isActive('room', roomId)) renderMessages(messages);
    });
    socket.on('room:message', ({ roomId, message }) => {
      const c = state.openChats.find(c => c.kind === 'room' && c.id === roomId);
      if (!c) return;
      if (isActive('room', roomId)) appendMessage(message);
      else { c.unread = (c.unread || 0) + 1; renderRooms(); }
    });
    socket.on('room:typing', ({ roomId, username, typing }) => {
      if (!isActive('room', roomId)) return;
      if (typing) {
        state.typingTimers.set('r' + roomId, username);
        typingEl.textContent = `${username} is typing…`;
        clearTimeout(state.typingTimers.get('t' + roomId));
        state.typingTimers.set('t' + roomId, setTimeout(() => { typingEl.textContent = ''; state.typingTimers.delete('r' + roomId); }, 2500));
      } else if (state.typingTimers.get('r' + roomId) === username) {
        clearTimeout(state.typingTimers.get('t' + roomId));
        typingEl.textContent = '';
      }
    });
    socket.on('room:created', ({ roomId }) => openChat({ kind: 'room', id: roomId }));

    socket.on('dm:history', ({ with: partner, messages }) => {
      if (isActive('dm', partner)) renderMessages(messages);
    });
    socket.on('dm:message', ({ message }) => {
      const partner = message.from === state.me.username ? message.to : message.from;
      const c = state.openChats.find(c => c.kind === 'dm' && c.id === partner);
      if (!c) return;
      if (isActive('dm', partner)) appendMessage(message);
      else { c.unread = (c.unread || 0) + 1; renderMembers(); }
    });
    socket.on('dm:typing', ({ from, typing }) => {
      if (!isActive('dm', from)) return;
      typingEl.textContent = typing ? `${from} is typing…` : '';
    });

    socket.on('error:msg', ({ text }) => toast(text));
  }

  const isActive = (kind, id) => state.active && state.active.kind === kind && state.active.id === id;

  /* ---------------- chat management ---------------- */
  function openChat(chat) {
    let c = state.openChats.find(c => c.kind === chat.kind && c.id === chat.id);
    if (!c) {
      c = { ...chat, unread: 0 };
      state.openChats.push(c);
    }
    c.unread = 0;
    state.active = c;

    messagesEl.innerHTML = '';
    typingEl.textContent = '';

    if (c.kind === 'room') {
      const room = state.rooms.find(r => r.id === c.id);
      panelIcon.textContent = '#';
      panelName.textContent = room ? room.name : c.id;
      panelDesc.textContent = room ? room.desc : '';
      state.socket.emit('room:join', { roomId: c.id });
      renderRooms(); renderMembers();
    } else {
      const partner = state.users.find(u => u.username === c.id);
      const hero = partner ? heroOf(partner.hero) : heroOf('superman');
      panelIcon.textContent = hero.emoji;
      panelName.textContent = c.id;
      panelDesc.textContent = 'Direct transmission — ' + hero.name;
      state.socket.emit('dm:open', { with: c.id });
      renderRooms(); renderMembers();
    }
    unreadBanner.hidden = true;
    messageInput.focus();
  }

  /* ---------------- rendering ---------------- */
  function renderRooms() {
    roomListEl.innerHTML = '';
    for (const room of state.rooms) {
      const open = state.openChats.find(c => c.kind === 'room' && c.id === room.id);
      const li = document.createElement('li');
      li.className = 'room-item' + (isActive('room', room.id) ? ' active' : '');
      li.innerHTML = `<span class="hash">#</span><span>${escapeHtml(room.name)}</span>` +
        (open && open.unread ? `<span class="badge">${open.unread}</span>` : '');
      li.addEventListener('click', () => openChat({ kind: 'room', id: room.id }));
      roomListEl.appendChild(li);
    }
  }

  function renderMembers() {
    memberListEl.innerHTML = '';
    onlineCountEl.textContent = state.users.length;
    const users = [...state.users].sort((a, b) => a.username.localeCompare(b.username));
    for (const u of users) {
      if (u.username === state.me.username) continue;
      const hero = heroOf(u.hero);
      const open = state.openChats.find(c => c.kind === 'dm' && c.id === u.username);
      const li = document.createElement('li');
      li.className = 'member-item';
      li.innerHTML = `
        <span class="avatar" style="border-color:${hero.color}">${hero.emoji}</span>
        <div class="member-meta">
          <strong>${escapeHtml(u.username)}</strong>
          <small style="color:${hero.color}">${hero.name}</small>
        </div>
        <span class="member-action" style="color:var(--muted);font-size:11px">DM</span>` +
        (open && open.unread ? `<span class="badge" style="background:var(--red);color:#fff;border-radius:999px;font-size:10px;padding:1px 6px">${open.unread}</span>` : '');
      li.addEventListener('click', () => openChat({ kind: 'dm', id: u.username }));
      memberListEl.appendChild(li);
    }
  }

  function messageNode(message) {
    const own = message.from === state.me.username;
    const hero = heroOf(message.hero);
    const div = document.createElement('div');
    div.className = 'msg' + (own ? ' own' : '');
    div.innerHTML = `
      <span class="avatar" style="border-color:${hero.color}">${hero.emoji}</span>
      <div class="msg-body">
        <div class="msg-head">
          <span class="msg-author" style="color:${hero.color}">${escapeHtml(message.from)}</span>
          <span class="msg-time">${fmtTime(message.ts)}</span>
        </div>
        <div class="msg-text">${escapeHtml(message.text)}</div>
      </div>`;
    return div;
  }

  function appendMessage(message) {
    messagesEl.appendChild(messageNode(message));
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function renderMessages(messages) {
    messagesEl.innerHTML = '';
    for (const m of messages) messagesEl.appendChild(messageNode(m));
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function escapeHtml(s) {
    const div = document.createElement('div');
    div.textContent = String(s);
    return div.innerHTML;
  }

  /* ---------------- sending / typing ---------------- */
  messageForm.addEventListener('submit', e => {
    e.preventDefault();
    const text = messageInput.value.trim();
    if (!text || !state.active) return;
    if (state.active.kind === 'room') {
      state.socket.emit('room:message', { roomId: state.active.id, text });
      state.socket.emit('room:typing', { roomId: state.active.id, typing: false });
    } else {
      state.socket.emit('dm:message', { to: state.active.id, text });
      state.socket.emit('dm:typing', { with: state.active.id, typing: false });
    }
    messageInput.value = '';
    messageInput.focus();
  });

  let typingSent = false;
  let typingReset;
  messageInput.addEventListener('input', () => {
    if (!state.active || !messageInput.value.trim()) return;
    if (!typingSent) {
      typingSent = true;
      if (state.active.kind === 'room')
        state.socket.emit('room:typing', { roomId: state.active.id, typing: true });
      else
        state.socket.emit('dm:typing', { with: state.active.id, typing: true });
    }
    clearTimeout(typingReset);
    typingReset = setTimeout(() => {
      typingSent = false;
      if (!state.active) return;
      if (state.active.kind === 'room')
        state.socket.emit('room:typing', { roomId: state.active.id, typing: false });
      else
        state.socket.emit('dm:typing', { with: state.active.id, typing: false });
    }, 1800);
  });

  /* ---------------- new room ---------------- */
  newRoomBtn.addEventListener('click', () => {
    const name = prompt('Name the new channel:');
    if (name && name.trim()) state.socket.emit('room:create', { name: name.trim() });
  });

  /* ---------------- unread banner ---------------- */
  unreadBanner.addEventListener('click', () => {
    const first = state.openChats.find(c => c.unread);
    if (first) openChat(first);
  });
  setInterval(() => {
    const unread = state.openChats.filter(c => c.unread);
    if (!unread.length) { unreadBanner.hidden = true; return; }
    const next = unread.find(c => !isActive(c.kind, c.id)) || unread[0];
    unreadBanner.textContent = `⚡ ${unread.reduce((s, c) => s + c.unread, 0)} unread — jump to ${next.name || next.id}`;
    unreadBanner.hidden = false;
  }, 800);

  /* ---------------- boot ---------------- */
  (async function boot() {
    await loadHeroes();
    const token = localStorage.getItem('jl-token');
    if (token) {
      const { ok, data } = await api('/api/session', { token });
      if (ok) { enterChat({ username: data.username, hero: data.hero }); return; }
      localStorage.removeItem('jl-token');
    }
    passwordInput.focus();
  })();
})();
