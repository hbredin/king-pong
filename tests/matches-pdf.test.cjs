const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

function app() {
  const html = fs.readFileSync(path.join(__dirname, '../ping.html'), 'utf8');
  const context = vm.createContext({
    console,
    localStorage: { getItem: () => null },
    document: { getElementById: () => ({ addEventListener() {}, innerHTML: '' }) },
  });
  vm.runInContext(html.match(/<script>([\s\S]*?)<\/script>/)[1], context);
  return context;
}

test('PDF widths use the emitted Helvetica face and WinAnsi characters', () => {
  const context = app();
  // Standard font metrics: the old average-width estimate underestimated these.
  assert.equal(context.pdfTextWidth('Jean', 10, 'F1'), 21.68);
  assert.equal(context.pdfTextWidth('Jean', 10, 'F2'), 22.79);
  assert.equal(context.pdfTextWidth('ÉWŒ', 10, 'F2'), 26.11);
  assert.equal(context.pdfFit('Long nom', 2, 10, 'F2'), '');
  assert.ok(context.pdfTextWidth(context.pdfFit('MMMMWWWW', 30, 10, 'F2'), 10, 'F2') <= 30);
});

test('dense match PDF keeps names, results, tags and neighbouring columns apart', () => {
  const context = app();
  const names = ['Jean-Christophe Willaume', 'Émilie Œuillet-Marchand', 'WWW MMM NOM TRÈS LONG', 'Anne Dupont'];
  const players = Array.from({ length: 50 }, (_, i) => ({ id: `p${i}`, name: `${names[i % names.length]} ${i+1}`, elo: 1500 }));
  const rounds = Array.from({ length: 4 }, (_, r) => Array.from({ length: 25 }, (_, i) => ({
    a: players[i].id, b: players[i+25].id,
    ...(i === 24 ? {} : { winner: players[i % 2 ? i : i+25].id }),
    groupWins: i % (r+1), countedA: true, countedB: true,
    ...(i % 5 === 0 ? { volunteerId: players[i].id, promotedId: players[i+25].id, adjusted: true, manual: true } : {}),
  })));
  const t = { id: 'dense', date: '2026-10-06', selectedIds: players.map(p => p.id), rounds, initialElo: Object.fromEntries(players.map(p => [p.id, p.elo])), completed: true };
  const pdf = context.buildMatchesPdf(t, id => players.find(p => p.id === id));
  const text = Buffer.from(pdf).toString('latin1');
  const lines = new Map();
  for (const match of text.matchAll(/BT \/(F[12]) ([\d.]+) Tf .*? 1 0 0 1 ([\d.]+) ([\d.]+) Tm \((.*)\) Tj ET/g)) {
    const [, font, size, x, y, escaped] = match;
    const value = escaped.replace(/\\([\\()])/g, '$1');
    // Text in the PDF is already WinAnsi encoded, including its ligatures.
    const widths = vm.runInContext(`PDF_FONT_WIDTHS.${font}`, context);
    const width = [...value].reduce((sum, char) => sum + widths[char.charCodeAt(0)-32], 0) * Number(size) / 1000;
    const spans = lines.get(y) || [];
    spans.push({ start: Number(x), end: Number(x)+width, value });
    lines.set(y, spans);
  }
  assert.ok(lines.size > 30, 'all rows must be inspected');
  for (const spans of lines.values()) {
    spans.sort((a,b) => a.start-b.start);
    for (let i=1; i<spans.length; i++) {
      assert.ok(spans[i].start-spans[i-1].end >= 1, `overlap or missing gap: ${spans[i-1].value} / ${spans[i].value}`);
    }
    assert.ok(spans.at(-1).end <= 801, 'text must remain inside the page margins');
  }
  assert.equal((text.match(/\[VOL\/REP\/AR\/MAN\]/g) || []).length, 20);
  if (process.env.MATCHES_PREVIEW_PATH) fs.writeFileSync(process.env.MATCHES_PREVIEW_PATH, pdf);
});
