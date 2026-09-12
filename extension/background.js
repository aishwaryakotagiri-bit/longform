/* right-click any selected text, anywhere, to send it to the panel. */
const MENU = {
  lookup: 'look up “%s” in longform',
  keep: 'keep “%s” as a word'
};

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    for (const [id, title] of Object.entries(MENU)) chrome.contextMenus.create({ id, title, contexts: ['selection'] });
  });
});

/* the toolbar icon opens the panel */
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  const msg = { type: String(info.menuItemId), text: String(info.selectionText || '').trim() };
  if (!msg.text) return;
  /* open first — this call must stay inside the click, not after an await */
  if (tab && tab.windowId !== undefined) chrome.sidePanel.open({ windowId: tab.windowId }).catch(() => {});
  /* park it in case the panel is only just opening, and deliver if it is already there */
  chrome.storage.session.set({ pending: msg })
    .then(() => chrome.runtime.sendMessage(msg))
    .catch(() => {});
});
