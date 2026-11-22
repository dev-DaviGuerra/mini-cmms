// Copia os arquivos de terceiros instalados pelo npm para pastas servidas pelo site.
// Não é um "build": o front continua sendo HTML/CSS/JS puro. Os arquivos copiados são
// versionados no git, então o deploy não precisa rodar npm no front.
//
// Uso (dentro de frontend/):  npm install && npm run vendor
import { copyFileSync, mkdirSync, statSync } from 'node:fs';

const NM = new URL('../node_modules/', import.meta.url);
const FONTES = new URL('../fontes/', import.meta.url);
const VENDOR = new URL('../vendor/', import.meta.url);

const ARQUIVOS = [
  // IBM Plex (licença SIL Open Font License 1.1), subconjunto "latin": cobre o português
  ['@fontsource/ibm-plex-sans/files/ibm-plex-sans-latin-400-normal.woff2', FONTES, 'ibm-plex-sans-400.woff2'],
  ['@fontsource/ibm-plex-sans/files/ibm-plex-sans-latin-500-normal.woff2', FONTES, 'ibm-plex-sans-500.woff2'],
  ['@fontsource/ibm-plex-sans/files/ibm-plex-sans-latin-600-normal.woff2', FONTES, 'ibm-plex-sans-600.woff2'],
  ['@fontsource/ibm-plex-sans/files/ibm-plex-sans-latin-700-normal.woff2', FONTES, 'ibm-plex-sans-700.woff2'],
  ['@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-400-normal.woff2', FONTES, 'ibm-plex-mono-400.woff2'],
  ['@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-500-normal.woff2', FONTES, 'ibm-plex-mono-500.woff2'],
  ['@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-600-normal.woff2', FONTES, 'ibm-plex-mono-600.woff2'],
  ['@fontsource/ibm-plex-sans/LICENSE', FONTES, 'LICENSE-IBM-Plex-OFL.txt'],
  // Chart.js (licença MIT): build UMD, carregado com <script src> (define window.Chart).
  // O build ESM importa "@kurkle/color" por nome de pacote, o que exigiria um import map
  // inline — bloqueado pela nossa CSP sem 'unsafe-inline'.
  ['chart.js/dist/chart.umd.min.js', VENDOR, 'chart.umd.min.js'],
  ['chart.js/LICENSE.md', VENDOR, 'LICENSE-chartjs.md'],
];

for (const pasta of [FONTES, VENDOR]) mkdirSync(pasta, { recursive: true });
for (const [origem, pasta, destino] of ARQUIVOS) {
  const de = new URL(origem, NM);
  const para = new URL(destino, pasta);
  copyFileSync(de, para);
  console.log(`${destino}  (${(statSync(para).size / 1024).toFixed(1)} KB)`);
}
