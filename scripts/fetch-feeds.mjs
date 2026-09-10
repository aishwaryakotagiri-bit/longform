import { writeFile, mkdir } from 'node:fs/promises';

/* Each source lists candidate feed URLs. The first one that yields fresh
   items wins, so a changed feed path does not take the whole build down.
   Every URL here was verified live on 2026-09-09.

   `exclude` drops items whose title or URL matches — for the short-form
   things some feeds mix in with their essays. Keep these narrow. */
const SOURCES = [
  { name: 'Aeon', site: 'https://aeon.co', candidates: [
      'https://aeon.co/feed.rss'
    ],
    /* Aeon's feed is roughly 40% short videos. */
    exclude: /aeon\.co\/videos\//
  },
  { name: 'Literary Hub', site: 'https://lithub.com', candidates: [
      'https://lithub.com/feed/',
      'https://lithub.com/rss'
    ],
    /* The daily link roundup, not a piece. */
    exclude: /^Lit Hub Daily\b/
  },
  { name: 'The Paris Review', site: 'https://www.theparisreview.org/blog/', candidates: [
      /* The FeedBurner mirror (feeds.feedburner.com/TheParisReviewBlog) stopped
         updating in Oct 2024. Do not add it back — it parses fine and would win. */
      'https://www.theparisreview.org/blog/feed/'
  ]},
  { name: 'Nautilus', site: 'https://nautil.us', candidates: [
      'https://nautil.us/feed/',
      'https://nautil.us/rss/'
  ]},
  { name: 'Orion Magazine', site: 'https://orionmagazine.org', candidates: [
      /* Orion stores pieces as a custom post type, so the default /feed/ is an
         empty channel. These two carry the actual articles. Both return 403
         from GitHub Actions (Cloudflare) though they work from a laptop. */
      'https://orionmagazine.org/article/feed/',
      'https://orionmagazine.org/feed/?post_type=article'
  ]},
  { name: 'The Cut', site: 'https://www.thecut.com', candidates: [
      /* thecut.com/rss.xml returns 404. */
      'https://feeds.feedburner.com/nymag/fashion'
    ],
    /* Daily and weekly horoscopes. */
    exclude: /horoscope/i
  }
];

const MAX_PER_SOURCE = 25;
const MAX_AGE_DAYS = 120;

const ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  ldquo: '“', rdquo: '”', lsquo: '‘', rsquo: '’',
  mdash: '—', ndash: '–', hellip: '…', eacute: 'é'
};

function decode(str) {
  return str
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&([a-zA-Z]+);/g, (m, n) => ENTITIES[n] ?? m);
}

function stripTags(html) {
  return decode(html).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

function tag(block, names) {
  for (const name of names) {
    const m = block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'i'));
    if (m) return decode(m[1]).trim();
  }
  return '';
}

/* Atom puts the URL in an attribute rather than the element body. */
function link(block) {
  const rss = block.match(/<link(?:\s[^>]*)?>([\s\S]*?)<\/link>/i);
  if (rss && rss[1].trim()) return decode(rss[1]).trim();
  const alt = block.match(/<link[^>]*rel=["']alternate["'][^>]*href=["']([^"']+)["']/i)
           || block.match(/<link[^>]*href=["']([^"']+)["']/i);
  return alt ? decode(alt[1]).trim() : '';
}

function parseFeed(xml, sourceName) {
  const blocks = xml.match(/<(item|entry)(?:\s[^>]*)?>[\s\S]*?<\/\1>/gi) || [];
  return blocks.map((block) => {
    const title = stripTags(tag(block, ['title']));
    const url = link(block);
    if (!title || !url) return null;

    const raw = tag(block, ['description', 'summary', 'content:encoded', 'content']);
    /* WordPress appends "The post X appeared first on Y." to every summary. */
    let blurb = stripTags(raw).replace(/\s*The post .{0,200}? appeared first on .{0,80}?\.?\s*$/, '');
    if (blurb.length > 240) blurb = blurb.slice(0, 237).trimEnd() + '…';

    const dateStr = tag(block, ['pubDate', 'published', 'updated', 'dc:date']);
    const parsed = dateStr ? new Date(dateStr) : null;
    const date = parsed && !isNaN(parsed) ? parsed.toISOString() : null;

    const author = stripTags(tag(block, ['dc:creator', 'author', 'name'])).slice(0, 80);

    return { source: sourceName, title, url, blurb, author, date };
  }).filter(Boolean);
}

async function fetchWithTimeout(url, ms = 20000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, {
      signal: ctrl.signal,
      redirect: 'follow',
      headers: {
        'user-agent': 'longform-reader/1.0 (personal RSS reader)',
        'accept': 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*'
      }
    });
  } finally {
    clearTimeout(timer);
  }
}

const cutoff = Date.now() - MAX_AGE_DAYS * 864e5;
const isFresh = (a) => !a.date || new Date(a.date).getTime() > cutoff;

/* A candidate that parses but has nothing recent is treated as broken.
   Without this, a stale mirror would win the race and quietly serve old posts. */
async function loadSource(source) {
  for (const url of source.candidates) {
    try {
      const res = await fetchWithTimeout(url);
      if (!res.ok) { console.log(`  ${url} -> HTTP ${res.status}`); continue; }
      const parsed = parseFeed(await res.text(), source.name);
      const items = parsed.filter((a) => !source.exclude?.test(`${a.title} ${a.url}`));
      const fresh = items.filter(isFresh);
      if (fresh.length) {
        const filtered = parsed.length - items.length;
        console.log(`  ${url} -> ${fresh.length} items${filtered ? ` (${filtered} filtered out)` : ''}`);
        return fresh.slice(0, MAX_PER_SOURCE);
      }
      console.log(`  ${url} -> parsed ${items.length} items, none within ${MAX_AGE_DAYS} days`);
    } catch (err) {
      console.log(`  ${url} -> ${err.message}`);
    }
  }
  console.log(`  ${source.name}: no working feed url`);
  return [];
}

const all = [];
const report = [];

for (const source of SOURCES) {
  console.log(source.name);
  const items = await loadSource(source);
  report.push({ source: source.name, count: items.length });
  all.push(...items);
}

const seen = new Set();
const articles = all
  .filter((a) => {
    const key = a.url.split('?')[0];
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  })
  .sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));

if (!articles.length) {
  console.error('No articles from any source. Keeping the previous articles.json.');
  process.exit(1);
}

await mkdir('data', { recursive: true });
await writeFile(
  'data/articles.json',
  JSON.stringify({ updated: new Date().toISOString(), report, articles }, null, 1)
);

console.log(`\nWrote ${articles.length} articles.`);
