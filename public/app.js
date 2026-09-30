/* ============================================================
   JUSTICE LEAGUE CHAT — client
   Gate (password → identity) · group channels · direct messages
   reactions · deletion · typing · presence · sounds · mobile
   ============================================================ */
(() => {
  'use strict';

  const $ = sel => document.querySelector(sel);
  const REACTIONS = ['⚡', '💥', '🛡️', '❤️', '😂', '👍'];
  const EMOJI_TRAY = [
    '😀', '😂', '😎', '🤔', '😱', '🥳', '😴', '🤖',
    '⚡', '💥', '🔥', '✨', '🛡️', '⚔️', '🏹', '🔱',
    '❤️', '💜', '💙', '👍', '👎', '🙏', '💪', '🫡',
    '🦇', '🦸', '🌊', '❄️', '🌙', '⭐', '🚀', '🍕'
  ];
  const GROUP_WINDOW = 5 * 60 * 1000; // ms between messages to stay grouped

  /* ---------------- state ---------------- */
  const state = {
    me: null,
    heroes: [],
    socket: null,
    rooms: [],
    users: [],            // online users
    active: null,         // { kind:'room'|'dm', id }
    chats: new Map(),     // key -> { kind, id, unread, lastTs }
    history: new Map(),   // key -> [messages] (local copy for live updates)
    msgEls: new Map(),    // msgId -> element (active view)
    roomPresence: new Map(),
    typing: new Map(),    // key -> Map(username -> timeout)
    muted: localStorage.getItem('jl-muted') === '1',
    sitePassword: ''
  };
  const chatKey = (kind, id) => kind + ':' + id;

  /* ---------------- elements ---------------- */
  const gate = $('#gate');
  const chat = $('#chat');
  const passwordForm = $('#password-form');
  const identityForm = $('#identity-form');
  const passwordInput = $('#password');
  const passwordError = $('#password-error');
  const usernameInput = $('#username');
  const usernameError = $('#username-error');
  const identityError = $('#identity-error');
  const heroGrid = $('#hero-grid');
  const assembleBtn = $('#assemble-btn');
  const togglePasswordBtn = $('#toggle-password');
  const roomListEl = $('#room-list');
  const dmListEl = $('#dm-list');
  const dmEmptyEl = $('#dm-empty');
  const memberListEl = $('#member-list');
  const memberEmptyEl = $('#member-empty');
  const onlineCountEl = $('#online-count');
  const messagesEl = $('#messages');
  const emptyStateEl = $('#empty-state');
  const messageForm = $('#message-form');
  const messageInput = $('#message-input');
  const charCountEl = $('#char-count');
  const emojiBtn = $('#emoji-btn');
  const emojiTrayEl = $('#emoji-tray');
  const panelName = $('#panel-name');
  const panelDesc = $('#panel-desc');
  const panelIcon = $('#panel-icon');
  const roomPresenceChip = $('#room-presence');
  const connPill = $('#conn-pill');
  const connText = $('#conn-text');
  const typingEl = $('#typing');
  const scrollBtn = $('#scroll-btn');
  const meName = $('#me-name');
  const meHero = $('#me-hero');
  const meAvatar = $('#me-avatar');
  const soundBtn = $('#sound-btn');
  const toastEl = $('#toast');
  const newRoomBtn = $('#new-room-btn');
  const logoutBtn = $('#logout-btn');
  const menuBtn = $('#menu-btn');
  const sidebar = $('#sidebar');
  const sidebarClose = $('#sidebar-close');
  const backdropDim = $('#backdrop-dim');

  /* ---------------- helpers ---------------- */
  const heroOf = id => state.heroes.find(h => h.id === id) ||
    { id: 'unknown', name: 'Unknown', emoji: '🛡️', color: '#8b9bc4' };

  function fmtTime(ts) {
    return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
  function fmtDay(ts) {
    const d = new Date(ts), now = new Date();
    const days = (name) => name;
    if (d.toDateString() === now.toDateString()) return days('Today');
    const y = new Date(now); y.setDate(y.getDate() - 1);
    if (d.toDateString() === y.toDateString()) return days('Yesterday');
    return d.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });
  }

  let toastTimer;
  function toast(text) {
    toastEl.textContent = text;
    toastEl.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (toastEl.hidden = true), 4000);
  }

  async function api(path, body) {
    const res = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {})
    });
    return { ok: res.ok, status: res.status, data: await res.json().catch(() => ({})) };
  }

  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }

  /* ---------------- sound ---------------- */
  let audioCtx;
  function ping() {
    if (state.muted) return;
    try {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      const t = audioCtx.currentTime;
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(660, t);
      osc.frequency.exponentialRampToValueAtTime(990, t + 0.08);
      gain.gain.setValueAtTime(0.12, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.28);
      osc.connect(gain).connect(audioCtx.destination);
      osc.start(t); osc.stop(t + 0.3);
    } catch (_) { /* audio unavailable */ }
  }

  /* ============================================================
     GATE
     ============================================================ */
  togglePasswordBtn.addEventListener('click', () => {
    const show = passwordInput.type === 'password';
    passwordInput.type = show ? 'text' : 'password';
    togglePasswordBtn.style.color = show ? 'var(--gold)' : '';
    passwordInput.focus();
  });

  passwordForm.addEventListener('submit', async e => {
    e.preventDefault();
    passwordError.hidden = true;
    const { ok, data } = await api('/api/verify-password', { password: passwordInput.value });
    if (!ok) {
      passwordError.textContent = data.error || 'Access denied.';
      passwordError.hidden = false;
      const field = passwordInput.closest('.field');
      field.classList.remove('shake'); void field.offsetWidth; field.classList.add('shake');
      return;
    }
    state.sitePassword = passwordInput.value;
    passwordForm.hidden = true;
    identityForm.hidden = false;
    identityForm.classList.add('is-active');
    usernameInput.focus();
  });

  usernameInput.addEventListener('input', () => {
    usernameError.hidden = true;
  });

  let chosenHero = null;

  async function loadHeroes() {
    const res = await fetch('/api/heroes');
    const data = await res.json();
    state.heroes = data.heroes;
    heroGrid.innerHTML = '';
    state.heroes.forEach((h, i) => {
      const b = el('button', 'hero-option');
      b.type = 'button';
      b.setAttribute('role', 'radio');
      b.dataset.hero = h.id;
      b.style.animationDelay = (i * 28) + 'ms';
      b.appendChild(el('span', 'hero-emoji', h.emoji));
      b.appendChild(el('span', null, h.name));
      b.addEventListener('click', () => {
        chosenHero = h.id;
        assembleBtn.disabled = false;
        identityError.hidden = true;
        heroGrid.querySelectorAll('.hero-option').forEach(x => {
          const on = x.dataset.hero === h.id;
          x.classList.toggle('selected', on);
          x.setAttribute('aria-checked', on);
        });
      });
      heroGrid.appendChild(b);
    });
  }

  identityForm.addEventListener('submit', async e => {
    e.preventDefault();
    identityError.hidden = true;
    usernameError.hidden = true;
    const name = usernameInput.value.trim();
    if (!/^[A-Za-z0-9_]{3,20}$/.test(name)) {
      usernameError.textContent = 'Hero name must be 3–20 characters (letters, numbers, underscore).';
      usernameError.hidden = false;
      return;
    }
    if (!chosenHero) {
      identityError.textContent = 'Pick your League alias first.';
      identityError.hidden = false;
      return;
    }
    assembleBtn.disabled = true;
    const { ok, data } = await api('/api/login', {
      password: state.sitePassword, username: name, hero: chosenHero
    });
    if (!ok) {
      assembleBtn.disabled = false;
      identityError.textContent = data.error || 'Could not assemble.';
      identityError.hidden = false;
      return;
    }
    localStorage.setItem('jl-token', data.token);
    enterChat({ username: data.username, hero: data.hero });
  });

  /* ============================================================
     CHAT — connection
     ============================================================ */
  function enterChat(me) {
    state.me = me;
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

    const openDefault = () => {
      if (!state.active && state.rooms.length) openChat('room', 'hall-of-justice');
    };
    socket.on('rooms', openDefault);
  }

  function bindSocket(socket) {
    /* resilient reconnects: always keep the freshest token */
    socket.on('session:renewed', ({ token }) => {
      localStorage.setItem('jl-token', token);
      socket.auth = { token };
    });

    socket.on('connect', () => setConn(true));
    socket.on('disconnect', () => setConn(false));
    socket.on('connect_error', err => {
      if (err && err.message === 'unauthorized') {
        localStorage.removeItem('jl-token');
        toast('Your session has expired — please sign in again.');
        setTimeout(() => location.reload(), 1400);
      }
    });

    socket.on('rooms', ({ rooms }) => { state.rooms = rooms; renderRooms(); });
    socket.on('presence', ({ users }) => { state.users = users; renderMembers(); renderDmList(); updateTitle(); });

    /* ---- channels ---- */
    socket.on('room:history', ({ roomId, messages }) => {
      state.history.set(chatKey('room', roomId), messages);
      if (isActive('room', roomId)) renderMessages(messages);
    });
    socket.on('room:message', ({ roomId, message }) => {
      const key = chatKey('room', roomId);
      const list = state.history.get(key) || [];
      list.push(message);
      state.history.set(key, list);
      const c = state.chats.get(key);
      if (isActive('room', roomId)) {
        appendMessage(message);
        if (message.from !== state.me.username && !document.hasFocus()) ping();
      } else {
        if (c) { c.unread = (c.unread || 0) + 1; c.lastTs = message.ts; }
        if (message.from !== state.me.username) ping();
        renderRooms();
      }
      if (c) c.lastTs = message.ts;
      updateTitle();
    });
    socket.on('room:typing', ({ roomId, username, typing }) => {
      if (!isActive('room', roomId) || username === state.me.username) return;
      setTyping(chatKey('room', roomId), username, typing);
    });
    socket.on('room:created', ({ roomId }) => openChat('room', roomId));
    socket.on('room:presence', ({ roomId, users }) => {
      state.roomPresence.set(roomId, users);
      if (isActive('room', roomId)) renderPresenceChip(users);
      renderRooms();
    });
    socket.on('room:reaction', ({ roomId, msgId, reactions }) => {
      const msg = (state.history.get(chatKey('room', roomId)) || []).find(m => m.id === msgId);
      if (msg) msg.reactions = reactions;
      if (isActive('room', roomId)) updateReactions(msgId, reactions);
    });
    socket.on('room:delete', ({ roomId, msgId }) => {
      const msg = (state.history.get(chatKey('room', roomId)) || []).find(m => m.id === msgId);
      if (msg) { msg.deleted = true; }
      if (isActive('room', roomId)) markDeleted(msgId);
    });

    /* ---- direct messages ---- */
    socket.on('dm:history', ({ with: partner, messages }) => {
      state.history.set(chatKey('dm', partner), messages);
      if (isActive('dm', partner)) renderMessages(messages);
    });
    socket.on('dm:message', ({ message }) => {
      const partner = message.from === state.me.username ? message.to : message.from;
      const key = chatKey('dm', partner);
      ensureChat('dm', partner, message.ts);
      const list = state.history.get(key) || [];
      list.push(message);
      state.history.set(key, list);
      const c = state.chats.get(key);
      c.lastTs = message.ts;
      if (isActive('dm', partner)) {
        appendMessage(message);
        if (message.from !== state.me.username && !document.hasFocus()) ping();
      } else if (message.from !== state.me.username) {
        c.unread = (c.unread || 0) + 1;
        ping();
      }
      renderDmList();
      updateTitle();
    });
    socket.on('dm:typing', ({ from, typing }) => {
      if (!isActive('dm', from)) return;
      setTyping(chatKey('dm', from), from, typing);
    });
    socket.on('dm:reaction', ({ pair, msgId, reactions }) => {
      const partner = pair && pair.find(u => u !== state.me.username);
      if (!partner) return;
      const msg = (state.history.get(chatKey('dm', partner)) || []).find(m => m.id === msgId);
      if (msg) msg.reactions = reactions;
      if (isActive('dm', partner)) updateReactions(msgId, reactions);
    });
    socket.on('dm:delete', ({ pair, msgId }) => {
      const partner = pair && pair.find(u => u !== state.me.username);
      if (!partner) return;
      const msg = (state.history.get(chatKey('dm', partner)) || []).find(m => m.id === msgId);
      if (msg) { msg.deleted = true; }
      if (isActive('dm', partner)) markDeleted(msgId);
    });

    socket.on('error:msg', ({ text }) => toast(text));
  }

  const isActive = (kind, id) => state.active && state.active.kind === kind && state.active.id === id;

  function ensureChat(kind, id, ts) {
    const key = chatKey(kind, id);
    if (!state.chats.has(key)) state.chats.set(key, { kind, id, unread: 0, lastTs: ts || Date.now() });
    return state.chats.get(key);
  }

  /* ============================================================
     CHAT MANAGEMENT
     ============================================================ */
  function openChat(kind, id) {
    state.active = { kind, id };
    const c = ensureChat(kind, id);
    c.unread = 0;
    state.msgEls.clear();
    state.typing.clear();
    renderTyping();

    messagesEl.innerHTML = '';
    emptyStateEl.hidden = true;
    typingEl.textContent = '';
    messageInput.value = '';
    charCountEl.hidden = true;
    scrollBtn.hidden = true;

    if (kind === 'room') {
      const room = state.rooms.find(r => r.id === id);
      panelIcon.textContent = '#';
      panelIcon.style.color = '';
      panelName.textContent = room ? room.name : id;
      panelDesc.textContent = room ? room.desc : '';
      renderPresenceChip(state.roomPresence.get(id) || []);
      state.socket.emit('room:join', { roomId: id });
      const list = state.history.get(chatKey('room', id));
      if (list && list.length) renderMessages(list);
      else if (state.socket.connected) emptyStateEl.hidden = false;
    } else {
      const partner = state.users.find(u => u.username === id);
      const hero = partner ? heroOf(partner.hero) : heroOf('batman');
      panelIcon.textContent = hero.emoji;
      panelIcon.style.color = hero.color;
      panelName.textContent = id;
      panelDesc.textContent = 'Direct transmission — ' + hero.name;
      roomPresenceChip.hidden = true;
      state.socket.emit('dm:open', { with: id });
      const list = state.history.get(chatKey('dm', id));
      if (list && list.length) renderMessages(list);
    }

    renderRooms(); renderDmList(); renderMembers();
    closeSidebar();
    messageInput.focus();
    updateTitle();
  }

  /* ============================================================
     RENDERING
     ============================================================ */
  function renderRooms() {
    roomListEl.innerHTML = '';
    for (const room of state.rooms) {
      const c = state.chats.get(chatKey('room', room.id));
      const inRoom = (state.roomPresence.get(room.id) || []).length;
      const li = el('li', 'side-item' + (isActive('room', room.id) ? ' active' : ''));
      li.appendChild(el('span', 'hash', '#'));
      li.appendChild(el('span', 'side-name', room.name));
      if (inRoom) li.appendChild(el('small', 'member-presence', inRoom + ' online'));
      if (c && c.unread) li.appendChild(el('span', 'badge', c.unread > 99 ? '99+' : String(c.unread)));
      li.addEventListener('click', () => openChat('room', room.id));
      roomListEl.appendChild(li);
    }
  }

  function renderDmList() {
    dmListEl.innerHTML = '';
    const dms = [...state.chats.values()].filter(c => c.kind === 'dm')
      .sort((a, b) => (b.lastTs || 0) - (a.lastTs || 0));
    dmEmptyEl.hidden = dms.length > 0;
    for (const c of dms) {
      const u = state.users.find(x => x.username === c.id);
      const hero = u ? heroOf(u.hero) : null;
      const li = el('li', 'side-item' + (isActive('dm', c.id) ? ' active' : ''));
      const av = el('span', 'avatar small', hero ? hero.emoji : '💬');
      if (hero) av.style.borderColor = hero.color;
      li.appendChild(av);
      li.appendChild(el('span', 'side-name', c.id));
      const dot = el('span', 'member-presence');
      dot.textContent = u ? '●' : '○';
      dot.style.color = u ? 'var(--green)' : 'var(--faint)';
      li.appendChild(dot);
      if (c.unread) li.appendChild(el('span', 'badge', c.unread > 99 ? '99+' : String(c.unread)));
      li.addEventListener('click', () => openChat('dm', c.id));
      dmListEl.appendChild(li);
    }
  }

  function renderMembers() {
    memberListEl.innerHTML = '';
    onlineCountEl.textContent = state.users.length;
    const users = [...state.users]
      .filter(u => u.username !== state.me.username)
      .sort((a, b) => a.username.localeCompare(b.username));
    memberEmptyEl.hidden = users.length > 0;
    for (const u of users) {
      const hero = heroOf(u.hero);
      const li = el('li', 'side-item');
      const av = el('span', 'avatar small', hero.emoji);
      av.style.borderColor = hero.color;
      av.style.boxShadow = '0 0 10px ' + hero.color + '55';
      li.appendChild(av);
      const meta = el('span', 'side-name');
      meta.appendChild(el('div', null, u.username));
      const role = el('small', null, hero.name);
      role.style.color = hero.color;
      meta.appendChild(role);
      li.appendChild(meta);
      li.addEventListener('click', () => openChat('dm', u.username));
      memberListEl.appendChild(li);
    }
  }

  function renderPresenceChip(users) {
    if (!state.active || state.active.kind !== 'room') { roomPresenceChip.hidden = true; return; }
    roomPresenceChip.hidden = false;
    roomPresenceChip.textContent = '👥 ' + users.length + ' in channel';
  }

  /* ---- messages ---- */
  function renderMessages(messages) {
    messagesEl.innerHTML = '';
    state.msgEls.clear();
    emptyStateEl.hidden = messages.length > 0;
    let prev = null;
    for (const m of messages) {
      appendMessage(m, prev, false);
      prev = m;
    }
    scrollToBottom(false);
  }

  function appendMessage(message, prevOverride, scroll) {
    const list = prevOverride !== undefined
      ? [prevOverride, message]
      : (state.history.get(chatKey(state.active.kind, state.active.id)) || []).slice(-2);
    const prev = list.length === 2 ? list[0] : null;
    emptyStateEl.hidden = true;

    let node;
    if (message.system) {
      node = el('div', 'sys-msg', message.text);
      messagesEl.appendChild(node);
    } else {
      const showHeader = !prev || prev.system || prev.from !== message.from ||
        (message.ts - prev.ts) > GROUP_WINDOW;
      node = buildMessageEl(message, showHeader);
      if (showHeader) node.classList.add('first');
      messagesEl.appendChild(node);
    }

    const wrap = messagesEl;
    const nearBottom = wrap.scrollHeight - wrap.scrollTop - wrap.clientHeight < 140;
    if (scroll !== false && (nearBottom || message.from === state.me.username)) {
      scrollToBottom(true);
    } else if (scroll === false) {
      /* initial render — handled by caller */
    } else {
      scrollBtn.hidden = false;
    }
    return node;
  }

  function buildMessageEl(message, showHeader) {
    const own = message.from === state.me.username;
    const hero = heroOf(message.hero);
    const node = el('div', 'msg' + (own ? ' own' : ''));
    node.dataset.msgId = message.id;

    const av = el('span', 'avatar', hero.emoji);
    av.style.borderColor = hero.color;
    if (!showHeader) { av.style.visibility = 'hidden'; }
    node.appendChild(av);

    const body = el('div', 'msg-body');
    if (showHeader) {
      const head = el('div', 'msg-head');
      const author = el('span', 'msg-author', message.from);
      author.style.color = hero.color;
      head.appendChild(author);
      head.appendChild(el('span', 'msg-time', fmtTime(message.ts)));
      body.appendChild(head);
    }
    const textEl = el('div', 'msg-text');
    if (message.deleted) {
      node.classList.add('deleted');
      textEl.textContent = '· transmission deleted ·';
    } else {
      renderText(textEl, message.text);
    }
    body.appendChild(textEl);

    const reactionsRow = el('div', 'reactions');
    body.appendChild(reactionsRow);
    renderReactionsRow(message, reactionsRow);

    /* hover actions */
    const actions = el('div', 'msg-actions');
    actions.setAttribute('role', 'toolbar');
    for (const r of REACTIONS) {
      const b = el('button', 'react-btn', r);
      b.type = 'button';
      b.title = 'React ' + r;
      b.addEventListener('click', () => react(message, r));
      actions.appendChild(b);
    }
    if (own && !message.deleted) {
      const d = el('button', 'delete-btn', '🗑');
      d.type = 'button';
      d.title = 'Delete message';
      d.addEventListener('click', () => deleteMessage(message));
      actions.appendChild(d);
    }
    node.appendChild(actions);

    node.appendChild(body);
    state.msgEls.set(message.id, node);
    return node;
  }

  function renderText(target, text) {
    const parts = String(text).split(/(https?:\/\/[^\s]+)/g);
    for (const p of parts) {
      if (/^https?:\/\//.test(p)) {
        const a = document.createElement('a');
        a.href = p;
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        a.textContent = p;
        target.appendChild(a);
      } else if (p) {
        target.appendChild(document.createTextNode(p));
      }
    }
  }

  function renderReactionsRow(message, row) {
    row.innerHTML = '';
    const reactions = message.reactions || {};
    const keys = Object.keys(reactions).filter(k => reactions[k] && reactions[k].length);
    if (!keys.length) return;
    for (const emoji of keys) {
      const users = reactions[emoji];
      const chip = el('button', 'reaction-chip' + (users.includes(state.me.username) ? ' mine' : ''));
      chip.type = 'button';
      chip.title = users.join(', ');
      chip.appendChild(el('span', null, emoji));
      chip.appendChild(el('b', null, String(users.length)));
      chip.addEventListener('click', () => react(message, emoji));
      row.appendChild(chip);
    }
  }

  function updateReactions(msgId, reactions) {
    const node = state.msgEls.get(msgId);
    const list = state.history.get(chatKey(state.active.kind, state.active.id)) || [];
    const msg = list.find(m => m.id === msgId);
    if (msg) msg.reactions = reactions;
    if (node) {
      const row = node.querySelector('.reactions');
      if (row) renderReactionsRow(msg || { reactions }, row);
    }
  }

  function markDeleted(msgId) {
    const node = state.msgEls.get(msgId);
    if (!node) return;
    node.classList.add('deleted');
    const textEl = node.querySelector('.msg-text');
    if (textEl) textEl.textContent = '· transmission deleted ·';
    const del = node.querySelector('.delete-btn');
    if (del) del.remove();
  }

  function react(message, emoji) {
    if (state.active.kind === 'room') {
      state.socket.emit('room:react', { roomId: state.active.id, msgId: message.id, emoji });
    } else {
      state.socket.emit('dm:react', { with: state.active.id, msgId: message.id, emoji });
    }
  }

  function deleteMessage(message) {
    if (state.active.kind === 'room') {
      state.socket.emit('room:delete', { roomId: state.active.id, msgId: message.id });
    } else {
      state.socket.emit('dm:delete', { with: state.active.id, msgId: message.id });
    }
  }

  /* ---- typing ---- */
  function setTyping(key, username, isTyping) {
    if (key !== chatKey(state.active.kind, state.active.id)) return;
    let m = state.typing.get(key);
    if (!m) { m = new Map(); state.typing.set(key, m); }
    clearTimeout(m.get(username));
    if (isTyping) {
      m.set(username, setTimeout(() => { m.delete(username); renderTyping(); }, 3200));
    } else {
      m.delete(username);
    }
    renderTyping();
  }

  function renderTyping() {
    const key = state.active && chatKey(state.active.kind, state.active.id);
    const names = key && state.typing.has(key) ? [...state.typing.get(key).keys()] : [];
    typingEl.textContent = names.length === 0 ? ''
      : names.length === 1 ? names[0] + ' is typing…'
      : names.length === 2 ? names.join(' and ') + ' are typing…'
      : names.length + ' heroes are typing…';
  }

  /* ---- connection / title / scroll ---- */
  function setConn(up) {
    connPill.classList.toggle('down', !up);
    connText.textContent = up ? 'Link stable' : 'Reconnecting…';
  }

  function updateTitle() {
    let unread = 0;
    for (const c of state.chats.values()) unread += c.unread || 0;
    document.title = (unread ? `(${unread}) ` : '') + 'Justice League Chat';
    const menuBadge = document.getElementById('menu-badge');
    if (menuBadge) {
      menuBadge.hidden = !unread;
      menuBadge.textContent = unread > 99 ? '99+' : String(unread);
    }
  }

  function scrollToBottom(smooth) {
    messagesEl.scrollTo({ top: messagesEl.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
    scrollBtn.hidden = true;
  }

  messagesEl.addEventListener('scroll', () => {
    const away = messagesEl.scrollHeight - messagesEl.scrollTop - messagesEl.clientHeight > 240;
    scrollBtn.hidden = !away;
  });
  scrollBtn.addEventListener('click', () => scrollToBottom(true));

  /* ============================================================
     COMPOSER
     ============================================================ */
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
    charCountEl.hidden = true;
    messageInput.focus();
  });

  messageInput.addEventListener('input', () => {
    const len = messageInput.value.length;
    charCountEl.hidden = len < 380;
    charCountEl.textContent = len + ' / 500';
    charCountEl.classList.toggle('warn', len > 460);

    if (!state.active || !messageInput.value.trim()) return;
    if (!typingSent) {
      typingSent = true;
      if (state.active.kind === 'room') {
        state.socket.emit('room:typing', { roomId: state.active.id, typing: true });
      } else {
        state.socket.emit('dm:typing', { with: state.active.id, typing: true });
      }
    }
    clearTimeout(typingReset);
    typingReset = setTimeout(() => {
      typingSent = false;
      if (!state.active) return;
      if (state.active.kind === 'room') {
        state.socket.emit('room:typing', { roomId: state.active.id, typing: false });
      } else {
        state.socket.emit('dm:typing', { with: state.active.id, typing: false });
      }
    }, 1800);
  });

  let typingSent = false;
  let typingReset;

  /* ---- emoji tray ---- */
  emojiBtn.addEventListener('click', e => {
    e.stopPropagation();
    emojiTrayEl.hidden = !emojiTrayEl.hidden;
    if (!emojiTrayEl.children.length) {
      for (const emo of EMOJI_TRAY) {
        const b = el('button', null, emo);
        b.type = 'button';
        b.addEventListener('click', () => {
          const input = messageInput;
          const start = input.selectionStart || input.value.length;
          input.value = input.value.slice(0, start) + emo + input.value.slice(input.selectionEnd || start);
          input.focus();
          input.selectionStart = input.selectionEnd = start + emo.length;
          emojiTrayEl.hidden = true;
        });
        emojiTrayEl.appendChild(b);
      }
    }
  });
  document.addEventListener('click', e => {
    if (!emojiTrayEl.hidden && !emojiTrayEl.contains(e.target) && e.target !== emojiBtn) {
      emojiTrayEl.hidden = true;
    }
  });

  /* ============================================================
     SIDEBAR / MISC
     ============================================================ */
  newRoomBtn.addEventListener('click', () => {
    const name = prompt('Name the new channel:');
    if (name && name.trim()) state.socket.emit('room:create', { name: name.trim() });
  });

  logoutBtn.addEventListener('click', () => {
    localStorage.removeItem('jl-token');
    location.reload();
  });

  soundBtn.textContent = state.muted ? '🔕' : '🔔';
  soundBtn.addEventListener('click', () => {
    state.muted = !state.muted;
    localStorage.setItem('jl-muted', state.muted ? '1' : '0');
    soundBtn.textContent = state.muted ? '🔕' : '🔔';
    toast(state.muted ? 'Sounds muted.' : 'Sounds on.');
  });

  function openSidebar() { sidebar.classList.add('open'); backdropDim.hidden = false; }
  function closeSidebar() { sidebar.classList.remove('open'); backdropDim.hidden = true; }
  menuBtn.addEventListener('click', openSidebar);
  sidebarClose.addEventListener('click', closeSidebar);
  backdropDim.addEventListener('click', closeSidebar);

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && state.active) {
      const c = state.chats.get(chatKey(state.active.kind, state.active.id));
      if (c && !c.unread) updateTitle();
    }
  });

  /* ============================================================
     BOOT
     ============================================================ */
  (async function boot() {
    await loadHeroes();
    const token = localStorage.getItem('jl-token');
    if (token) {
      const { ok, data } = await api('/api/session', { token });
      if (ok) { enterChat({ username: data.username, hero: data.hero }); return; }
      localStorage.removeItem('jl-token');
      if (data && data.error && data.error !== 'session-expired') {
        toast(data.error);
      }
    }
    passwordInput.focus();
  })();
})();
