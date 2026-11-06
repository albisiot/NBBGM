// Le Edge Functions girano su Deno e i loro index.ts non passano da tsc né dagli altri test: qui si controlla
// almeno che, tolti i tipi, siano JavaScript valido. Una variabile dichiarata due volte, per esempio, impedisce
// alla funzione di partire e si scopre solo in produzione.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { ROOT } from '../src/paths.ts';

const DIR = join(ROOT, 'supabase', 'functions');
const FUNCTIONS = readdirSync(DIR, { withFileTypes: true })
  .filter((d) => d.isDirectory() && !d.name.startsWith('_') && existsSync(join(DIR, d.name, 'index.ts')))
  .map((d) => d.name)
  .sort();

describe('Edge Functions', () => {
  it('sono quelle che il workflow pubblica', () => {
    const workflow = readFileSync(join(ROOT, '.github', 'workflows', 'supabase.yml'), 'utf8');
    expect(FUNCTIONS).toEqual(['advance-turn', 'create-league', 'draft', 'market']);
    for (const name of FUNCTIONS) expect(workflow).toContain(name);
  });

  it('si pubblicano, con l’app, solo dopo i Controlli riusciti', () => {
    const ci = readFileSync(join(ROOT, '.github', 'workflows', 'ci.yml'), 'utf8');
    expect(ci).toMatch(/^name: Controlli$/m);
    for (const file of ['supabase.yml', 'pages.yml']) {
      const workflow = readFileSync(join(ROOT, '.github', 'workflows', file), 'utf8');
      expect(workflow, file).toMatch(/workflow_run:\s+workflows: \[Controlli\]/);
      expect(workflow, file).toContain("github.event.workflow_run.conclusion == 'success'");
      expect(workflow, file).toContain('ref: ${{ github.event.workflow_run.head_sha || github.sha }}');
      expect(workflow, file).not.toMatch(/^\s+push:/m);
    }
  });

  it.each(FUNCTIONS)('%s è JavaScript valido, tolti i tipi', (name) => {
    const js = ts.transpileModule(readFileSync(join(DIR, name, 'index.ts'), 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ESNext },
    }).outputText;
    const file = join(mkdtempSync(join(tmpdir(), 'nbbgm-funzioni-')), `${name}.mjs`);
    writeFileSync(file, js);
    const check = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
    expect(check.stderr).toBe('');
    expect(check.status).toBe(0);
  });
});
