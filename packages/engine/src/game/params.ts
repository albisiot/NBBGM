// Parametri del motore partita. I valori vengono dalla calibrazione (pnpm sim:calibrate).

export const DEFAULT_PARAMS = {
  // Durata media di un possesso in secondi per ritmo, e dispersione
  possessionSeconds: { slow: 16.9, normal: 15.1, fast: 13.5 },
  possessionSd: 4.2,
  offensiveReboundSeconds: 7.5,
  transitionSeconds: 6.5,
  transitionAfterSteal: 0.55,
  transitionAfterRebound: 0.13,
  transitionBonus: 0.05,

  // Palle perse e falli lontani dal tiro
  turnoverBase: 0.16,
  turnoverSkillK: 1.6,
  liveBallTurnoverShare: 0.56,
  offensiveFoulShare: 0.1,
  nonShootingFoulBase: 0.095,

  // Chi tira: esponente sulla qualità offensiva (più alto = più tiri alle stelle)
  usageExponent: 3.8,
  // Peso in più per il tiro da 3 nella scelta della giocata
  threeWeight: 1.5,

  // Probabilità base di canestro per tipo di conclusione
  base: {
    dunk: 0.86,
    layup: 0.585,
    close: 0.575,
    floater: 0.48,
    hook: 0.52,
    fade: 0.48,
    midCatch: 0.4,
    midPull: 0.375,
    threeCatch: 0.337,
    threePull: 0.305,
  },
  skillK: 0.24,
  homeAdvantage: 0.021,
  // Rimonta: chi è avanti si rilassa un po' e chi è sotto spinge. Per ogni punto di vantaggio (fino al tetto)
  // la probabilità di canestro di chi è avanti scende di tanto, e quella di chi è sotto sale di tanto
  comebackPerPoint: 0.0022,
  comebackCap: 20,
  // Negli ultimi 5 minuti di una partita aperta (scarto da 1 a 8) chi è sotto spinge e chi è avanti si protegge:
  // la probabilità di canestro si sposta di tanto, in più
  comebackClose: 0.025,
  clutchMax: 0.03,
  // Forma del giorno: dispersione base più una parte che cresce con la scarsa costanza
  formBase: 0.028,
  formRange: 0.06,
  openShotDefense: 0.55,
  // Quanto pesa il miglior protettore del ferro sui tiri vicino a canestro (difesa a uomo)
  rimProtectionShare: 0.5,

  // Aiuti, scarichi, stoppate
  helpChance: 0.33,
  kickOutChance: 0.32,
  blockBase: 0.075,

  // Falli sul tiro per zona
  shootingFoul: { rim: 0.17, short: 0.1, mid: 0.045, three: 0.018 },
  andOneMakeFactor: 0.42,

  // Rimbalzi: base della quota offensiva, sensibilità alla differenza, medie dei valori nel file
  offensiveReboundBase: 0.25,
  reboundExponent: 1.3,
  reboundMeans: { offensive: 40, defensive: 60 },
  putbackChance: 0.32,
  // Concentrazione dei rimbalzi sui migliori rimbalzisti e degli assist sui migliori passatori
  reboundPickExponent: 0.9,
  passerExponent: 6,
  // Quota di rimbalzi non assegnati a un giocatore (palla fuori, rimbalzi di squadra)
  teamReboundShare: 0.1,
  // Peso del tiro dalla media e quota di floater sulle penetrazioni
  midWeight: 0.45,
  floaterShare: 0.7,
  // Peso del gioco in post nella scelta della giocata
  postWeight: 1.5,

  // Assist per tipo di giocata
  assist: {
    three: 0.9,
    mid: 0.8,
    drive: 0.6,
    post: 0.6,
    iso: 0.15,
    pnr: 0.55,
    cut: 0.95,
    kick: 0.97,
    roll: 0.95,
    pull: 0.28,
    transition: 0.72,
  },

  // Energia (punti per minuto) e cambi
  energyDrain: 1.25,
  benchRecovery: 2.2,
  fatigueThreshold: 70,
  fatigueMaxPenalty: 0.15,
  subEnergy: 50,
  subMinutesSlack: 150,
  subCheckSeconds: 40,

  // Infortuni: probabilità per minuto in campo a durabilità 80, energia piena, età fino a 30
  injuryPerMinute: 0.00042,
  injurySeverity: { light: 0.7, medium: 0.22, severe: 0.08 },

  // Falli personali: limite e soglie per sedersi in panchina per periodo (1-4, supplementari)
  foulOut: 6,
  foulTrouble: [2, 3, 4, 5, 6],

  // Finale di partita (quarto periodo e supplementari)
  endgame: {
    // Da quanti secondi alla fine valgono le scelte del finale
    lateSeconds: 120,
    // Falli sistematici di chi è sotto e non ha la palla: fino a 9 punti, quando restano meno di questi
    // secondi per ogni possesso che serve per recuperare (1-3 punti: 24 secondi, 4-6: 48, 7-9: 72)
    foulMaxLead: 9,
    foulSecondsPerPossession: 24,
    // In parità o sotto di un possesso, con meno di questi secondi si gioca per l'ultimo tiro
    lastShotSeconds: 24,
    // Probabilità di canestro persa: possesso che parte con 3-5 secondi alla fine del periodo, con 1-2 secondi
    // (quasi una preghiera), ultimo tiro preparato con la difesa che lo aspetta
    hurryPenalty: 0.08,
    heavePenalty: 0.25,
    lastShotPenalty: 0.03,
  },
};

export type EngineParams = typeof DEFAULT_PARAMS;

/** Parametri con alcune voci cambiate (per la calibrazione); gli oggetti annidati si fondono. */
export function withParams(overrides: {
  [K in keyof EngineParams]?: Partial<EngineParams[K]> | EngineParams[K];
}): EngineParams {
  const out = JSON.parse(JSON.stringify(DEFAULT_PARAMS)) as Record<string, unknown>;
  for (const [k, v] of Object.entries(overrides)) {
    const cur = out[k];
    out[k] =
      cur && typeof cur === 'object' && !Array.isArray(cur) && typeof v === 'object' ? { ...cur, ...v } : v;
  }
  return out as EngineParams;
}
