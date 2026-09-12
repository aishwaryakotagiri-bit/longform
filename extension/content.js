/* on the six publishers' pages: whatever you select shows up in the panel's
   look-up box. it goes to this extension and nowhere else. */
let last = '';
function report() {
  const text = String(window.getSelection() || '').replace(/\s+/g, ' ').trim();
  if (!text || text === last || text.length > 300) return;
  last = text;
  chrome.runtime.sendMessage({ type: 'selection', text }).catch(() => {});
}
document.addEventListener('mouseup', () => setTimeout(report, 0));
document.addEventListener('keyup', (e) => { if (e.key === 'Shift' || e.shiftKey) setTimeout(report, 0); });
