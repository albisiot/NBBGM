import {
  HIDDEN_FIELDS,
  RATING_FIELDS,
  ROLES,
  SEASON_2026_27,
  TENDENCY_FIELDS,
  overall,
  overallRaw,
  type Issue,
  type LeagueData,
  type Player,
  type Role,
} from '@nbbgm/engine';

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / (xs.length || 1);
const sd = (xs: number[]) => {
  const m = mean(xs);
  return Math.sqrt(mean(xs.map((x) => (x - m) ** 2)));
};
function corr(xs: number[], ys: number[]): number {
  const mx = mean(xs);
  const my = mean(ys);
  const d = sd(xs) * sd(ys);
  return d === 0 ? 0 : mean(xs.map((x, i) => (x - mx) * ((ys[i] as number) - my))) / d;
}
const f1 = (x: number) => x.toFixed(1).replace('.', ',');
const f2 = (x: number) => x.toFixed(2).replace('.', ',');
const money = (x: number) => `${(x / 1e6).toFixed(1).replace('.', ',')} mln`;

/** Report di qualità del file dati, in Markdown. */
export function qualityReport(league: LeagueData, issues: Issue[], dunkest: Map<string, number>): string {
  const players = league.players;
  const out: string[] = [];
  const byRole = new Map<Role, Player[]>(ROLES.map((r) => [r, players.filter((p) => p.role === r)]));
  const free = players.filter((p) => p.teamId === null).length;
  const types = new Map<string, number>();
  for (const c of league.contracts) types.set(c.type, (types.get(c.type) ?? 0) + 1);

  out.push(`# Report di import — stagione ${league.season}`, '');
  out.push(`- Giocatori: ${players.length} (${players.length - free} in squadra, ${free} svincolati)`);
  out.push(`- Contratti: ${[...types].map(([t, n]) => `${n} ${t}`).join(', ')}`);
  out.push(`- Residui di tagliati: ${league.deadMoney.length}`);
  out.push(
    `- Avvisi: ${issues.filter((i) => i.level === 'warning').length}, errori: ${issues.filter((i) => i.level === 'error').length}`,
    '',
  );
  if (issues.length) {
    out.push('## Avvisi ed errori', '');
    for (const i of issues) out.push(`- ${i.level === 'error' ? '**Errore**' : 'Avviso'}: ${i.message}`);
    out.push('');
  }

  out.push('## Overall', '');
  out.push(
    'Media e dispersione dell’overall grezzo per ruolo (da copiare in `OVERALL_SCALE` se cambiano):',
    '',
  );
  out.push('| Ruolo | Giocatori | Media | Dispersione |', '| --- | --- | --- | --- |');
  for (const [role, list] of byRole) {
    const raws = list.map((p) => overallRaw(p.ratings, p.role));
    out.push(`| ${role} | ${list.length} | ${f1(mean(raws))} | ${f1(sd(raws))} |`);
  }
  const ovr = players.map((p) => ({ p, o: overall(p) })).sort((a, b) => b.o - a.o);
  const count = (lo: number, hi: number) => ovr.filter(({ o }) => o >= lo && o <= hi).length;
  out.push(
    '',
    `Distribuzione: ${count(80, 99)} stelle (80+), ${count(65, 79)} titolari (65-79), ${count(0, 64)} riserve.`,
    '',
  );
  out.push('| # | Giocatore | Squadra | Ruolo | Overall |', '| --- | --- | --- | --- | --- |');
  ovr
    .slice(0, 20)
    .forEach(({ p, o }, i) =>
      out.push(`| ${i + 1} | ${p.firstName} ${p.lastName} | ${p.teamId ?? '—'} | ${p.role} | ${o} |`),
    );
  out.push('');

  out.push('## Campi', '');
  out.push(
    'Dispersione nel ruolo = media delle deviazioni standard calcolate dentro ogni ruolo. Valore più frequente = quota di giocatori con lo stesso valore (segnala i valori neutri).',
    '',
  );
  out.push(
    '| Campo | Min | Max | Media | Dispersione | Dispersione nel ruolo | Valore più frequente |',
    '| --- | --- | --- | --- | --- | --- | --- |',
  );
  const groups = [
    [RATING_FIELDS, (p: Player, k: string) => p.ratings[k as keyof Player['ratings']]],
    [TENDENCY_FIELDS, (p: Player, k: string) => p.tendencies[k as keyof Player['tendencies']]],
    [HIDDEN_FIELDS, (p: Player, k: string) => p.hidden[k as keyof Player['hidden']]],
  ] as const;
  for (const [fields, pick] of groups) {
    for (const f of fields) {
      const xs = players.map((p) => pick(p, f.key));
      const within = mean(ROLES.map((r) => sd((byRole.get(r) as Player[]).map((p) => pick(p, f.key)))));
      const freq = new Map<number, number>();
      for (const x of xs) freq.set(x, (freq.get(x) ?? 0) + 1);
      const [top, n] = [...freq].sort((a, b) => b[1] - a[1])[0] as [number, number];
      out.push(
        `| ${f.label} | ${Math.min(...xs)} | ${Math.max(...xs)} | ${f1(mean(xs))} | ${f1(sd(xs))} | ${f1(within)} | ${top} (${Math.round((n / xs.length) * 100)}%) |`,
      );
    }
  }
  out.push('');

  out.push('## Tendenze e abilità', '');
  const withinCorr = (a: (p: Player) => number, b: (p: Player) => number) =>
    mean(ROLES.map((r) => corr((byRole.get(r) as Player[]).map(a), (byRole.get(r) as Player[]).map(b))));
  out.push(
    `- Tiro da 3, abilità/tendenza dentro il ruolo: ${f2(
      withinCorr(
        (p) => p.ratings.threePoint,
        (p) => p.tendencies.three,
      ),
    )}`,
  );
  out.push(
    `- Gioco in post, abilità/tendenza dentro il ruolo: ${f2(
      withinCorr(
        (p) => p.ratings.postControl,
        (p) => p.tendencies.post,
      ),
    )}`,
  );
  const priced = players.filter((p) => dunkest.has(p.id));
  const price = priced.map((p) => dunkest.get(p.id) as number);
  out.push(
    `- Overall / prezzo Dunkest (${priced.length} giocatori): ${f2(
      corr(
        priced.map((p) => overall(p)),
        price,
      ),
    )}`,
    '',
  );

  out.push('## Monte stipendi', '');
  out.push(
    `Cap ${money(SEASON_2026_27.salaryCap)}, tassa ${money(SEASON_2026_27.luxuryTax)}, minimo di squadra ${money(SEASON_2026_27.minimumTeamSalary)}. Residui dei tagliati compresi.`,
    '',
  );
  out.push(
    '| Squadra | Standard | Two-way | Monte stipendi | Rispetto alla tassa |',
    '| --- | --- | --- | --- | --- |',
  );
  for (const t of league.teams) {
    const cs = league.contracts.filter((c) => c.teamId === t.id);
    const tw = cs.filter((c) => c.type === 'two-way').length;
    const payroll =
      cs.filter((c) => c.type !== 'two-way').reduce((a, c) => a + (c.salaries[0] ?? 0), 0) +
      league.deadMoney.filter((d) => d.teamId === t.id).reduce((a, d) => a + (d.salaries[0] ?? 0), 0);
    const delta = payroll - SEASON_2026_27.luxuryTax;
    out.push(
      `| ${t.fullName} | ${cs.length - tw} | ${tw} | ${money(payroll)} | ${delta > 0 ? `+${money(delta)}` : money(delta)} |`,
    );
  }
  out.push('');
  return out.join('\n');
}
