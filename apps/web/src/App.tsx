import { ENGINE_VERSION } from '@nbbgm/engine';

// Segnaposto della Fase 1: l'interfaccia vera arriva dalla Fase 6.
export function App() {
  return (
    <main className="min-h-screen bg-slate-50 px-4 py-10 text-slate-900">
      <h1 className="text-2xl font-bold">NBBGM</h1>
      <p className="mt-2 text-slate-600">Manageriale di basket a turni. Motore {ENGINE_VERSION}.</p>
    </main>
  );
}
