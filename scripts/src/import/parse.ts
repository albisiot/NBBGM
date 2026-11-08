import {
  HIDDEN_FIELDS,
  RATING_FIELDS,
  ROLES,
  TENDENCY_FIELDS,
  teamByFullName,
  TEAMS,
  draftProblem,
  type Contract,
  type ContractOption,
  type ContractType,
  type DeadMoney,
  type DraftInfo,
  type Hidden,
  type LeagueData,
  type Player,
  type Ratings,
  type Role,
  type Tendencies,
} from '@nbbgm/engine';

export type Cell = string | number | null;
export type Row = Cell[];

/** Riga della tabella giocatori (foglio GIOCATORI): campi per nome di colonna. */
export interface ParseInput {
  playerHeader: string[];
  playerRows: Row[];
  /** Numero di riga Excel della prima riga dati, per i messaggi. */
  firstPlayerRow: number;
  contractHeader: string[];
  contractRows: Row[];
  deadHeader: string[];
  deadRows: Row[];
  /** Foglio DRAFT del file del draft; senza, il draft di tutti resta non noto. */
  draftHeader?: string[];
  draftRows?: Row[];
  season: string;
}

export interface ParseResult {
  league: LeagueData;
  errors: string[];
  /** Avvisi che non fermano l'import (righe del draft che mancano o non servono). */
  warnings: string[];
  /** Prezzo Dunkest per id, solo per il report di qualità. */
  dunkestPrice: Map<string, number>;
}

/** Giocatori senza squadra NBA: "Svincolato" fino al file v2, "Free Agent" e "Fuori NBA" dal v4. */
const FREE_AGENTS = new Set(['Svincolato', 'Free Agent', 'Fuori NBA']);
/** Nel foglio CONTRATTI gli svincolati stanno sotto "Svincolato". */
const FREE_AGENT_CONTRACTS = 'Svincolato';
/** Apertura alare: stimata fino al v2, misurata (NBA 2K27) dal v4. */
const WINGSPAN = ['Apertura alare (cm)', 'Apertura alare (cm, stima)'];
const SEASONS = ['2026-27', '2027-28', '2028-29', '2029-30', '2030-31', '2031-32'];
const CONTRACT_TYPES: Record<string, ContractType | 'free-agent'> = {
  standard: 'standard',
  'rookie (stimato)': 'rookie',
  'two-way': 'two-way',
  '10 giorni': 'ten-day',
  'minimo (non garantito)': 'minimum',
  'da verificare': 'unknown',
  svincolato: 'free-agent',
};
const IDENTITY = [
  'Squadra NBA',
  'Nome',
  'Cognome',
  'Nazionalità',
  'Ruolo principale',
  'Ruolo secondario',
  'Mano dominante',
  'Archetipo',
  'Età',
  'Altezza (cm)',
  'Peso (kg)',
];

