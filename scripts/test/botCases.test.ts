// Seconda analisi dopo la Fase 13: i casi trovati con i giocatori reali (data/league-2026-27.json, fuori dal repo:
// senza il file questi test si saltano; gli stessi comportamenti li provano, su una lega generata, i test del
// motore in packages/engine/test/botTrades.test.ts).
//   - una stella infortunata non si regala per un giocatore qualsiasi (prima 10 bot su 29 cedevano il migliore,
//     fermo per 60 partite, per Ron Harper Jr.);
//   - il valore di una scelta non cambia con un infortunio di una partita (la prima 2027 di Boston passava da 5,0
//     a 20,6 con Tatum fuori un turno);
//   - nel turno del draft la tassa della stagione finita, già pagata, non fa regalare giocatori (prima 14 bot su 14
//     sopra la tassa regalavano qualcuno: Embiid, Adebayo, Towns, Wagner, Gobert);
//   - in stagione Philadelphia, in corsa, non cede Jaylen Brown per due ventenni da 58 solo per la tassa.
import {
  botAccepts,
  contractOf,
  createLeagueState,
  draftRanking,
  overall,
  payroll,
  pickValue,
  playerValue,
  standardRoster,
  tradeBalance,
  validateTrade,
  type LeagueData,
  type LeagueState,
  type Trade,
} from '@nbbgm/engine';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { DATA_DIR } from '../src/paths.ts';

const FILE = path.join(DATA_DIR, 'league-2026-27.json');
const real = existsSync(FILE) ? (JSON.parse(readFileSync(FILE, 'utf8')) as LeagueData) : null;

function fresh(turn: number): LeagueState {
  const s = createLeagueState(real as LeagueData, 'prova-analisi', { humanTeams: ['BOS'] });
  s.turn = turn;
  return s;
}
const bots = (s: LeagueState) => s.teams.filter((t) => !t.human).map((t) => t.id);
const best = (s: LeagueState, team: string) =>
  [...standardRoster(s, team)].sort((a, b) => overall(b) - overall(a));
const player = (s: LeagueState, id: string) => {
  const p = s.players.find((x) => x.id === id);
  if (!p) throw new Error(`Manca ${id}`);
  return p;
};

describe.skipIf(!real)('casi della seconda analisi con i giocatori reali', () => {
  it('nessun bot cede il migliore, fermo per 60 partite, per Ron Harper Jr.', () => {
    for (const turn of [0, 30, 50]) {
      const s = fresh(turn);
      const harper = player(s, 'ron-harper-jr');
      const yes: string[] = [];
      for (const bot of bots(s)) {
        const star = best(s, bot)[0]!;
        star.injury = { bodyPart: 'knees', severity: 'severe', gamesRemaining: 60 };
        const t: Trade = {
          teamA: 'BOS',
          teamB: bot,
          playersA: [harper.id],
          playersB: [star.id],
          picksA: [],
          picksB: [],
        };
        if (botAccepts(s, t, bot)) yes.push(`${bot} ${star.lastName}`);
        star.injury = null;
      }
      expect(yes, `giornata ${turn + 1}`).toEqual([]);
    }
  });

  it('la prima scelta di Boston non cambia con Tatum fuori una partita', () => {
    const s = fresh(10);
    const pick = s.picks.find(
      (k) => k.originalTeamId === 'BOS' && k.round === 1 && k.draftYear === s.config.year + 1,
    )!;
    const before = pickValue(s, pick, 'middle', draftRanking(s));
    player(s, 'jayson-tatum').injury = { bodyPart: 'ankles', severity: 'light', gamesRemaining: 1 };
    expect(pickValue(s, pick, 'middle', draftRanking(s))).toBeCloseTo(before);
  });

  it('nel turno del draft i bot sopra la tassa non regalano giocatori che valgono', () => {
    const s = fresh(0);
    // Turno del draft: la stagione è finita, i contratti non sono ancora scalati
    s.phase = 'offseason';
    s.offseason = { draftYear: s.config.year + 1, lottery: [], slots: [] };
    s.picks = s.picks.filter((k) => k.draftYear !== s.config.year + 1);
    const over = bots(s).filter((b) => payroll(s, b) > s.config.luxuryTax);
    expect(over.length).toBeGreaterThan(10);
    const gifts: string[] = [];
    for (const bot of over)
      for (const p of best(s, bot).slice(0, 10)) {
        const t: Trade = { teamA: bot, teamB: 'BOS', playersA: [p.id], playersB: [], picksA: [], picksB: [] };
        if (validateTrade(s, t).length || !botAccepts(s, t, bot)) continue;
        // Restano solo i contratti che per il bot non valgono quasi nulla (stipendio vicino o sopra il valore di
        // mercato): per quelli conta il risparmio vero, sulla tassa della stagione che arriva (Watson a Cleveland)
        if (tradeBalance(s, t, bot).give >= 2) gifts.push(`${bot} ${p.lastName}`);
      }
    expect(gifts).toEqual([]);
  });

  it('Philadelphia, in corsa, non cede Jaylen Brown per due ventenni da 58', () => {
    const s = fresh(20);
    expect(s.teams.find((t) => t.id === 'PHI')!.strategy).toBe('contend');
    const brown = player(s, 'jaylen-brown');
    const kids = ['gonzalez', 'cenac'].map((n) =>
      best(s, 'BOS').find((p) => p.lastName.toLowerCase().startsWith(n) && p.age <= 21)!,
    );
    for (const k of kids) expect(Math.round(overall(k))).toBe(58);
    const t: Trade = {
      teamA: 'PHI',
      teamB: 'BOS',
      playersA: [brown.id],
      playersB: kids.map((k) => k.id),
      picksA: [],
      picksB: [],
    };
    expect(validateTrade(s, t)).toEqual([]);
    expect(botAccepts(s, t, 'PHI')).toBe(false);
    // Per Brown la squadra in corsa chiede più di quanto valgono i due ragazzi più il risparmio
    const { get, give } = tradeBalance(s, t, 'PHI');
    expect(give).toBeCloseTo(playerValue(brown, contractOf(s, brown.id), 'contend', s.config, s));
    expect(get).toBeLessThan(give);
  });
});
