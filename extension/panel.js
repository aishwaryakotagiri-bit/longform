/* the panel is the hosted page in a frame. this file only relays:
   selections and menu clicks in, and which article tab is in front. */
const ORIGIN = 'https://aishwaryakotagiri-bit.github.io';
const frame = document.getElementById('app');
let ready = false;
const waiting = [];

const send = (msg) => frame.contentWindow.postMessage({ longform: true, ...msg }, ORIGIN);
const deliver = (msg) => { if (ready) send(msg); else waiting.push(msg); };

window.addEventListener('message', (e) => {
  if (e.origin !== ORIGIN || !e.data || e.data.longform !== 'ready') return;
  ready = true;
  while (waiting.length) send(waiting.shift());
});

chrome.runtime.onMessage.addListener((msg) => {
  if (!msg || typeof msg.type !== 'string') return;
  deliver(msg);
  chrome.storage.session.remove('pending').catch(() => {});
});
chrome.storage.session.get('pending').then(({ pending }) => {
  if (!pending) return;
  deliver(pending);
  chrome.storage.session.remove('pending').catch(() => {});
}).catch(() => {});

/* which tab is in front. the url is only visible for the six publishers
   (host_permissions), so nothing else about your browsing reaches the page. */
async function announce() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab && tab.url) deliver({ type: 'page', url: tab.url });
  } catch { /* no tab access */ }
}
chrome.tabs.onActivated.addListener(announce);
chrome.tabs.onUpdated.addListener((tabId, info, tab) => { if (info.status === 'complete' && tab.active) announce(); });
announce();
