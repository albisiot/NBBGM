// Test "golden" del motore: partite, finali, impostazioni automatiche, valutazioni dei bot, turni di regular
// season e una stagione con l'offseason, con seed fissi. Le impronte (sha-256 del risultato completo: box score,
// cronaca, energie, infortuni, stato della lega) devono restare identiche bit per bit: le ottimizzazioni del motore
// non possono cambiare nemmeno un risultato, perché le partite delle leghe in corso cambierebbero subito.
//
// Se un'impronta cambia, qualcosa nel motore gioca in modo diverso. Va aggiornata solo per un cambio di regole o di
// calibrazione voluto: in quel caso si copia il valore nuovo che il test mostra nell'errore.
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { ARCHETYPE_PROFILES } from '../src/archetype-profiles.ts';
import { autoSetup, roleFit, setupFromSettings, SLOT_ROLES } from '../src/game/setup.ts';
import { simulateGame, type GameSituation } from '../src/game/simulate.ts';
import type { Tactics, TeamSetup } from '../src/game/types.ts';
import { generateLeague } from '../src/generator.ts';
import { Rng } from '../src/rng.ts';
import {
  botBotTrade,
  botProposeTrade,
  playerValue,
  strengthRanking,
  teamStrength,
  tradeBalance,
} from '../src/season/bots.ts';
import { contractOf } from '../src/season/finance.ts';
import { simulateSeason } from '../src/season/offseason.ts';
import { createLeagueState, playRegularTurn } from '../src/season/season.ts';
import type { LeagueState } from '../src/season/state.ts';
import type { LeagueData } from '../src/types.ts';
import { quickGame } from './helpers.ts';

/** JSON con le chiavi in ordine: l'impronta dipende dai valori, non dall'ordine in cui nascono le proprietà. */
function stable(value: unknown): string {
  return JSON.stringify(value, (_, v: unknown) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : 1)))
      : v,
  );
}

const hash = (value: unknown) => createHash('sha256').update(stable(value)).digest('hex').slice(0, 16);

const league = generateLeague(new Rng('golden'), ARCHETYPE_PROFILES);
// Energia e morale diversi da giocatore a giocatore: fatica, cambi e morale entrano nei conti
const players: LeagueData['players'] = league.players.map((p, i) => ({
  ...p,
  energy: 45 + ((i * 37) % 56),
  morale: 10 + ((i * 53) % 85),
}));
const teamIds = league.teams.map((t) => t.id);
const rosterOf = (id: string) => players.filter((p) => p.teamId === id);

const PACES: Tactics['pace'][] = ['slow', 'normal', 'fast'];
const FOCUSES: Tactics['focus'][] = ['perimeter', 'balanced', 'inside'];
const DEFENSES: Tactics['defense'][] = ['man', 'zone'];
const INTENSITIES: Tactics['intensity'][] = ['low', 'medium', 'high'];
const tacticsFor = (i: number): Tactics => ({
  pace: PACES[i % 3]!,
  focus: FOCUSES[Math.floor(i / 3) % 3]!,
  defense: DEFENSES[Math.floor(i / 2) % 2]!,
  intensity: INTENSITIES[Math.floor(i / 5) % 3]!,
});

/** Impostazioni della partita i: automatiche, oppure salvate con i titolari fuori ruolo (penalità di ruolo). */
function setupFor(teamId: string, i: number): TeamSetup {
  const auto = autoSetup(teamId, rosterOf(teamId), tacticsFor(i));
  if (i % 4 !== 1) return auto;
  // Quintetto rovesciato: il centro in regia, il playmaker sotto canestro
  return setupFromSettings(teamId, rosterOf(teamId), {
    starters: [...auto.starters].reverse(),
    minutes: auto.minutes,
    tactics: tacticsFor(i + 1),
  });
}

const GAMES = Array.from({ length: 36 }, (_, i) => {
  const home = teamIds[i % 30]!;
  const away = teamIds[(i * 7 + 11) % 30]!;
  return { i, home, away: away === home ? teamIds[(i + 1) % 30]! : away };
});

const SITUATIONS: GameSituation[] = [
  { period: 4, clock: 30, home: 100, away: 102, ball: 'home' },
  { period: 4, clock: 18, home: 98, away: 95, ball: 'away' },
  { period: 4, clock: 95, home: 101, away: 101, ball: 'home' },
  { period: 4, clock: 50, home: 90, away: 98, ball: 'away' },
  { period: 5, clock: 12, home: 110, away: 108, ball: 'away' },
];

