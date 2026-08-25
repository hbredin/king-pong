'use client';

import { ChangeEvent, useEffect, useMemo, useRef, useState } from 'react';

type Player = { id: string; name: string; elo: number; color: string };
type Match = { id: string; round: number; groupWins: number; a: string; b: string; countedA: boolean; countedB: boolean; winner?: string };
type Tournament = { id: string; date: string; round: number; selectedIds: string[]; rounds: Match[][]; initialElo: Record<string, number>; completed: boolean };
type HistoryItem = { id: string; date: string; playerCount: number; winner: string; rounds: Match[][] };
type AppData = { version: 1; players: Player[]; history: HistoryItem[]; active: Tournament | null };
type View = 'tournoi' | 'joueurs' | 'classement' | 'historique';

const COLORS = ['mint', 'blue', 'coral', 'gold', 'lilac', 'sky', 'pink', 'lime'];
const INITIAL_PLAYERS: Player[] = [
  { id: 'camille', name: 'Camille Laurent', elo: 1642, color: 'mint' },
  { id: 'mathieu', name: 'Mathieu Bernard', elo: 1587, color: 'blue' },
  { id: 'sophie', name: 'Sophie Martin', elo: 1531, color: 'coral' },
  { id: 'thomas', name: 'Thomas Dubois', elo: 1498, color: 'gold' },
  { id: 'emma', name: 'Emma Lefèvre', elo: 1456, color: 'lilac' },
  { id: 'nicolas', name: 'Nicolas Henry', elo: 1412, color: 'sky' },
  { id: 'julie', name: 'Julie Moreau', elo: 1378, color: 'pink' },
  { id: 'lucas', name: 'Lucas Blanc', elo: 1344, color: 'lime' },
];
const STORAGE_KEY = 'ping-tournament-v1';

