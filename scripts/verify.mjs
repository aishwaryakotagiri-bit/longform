/* design-brief verification: screenshots into verify/ from a real headless
   chrome, plus the contrast figures recomputed from the tokens in index.html.
   zero deps — node's own WebSocket talks the devtools protocol.
   run: node scripts/verify.mjs   (CHROME=... to point at another binary) */
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(import.meta.url), '..', '..');
const OUT = join(ROOT, 'verify');
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 8200 + Math.floor(Math.random() * 200);
const CDP = 9400 + Math.floor(Math.random() * 200);
mkdirSync(OUT, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const server = spawn('python3', ['-m', 'http.server', String(PORT), '--directory', ROOT], { stdio: 'ignore' });
const profile = mkdtempSync(join(tmpdir(), 'longform-verify-'));
const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${CDP}`, `--user-data-dir=${profile}`,
  '--no-first-run', '--no-default-browser-check', '--hide-scrollbars', '--disable-gpu',
  '--window-size=1280,900', 'about:blank'
], { stdio: 'ignore' });
const cleanup = () => {
  try { chrome.kill(); } catch { /* gone */ }
  try { server.kill(); } catch { /* gone */ }
  try { rmSync(profile, { recursive: true, force: true }); } catch { /* fine */ }
};
process.on('exit', cleanup);

async function pageTarget() {
  for (let i = 0; i < 80; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${CDP}/json/list`)).json();
      const t = list.find((x) => x.type === 'page');
      if (t) return t;
    } catch { /* not up yet */ }
    await sleep(250);
  }
  throw new Error('chrome did not come up');
}
const target = await pageTarget();
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('devtools socket failed')); });
let seq = 0;
const waiting = new Map();
ws.onmessage = (m) => {
  const d = JSON.parse(m.data);
  if (!d.id || !waiting.has(d.id)) return;
  const { res, rej } = waiting.get(d.id);
  waiting.delete(d.id);
  d.error ? rej(new Error(d.error.message)) : res(d.result);
};
const cdp = (method, params = {}) => new Promise((res, rej) => {
  const id = ++seq; waiting.set(id, { res, rej }); ws.send(JSON.stringify({ id, method, params }));
});
async function js(expression) {
  const r = await cdp('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' ' + ((r.exceptionDetails.exception || {}).description || ''));
  return r.result.value;
}
async function until(expr, ms = 12000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try { if (await js(expr)) return; } catch { /* context mid-reload */ }
    await sleep(100);
  }
  throw new Error('timed out waiting for: ' + expr);
}

await cdp('Page.enable');
await cdp('Runtime.enable');
await cdp('Animation.enable');

const today = new Date().toISOString().slice(0, 10);
const articles = JSON.parse(readFileSync(join(ROOT, 'data/articles.json'), 'utf8')).articles;
const allIds = articles.map((a) => a.url.split('?')[0]);
const READY = `document.readyState === 'complete' && !window.__stale && (document.querySelectorAll('#queue .card-shell').length > 0 || !!document.querySelector('.empty-frame'))`;

