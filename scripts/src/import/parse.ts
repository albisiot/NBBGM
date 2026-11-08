import {
  HIDDEN_FIELDS,
  RATING_FIELDS,
  ROLES,
  TENDENCY_FIELDS,
  teamByFullName,
  TEAMS,
  type Contract,
  type ContractOption,
  type ContractType,
  type DeadMoney,
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
  season: string;
}

export interface ParseResult {
  league: LeagueData;
  errors: string[];
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

export function parseLeague(input: ParseInput): ParseResult {
  const errors: string[] = [];
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
  if (errors.length || !wingspanLabel) return { league: empty, errors, dunkestPrice: new Map() };

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

  return {
    league: { season: input.season, teams: [...TEAMS], players, contracts, deadMoney },
    errors,
    dunkestPrice,
  };
}