function initials(name: string) { return name.split(/\s+/).map((part) => part[0]).join('').slice(0, 2).toUpperCase(); }
function uid(prefix: string) { return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`; }
function shuffle<T>(items: T[]) { const out = [...items]; for (let i = out.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [out[i], out[j]] = [out[j], out[i]]; } return out; }
function formatDate(value: string, long = false) { return new Intl.DateTimeFormat('fr-FR', long ? { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' } : { day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(`${value}T12:00:00`)); }

function scoreTournament(tournament: Tournament) {
  const wins: Record<string, number> = Object.fromEntries(tournament.selectedIds.map((id) => [id, 0]));
  const elo = { ...tournament.initialElo };
  tournament.rounds.flat().forEach((match) => {
    if (!match.winner) return;
    const loser = match.winner === match.a ? match.b : match.a;
    if (match.winner === match.a && match.countedA) wins[match.a] = (wins[match.a] || 0) + 1;
    if (match.winner === match.b && match.countedB) wins[match.b] = (wins[match.b] || 0) + 1;
    const expectedWinner = 1 / (1 + Math.pow(10, ((elo[loser] || 1500) - (elo[match.winner] || 1500)) / 400));
    const delta = Math.round(24 * (1 - expectedWinner));
    elo[match.winner] = (elo[match.winner] || 1500) + delta;
    elo[loser] = (elo[loser] || 1500) - delta;
  });
  return { wins, elo };
}

function makeRound(players: Player[], tournament: Tournament, round: number): Match[] {
  void players;
  const { wins, elo } = scoreTournament(tournament);
  const selected = tournament.selectedIds;
  const levels = [...new Set(selected.map((id) => wins[id] || 0))].sort((a, b) => b - a);
  const groups = levels.map((level) => selected.filter((id) => (wins[id] || 0) === level).sort((a, b) => (elo[b] || 0) - (elo[a] || 0)));
  const matches: Match[] = [];

  groups.forEach((ids, groupIndex) => {
    const entries = ids.map((id) => ({ id, counted: true }));
    if (entries.length % 2 === 1) {
      const lower = groups[groupIndex + 1] || [];
      const other = selected.filter((id) => !ids.includes(id)).sort((a, b) => (elo[b] || 0) - (elo[a] || 0));
      const helper = lower[0] || other[0] || ids[0];
      if (helper) entries.push({ id: helper, counted: false });
    }
    entries.sort((a, b) => (elo[b.id] || 0) - (elo[a.id] || 0));
    const half = Math.ceil(entries.length / 2);
    const strong = entries.slice(0, half);
    const weak = shuffle(entries.slice(half));
    strong.forEach((first, index) => {
      if (!weak[index]) return;
      if (first.id === weak[index].id) {
        const swapIndex = weak.findIndex((candidate, i) => i !== index && candidate.id !== first.id && strong[i]?.id !== weak[index].id);
        if (swapIndex >= 0) [weak[index], weak[swapIndex]] = [weak[swapIndex], weak[index]];
      }
      const second = weak[index];
      if (first.id === second.id) return;
      matches.push({ id: uid('match'), round, groupWins: levels[groupIndex], a: first.id, b: second.id, countedA: first.counted, countedB: second.counted });
    });
  });
  return matches;
}

export default function Home() {
  const [data, setData] = useState<AppData>({ version: 1, players: INITIAL_PLAYERS, history: [], active: null });
  const [hydrated, setHydrated] = useState(false);
  const [view, setView] = useState<View>('tournoi');
  const [selected, setSelected] = useState<string[]>(INITIAL_PLAYERS.slice(0, 6).map((p) => p.id));
  const [query, setQuery] = useState('');
  const [newName, setNewName] = useState('');
  const [newElo, setNewElo] = useState('1500');
  const [dataOpen, setDataOpen] = useState(false);
  const [notice, setNotice] = useState('');
  const importRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        const saved = localStorage.getItem(STORAGE_KEY);
        if (saved) {
          const parsed = JSON.parse(saved) as AppData;
          if (parsed.version === 1 && Array.isArray(parsed.players)) { setData(parsed); setSelected(parsed.active?.selectedIds || []); }
        }
      } catch { setNotice('Les données locales n’ont pas pu être lues.'); }
      setHydrated(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);
  useEffect(() => { if (hydrated) localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); }, [data, hydrated]);
  useEffect(() => { if (!notice) return; const timeout = window.setTimeout(() => setNotice(''), 3200); return () => window.clearTimeout(timeout); }, [notice]);

  const sortedPlayers = useMemo(() => [...data.players].sort((a, b) => b.elo - a.elo), [data.players]);
  const filteredPlayers = sortedPlayers.filter((player) => player.name.toLowerCase().includes(query.toLowerCase()));
  const current = data.active;
  const scored = current ? scoreTournament(current) : null;
  const currentMatches = current?.rounds[current.round - 1] || [];
  const allCurrentDone = currentMatches.length > 0 && currentMatches.every((match) => match.winner);

  function startTournament() {
    if (selected.length < 2) return;
    const date = new Date().toISOString().slice(0, 10);
    const tournament: Tournament = { id: uid('tournoi'), date, round: 1, selectedIds: selected, rounds: [], initialElo: Object.fromEntries(data.players.map((p) => [p.id, p.elo])), completed: false };
    tournament.rounds = [makeRound(data.players, tournament, 1)];
    setData((old) => ({ ...old, active: tournament }));
  }

  function setWinner(matchId: string, winnerId: string) {
    setData((old) => {
      if (!old.active) return old;
      const rounds = old.active.rounds.map((round) => round.map((match) => match.id === matchId ? { ...match, winner: winnerId } : match));
      return { ...old, active: { ...old.active, rounds } };
    });
  }

  function nextRound() {
    if (!current || !allCurrentDone) return;
    if (current.round < 4) {
      const next = current.round + 1;
      const nextTournament = { ...current, round: next };
      nextTournament.rounds = [...current.rounds, makeRound(data.players, nextTournament, next)];
      setData((old) => ({ ...old, active: nextTournament }));
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    const finalScore = scoreTournament(current);
    const ranking = [...current.selectedIds].sort((a, b) => (finalScore.wins[b] - finalScore.wins[a]) || (finalScore.elo[b] - finalScore.elo[a]));
    const finished: Tournament = { ...current, completed: true, round: 5 };
    const history: HistoryItem = { id: current.id, date: current.date, playerCount: current.selectedIds.length, winner: ranking[0], rounds: current.rounds };
    setData((old) => ({ ...old, players: old.players.map((p) => ({ ...p, elo: finalScore.elo[p.id] ?? p.elo })), history: [history, ...old.history], active: finished }));
  }

  function newTournament() { setData((old) => ({ ...old, active: null })); setSelected([]); setView('tournoi'); }
  function addPlayer() {
    const name = newName.trim(); const elo = Number(newElo);
    if (!name || !Number.isFinite(elo) || elo < 100 || elo > 4000) return;
    setData((old) => ({ ...old, players: [...old.players, { id: uid('joueur'), name, elo: Math.round(elo), color: COLORS[old.players.length % COLORS.length] }] }));
    setNewName(''); setNewElo('1500'); setNotice(`${name} a été ajouté.`);
  }
  function deletePlayer(id: string) {
    if (data.active && !data.active.completed && data.active.selectedIds.includes(id)) { setNotice('Ce joueur participe au tournoi en cours.'); return; }
    setData((old) => ({ ...old, players: old.players.filter((p) => p.id !== id) })); setSelected((ids) => ids.filter((item) => item !== id));
  }
  function exportData() {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }); const url = URL.createObjectURL(blob); const anchor = document.createElement('a');
    anchor.href = url; anchor.download = `ping-sauvegarde-${new Date().toISOString().slice(0, 10)}.json`; anchor.click(); URL.revokeObjectURL(url); setNotice('Sauvegarde exportée.');
  }
  function importData(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]; if (!file) return; const reader = new FileReader();
    reader.onload = () => { try { const parsed = JSON.parse(String(reader.result)) as AppData; if (parsed.version !== 1 || !Array.isArray(parsed.players) || !Array.isArray(parsed.history)) throw new Error(); setData(parsed); setSelected(parsed.active?.selectedIds || []); setDataOpen(false); setNotice('Sauvegarde importée.'); } catch { setNotice('Ce fichier de sauvegarde n’est pas valide.'); } };
    reader.readAsText(file); event.target.value = '';
  }

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <button className="brand brand-button" onClick={() => setView('tournoi')} aria-label="Ping — accueil"><span className="brand-mark"><i /></span><span>ping<span className="brand-dot">.</span></span></button>
        <nav className="main-nav" aria-label="Navigation principale"><NavItem label="Tournoi" icon="bracket-icon" active={view === 'tournoi'} onClick={() => setView('tournoi')} /><NavItem label="Joueurs" icon="people-icon" active={view === 'joueurs'} onClick={() => setView('joueurs')} /><NavItem label="Classement" icon="rank-icon" active={view === 'classement'} onClick={() => setView('classement')} /><NavItem label="Historique" icon="history-icon" active={view === 'historique'} onClick={() => setView('historique')} /></nav>
        <div className="sidebar-bottom"><p className="storage-label">Stockage local</p><div className="storage-status"><span />Données sauvegardées</div><button className="data-button" type="button" onClick={() => setDataOpen(true)}><span className="download-icon">↓</span> Importer / Exporter</button></div>
      </aside>
      <section className="workspace">
        <Header view={view} active={current} onData={() => setDataOpen(true)} />
        {view === 'tournoi' && !current && <Presence players={filteredPlayers} selected={selected} query={query} setQuery={setQuery} toggle={(id) => setSelected((ids) => ids.includes(id) ? ids.filter((item) => item !== id) : [...ids, id])} onStart={startTournament} />}
        {view === 'tournoi' && current && !current.completed && <RoundView tournament={current} matches={currentMatches} players={data.players} wins={scored!.wins} onWinner={setWinner} onNext={nextRound} allDone={allCurrentDone} />}
        {view === 'tournoi' && current?.completed && <Results tournament={current} players={data.players} score={scored!} onNew={newTournament} />}
        {view === 'joueurs' && <PlayersView players={sortedPlayers} newName={newName} newElo={newElo} setNewName={setNewName} setNewElo={setNewElo} onAdd={addPlayer} onDelete={deletePlayer} />}
        {view === 'classement' && <RankingView players={sortedPlayers} history={data.history} />}
        {view === 'historique' && <HistoryView history={data.history} players={data.players} />}
      </section>
      {dataOpen && <DataModal onClose={() => setDataOpen(false)} onExport={exportData} onImport={() => importRef.current?.click()} />}
      <input ref={importRef} className="hidden-input" type="file" accept="application/json,.json" onChange={importData} />
      {notice && <div className="toast" role="status">{notice}</div>}
    </main>
  );
}

function NavItem({ label, icon, active, onClick }: { label: string; icon: string; active: boolean; onClick: () => void }) { return <button className={`nav-item ${active ? 'active' : ''}`} onClick={onClick}><span className={`nav-icon ${icon}`} />{label}</button>; }
function Header({ view, active, onData }: { view: View; active: Tournament | null; onData: () => void }) { const titles: Record<View, string> = { tournoi: active?.completed ? 'Résultats du tournoi' : active ? `Tour ${active.round} sur 4` : 'Tournoi du jour', joueurs: 'Membres du club', classement: 'Classement Elo', historique: 'Historique des tournois' }; return <header className="topbar"><div><p className="eyebrow">{formatDate(new Date().toISOString().slice(0, 10), true)}</p><h1>{titles[view]}</h1></div><div className="top-actions"><span className="round-pill">4 tours · Elo K24</span><button className="more-button" type="button" aria-label="Importer ou exporter" onClick={onData}>•••</button></div></header>; }
function Stepper({ round }: { round: number }) { const steps = [{ n: 1, title: 'Présences', sub: 'Joueurs du jour' }, { n: 2, title: 'Tour 1', sub: 'Tirage initial' }, { n: 3, title: 'Tours 2–4', sub: 'Groupes par victoires' }, { n: 4, title: 'Résultats', sub: 'Nouveau classement' }]; const active = round === 0 ? 1 : round === 1 ? 2 : round <= 4 ? 3 : 4; return <div className="stepper" aria-label="Progression du tournoi">{steps.map((step, index) => <span className="step-fragment" key={step.n}><div className={`step ${active === step.n ? 'active' : active > step.n ? 'done' : ''}`}><span>{active > step.n ? '✓' : step.n}</span><div><strong>{step.title}</strong><small>{step.sub}</small></div></div>{index < steps.length - 1 && <i />}</span>)}</div>; }

function Presence({ players, selected, query, setQuery, toggle, onStart }: { players: Player[]; selected: string[]; query: string; setQuery: (v: string) => void; toggle: (id: string) => void; onStart: () => void }) { return <><Stepper round={0} /><div className="content-grid"><section className="selection-panel"><div className="panel-heading"><div><h2>Qui joue aujourd’hui&nbsp;?</h2><p>Sélectionnez les membres présents pour commencer le tournoi.</p></div><div className="count-badge"><strong>{selected.length}</strong><span>présents</span></div></div><label className="search-box"><span className="search-icon" /><input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Rechercher un joueur…" aria-label="Rechercher un joueur" /></label><div className="table-labels"><span>Joueur</span><span>Classement Elo</span><span>Présent</span></div><div className="players-list">{players.map((item, index) => <label className={`player-row ${selected.includes(item.id) ? 'selected' : ''}`} key={item.id}><span className={`avatar ${item.color}`}>{initials(item.name)}</span><span className="player-meta"><strong>{item.name}</strong><small>#{index + 1} du club</small></span><span className="elo"><strong>{item.elo}</strong><small>points</small></span><input type="checkbox" checked={selected.includes(item.id)} onChange={() => toggle(item.id)} /><span className="checkmark" /></label>)}</div><div className="selection-footer"><p><span className="info-icon">i</span> Le classement Elo détermine les têtes de série.</p><button className="primary-button" type="button" disabled={selected.length < 2} onClick={onStart}>Créer le tirage <span>→</span></button></div></section><MiniRanking players={players} /></div></>; }
function MiniRanking({ players }: { players: Player[] }) { return <aside className="ranking-card"><div className="ranking-title"><div><span className="trophy-icon">♜</span><h2>Classement du club</h2></div></div><p className="ranking-note">Mis à jour après le dernier tournoi</p><ol>{players.slice(0, 5).map((item, index) => <li key={item.id}><span className={`rank-number rank-${index + 1}`}>{index + 1}</span><span className={`avatar small ${item.color}`}>{initials(item.name)}</span><span className="rank-player"><strong>{item.name.split(' ')[0]}</strong><small>{index === 0 ? 'Tête de série' : 'Elo officiel'}</small></span><strong className="rank-elo">{item.elo}</strong></li>)}</ol><div className="elo-explainer"><span className="spark">✦</span><div><strong>Des matchs équilibrés</strong><p>Chaque groupe oppose sa moitié haute à sa moitié basse.</p></div></div></aside>; }

function RoundView({ tournament, matches, players, wins, onWinner, onNext, allDone }: { tournament: Tournament; matches: Match[]; players: Player[]; wins: Record<string, number>; onWinner: (match: string, winner: string) => void; onNext: () => void; allDone: boolean }) { const byGroup = [...new Set(matches.map((m) => m.groupWins))].sort((a, b) => b - a); const find = (id: string) => players.find((p) => p.id === id)!; return <><Stepper round={tournament.round} /><section className="round-shell"><div className="round-intro"><div><p className="round-kicker">Tour {tournament.round} · {matches.length} matchs</p><h2>{tournament.round === 1 ? 'Le tirage est prêt' : 'Les groupes sont formés'}</h2><p>Cliquez sur le vainqueur de chaque rencontre.</p></div><div className="score-legend"><span><i className="strong-dot" />Moitié haute</span><span><i className="weak-dot" />Moitié basse</span></div></div>{byGroup.map((group) => <div className="match-group" key={group}><div className="group-heading"><strong>{group} victoire{group > 1 ? 's' : ''}</strong><span>{matches.filter((m) => m.groupWins === group).length} match{matches.filter((m) => m.groupWins === group).length > 1 ? 's' : ''}</span></div><div className="matches-grid">{matches.filter((m) => m.groupWins === group).map((match, index) => <article className="match-card" key={match.id}><div className="match-number"><span>Match {index + 1}</span>{(!match.countedA || !match.countedB) && <em>Repêchage</em>}</div><WinnerButton item={find(match.a)} selected={match.winner === match.a} lost={!!match.winner && match.winner !== match.a} onClick={() => onWinner(match.id, match.a)} guest={!match.countedA} wins={wins[match.a] || 0} /><div className="versus">VS</div><WinnerButton item={find(match.b)} selected={match.winner === match.b} lost={!!match.winner && match.winner !== match.b} onClick={() => onWinner(match.id, match.b)} guest={!match.countedB} wins={wins[match.b] || 0} /></article>)}</div></div>)}<div className="round-footer"><p>{matches.filter((m) => m.winner).length} / {matches.length} résultats saisis</p><button className="primary-button large" disabled={!allDone} onClick={onNext}>{tournament.round === 4 ? 'Terminer le tournoi' : `Passer au tour ${tournament.round + 1}`} <span>→</span></button></div></section></>; }
function WinnerButton({ item, selected, lost, onClick, guest, wins }: { item: Player; selected: boolean; lost: boolean; onClick: () => void; guest: boolean; wins: number }) { return <button className={`competitor ${selected ? 'winner' : ''} ${lost ? 'loser' : ''}`} onClick={onClick}><span className={`avatar ${item.color}`}>{initials(item.name)}</span><span><strong>{item.name}</strong><small>{item.elo} Elo · {wins} V{guest ? ' · renfort' : ''}</small></span>{selected && <b>✓</b>}</button>; }

function Results({ tournament, players, score, onNew }: { tournament: Tournament; players: Player[]; score: { wins: Record<string, number>; elo: Record<string, number> }; onNew: () => void }) { const ranking = [...tournament.selectedIds].sort((a, b) => (score.wins[b] - score.wins[a]) || (score.elo[b] - score.elo[a])); const find = (id: string) => players.find((p) => p.id === id)!; return <><Stepper round={5} /><section className="results-shell"><div className="podium"><span className="confetti">✦</span><p>Tournoi terminé</p><h2>{find(ranking[0]).name} s’impose&nbsp;!</h2><span>{score.wins[ranking[0]]} victoires · {score.elo[ranking[0]]} Elo</span></div><div className="results-table"><div className="results-head"><span>Place</span><span>Joueur</span><span>Victoires</span><span>Évolution Elo</span><span>Nouveau Elo</span></div>{ranking.map((id, index) => { const item = find(id); const delta = score.elo[id] - tournament.initialElo[id]; return <div className="result-row" key={id}><strong className={`place place-${index + 1}`}>{index + 1}</strong><span className="result-person"><i className={`avatar small ${item.color}`}>{initials(item.name)}</i><strong>{item.name}</strong></span><strong>{score.wins[id]} / 4</strong><span className={delta >= 0 ? 'positive' : 'negative'}>{delta >= 0 ? '+' : ''}{delta}</span><strong>{score.elo[id]}</strong></div>; })}</div><button className="primary-button large new-button" onClick={onNew}>Préparer un nouveau tournoi <span>→</span></button></section></>; }

function PlayersView({ players, newName, newElo, setNewName, setNewElo, onAdd, onDelete }: { players: Player[]; newName: string; newElo: string; setNewName: (v: string) => void; setNewElo: (v: string) => void; onAdd: () => void; onDelete: (id: string) => void }) { return <section className="page-card management"><div className="section-heading"><div><p className="round-kicker">{players.length} membres inscrits</p><h2>Effectif du club</h2></div></div><div className="add-player"><input value={newName} onChange={(e) => setNewName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && onAdd()} placeholder="Nom et prénom" aria-label="Nom du joueur" /><input value={newElo} onChange={(e) => setNewElo(e.target.value)} type="number" min="100" max="4000" aria-label="Classement Elo initial" /><button className="primary-button" onClick={onAdd}>Ajouter</button></div><div className="member-list">{players.map((item, index) => <div className="member-row" key={item.id}><span className="member-rank">#{index + 1}</span><span className={`avatar ${item.color}`}>{initials(item.name)}</span><span><strong>{item.name}</strong><small>Membre actif</small></span><strong className="member-elo">{item.elo} <small>Elo</small></strong><button className="delete-button" onClick={() => onDelete(item.id)} aria-label={`Supprimer ${item.name}`}>×</button></div>)}</div></section>; }
function RankingView({ players, history }: { players: Player[]; history: HistoryItem[] }) { return <section className="page-card management"><div className="section-heading"><div><p className="round-kicker">Après {history.length} tournoi{history.length > 1 ? 's' : ''}</p><h2>Classement général</h2></div><span className="round-pill">Coefficient K = 24</span></div><div className="leaderboard">{players.map((item, index) => <div className={`leader-row ${index < 3 ? 'top' : ''}`} key={item.id}><span className={`leader-place place-${index + 1}`}>{index + 1}</span><span className={`avatar ${item.color}`}>{initials(item.name)}</span><span><strong>{item.name}</strong><small>{index === 0 ? 'Leader du club' : `${players[index - 1]?.elo - item.elo || 0} pts du rang précédent`}</small></span><strong>{item.elo}</strong></div>)}</div></section>; }
function HistoryView({ history, players }: { history: HistoryItem[]; players: Player[] }) { const find = (id: string) => players.find((p) => p.id === id); return <section className="page-card management"><div className="section-heading"><div><p className="round-kicker">Archives locales</p><h2>Tournois précédents</h2></div></div>{history.length === 0 ? <div className="empty-state"><span>◎</span><h3>Aucun tournoi terminé</h3><p>Les résultats apparaîtront ici après le quatrième tour.</p></div> : <div className="history-list">{history.map((item) => <article key={item.id}><div className="history-date"><strong>{formatDate(item.date)}</strong><span>{item.playerCount} joueurs · 4 tours</span></div><div className="history-winner"><span className={`avatar ${find(item.winner)?.color || 'mint'}`}>{initials(find(item.winner)?.name || '?')}</span><span><small>Vainqueur</small><strong>{find(item.winner)?.name || 'Joueur supprimé'}</strong></span></div><span className="history-matches">{item.rounds.flat().length} matchs</span></article>)}</div>}</section>; }
function DataModal({ onClose, onExport, onImport }: { onClose: () => void; onExport: () => void; onImport: () => void }) { return <div className="modal-backdrop" onMouseDown={onClose}><section className="modal" role="dialog" aria-modal="true" aria-labelledby="data-title" onMouseDown={(e) => e.stopPropagation()}><button className="modal-close" onClick={onClose} aria-label="Fermer">×</button><span className="modal-icon">↕</span><h2 id="data-title">Vos données Ping</h2><p>Transférez l’effectif, le classement et l’historique vers un autre ordinateur avec un fichier JSON.</p><div className="modal-actions"><button className="primary-button" onClick={onExport}>↓ Exporter une sauvegarde</button><button className="secondary-button" onClick={onImport}>↑ Importer un fichier</button></div><small>Tout reste dans le stockage local de votre navigateur. Aucun serveur n’est utilisé.</small></section></div>; }
