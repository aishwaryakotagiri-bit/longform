/* exercises the page's logic without a browser: the queue rules, notes,
   words, export, and (if online) the look-up calls. run: node scripts/test-page.mjs */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(join(root, 'index.html'), 'utf8');
const code = html.slice(html.indexOf('const SHOW = 5;'), html.indexOf('/* ---------- rendering ---------- */'));
const data = JSON.parse(readFileSync(join(root, 'data/articles.json'), 'utf8'));
const mk = () => new Function('articles', code +
  '\nstate.articles = articles; return { queue, state, id, setReading, setNote, keepWord, exportText, lookupData, byUrl, firstSentence };')(data.articles);

let fails = 0;
const check = (ok, label) => { console.log((ok ? 'PASS ' : 'FAIL ') + label); if (!ok) fails++; };
const show = (q) => q.map((a) => a.source).join(' | ');

/* --- the pile --- */
const t = mk();
const q1 = t.queue(); console.log('  initial: ' + show(q1));
check(q1.length === 5, 'five cards');
check(new Set(q1.map((a) => a.source)).size === 5, 'five different sources');
check(q1.filter((a) => a.source === 'The Cut').length <= 1, 'at most one Cut');

t.state.marks.read[t.id(q1[0])] = new Date().toISOString();
const q2 = t.queue(); console.log('  after read: ' + show(q2));
check(q1.slice(1).every((a, i) => q2[i] === a), 'remaining four stay in place');
check(!q1.some((a) => a.source === q2[4].source), 'refill came from the source that was waiting');

/* now reading: the piece leaves the pile, a slot is refilled, and it comes back on close */
const reading = q2[1];
t.setReading(t.id(reading));
const q3 = t.queue(); console.log('  while reading: ' + show(q3));
check(!q3.includes(reading) && q3.length === 5, 'the piece being read is out of the pile, slot refilled');
t.setReading(null);
const q4 = t.queue();
check(q4[0] === reading && q4.length === 5, 'closing it puts it back at the top');

const before = t.queue().map(t.id);
for (const a of data.articles) if (a.source !== 'The Cut') t.state.marks.skipped[t.id(a)] = 'x';
const q5 = t.queue();
check(q5.length === 1 && q5[0].source === 'The Cut', 'Cut cap holds even when it is all that is left');
const t2 = mk(); t2.state.marks = t.state.marks; t2.state.visible = t.state.visible;
check(JSON.stringify(t2.queue().map(t2.id)) === JSON.stringify(q5.map(t.id)), 'same cards after a reload');

/* --- notes --- */
const n = mk();
const art = data.articles[0];
n.setNote(n.id(art), 'the bit about frost pockets', art);
check(n.state.notes[n.id(art)].text === 'the bit about frost pockets' && n.state.notes[n.id(art)].title === art.title, 'a note keeps the article title with it');
n.setNote(n.id(art), '   ', art);
check(!(n.id(art) in n.state.notes), 'an emptied note is removed');

/* --- words --- */
n.keepWord('Serendipity', 'a happy accident', { title: art.title, url: art.url, source: art.source });
n.keepWord('peatland', '', null);
n.keepWord('serendipity', '', null);
check(n.state.words.length === 2, 'keeping a word again does not duplicate it');
check(n.state.words[0].w === 'serendipity' && n.state.words[0].m === 'a happy accident', 'it moves to the top and keeps its meaning');
check(n.keepWord('   ', '', null) === null, 'blank words are ignored');

/* --- export --- */
n.setNote(n.id(art), 'a note to export', art);
const md = n.exportText();
check(md.includes('## notes') && md.includes('a note to export') && md.includes('**serendipity** — a happy accident'), 'export carries notes and words');

/* --- url matching for the extension --- */
check(n.byUrl(art.url.toUpperCase() + '?utm=x#frag') === art, 'url matching ignores case, query and fragment');
check(n.firstSentence('One. Two three. Four') === 'One.', 'first sentence');

/* --- look-up (network; skipped if offline) --- */
try {
  const r = await n.lookupData('serendipity', new AbortController().signal);
  check(r.dict && r.dict.senses.length > 0 && !r.dictError, 'dictionary answers for a real word');
  check(r.wiki && r.wiki.extract.length > 0 && !r.wikiError, 'wikipedia answers for a real word');
  const z = await n.lookupData('zzqxvw', new AbortController().signal);
  check(!z.dict && !z.wiki && !z.dictError && !z.wikiError, 'a nonsense word is "nothing found", not an error');
} catch (e) {
  console.log('SKIP look-up tests (offline?): ' + e.message);
}

console.log(fails ? `\n${fails} failing` : '\nall passing');
process.exit(fails ? 1 : 0);
