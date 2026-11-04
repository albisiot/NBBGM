// Punto d'ingresso del pacchetto engine. Gli import interni usano l'estensione .ts
// così lo stesso sorgente gira anche su Deno (Edge Functions di Supabase).
export const ENGINE_VERSION = '0.1.0';

export * from './archetype-profiles.ts';
export * from './economy.ts';
export * from './fields.ts';
export * from './game/params.ts';
export * from './game/setup.ts';
export * from './game/simulate.ts';
export * from './game/types.ts';
export * from './generator.ts';
export * from './names.ts';
export * from './overall.ts';
export * from './profiles.ts';
export * from './rng.ts';
export * from './teams.ts';
export * from './types.ts';
export * from './validate.ts';
