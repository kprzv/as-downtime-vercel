import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const PRIMARY = 'https://6a6116c13f60e00f80ab923a--as-downtime.netlify.app';
const FALLBACK = 'https://as-downtime.netlify.app';
const SOURCES = [...new Set([
  process.env.ASD_ASSET_SOURCE_URL,
  PRIMARY,
  FALLBACK
].filter(Boolean).map(value => value.replace(/\/$/, '')))];

// sw.js is stored directly in the repository and is intentionally absent here.
const ASSETS = [
  'config.js',
  'icons/icon-180.png',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'index.html',
  'main.js',
  'manifest.webmanifest',
  'modules/insights.js',
  'modules/recommendation-engine.js',
  'modules/runtime-manager.js',
  'styles.css',
  'vendor/SUPABASE-LICENSE.txt',
  'vendor/TESSERACT-LICENSE.txt',
  'vendor/supabase-2.110.7.js',
  'vendor/tesseract-5.1.1.min.js',
  'vendor/tesseract-worker-5.1.1.min.js'
];

const sleep = ms => new Promise(resolvePromise => setTimeout(resolvePromise, ms));

async function download(path) {
  const failures = [];

  for (const source of SOURCES) {
    for (let attempt = 1; attempt <= 4; attempt += 1) {
      const separator = path.includes('?') ? '&' : '?';
      const url = `${source}/${path}${separator}vercel_build=715_${attempt}`;
      try {
        const response = await fetch(url, {
          redirect: 'follow',
          cache: 'no-store',
          headers: {
            'User-Agent': 'AS-Downtime-Vercel-Builder/3.10.5',
            Accept: '*/*'
          },
          signal: AbortSignal.timeout(30000)
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);

        const data = Buffer.from(await response.arrayBuffer());
        if (data.length === 0) throw new Error('empty response');

        const destination = resolve('public', path);
        await mkdir(dirname(destination), { recursive: true });
        await writeFile(destination, data);
        console.log(`Downloaded: ${path} (${data.length} bytes)`);
        return;
      } catch (error) {
        failures.push(`${url}: ${error.message}`);
        if (attempt < 4) await sleep(700 * attempt);
      }
    }
  }

  throw new Error(`Could not download ${path}\n${failures.join('\n')}`);
}

await mkdir('public', { recursive: true });
for (const path of ASSETS) {
  await download(path);
}
await writeFile(resolve('public', '.nojekyll'), '');
console.log(`AS Downtime public build ready: ${ASSETS.length} remote assets + local sw.js.`);