export function slug(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function columns(header: string[], required: string[], sheet: string, errors: string[]): Map<string, number> {
  const index = new Map(header.map((h, i) => [String(h ?? '').trim(), i]));
  for (const name of required) {
    if (!index.has(name)) errors.push(`Foglio ${sheet}: colonna "${name}" mancante`);
  }
  return index;
}

const text = (v: Cell) => (v === null || v === undefined ? '' : String(v).trim());

/** "non scelto" nella colonna Giro del foglio DRAFT. */
const UNDRAFTED = 'non scelto';

/**
 * Foglio DRAFT: per nome e cognome (come gli id dei giocatori, senza accenti) anno, giro e scelta assoluta, oppure
 * "non scelto" nella colonna Giro. Una riga senza Giro lascia il draft non noto.
 */
function readDrafts(
  header: string[],
  rows: Row[],
  errors: string[],
): Map<string, { draft: DraftInfo | null; where: string }> {
  const dc = columns(header, ['Nome', 'Cognome', 'Anno draft', 'Giro', 'Scelta'], 'DRAFT', errors);
  const out = new Map<string, { draft: DraftInfo | null; where: string }>();
  if (errors.length) return out;
  const seen = new Set<string>();
  const get = (row: Row, name: string): Cell => row[dc.get(name) as number] ?? null;
  const whole = (v: Cell): number | null | undefined => {
    if (v === null || v === '') return null;
    const n = typeof v === 'number' ? v : Number(String(v).trim());
    return Number.isInteger(n) ? n : undefined;
  };
  rows.forEach((row, k) => {
    const first = text(get(row, 'Nome'));
    const last = text(get(row, 'Cognome'));
    if (!first && !last) return;
    const where = `DRAFT riga ${k + 2} (${first} ${last})`;
    const key = slug(`${first} ${last}`);
    if (seen.has(key)) {
      errors.push(`${where}: giocatore già presente in un'altra riga`);
      return;
    }
    seen.add(key);
    const year = whole(get(row, 'Anno draft'));
    const pick = whole(get(row, 'Scelta'));
    const roundText = text(get(row, 'Giro')).toLowerCase();
    if (year === undefined || pick === undefined) {
      errors.push(`${where}: anno e scelta devono essere numeri interi`);
      return;
    }
    let draft: DraftInfo | null;
    if (roundText === '') {
      if (year !== null || pick !== null) {
        errors.push(`${where}: manca il giro (1, 2 o "${UNDRAFTED}")`);
        return;
      }
      draft = null;
    } else if (roundText === UNDRAFTED) {
      if (pick !== null) {
        errors.push(`${where}: "${UNDRAFTED}" con una scelta`);
        return;
      }
      draft = { year, round: null, pick: null };
    } else if (roundText === '1' || roundText === '2') {
      if (year === null || pick === null) {
        errors.push(`${where}: giro ${roundText} senza anno o scelta`);
        return;
      }
      draft = { year, round: roundText === '1' ? 1 : 2, pick };
    } else {
      errors.push(`${where}: giro "${text(get(row, 'Giro'))}" non valido (1, 2 o "${UNDRAFTED}")`);
      return;
    }
    const problem = draft ? draftProblem(draft) : null;
    if (problem) {
      errors.push(`${where}: ${problem}`);
      return;
    }
    out.set(key, { draft, where });
  });
  return out;
}

export function parseLeague(input: ParseInput): ParseResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const numericLabels = [...RATING_FIELDS, ...TENDENCY_FIELDS, ...HIDDEN_FIELDS].map((f) => f.label);
  const pc = columns(input.playerHeader, [...IDENTITY, ...numericLabels], 'GIOCATORI', errors);
  const wingspanLabel = WINGSPAN.find((w) => pc.has(w));
  if (!wingspanLabel) errors.push(`Foglio GIOCATORI: colonna "${WINGSPAN[0]}" mancante`);
  const cc = columns(
    input.contractHeader,
    ['Squadra NBA', 'Nome', 'Cognome', 'Tipo contratto', 'Anni nella lega', 'Opzioni', 'Garantito residuo'],
    'CONTRATTI',
    errors,
  );
  const dc = columns(input.deadHeader, ['Squadra che paga', 'Nome', 'Cognome'], 'TAGLIATI', errors);
  const empty: LeagueData = {
    season: input.season,
    teams: [...TEAMS],
    players: [],
    contracts: [],
    deadMoney: [],
  };
  const drafts = input.draftHeader ? readDrafts(input.draftHeader, input.draftRows ?? [], errors) : null;
  if (errors.length || !wingspanLabel) return { league: empty, errors, warnings, dunkestPrice: new Map() };
  const usedDrafts = new Set<string>();

  const get = (row: Row, map: Map<string, number>, name: string): Cell =>
    row[map.get(name) as number] ?? null;

  // Contratti per squadra + nome + cognome
  const contractRows = new Map<string, Row>();
  for (const row of input.contractRows) {
    const key = [get(row, cc, 'Squadra NBA'), get(row, cc, 'Nome'), get(row, cc, 'Cognome')]
      .map(text)
      .join('|');
    if (key !== '||') contractRows.set(key, row);
  }

  const players: LeagueData['players'] = [];
  const contracts: Contract[] = [];
  const dunkestPrice = new Map<string, number>();
  const usedIds = new Set<string>();

  input.playerRows.forEach((row, k) => {
    const rowNo = input.firstPlayerRow + k;
    const teamName = text(get(row, pc, 'Squadra NBA'));
    if (!teamName) return;
    const first = text(get(row, pc, 'Nome'));
    const last = text(get(row, pc, 'Cognome'));
    const where = `GIOCATORI riga ${rowNo} (${first} ${last})`;
    const rowErrors: string[] = [];

    const team = FREE_AGENTS.has(teamName) ? null : teamByFullName(teamName);
    if (team === undefined) rowErrors.push(`${where}: squadra "${teamName}" sconosciuta`);
    const role = text(get(row, pc, 'Ruolo principale')) as Role;
    if (!ROLES.includes(role))
      rowErrors.push(`${where}: ruolo principale "${role}" non valido (PG, SG, SF, PF, C)`);
    const secondaryText = text(get(row, pc, 'Ruolo secondario'));
    // Il v4 ripete il ruolo principale come secondario quando 2K ne dà uno solo: vale come nessun secondario
    const secondary = secondaryText && secondaryText !== role ? (secondaryText as Role) : null;
    if (secondary !== null && !ROLES.includes(secondary)) {
      rowErrors.push(`${where}: ruolo secondario "${secondaryText}" non valido`);
    }

    const num = (label: string, min: number, max: number): number => {
      const v = get(row, pc, label);
      const n = typeof v === 'number' ? v : Number(String(v ?? '').replace(',', '.'));
      if (v === null || v === '' || !Number.isFinite(n)) {
        rowErrors.push(`${where}: "${label}" mancante o non numerico`);
        return 0;
      }
      if (n < min || n > max) rowErrors.push(`${where}: "${label}" = ${n}, fuori da ${min}-${max}`);
      return n;
    };
    const fill = <K extends string>(fields: readonly { key: K; label: string }[]) =>
      Object.fromEntries(fields.map((f) => [f.key, num(f.label, 0, 100)])) as Record<K, number>;

    const ratings = fill(RATING_FIELDS) as Ratings;
    const tendencies = fill(TENDENCY_FIELDS) as Tendencies;
    const hidden = fill(HIDDEN_FIELDS) as Hidden;
    const age = num('Età', 17, 45);
    const heightCm = num('Altezza (cm)', 150, 245);
    const wingspanCm = num(wingspanLabel, 150, 260);
    const weightKg = num('Peso (kg)', 55, 170);

    if (rowErrors.length) {
      errors.push(...rowErrors);
      return;
    }

    let id = slug(`${first} ${last}`);
    for (let n = 2; usedIds.has(id); n++) id = `${slug(`${first} ${last}`)}-${n}`;
    usedIds.add(id);

    const crow = contractRows.get([team ? teamName : FREE_AGENT_CONTRACTS, first, last].join('|'));
    const yearsRaw = crow ? get(crow, cc, 'Anni nella lega') : null;
    // Senza riga nei contratti (svincolati e giocatori fuori dalla NBA aggiunti dal v4) gli anni nella lega si
    // stimano dall'età, come nel generatore: decidono minimo e massimo dello stipendio
    const yearsInLeague = typeof yearsRaw === 'number' ? yearsRaw : crow ? null : Math.max(0, age - 20);
    const nameKey = slug(`${first} ${last}`);
    const draftRow = drafts?.get(nameKey);
    if (drafts && !draftRow) warnings.push(`${where}: nessuna riga nel foglio DRAFT, draft non noto`);
    else if (draftRow && draftRow.draft === null) warnings.push(`${draftRow.where}: draft non noto`);
    if (draftRow) usedDrafts.add(nameKey);
    const player: Player & { teamId: string | null } = {
      id,
      firstName: first,
      lastName: last,
      nationality: text(get(row, pc, 'Nazionalità')) || 'Stati Uniti',
      role,
      secondaryRole: secondary,
      hand: text(get(row, pc, 'Mano dominante')).startsWith('Sinistra') ? 'L' : 'R',
      archetype: text(get(row, pc, 'Archetipo')),
      age,
      heightCm,
      wingspanCm,
      weightKg,
      yearsInLeague,
      draft: draftRow?.draft ?? null,
      ratings,
      tendencies,
      hidden,
      energy: 100,
      morale: 60,
      injury: null,
      teamId: team ? team.id : null,
    };
    players.push(player);
    const price = get(row, pc, 'Prezzo Dunkest (sett. 2026)');
    if (typeof price === 'number') dunkestPrice.set(id, price);

    if (!crow) {
      if (team) errors.push(`${where}: nessuna riga nel foglio CONTRATTI`);
      return;
    }
    const kindText = text(get(crow, cc, 'Tipo contratto'));
    const kind = CONTRACT_TYPES[kindText];
    if (!kind) {
      errors.push(`CONTRATTI (${first} ${last}): tipo "${kindText}" sconosciuto`);
      return;
    }
    if (kind === 'free-agent' || !team) return;
    const salaries: number[] = [];
    for (const s of SEASONS) {
      const v = get(crow, cc, `Stipendio ${s}`);
      if (typeof v !== 'number') break;
      salaries.push(v);
    }
    const optionsText = text(get(crow, cc, 'Opzioni'));
    const options: ContractOption[] = salaries.map((_, i) => {
      const m = optionsText.match(new RegExp(`${SEASONS[i]} (giocatore|squadra)`));
      return m ? (m[1] === 'giocatore' ? 'player' : 'team') : null;
    });
    const guaranteed = get(crow, cc, 'Garantito residuo');
    contracts.push({
      playerId: id,
      teamId: team.id,
      type: kind,
      salaries,
      options,
      guaranteed: typeof guaranteed === 'number' ? guaranteed : null,
    });
  });

  const deadMoney: DeadMoney[] = [];
  for (const row of input.deadRows) {
    const payer = text(get(row, dc, 'Squadra che paga'));
    if (!payer || !text(get(row, dc, 'Nome'))) continue; // righe vuote o di nota
    const team = teamByFullName(payer);
    if (!team) {
      errors.push(`TAGLIATI: squadra "${payer}" sconosciuta`);
      continue;
    }
    const salaries: number[] = [];
    for (const s of SEASONS) {
      const v = get(row, dc, `Residuo ${s}`);
      if (typeof v !== 'number') break;
      salaries.push(v);
    }
    deadMoney.push({
      teamId: team.id,
      playerName: `${text(get(row, dc, 'Nome'))} ${text(get(row, dc, 'Cognome'))}`,
      salaries,
    });
  }

  for (const [key, row] of drafts ?? []) {
    if (!usedDrafts.has(key))
      warnings.push(`${row.where}: nessun giocatore con questo nome nel foglio GIOCATORI`);
  }

  return {
    league: { season: input.season, teams: [...TEAMS], players, contracts, deadMoney },
    errors,
    warnings,
    dunkestPrice,
  };
}
