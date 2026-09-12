# longform

A single-user reading page. Five articles at a time from six longform
publications, spread across sources. Mark each one read, save it, or dismiss it.
Take notes while you read, keep the words that stick, look things up without
leaving.

Live: https://aishwaryakotagiri-bit.github.io/longform/

## How it works

```
GitHub Actions (daily, ~6am IST)
    └─ node scripts/fetch-feeds.mjs
         └─ fetches the feeds → dedupes → filters short-form → writes data/articles.json

GitHub Pages
    └─ serves index.html + data/articles.json
         └─ read / saved / dismissed / notes / words live in the browser (localStorage)
```

The page never fetches a publisher's feed itself — browsers block that. All
feed access is server-side. The look-up box calls Wiktionary and Wikipedia,
which are built for browser use and allow it.

Sources: Aeon, Literary Hub, The Paris Review, Nautilus, Orion Magazine, The Cut.
Orion blocks GitHub's servers, so its articles are seeded from a laptop run and
carried forward by the Action (shown as "kept" in the footer). To refresh them:

```
node scripts/fetch-feeds.mjs && git add data/articles.json && git commit -m "articles: refresh orion" && git push
```

## Notes and words live in the browser

Each device (and each way of opening the page — Safari vs a Home Screen icon)
keeps its own notes and words. Use **copy all** or **download .md** on the notes
and words tabs to get everything out as text.

## Browser extension (Chrome)

`extension/` is a Chrome side panel that shows the same page beside whatever
you're reading. On the six publishers' sites, selecting text drops it into the
look-up box; right-click any selection anywhere for "look up in longform" or
"keep as a word". The panel follows your tabs, so the article you're on becomes
"now reading" with its notes box.

Install: `chrome://extensions` → turn on **Developer mode** → **Load unpacked**
→ pick the `extension` folder. Click the toolbar icon to open the panel.

The panel keeps its own notes and words, separate from the web page.

## Local

```
python3 -m http.server 8000     # then open http://localhost:8000
node scripts/test-page.mjs      # page logic, no browser needed
node scripts/fetch-feeds.mjs    # refresh data/articles.json
```
