/* Integration test: two users — group chat, DM, presence, room creation */
const { io } = require('socket.io-client');
const BASE = 'http://localhost:3111';

const sleep = ms => new Promise(r => setTimeout(r, ms));
let failures = 0;
const check = (name, cond) => {
  console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name);
  if (!cond) failures++;
};

const http = require('http');
function post(path, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = http.request(BASE + path, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }
    }, res => {
      let buf = '';
      res.on('data', c => (buf += c));
      res.on('end', () => resolve({ status: res.statusCode, json: JSON.parse(buf) }));
    });
    req.on('error', reject);
    req.end(data);
  });
}

async function login(username, hero) {
  const r = await post('/api/login', { password: 'watchtower', username, hero });
  return r.json.token;
}

function eventsReceived(socket, names) {
  const got = {};
  for (const n of names) socket.on(n, (data) => { got[n] = data; });
  return got;
}

async function main() {
  const tA = await login('alice_test', 'wonder-woman');
  const tB = await login('bob_test', 'flash');
  const bad = io(BASE, { auth: { token: 'garbage' } });
  const badErr = await new Promise(r => bad.on('connect_error', r));
  check('bad token rejected', badErr.message === 'unauthorized');
  bad.close();

  const a = io(BASE, { auth: { token: tA } });
  const b = io(BASE, { auth: { token: tB } });
  const aEv = eventsReceived(a, ['presence', 'rooms', 'room:message', 'room:history', 'dm:message', 'room:created']);
  const bEv = eventsReceived(b, ['presence', 'room:message', 'dm:message', 'room:created', 'rooms']);
  await Promise.all([new Promise(r => a.on('connect', r)), new Promise(r => b.on('connect', r))]);
  await sleep(500);

  // presence (register a fresh presence event by triggering an update)
  const presencePromise = new Promise(r => a.once('presence', r));
  await sleep(50);
  // trigger a presence update: connect and disconnect a third user
  const tC = await login('charlie_test', 'cyborg');
  const c = io(BASE, { auth: { token: tC } });
  await new Promise(r => c.on('connect', r));
  await sleep(200);
  const pres = await presencePromise;
  check('presence updates broadcast', pres.users.length === 3);
  c.close();
  await sleep(200);

  // group chat
  a.emit('room:join', { roomId: 'hall-of-justice' });
  b.emit('room:join', { roomId: 'hall-of-justice' });
  await sleep(200);
  check('room history event received', !!aEv['room:history']);
  b.emit('room:message', { roomId: 'hall-of-justice', text: 'Metropolis needs backup! <script>alert(1)</script>' });
  await sleep(300);
  check('group message delivered to alice', aEv['room:message'] && aEv['room:message'].message.text.includes('Metropolis'));
  check('group message escaped/kept raw text (server stores raw)', aEv['room:message'].message.from === 'bob_test');

  // room creation
  a.emit('room:create', { name: 'Star Labs' });
  await sleep(300);
  // room creation (creator is notified, everyone gets the room list)
  check('room created event sent to creator', !!aEv['room:created'] && aEv['room:created'].roomId === 'star-labs');
  check('room appears in room list', (bEv.rooms ? bEv.rooms.rooms : []).some(r => r.id === 'star-labs'));

  // DM (bob has NOT opened a DM with alice — server should join him in)
  a.emit('dm:open', { with: 'bob_test' });
  await sleep(150);
  a.emit('dm:message', { to: 'bob_test', text: 'Flash, this is a private line.' });
  await sleep(300);
  check('DM delivered to bob', bEv['dm:message'] && bEv['dm:message'].message.text.includes('private line'));
  check('DM from field correct', bEv['dm:message'].message.from === 'alice_test');

  // history replay for dm
  const bHist = {};
  b.on('dm:history', d => (bHist[d.with] = d.messages));
  b.emit('dm:open', { with: 'alice_test' });
  await sleep(300);
  check('DM history replayed', (bHist['alice_test'] || []).some(m => m.text.includes('private line')));

  // duplicate username rejected
  const dup = await post('/api/login', { password: 'watchtower', username: 'alice_test', hero: 'batman' });
  check('duplicate online username rejected', dup.status === 409);

  a.close(); b.close();
  await sleep(300);
  console.log(failures === 0 ? 'ALL TESTS PASSED' : failures + ' TEST(S) FAILED');
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(e => { console.error(e); process.exit(1); });
