import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const PRIMARY = 'https://6a6116c13f60e00f80ab923a--as-downtime.netlify.app';
const FALLBACK = 'https://as-downtime.netlify.app';
const SOURCES = [...new Set([process.env.ASD_ASSET_SOURCE_URL, PRIMARY, FALLBACK].filter(Boolean).map(value => value.replace(/\/$/, '')))];
const ASSETS = new Map([
  ['config.js', '34684c9d171fc28b91ef4008c56d032ec70c3a6c8c9e69da5dd2bf9b10ab0e70'],
  ['icons/icon-180.png', 'a16977a1d31bc66cfda2a3e191fe8d78e8082099d230f16f4197d3e4f3d75d50'],
  ['icons/icon-192.png', 'feee02f1af32e56a7ed29d372d7d21bd0b46a586ddcf99f1b0dc253a4f6293fd'],
  ['icons/icon-512.png', 'a8e439abdc8610c6e40ed6f7cfcac603a34881d31e6d3bb448905bf28d004033'],
  ['index.html', '71725191eec2065660b681615f86a64d1413ed61efe9e0cd554010c3373dba6f'],
  ['main.js', '9734db1b26fad5c5de4f94cf71229b0dbcd5c04319b876070e13bd6761c3d052'],
  ['manifest.webmanifest', '933806a0cf1eb067066d9bd4ad938f5f4b6f007b56b07ed44f339a6f406a54ab'],
  ['modules/insights.js', '7499ab29f0ae66d5d91dae2670e6c5d86cd44f1c84f8cc5441e0d8f1118e66ac'],
  ['modules/recommendation-engine.js', 'd2bf28e4e7e1b9c39f988ed7d6c6c1fa5eda9a23b5abc233d7469ba51212c956'],
  ['modules/runtime-manager.js', '9c2f94606f26975b78f6a063c8d88bd72c4894f87a913c0d07a6ab5da5e26f65'],
  ['styles.css', 'e69106f378245816985822a1df7def355008dabdb4c301825c0c4d1a8e04df6e'],
  ['sw.js', 'e484fed742169b9ffce8af1ba31a93962fcf98da4f8c1b121c0699593cff4ff7'],
  ['vendor/SUPABASE-LICENSE.txt', '334dd6820e2eaeab2064e7c59001b810566728a28a41a7c1dbf69bbee17d0936'],
  ['vendor/TESSERACT-LICENSE.txt', 'b40930bbcf80744c86c46a12bc9da056641d722716c378f5659b9e555ef833e1'],
  ['vendor/supabase-2.110.7.js', '2697f51bb3efa5f10b5b0bca2a39b3772b1b8f810e6885e3bb8d69c3242d5e07'],
  ['vendor/tesseract-5.1.1.min.js', 'a8e29918d098b2b06e1012bdaeffb4aec0445c5d5654709023e0bd1f442a80e8'],
  ['vendor/tesseract-worker-5.1.1.min.js', 'aca1229639fc9907d86f96e825955a2b7c5716d17f3bc3acd71f9c7ab66181fc']
]);

const sha256 = data => createHash('sha256').update(data).digest('hex');

async function download(path, expectedHash) {
  const failures = [];
  for (const source of SOURCES) {
    const url = `${source}/${path}`;
    try {
      const response = await fetch(url, { redirect: 'follow' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = Buffer.from(await response.arrayBuffer());
      const actualHash = sha256(data);
      if (actualHash !== expectedHash) throw new Error(`SHA-256 mismatch: ${actualHash}`);
      const destination = resolve('public', path);
      await mkdir(dirname(destination), { recursive: true });
      await writeFile(destination, data);
      console.log(`Downloaded and verified: ${path}`);
      return;
    } catch (error) {
      failures.push(`${url}: ${error.message}`);
    }
  }
  throw new Error(`Could not download ${path}\n${failures.join('\n')}`);
}

await mkdir('public', { recursive: true });
await Promise.all([...ASSETS].map(([path, hash]) => download(path, hash)));
await writeFile(resolve('public', '.nojekyll'), '');
console.log(`AS Downtime public build ready: ${ASSETS.size} verified assets.`);