// Impronte di riferimento, calcolate con il motore prima delle ottimizzazioni
const EXPECTED = {
  games: [
    '6c587289cfd28c25',
    '383f5b46724b602b',
    '3d7a66a71996fc9d',
    '021c76229f8eda59',
    '5b04ad52b89c101e',
    '3c170989dbd036a6',
    '2fa6cc060fabedc6',
    '62038efb85fd466a',
    'c8ec7698a3199924',
    'bb4baa4fad52d13a',
    'f9eaf4c52997f7ab',
    'a80b4b64fd815255',
    '6d620d49cc5202d5',
    '710174d8abbaaf2b',
    'c7ad8c7057ab1a47',
    '648531b28f5dec67',
    '96eb70e340f9aa2d',
    'eb6bf7948caafed4',
    '6839188afb9207df',
    'b5f1c6968f3549b7',
    '45f4f8155adf5b7d',
    '89b38a1d0823321e',
    '155b0c083853208b',
    '5ef3118998b164df',
    '80223c5ace5e9d2e',
    'fa300391fb4e6013',
    '25881aeff8194008',
    'c5bb8a3edf817e06',
    '376dae2d7af0623f',
    '69426c991f6bd0d5',
    '157621c43575f01d',
    '45d53fd43ff3bc29',
    '14fdaaa11a84bef6',
    '149266477276f0b1',
    '3a11e6b6e4292dc6',
    '10588266bbbd082c',
  ],
  situations: [
    '1c27552a018083db',
    '04b739ec56f4283c',
    '41d3cd4aacfdbb54',
    '33e6700a2621d6b9',
    'ac190ce0916f473b',
  ],
  setups: '1017a8c97b0b23ef',
  bots: 'ab419486cefd7b04',
  turns: 'fbffb2916d0918c7',
  season: 'c5f7de0d864a1126',
};

describe('golden: il motore gioca sempre le stesse partite', () => {
  it('partite complete', () => {
    const got = GAMES.map((g) =>
      hash(simulateGame(setupFor(g.home, g.i), setupFor(g.away, g.i + 7), `golden-${g.i}`)),
    );
    expect(got).toEqual(EXPECTED.games);
  });

  it('finali da una situazione data', () => {
    const got = SITUATIONS.map((s, i) =>
      hash(
        simulateGame(
          setupFor(teamIds[i]!, i),
          setupFor(teamIds[29 - i]!, i + 3),
          `golden-finale-${i}`,
          undefined,
          s,
        ),
      ),
    );
    expect(got).toEqual(EXPECTED.situations);
  });

  it('impostazioni automatiche e adattamento al ruolo', () => {
    const got = hash({
      setups: teamIds.map((id, i) => autoSetup(id, rosterOf(id), tacticsFor(i))),
      fits: players.slice(0, 60).map((p) => SLOT_ROLES.map((r) => roleFit(p, r))),
    });
    expect(got).toBe(EXPECTED.setups);
  });
});

describe('golden: stagione e bot', () => {
  const fresh = (): LeagueState =>
    createLeagueState({ ...league, players }, 'golden-lega', {
      potentialOnOverallScale: true,
      humanTeams: ['BOS', 'LAL'],
    });

  it('forza delle squadre, valutazioni e scambi dei bot', () => {
    const state = fresh();
    const ranking = strengthRanking(state);
    const trades = [];
    for (let k = 0; k < 6; k++) {
      const s = fresh();
      trades.push(botBotTrade(s, new Rng(`golden-scambio-${k}`), 3));
      for (const bot of ranking.filter((id) => id !== 'BOS' && id !== 'LAL').slice(k * 4, k * 4 + 4))
        trades.push(botProposeTrade(s, bot, 'BOS', new Rng(`golden-proposta-${k}-${bot}`)));
    }
    const balances = trades
      .filter((t) => t !== null)
      .map((t) => [tradeBalance(state, t, t.teamA), tradeBalance(state, t, t.teamB)]);
    const values = state.players
      .slice(0, 80)
      .map((p) =>
        ['contend', 'middle', 'rebuild'].map((s) =>
          playerValue(p, contractOf(state, p.id), s as never, state.config),
        ),
      );
    const got = hash({
      ranking,
      strength: teamIds.map((id) => teamStrength(state, id)),
      strategies: state.teams.map((t) => t.strategy),
      trades,
      balances,
      values,
    });
    expect(got).toBe(EXPECTED.bots);
  });

  it('turni di regular season con il motore vero', () => {
    const state = fresh();
    for (let t = 0; t < 4; t++) playRegularTurn(state);
    expect(hash(state)).toBe(EXPECTED.turns);
  });

  it('una stagione intera con la partita finta, play-off e offseason', () => {
    const state = fresh();
    const summary = simulateSeason(state, quickGame);
    expect(hash({ state, summary })).toBe(EXPECTED.season);
  });
});
