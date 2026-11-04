// Campi numerici dei giocatori (0-100) con le etichette del file Excel dei giocatori.
// Le chiavi sono quelle usate nel codice; le etichette sono quelle mostrate al manager.

export const RATING_FIELDS = [
  // Conclusioni
  { key: 'closeShot', label: 'Tiro ravvicinato', group: 'Conclusioni' },
  { key: 'layup', label: 'Layup', group: 'Conclusioni' },
  { key: 'drivingDunk', label: 'Schiacciata in penetrazione', group: 'Conclusioni' },
  { key: 'standingDunk', label: 'Schiacciata da fermo', group: 'Conclusioni' },
  { key: 'postControl', label: 'Gioco in post (abilità)', group: 'Conclusioni' },
  { key: 'hook', label: 'Gancio', group: 'Conclusioni' },
  { key: 'postFade', label: 'Fadeaway in post', group: 'Conclusioni' },
  { key: 'drawFoul', label: 'Subire falli', group: 'Conclusioni' },
  // Tiro
  { key: 'midRange', label: 'Media distanza', group: 'Tiro' },
  { key: 'threePoint', label: 'Tiro da 3 (abilità)', group: 'Tiro' },
  { key: 'pullUp', label: 'Tiro dal palleggio', group: 'Tiro' },
  { key: 'freeThrow', label: 'Tiri liberi', group: 'Tiro' },
  // Gioco
  { key: 'ballHandle', label: 'Palleggio', group: 'Gioco' },
  { key: 'speedWithBall', label: 'Velocità con palla', group: 'Gioco' },
  { key: 'passAccuracy', label: 'Precisione nei passaggi', group: 'Gioco' },
  { key: 'passVision', label: 'Visione di gioco', group: 'Gioco' },
  { key: 'hands', label: 'Mani', group: 'Gioco' },
  // Difesa
  { key: 'perimeterDefense', label: 'Difesa sul perimetro', group: 'Difesa' },
  { key: 'interiorDefense', label: 'Difesa interna', group: 'Difesa' },
  { key: 'steal', label: 'Rubate', group: 'Difesa' },
  { key: 'block', label: 'Stoppate', group: 'Difesa' },
  { key: 'helpDefense', label: "Difesa d'aiuto", group: 'Difesa' },
  { key: 'passLaneReading', label: 'Lettura delle linee di passaggio', group: 'Difesa' },
  // Rimbalzi
  { key: 'offensiveRebound', label: 'Rimbalzo offensivo', group: 'Rimbalzi' },
  { key: 'defensiveRebound', label: 'Rimbalzo difensivo', group: 'Rimbalzi' },
  // Fisico atletico
  { key: 'speed', label: 'Velocità', group: 'Fisico atletico' },
  { key: 'agility', label: 'Agilità', group: 'Fisico atletico' },
  { key: 'strength', label: 'Forza', group: 'Fisico atletico' },
  { key: 'vertical', label: 'Elevazione', group: 'Fisico atletico' },
  { key: 'stamina', label: 'Resistenza', group: 'Fisico atletico' },
  { key: 'hustle', label: 'Grinta', group: 'Fisico atletico' },
  // Mentale
  { key: 'offensiveIQ', label: 'QI offensivo', group: 'Mentale' },
  { key: 'defensiveIQ', label: 'QI difensivo', group: 'Mentale' },
  { key: 'clutch', label: 'Freddezza', group: 'Mentale' },
  { key: 'leadership', label: 'Leadership', group: 'Mentale' },
] as const;

export const TENDENCY_FIELDS = [
  { key: 'three', label: 'Tiro da 3 (tendenza)', group: 'Tendenze in attacco' },
  { key: 'midRange', label: 'Tiro dalla media', group: 'Tendenze in attacco' },
  { key: 'drive', label: 'Penetrazione', group: 'Tendenze in attacco' },
  { key: 'post', label: 'Gioco in post (tendenza)', group: 'Tendenze in attacco' },
  { key: 'isolation', label: 'Isolamento', group: 'Tendenze in attacco' },
  { key: 'pickAndRoll', label: 'Pick and roll da palleggiatore', group: 'Tendenze in attacco' },
  { key: 'cut', label: 'Taglio senza palla', group: 'Tendenze in attacco' },
  { key: 'dunkOverLayup', label: 'Schiacciata invece del layup', group: 'Tendenze in attacco' },
  { key: 'pullUpOverPass', label: 'Tiro dal palleggio invece del passaggio', group: 'Tendenze in attacco' },
  { key: 'drawFoul', label: 'Cercare il fallo', group: 'Tendenze in attacco' },
  { key: 'steal', label: 'Tentare la rubata', group: 'Tendenze in difesa' },
  { key: 'block', label: 'Tentare la stoppata', group: 'Tendenze in difesa' },
  { key: 'contest', label: 'Contestare il tiro', group: 'Tendenze in difesa' },
  { key: 'hardFoul', label: 'Fallo duro per evitare il canestro', group: 'Tendenze in difesa' },
] as const;

export const HIDDEN_FIELDS = [
  { key: 'potential', label: 'Potenziale' },
  { key: 'workEthic', label: 'Etica del lavoro' },
  { key: 'offensiveConsistency', label: 'Costanza offensiva' },
  { key: 'defensiveConsistency', label: 'Costanza difensiva' },
  { key: 'durabilityBack', label: 'Durabilità schiena' },
  { key: 'durabilityKnees', label: 'Durabilità ginocchia' },
  { key: 'durabilityAnkles', label: 'Durabilità caviglie' },
  { key: 'durabilityFeet', label: 'Durabilità piedi' },
  { key: 'durabilityShoulders', label: 'Durabilità spalle' },
  { key: 'character', label: 'Carattere' },
] as const;

export type RatingKey = (typeof RATING_FIELDS)[number]['key'];
export type TendencyKey = (typeof TENDENCY_FIELDS)[number]['key'];
export type HiddenKey = (typeof HIDDEN_FIELDS)[number]['key'];

export const RATING_KEYS: readonly RatingKey[] = RATING_FIELDS.map((f) => f.key);
export const TENDENCY_KEYS: readonly TendencyKey[] = TENDENCY_FIELDS.map((f) => f.key);
export const HIDDEN_KEYS: readonly HiddenKey[] = HIDDEN_FIELDS.map((f) => f.key);

export const BODY_PARTS = ['back', 'knees', 'ankles', 'feet', 'shoulders'] as const;
export type BodyPart = (typeof BODY_PARTS)[number];

export const DURABILITY_KEY: Record<BodyPart, HiddenKey> = {
  back: 'durabilityBack',
  knees: 'durabilityKnees',
  ankles: 'durabilityAnkles',
  feet: 'durabilityFeet',
  shoulders: 'durabilityShoulders',
};

export const BODY_PART_LABEL: Record<BodyPart, string> = {
  back: 'schiena',
  knees: 'ginocchia',
  ankles: 'caviglie',
  feet: 'piedi',
  shoulders: 'spalle',
};
