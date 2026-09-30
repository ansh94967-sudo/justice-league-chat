/* Responsive QA — verify nothing is clipped on Android portrait & landscape sizes.
   Checks element bounding boxes against the viewport, and captures screenshots. */
const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');

const BASE = 'http://localhost:3111';
const OUT = path.join(__dirname, 'docs', 'responsive');
const EXEC = '/usr/local/bin/chromium-headless-shell';
const sleep = ms => new Promise(r => setTimeout(r, ms));

const DEVICES = [
  { name: 'portrait-360x640',  w: 360, h: 640 },
  { name: 'portrait-412x915',  w: 412, h: 915 },
  { name: 'portrait-320x568',  w: 320, h: 568 },
  { name: 'landscape-915x412', w: 915, h: 412 },
  { name: 'landscape-800x360', w: 800, h: 360 },
  { name: 'landscape-640x360', w: 640, h: 360 }
].filter(d => !process.env.QA_ONLY || d.name.includes(process.env.QA_ONLY));

const CHAT_SELECTORS = [
  '.panel-head', '.menu-btn', '#panel-name', '.conn-pill',
  '.messages', '.typing-row', '#message-input', '.btn-send', '.composer'
];
const GATE_SELECTORS = ['.gate-card', '.gate-title', '#password', '#password-form .btn-hero'];

