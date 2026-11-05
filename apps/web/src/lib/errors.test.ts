import { describe, expect, it } from 'vitest';
import { friendlyError, normalizeInviteCode, normalizeOtp } from './errors.ts';

describe('messaggi per il manager', () => {
  it('traducono gli errori di Supabase Auth', () => {
    expect(friendlyError(new Error('email rate limit exceeded'))).toMatch(/Troppe email/);
    expect(friendlyError({ message: 'Token has expired or is invalid' })).toBe('Codice sbagliato o scaduto.');
    expect(friendlyError(new Error('Email address not authorized'))).toMatch(/indirizzi autorizzati/);
  });

  it('lasciano com’è un messaggio già in italiano', () => {
    expect(friendlyError(new Error('Codice invito non valido'))).toBe('Codice invito non valido');
  });
});

describe('codici', () => {
  it('il codice invito si scrive come si vuole', () => {
    expect(normalizeInviteCode(' ab3-k7q ')).toBe('AB3K7Q');
  });

  it('il codice dell’email tiene solo le cifre', () => {
    expect(normalizeOtp('123 456')).toBe('123456');
    expect(normalizeOtp('12-34-56-78-90')).toBe('12345678');
  });
});