/* load once to reach the origin, set storage, reload so the page boots with it */
async function open({ width, height, dark, mobile = false, state = null, wipe = false, scroll = 0, settle = 900 }) {
  await cdp('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 2, mobile });
  await cdp('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: dark ? 'dark' : 'light' }] });
  await cdp('Page.navigate', { url: `http://127.0.0.1:${PORT}/index.html` });
  await until(`document.readyState === 'complete'`);
  await js(`localStorage.clear();
    ${wipe ? '' : `localStorage.setItem('longform.lastWipe', '${today}');`}
    ${state ? `localStorage.setItem('longform.state.v1', ${JSON.stringify(JSON.stringify(state))});` : ''}
    window.__stale = true; 'ok'`);
  await cdp('Page.reload');
  await until(READY);
  if (scroll) await js(`window.scrollTo(0, ${scroll}); 'ok'`);
  await sleep(settle);
}
async function shot(name) {
  const { data } = await cdp('Page.captureScreenshot', { format: 'png' });
  writeFileSync(join(OUT, name), Buffer.from(data, 'base64'));
  console.log('  verify/' + name);
}

console.log('screenshots');
await open({ width: 375, height: 812, dark: false, mobile: true }); await shot('light-375.png');
await open({ width: 375, height: 812, dark: true, mobile: true });  await shot('dark-375.png');
await open({ width: 1280, height: 900, dark: false, scroll: 260 });  await shot('light-1280.png');
await open({ width: 1280, height: 900, dark: true, scroll: 260 });   await shot('dark-1280.png');

const allRead = { marks: { read: Object.fromEntries(allIds.map((k) => [k, new Date().toISOString()])), saved: {}, skipped: {} } };
await open({ width: 1280, height: 900, dark: false, state: allRead }); await shot('empty-state.png');

/* the tear mid-way: start it, then pause every transition and seek */
await open({ width: 1280, height: 900, dark: false, scroll: 260 });
const tearFacts = await js(`(async () => {
  const shell = document.querySelector('#queue .card-shell');
  shell.querySelector('[data-act="read"]').click();
  await new Promise((r) => requestAnimationFrame(r));
  const anims = document.getAnimations().filter((a) => a.constructor.name === 'CSSTransition');
  for (const a of anims) { a.pause(); a.currentTime = 180; }   /* ease-in: 180ms is the visual midpoint */
  const cs = getComputedStyle(shell.querySelector('.card'));
  return { transitionsPaused: anims.length, properties: anims.map((a) => a.transitionProperty), midClip: cs.clipPath.slice(0, 40), shellTransform: getComputedStyle(shell).transform };
})()`);
console.log('tear', JSON.stringify(tearFacts));
await sleep(150);
await shot('tear-midframe.png');

/* the daily wipe mid-sweep: same trick on the keyframe animation */
await open({ width: 1280, height: 900, dark: false, wipe: true, settle: 0 });
const wipeFacts = await js(`(async () => {
  const el = document.querySelector('.wipe');
  if (!el) return { wipePresent: false };
  await new Promise((r) => requestAnimationFrame(r));
  const a = document.getAnimations().find((x) => x.animationName === 'wipe-off');
  if (a) { a.pause(); a.currentTime = 120 + 48; }   /* ease-out: half the travel happens in the first 10% */
  return { wipePresent: true, animationFound: !!a };
})()`);
console.log('wipe', JSON.stringify(wipeFacts));
await sleep(150);
await shot('wipe-midframe.png');
/* ...and it must not run again the same day */
await js(`document.getAnimations().forEach((a) => a.finish && a.finish()); 'ok'`);
await sleep(300);
await js(`window.__stale = true; 'ok'`);
await cdp('Page.reload');
await until(READY);
const wipeAgain = await js(`!!document.querySelector('.wipe')`);
console.log('wipe again on reload same day:', wipeAgain);

/* two taps in quick succession retarget the same tear rather than restarting it */
await open({ width: 1280, height: 900, dark: false, scroll: 260 });
const retarget = await js(`(async () => {
  const shell = document.querySelector('#queue .card-shell');
  const key = shell.dataset.id;
  shell.querySelector('[data-act="read"]').click();
  await new Promise((r) => setTimeout(r, 60));
  shell.querySelector('[data-act="saved"]').click();
  const act = shell.dataset.act, leaving = shell.classList.contains('is-leaving'), stillSameNode = document.contains(shell);
  await new Promise((r) => setTimeout(r, 700));
  const s = JSON.parse(localStorage.getItem('longform.state.v1'));
  return { actAfterSecondTap: act, stillLeavingSameNode: leaving && stillSameNode, bothMarksKept: key in s.marks.read && key in s.marks.saved, cardGone: !document.querySelector('.card-shell[data-id="' + CSS.escape(key) + '"]') };
})()`);
console.log('retarget', JSON.stringify(retarget));

/* reduced motion: the leave is a plain fade — no clip, no transform — and the card still goes */
await cdp('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }, { name: 'prefers-reduced-motion', value: 'reduce' }] });
await js(`window.__stale = true; 'ok'`);
await cdp('Page.reload');
await until(READY);
const reduced = await js(`(async () => {
  const shell = document.querySelector('#queue .card-shell');
  const key = shell.dataset.id;
  const entrance = getComputedStyle(shell).animationName;
  const hairline = getComputedStyle(document.querySelector('.hairline')).transform;
  shell.querySelector('[data-act="read"]').click();
  await new Promise((r) => setTimeout(r, 40));
  const during = { transform: getComputedStyle(shell).transform, clip: getComputedStyle(shell.querySelector('.card')).clipPath.includes('100% 100%') ? 'rest (no tear)' : 'TORN', underlayOpacity: getComputedStyle(shell, '::after').opacity };
  await new Promise((r) => setTimeout(r, 500));
  return { entranceAnimation: entrance, hairline, during, cardGoneAfter540ms: !document.querySelector('.card-shell[data-id="' + CSS.escape(key) + '"]'), wipeInserted: !!document.querySelector('.wipe') };
})()`);
console.log('reduced-motion', JSON.stringify(reduced));
await cdp('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });

/* a few facts about the rendered page */
await open({ width: 375, height: 812, dark: false, mobile: true, settle: 300 });
const facts = await js(`(() => {
  const rng = document.createRange(); rng.selectNodeContents(document.querySelector('.wordmark')); const wm = rng.getBoundingClientRect();
  const mh = document.querySelector('.masthead');
  const small = [...document.querySelectorAll('button, a, input, textarea')].filter((el) => { const r = el.getBoundingClientRect(); return r.width && r.height && (r.height < 44 || r.width < 44); }).map((el) => (el.textContent || el.id).trim().slice(0, 20) + ' ' + Math.round(el.getBoundingClientRect().width) + 'x' + Math.round(el.getBoundingClientRect().height));
  window.scrollTo(0, 400);
  const stuck = getComputedStyle(mh).position === 'sticky' && mh.getBoundingClientRect().top === 0;
  return {
    wordmarkRunsOffRight: wm.right > innerWidth, wordmarkRight: Math.round(wm.right), innerWidth,
    horizontalScroll: (() => { window.scrollTo(9999, 0); const x = window.scrollX; window.scrollTo(0, 0); return x > 0; })(),
    rootOverflowX: getComputedStyle(document.documentElement).overflowX,
    mastheadSticks: stuck,
    fontsRequested: performance.getEntriesByType('resource').filter((e) => /fonts\\//.test(e.name)).map((e) => e.name.split('/').pop() + (e.responseStatus ? ' ' + e.responseStatus : '')),
    externalRequests: performance.getEntriesByType('resource').filter((e) => !e.name.startsWith(location.origin)).map((e) => e.name),
    targetsUnder44: small
  };
})()`);
console.log('facts', JSON.stringify(facts, null, 2));

console.log('contrast (wcag 2.x, recomputed from the tokens in index.html)');
const css = readFileSync(join(ROOT, 'index.html'), 'utf8');
const tokens = (block) => Object.fromEntries([...block.matchAll(/--([a-z-]+):\s*(#[0-9a-f]{6})/gi)].map((m) => [m[1], m[2]]));
const darkAt = css.indexOf('@media (prefers-color-scheme: dark)');
const L = tokens(css.slice(css.indexOf(':root {'), darkAt));
const Dk = tokens(css.slice(darkAt, css.indexOf('}', css.indexOf('--acid', darkAt))));
const lum = (hex) => {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const pairs = [
  ['ink', 'paper', 4.5], ['ink-soft', 'card', 4.5], ['ink-faint', 'card', 4.5], ['gilt-text', 'card', 4.5],
  ['acid', 'paper', 3], ['gilt', 'card', 3],
  ['ink-soft', 'paper', 4.5], ['ink-faint', 'paper', 4.5], ['ink-soft', 'paper-deep', 4.5], ['ink-faint', 'paper-deep', 1], ['rule-strong', 'card', 1]
];
let low = 0;
for (const [scheme, T] of [['light', L], ['dark', Dk]]) {
  for (const [fg, bg, min] of pairs) {
    const r = ratio(T[fg], T[bg]);
    if (r < min) low++;
    console.log(`  ${r >= min ? 'ok ' : 'LOW'} ${scheme.padEnd(5)} ${(fg + ' on ' + bg).padEnd(26)} ${r.toFixed(2)}:1  (needs ${min})`);
  }
}
ws.close();
cleanup();
console.log(low ? `\n${low} pair(s) below minimum` : '\ncontrast ok');
process.exit(low ? 1 : 0);