function boxReport() {
  const vw = window.innerWidth, vh = window.innerHeight;
  const probe = sel => [...document.querySelectorAll(sel)]
    .filter(el => el.offsetParent !== null || el === document.activeElement)
    .map(el => {
      const r = el.getBoundingClientRect();
      return {
        sel, id: el.id || el.className.split(' ')[0],
        top: Math.round(r.top), bottom: Math.round(r.bottom),
        left: Math.round(r.left), right: Math.round(r.right),
        w: Math.round(r.width), h: Math.round(r.height),
        overBottom: Math.round(r.bottom - vh),
        overRight: Math.round(r.right - vw),
        overLeft: Math.round(-r.left)
      };
    });
  const out = [];
  for (const s of window.__probe) out.push(...probe(s));
  return { vw, vh, boxes: out, scrollH: document.documentElement.scrollHeight };
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await puppeteer.launch({
    executablePath: EXEC,
    args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage']
  });
  const results = [];

  for (const [i, dev] of DEVICES.entries()) {
    const page = await browser.newPage();
    await page.setViewport({ width: dev.w, height: dev.h, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
    // always start this device with a clean session so the gate is exercised
    await page.evaluateOnNewDocument(() => { try { localStorage.clear(); } catch (e) {} });
    await page.evaluateOnNewDocument(sels => { window.__probe = sels; }, GATE_SELECTORS);

    // ---- gate ----
    await page.goto(BASE, { waitUntil: 'networkidle2', timeout: 30000 });
    await sleep(500);
    await page.screenshot({ path: path.join(OUT, `${dev.name}-gate.png`) });
    let gate = await page.evaluate(boxReport);
    // visibility sanity on the gate step
    const gateState = await page.evaluate(() => {
      const shown = sel => { const el = document.querySelector(sel); return !!el && getComputedStyle(el).display !== 'none'; };
      return {
        gateShown: shown('#gate'), chatShown: shown('#chat'),
        docScroll: document.documentElement.scrollHeight, vh: window.innerHeight,
        scrollBtnShown: shown('#scroll-btn')
      };
    });

    // ---- identity step ----
    await page.type('#password', 'watchtower');
    await page.click('#password-form button[type=submit]');
    await page.waitForSelector('#identity-form:not([hidden])', { timeout: 10000 });
    await sleep(400);
    await page.screenshot({ path: path.join(OUT, `${dev.name}-identity.png`) });
    let ident = await page.evaluate(() => {
      const vh = window.innerHeight, vw = window.innerWidth;
      const pick = s => { const el = document.querySelector(s); if (!el) return null;
        const r = el.getBoundingClientRect();
        return { sel: s, bottom: Math.round(r.bottom), right: Math.round(r.right), overBottom: Math.round(r.bottom - vh), overRight: Math.round(r.right - vw) }; };
      return { vh, vw, boxes: [pick('#identity-form .btn-hero'), pick('.hero-grid'), pick('#username')].filter(Boolean) };
    });

    // ---- chat ----
    await page.type('#username', 'hero' + i + '_' + dev.name.replace(/[^a-z0-9]/gi, ''));
    await page.click('.hero-option:nth-child(' + ((i % 8) + 1) + ')');
    await sleep(120);
    await page.click('#assemble-btn');
    await page.waitForSelector('#sidebar', { timeout: 15000 });
    await page.waitForSelector('.side-item', { timeout: 15000 });
    await sleep(700);
    // send a couple of messages so the message area has content
    const inp = await page.$('#message-input');
    if (inp) {
      await inp.type('Checking layout on ' + dev.name);
      await page.keyboard.press('Enter');
      await sleep(350);
      await inp.type('All panels visible?');
      await page.keyboard.press('Enter');
      await sleep(500);
    }
    await page.screenshot({ path: path.join(OUT, `${dev.name}-chat.png`) });
    await page.evaluateOnNewDocument(sels => { window.__probe = sels; }, CHAT_SELECTORS);
    await page.evaluate(sels => { window.__probe = sels; }, CHAT_SELECTORS);
    let chat = await page.evaluate(boxReport);
    const chatState = await page.evaluate(() => {
      const shown = sel => { const el = document.querySelector(sel); return !!el && getComputedStyle(el).display !== 'none'; };
      return {
        gateShown: shown('#gate'), chatShown: shown('#chat'),
        docScroll: document.documentElement.scrollHeight, vh: window.innerHeight,
        scrollBtnShown: shown('#scroll-btn')
      };
    });

    // ---- drawer ----
    await page.click('#menu-btn');
    await sleep(450);
    await page.screenshot({ path: path.join(OUT, `${dev.name}-drawer.png`) });
    const drawer = await page.evaluate(() => {
      const vh = window.innerHeight, vw = window.innerWidth;
      const sb = document.querySelector('#sidebar');
      const r = sb.getBoundingClientRect();
      const items = [...document.querySelectorAll('#sidebar .section-title')].map(e => e.textContent.trim());
      return { vh, vw, sidebar: { left: Math.round(r.left), right: Math.round(r.right), bottom: Math.round(r.bottom) }, sections: items };
    });

    results.push({ device: dev.name, gate, gateState, ident, chat, chatState, drawer });
    await page.close();
  }

  await browser.close();

  // ---- report ----
  let problems = 0;
  for (const r of results) {
    console.log('\n=== ' + r.device + ' ===');
    const overflow = (boxes, label) => {
      for (const b of boxes) {
        const bad = b.overBottom > 1 || b.overRight > 1 || b.overLeft > 1;
        if (bad) { problems++; console.log(`  CLIPPED [${label}] ${b.sel} overBottom=${b.overBottom} overRight=${b.overRight} overLeft=${b.overLeft}`); }
      }
    };
    overflow(r.gate.boxes, 'gate');
    overflow(r.ident.boxes, 'identity');
    overflow(r.chat.boxes, 'chat');

    // only one screen may be visible at a time, and the page must not scroll
    const exclusive = (s, label) => {
      const ok = s.gateShown !== s.chatShown;
      if (!ok) { problems++; console.log(`  SCREEN BLEED [${label}] gateShown=${s.gateShown} chatShown=${s.chatShown}`); }
      if (s.docScroll > s.vh + 2) { problems++; console.log(`  PAGE SCROLLS [${label}] doc=${s.docScroll} viewport=${s.vh}`); }
    };
    exclusive(r.gateState, 'gate');
    exclusive(r.chatState, 'chat');
    if (r.gateState.scrollBtnShown) { problems++; console.log('  STRAY scroll-btn visible on the gate'); }
    if (r.chatState.scrollBtnShown) { problems++; console.log('  STRAY scroll-btn visible while at the bottom'); }

    console.log(`  gate: vh=${r.gate.vh} vw=${r.gate.vw} | gateShown=${r.gateState.gateShown} chatShown=${r.gateState.chatShown} docScroll=${r.gateState.docScroll}`);
    console.log(`  chat: messages h=${(r.chat.boxes.find(b => b.sel === '.messages') || {}).h}px, composer bottom=${(r.chat.boxes.find(b => b.sel === '.composer') || {}).bottom} / vh=${r.chat.vh}`);
    console.log(`  drawer: width=${r.drawer.sidebar.right - r.drawer.sidebar.left}px, sections=[${r.drawer.sections.join(' | ')}]`);
  }
  console.log('\n' + (problems === 0 ? 'NO CLIPPING OR LAYOUT BLEED — all good' : problems + ' PROBLEM(S) FOUND'));
  process.exitCode = problems === 0 ? 0 : 1;
})().catch(e => { console.error('QA ERROR:', e); process.exit(1); });
