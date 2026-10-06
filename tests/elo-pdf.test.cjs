const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const html = fs.readFileSync(path.join(__dirname, '../ping.html'), 'utf8');
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
function app() {
  const context = vm.createContext({
    console,
    localStorage: { getItem: () => null },
    document: { getElementById: () => ({ addEventListener() {}, innerHTML: '' }) },
  });
  vm.runInContext(script, context);
  return context;
}

function tournament() {
  return {
    id: 'example', date: '2026-10-06', completed: true,
    selectedIds: ['a', 'b', 'c', 'd'],
    initialElo: { a: 1500, b: 1500, c: 1500, d: 1500 },
    withdrawals: { d: 2 },
    rounds: [
      [{ a: 'a', b: 'b', winner: 'a', countedA: true, countedB: true },
       { a: 'c', b: 'd', winner: 'c', countedA: true, countedB: true }],
      [{ a: 'b', b: 'a', winner: 'a', countedA: true, countedB: false, volunteerId: 'a' }],
      [{ a: 'a', b: 'c', winner: 'c', countedA: false, countedB: true, volunteerId: 'a' }],
      [{ a: 'b', b: 'c', countedA: true, countedB: true }],
    ],
  };
}

test('counts only played, counted results, including losses before withdrawal', () => {
  const context = app();
  const result = context.score(tournament());
  assert.deepEqual({ ...result.wins }, { a: 1, b: 0, c: 2, d: 0 });
  assert.deepEqual({ ...result.losses }, { a: 0, b: 2, c: 0, d: 1 });
  assert.deepEqual({ ...result.elo }, { a: 1512, b: 1477, c: 1524, d: 1488 });
  const empty = context.score({ ...tournament(), rounds: [] });
  assert.deepEqual({ ...empty.losses }, { a: 0, b: 0, c: 0, d: 0 });
});

test('Elo PDF includes matching win/loss columns for active and archived tournaments', () => {
  const context = app();
  const t = tournament();
  const roster = ['Anne Dupont', 'Bernard Martin', 'Claire Lefèvre', 'Dominique Bernard'].map((name, i) => ({
    id: t.selectedIds[i], name, elo: 1500,
  }));
  context.fixture = { active: t, players: roster, history: [{ ...t, roster }] };
  vm.runInContext('state = fixture', context);
  const calls = [];
  const originalText = context.pdfText;
  context.pdfText = (...args) => { calls.push(args); return originalText(...args); };
  for (const historyId of [null, t.id]) {
    calls.length = 0;
    const source = context.pdfTournamentSource(historyId);
    const pdf = context.buildTournamentPdf('elo', source.t, source.resolve);
    assert.equal(Buffer.from(pdf).subarray(0, 8).toString(), '%PDF-1.4');
    const column = x => calls.filter(call => call[1] === x).map(call => call[3]);
    assert.deepEqual(column(228), ['V', '2', '1', '0', '0']);
    assert.deepEqual(column(252), ['D', '0', '0', '1', '2']);
    if (process.env.PDF_PREVIEW_PATH && !historyId) fs.writeFileSync(process.env.PDF_PREVIEW_PATH, pdf);
  }
});

test('cumulative records include earlier tournaments once and stop at the selected archive', () => {
  const context = app();
  const current = tournament();
  // Same date on purpose: use archive order rather than the calendar date.
  const earlier = { ...tournament(), id: 'earlier', rounds: [[
    { a: 'a', b: 'b', winner: 'b', countedA: true, countedB: true },
    { a: 'c', b: 'd', winner: 'd', countedA: true, countedB: true },
  ]] };
  context.fixture = { history: [current, earlier], active: current };
  vm.runInContext('state = fixture', context);
  const record = context.cumulativeRecord(current);
  assert.deepEqual({ ...record.wins }, { a: 1, b: 1, c: 2, d: 1 });
  assert.deepEqual({ ...record.losses }, { a: 1, b: 2, c: 1, d: 1 });
  const names = { a: 'Anne Dupont', b: 'Bernard Martin', c: 'Claire Lefèvre', d: 'Dominique Bernard' };
  const cells = [];
  const originalText = context.pdfText;
  context.pdfText = (...args) => { cells.push(args); return originalText(...args); };
  const pdf = context.buildEloPdf(current, pid => ({ name: names[pid], elo: 1500 }));
  assert.deepEqual(cells.filter(cell => cell[1] === 228).map(cell => cell[3]), ['V', '2', '1', '1', '1']);
  assert.deepEqual(cells.filter(cell => cell[1] === 252).map(cell => cell[3]), ['D', '1', '1', '1', '2']);
  if (process.env.PDF_PREVIEW_PATH) fs.writeFileSync(process.env.PDF_PREVIEW_PATH, pdf);
  const archived = context.cumulativeRecord(earlier);
  assert.deepEqual({ ...archived.wins }, { a: 0, b: 1, c: 0, d: 1 });
  assert.deepEqual({ ...archived.losses }, { a: 1, b: 0, c: 1, d: 0 });
  context.fixture.history = [earlier];
  assert.deepEqual({ ...context.cumulativeRecord(current).wins }, { ...record.wins });
  // Counting follows player IDs, including players absent from earlier events.
  const newcomer = { ...current, selectedIds: [...current.selectedIds, 'new'] };
  assert.equal(context.cumulativeRecord(newcomer).wins.new, 0);
  assert.equal(context.cumulativeRecord(newcomer).losses.new, 0);
});
