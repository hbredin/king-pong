const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

function app(round = 2) {
  const context = vm.createContext({
    console, localStorage: { getItem: () => null, setItem() {} },
    document: { getElementById: () => ({ addEventListener() {} }) },
  });
  const script = fs.readFileSync(path.join(__dirname, '../ping.html'), 'utf8').match(/<script>([\s\S]*?)<\/script>/)[1];
  vm.runInContext(script, context);
  const run = code => vm.runInContext(code, context);
  run('render=()=>{};notice=()=>{}');
  const players = Array.from({ length: 10 }, (_, i) => ({ id: `p${i}`, name: `Joueur ${i}`, elo: 1500+i*10, color: i%8 }));
  const ids = players.slice(0, 8).map(p => p.id);
  const rounds = Array.from({ length: round }, () => []);
  rounds[0] = Array.from({ length: 4 }, (_, i) => ({ id: `m${i}`, a: `p${2*i}`, b: `p${2*i+1}`, winner: `p${2*i}`, countedA: true, countedB: true, groupWins: 0 }));
  if (round > 1) rounds[round-1] = [{ id: 'locked', a: 'p0', b: 'p2', winner: 'p0', countedA: true, countedB: true, groupWins: 1 }];
  context.fixture = { version: 1, eloK: 40, players, history: [], active: { id: 't', date: '2026-10-20', round, completed: false, eloK: 32, selectedIds: ids, initialElo: Object.fromEntries(players.map(p => [p.id, 1500])), rounds, withdrawals: {} } };
  run('state=fixture');
  return { context, run };
}

for (const round of [2,3,4]) test(`arrivals in round ${round} preserve played matches and start with current Elo`, () => {
  const { context, run } = app(round);
  const original = run('JSON.stringify(state.active.rounds)');
  run("arrivalSelected=['p8','p9','p8','p0','missing'];confirmArrivals()");
  assert.equal(run('state.active.selectedIds.length'), 10);
  assert.equal(run('state.active.initialElo.p8'), 1580);
  assert.equal(run('state.active.eloK'), 32);
  assert.equal(run('score(state.active).wins.p8'), 0);
  assert.equal(run('score(state.active).losses.p8'), 0);
  assert.equal(run('score(state.active).elo.p8'), 1580);
  const before = JSON.parse(original);
  assert.equal(run('JSON.stringify(state.active.rounds.slice(0,-1))'), JSON.stringify(before.slice(0,-1)));
  assert.equal(run("JSON.stringify(state.active.rounds.at(-1).find(m=>m.id==='locked'))"), JSON.stringify(before.at(-1)[0]));
  assert.equal(run('state.active.pendingVolunteer'), null);
  for (const id of ['p8','p9']) {
    assert.equal(run(`state.active.rounds.at(-1).filter(m=>m.a==='${id}'||m.b==='${id}').length`), 1);
  }
  assert.equal(run('validateManualDraw(state.active,state.active.rounds.at(-1))'), '');
  run('state=sanitize(JSON.parse(JSON.stringify(state)))');
  assert.equal(run('state.active.initialElo.p8'), 1580);
  run('finishTournament(state.active)');
  assert.equal(run('state.history[0].playerCount'), 10);
  assert.equal(run("pdfTournamentSource('t').t.initialElo.p8"), 1580);
  for (const kind of ['ranking','matches','elo']) {
    const pdf = run(`buildTournamentPdf('${kind}',pdfTournamentSource('t').t,pdfTournamentSource('t').resolve)`);
    assert.equal(Buffer.from(pdf).subarray(0,8).toString(), '%PDF-1.4');
  }
});

test('odd arrivals request a volunteer, retain locked results, and can complete the draw', () => {
  const { run } = app();
  run("arrivalSelected=['p8'];confirmArrivals()");
  assert.equal(run('state.active.pendingVolunteer.round'), 2);
  assert.equal(run("state.active.rounds[1][0].id"), 'locked');
  run("chooseVolunteer('p0')");
  assert.equal(run('state.active.pendingVolunteer'), null);
  assert.equal(run("state.active.rounds[1].filter(m=>m.volunteerId==='p0').length"), 1);
  assert.equal(run("state.active.rounds[1].filter(m=>m.a==='p8'||m.b==='p8').length"), 1);
});

test('arrivals can resolve a pending volunteer request', () => {
  const { run } = app();
  run("arrivalSelected=['p8'];confirmArrivals();arrivalSelected=['p9'];confirmArrivals()");
  assert.equal(run('state.active.pendingVolunteer'), null);
  assert.equal(run('state.active.selectedIds.length'), 10);
});

test('closed tournaments, round one, duplicates and withdrawn players cannot be added', () => {
  for (const round of [1,5]) {
    const { run } = app(round);
    const before = run('JSON.stringify(state)');
    run("arrivalSelected=['p8'];confirmArrivals()");
    assert.equal(run('JSON.stringify(state)'), before);
  }
  const { run } = app();
  run("state.active.withdrawals.p1=2;arrivalSelected=['p1','p0'];confirmArrivals()");
  assert.equal(run('state.active.selectedIds.length'), 8);
  run('state.active.completed=true');
  const before = run('JSON.stringify(state)');
  run("arrivalSelected=['p8'];confirmArrivals()");
  assert.equal(run('JSON.stringify(state)'), before);
});

test('failed redraw leaves original participants, matches and Elo untouched', () => {
  const { run } = app();
  const before = run('JSON.stringify(state)');
  run("roundPlan=()=>({impossible:true});arrivalSelected=['p8','p9'];confirmArrivals()");
  assert.equal(run('JSON.stringify(state)'), before);
});
