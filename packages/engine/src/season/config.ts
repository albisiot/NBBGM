// Configurazione economica di una stagione. I valori 2026-27 vengono dal comunicato NBA del 30/06/2026
// (cap, tassa, apron, minimo di squadra), dalla tabella dei minimi per anzianità (coincide con gli stipendi
// al minimo del file contratti) e dai contratti dei rookie 2026 per la scala rookie.

export interface SeasonConfig {
  /** Anno di inizio, es. 2026 per la stagione 2026-27. */
  year: number;
  salaryCap: number;
  luxuryTax: number;
  firstApron: number;
  secondApron: number;
  minimumTeamSalary: number;
  /** Minimo per anni nella lega: indice 0-10 (10 = 10 anni o più). */
  minimumSalary: number[];
  /** Stipendi dei 4 anni di contratto per le scelte 1-30 del primo giro. */
  rookieScale: number[][];
  /** Ricavi stagionali uguali per tutte le squadre. */
  revenue: number;
  /** Crescita annua di cap, soglie, minimi e scala rookie. */
  growth: number;
}

export const CONFIG_2026_27: SeasonConfig = {
  year: 2026,
  salaryCap: 164_961_000,
  luxuryTax: 200_428_000,
  firstApron: 209_015_000,
  secondApron: 221_686_000,
  minimumTeamSalary: 148_465_000,
  minimumSalary: [
    1_357_763, 2_185_116, 2_449_421, 2_537_526, 2_625_627, 2_845_883, 3_066_143, 3_286_399, 3_506_659,
    3_524_115, 3_876_529,
  ],
  rookieScale: [
    [14_748_000, 15_485_760, 16_223_040, 20_457_254],
    [13_195_320, 13_855_320, 14_515_320, 18_318_335],
    [11_849_760, 12_441_840, 13_034_880, 16_476_089],
    [10_683_720, 11_217_960, 11_752_320, 14_866_685],
    [9_674_760, 10_158_240, 10_641_960, 13_483_364],
    [8_787_000, 9_226_440, 9_666_000, 12_256_488],
    [8_021_640, 8_422_920, 8_823_600, 11_205_972],
    [7_348_680, 7_716_120, 8_083_680, 10_282_441],
    [6_754_800, 7_093_080, 7_430_640, 9_466_636],
    [6_417_360, 6_738_000, 7_058_520, 8_999_614],
    [6_096_240, 6_401_280, 6_706_200, 8_899_128],
    [5_791_680, 6_081_480, 6_371_160, 8_779_459],
    [5_502_000, 5_777_280, 6_052_200, 8_648_594],
    [5_227_200, 5_488_560, 5_750_160, 8_515_987],
    [4_965_480, 5_213_760, 5_461_920, 8_373_124],
    [4_717_320, 4_953_240, 5_189_400, 7_960_540],
    [4_481_280, 4_705_440, 4_929_360, 7_571_497],
    [4_257_480, 4_470_000, 4_683_120, 7_202_639],
    [4_065_720, 4_268_880, 4_472_640, 6_887_866],
    [3_902_760, 4_097_880, 4_292_880, 6_619_621],
    [3_746_760, 3_934_320, 4_121_760, 6_565_964],
    [3_597_120, 3_776_760, 3_956_760, 6_508_871],
    [3_453_360, 3_626_160, 3_798_360, 6_445_818],
    [3_315_360, 3_481_080, 3_646_800, 6_378_253],
    [3_182_280, 3_341_280, 3_500_880, 6_305_086],
    [3_076_920, 3_230_520, 3_384_480, 6_102_218],
    [2_988_120, 3_137_640, 3_287_400, 5_930_470],
    [2_969_520, 3_118_560, 3_266_880, 5_896_718],
    [2_948_280, 3_095_640, 3_243_120, 5_853_832],
    [2_926_800, 3_073_080, 3_219_840, 5_811_811],
  ],
  // Ricavi a metà tra il cap e la soglia della tassa (+11% sul cap): chi resta al cap guadagna, chi spende fino alla
  // tassa va in perdita, chi la supera perde molto. Con stipendi come quelli veri, a saldi stabili il monte medio è
  // circa i ricavi meno tasse e two-way: con 170 milioni (+3%) stava sotto il cap e i saldi scivolavano in rosso.
  // Calibrati con pnpm sim:seasons.
  revenue: 182_700_000,
  growth: 0.07,
};

/** Configurazione della stagione successiva: tutto cresce della stessa percentuale. */
export function nextConfig(c: SeasonConfig): SeasonConfig {
  const g = (x: number) => Math.round(x * (1 + c.growth));
  return {
    year: c.year + 1,
    salaryCap: g(c.salaryCap),
    luxuryTax: g(c.luxuryTax),
    firstApron: g(c.firstApron),
    secondApron: g(c.secondApron),
    minimumTeamSalary: g(c.minimumTeamSalary),
    minimumSalary: c.minimumSalary.map(g),
    rookieScale: c.rookieScale.map((row) => row.map(g)),
    revenue: g(c.revenue),
    growth: c.growth,
  };
}

export function seasonLabel(year: number): string {
  return `${year}-${String((year + 1) % 100).padStart(2, '0')}`;
}

export function minimumSalaryFor(c: SeasonConfig, yearsInLeague: number | null): number {
  return c.minimumSalary[Math.max(0, Math.min(10, yearsInLeague ?? 0))] as number;
}

/** Stipendio massimo: 25% (0-6 anni), 30% (7-9), 35% (10+) del cap. */
export function maxSalaryFor(c: SeasonConfig, yearsInLeague: number | null): number {
  const y = yearsInLeague ?? 0;
  return Math.round(c.salaryCap * (y >= 10 ? 0.35 : y >= 7 ? 0.3 : 0.25));
}

/** Stipendio fisso dei two-way: metà del minimo per i rookie. */
export function twoWaySalary(c: SeasonConfig): number {
  return Math.round((c.minimumSalary[0] as number) / 2);
}

/**
 * Luxury tax a scaglioni di 5 milioni sopra la soglia: 1,50 / 1,75 / 2,50 / 3,25 $ per dollaro, poi +0,50 a
 * scaglione. Chi l'ha pagata in 3 delle 4 stagioni precedenti paga le aliquote maggiorate (2,50 / 2,75 / 3,50 / 4,25).
 */
export function luxuryTax(c: SeasonConfig, payroll: number, repeater: boolean): number {
  let over = payroll - c.luxuryTax;
  if (over <= 0) return 0;
  const rates = repeater ? [2.5, 2.75, 3.5, 4.25] : [1.5, 1.75, 2.5, 3.25];
  let tax = 0;
  for (let i = 0; over > 0; i++) {
    const slice = Math.min(over, 5_000_000);
    const rate =
      i < rates.length
        ? (rates[i] as number)
        : (rates[rates.length - 1] as number) + 0.5 * (i - rates.length + 1);
    tax += slice * rate;
    over -= slice;
  }
  return Math.round(tax);
}
