import { defineConfig } from 'vite';
import monkey from 'vite-plugin-monkey';

export default defineConfig({
  plugins: [
    monkey({
      entry: 'src/main.ts',
      userscript: {
        name: 'Google Docs → LaTeX 1 línea (TM)',
        namespace: 'https://tampermonkey.net/',
        version: '1.9.4',
        description: 'Motor de conversión restaurado. Respeta saltos de línea múltiples.',
        match: ['https://docs.google.com/document/*'],
        grant: 'none',
        'run-at': 'document-end',
        'inject-into': 'page',
        license: 'MIT',
      },
    }),
  ],
});