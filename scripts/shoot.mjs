/* screenshots of any page in the repo from headless chrome.
   node scripts/shoot.mjs demo.html  →  verify/demo-*.png */
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = join(fileURLToPath(import.meta.url), '..', '..');
const PAGE = process.argv[2] || 'index.html';
const TAG = PAGE.replace(/\.html$/, '');
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 8200 + Math.floor(Math.random() * 200), CDP = 9400 + Math.floor(Math.random() * 200);
mkdirSync(join(ROOT, 'verify'), { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const server = spawn('python3', ['-m', 'http.server', String(PORT), '--directory', ROOT], { stdio: 'ignore' });
const profile = mkdtempSync(join(tmpdir(), 'longform-shoot-'));
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${CDP}`, `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', '--hide-scrollbars', '--disable-gpu', '--window-size=1280,900', 'about:blank'], { stdio: 'ignore' });
process.on('exit', () => { try { chrome.kill(); } catch {} try { server.kill(); } catch {} try { rmSync(profile, { recursive: true, force: true }); } catch {} });
let t; for (let i = 0; i < 80 && !t; i++) { try { t = (await (await fetch(`http://127.0.0.1:${CDP}/json/list`)).json()).find((x) => x.type === 'page'); } catch {} if (!t) await sleep(250); }
const ws = new WebSocket(t.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let seq = 0; const waiting = new Map();
ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && waiting.has(d.id)) { const { res, rej } = waiting.get(d.id); waiting.delete(d.id); d.error ? rej(new Error(d.error.message)) : res(d.result); } };
const cdp = (method, params = {}) => new Promise((res, rej) => { const id = ++seq; waiting.set(id, { res, rej }); ws.send(JSON.stringify({ id, method, params })); });
const js = async (expression) => (await cdp('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })).result.value;
await cdp('Page.enable'); await cdp('Runtime.enable');
async function shot(name, { width, height, mobile = false, scroll = 0, settle = 2600, dark = false }) {
  await cdp('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 2, mobile });
  await cdp('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: dark ? 'dark' : 'light' }] });
  await cdp('Page.navigate', { url: `http://127.0.0.1:${PORT}/${PAGE}` });
  for (let i = 0; i < 100; i++) { if (await js(`document.readyState === 'complete' && document.querySelectorAll('.card-shell').length > 0`)) break; await sleep(100); }
  if (scroll) await js(`document.documentElement.style.scrollBehavior = 'auto'; window.scrollTo(0, ${scroll}); 'ok'`);
  await sleep(settle);
  const { data } = await cdp('Page.captureScreenshot', { format: 'png' });
  writeFileSync(join(ROOT, 'verify', name), Buffer.from(data, 'base64'));
  console.log('  verify/' + name);
}
await shot(`${TAG}-1280-rest.png`, { width: 1280, height: 900 });
await shot(`${TAG}-1280-mid.png`, { width: 1280, height: 900, scroll: 420 });
await shot(`${TAG}-1280-pile.png`, { width: 1280, height: 900, scroll: 900 });
await shot(`${TAG}-375-rest.png`, { width: 375, height: 812, mobile: true });
await shot(`${TAG}-375-mid.png`, { width: 375, height: 812, mobile: true, scroll: 380 });
await shot(`${TAG}-1280-load.png`, { width: 1280, height: 900, settle: 700 });
ws.close(); process.exit(0);
