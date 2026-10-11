const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const { test } = require('node:test');

function app() {
  const input = { value: '32', addEventListener() {} };
  const context = vm.createContext({ console, localStorage: { getItem: () => null, setItem() {} }, document: { getElementById: () => input } });
  const html = fs.readFileSync(path.join(__dirname, '../ping.html'), 'utf8');
  vm.runInContext(html.match(/<script>([\s\S]*?)<\/script>/)[1], context);
  vm.runInContext('render=()=>{};notice=()=>{}', context);
  return { context, input, run: code => vm.runInContext(code, context) };
}

test('K affects Elo and retains volunteer neutrality', () => {
  const { context } = app();
  const t = { selectedIds: ['a', 'b'], initialElo: { a: 1500, b: 1500 }, rounds: [[{ a: 'a', b: 'b', winner: 'a', countedA: true, countedB: true }]] };
  assert.equal(context.score(t).elo.a, 1512);
  assert.equal(context.score({ ...t, eloK: 32 }).elo.a, 1516);
  t.rounds[0][0].volunteerId = 'a';
  assert.equal(context.score({ ...t, eloK: 32 }).elo.a, 1500);
  assert.equal(context.score({ ...t, eloK: 32 }).elo.b, 1484);
});

test('settings apply to new tournaments, survive JSON, and never rewrite active or archived K', () => {
  const { context, input, run } = app();
  const event = { preventDefault() {} };
  context.saveEloK(event);
  run('selected=state.players.slice(0,2).map(p=>p.id);startTournament()');
  assert.equal(run('state.active.eloK'), 32);
  input.value = '40'; context.saveEloK(event);
  assert.equal(run('state.eloK'), 40);
  assert.equal(run('state.active.eloK'), 32);
  run('state.active.rounds[0][0].winner=state.active.rounds[0][0].a;finishTournament(state.active)');
  assert.equal(run('state.history[0].eloK'), 32);
  run('state=sanitize(JSON.parse(JSON.stringify(state)))');
  assert.equal(run('state.eloK'), 40);
  assert.equal(run('state.active.eloK'), 32);
  assert.equal(run('pdfTournamentSource(state.history[0].id).t.eloK'), 32);
  const pdf = run("buildTournamentPdf('elo',pdfTournamentSource(state.history[0].id).t,player)");
  assert.match(Buffer.from(pdf).toString('latin1'), /coefficient K = 32/);
  run('newTournament();selected=state.players.slice(0,2).map(p=>p.id);startTournament()');
  assert.equal(run('state.active.eloK'), 40);
  for (const bad of ['', '0', '-1', '101', 'NaN', '3.5']) {
    input.value = bad; context.saveEloK(event);
    assert.equal(run('state.eloK'), 40);
  }
});

test('old backups keep K=24 independently of the new preference', () => {
  const { run } = app();
  run('selected=state.players.slice(0,2).map(p=>p.id);startTournament();state.active.rounds[0][0].winner=state.active.rounds[0][0].a;finishTournament(state.active);delete state.active.eloK;delete state.history[0].eloK;state.eloK=40;state=sanitize(state)');
  assert.equal(run('state.eloK'), 40);
  assert.equal(run('state.active.eloK'), 24);
  assert.equal(run('state.history[0].eloK'), 24);
  assert.equal(run('sanitize({version:1,players:[]}).eloK'), 24);
});
