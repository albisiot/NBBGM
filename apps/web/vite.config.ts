import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// base relativo: il sito viene pubblicato su GitHub Pages in una sottocartella.
export default defineConfig({
  base: './',
  plugins: [react(), tailwindcss()],
});
