import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateRawSync } from 'node:zlib';

const HERE = dirname(fileURLToPath(import.meta.url));
const PAYLOAD_DIR = resolve(HERE, '../payload');
const PARTS = ['server-part-000', 'server-part-001', 'server-part-002', 'server-part-003'];
let archiveFiles;
const handlerCache = new Map();

function extractArchive() {
  if (archiveFiles) return archiveFiles;
  const encoded = PARTS.map(name => readFileSync(resolve(PAYLOAD_DIR, name), 'utf8')).join('').trim();
  const zip = Buffer.from(encoded, 'base64');
  const files = new Map();
  let offset = 0;

  while (offset + 30 <= zip.length && zip.readUInt32LE(offset) === 0x04034b50) {
    const flags = zip.readUInt16LE(offset + 6);
    const method = zip.readUInt16LE(offset + 8);
    const compressedSize = zip.readUInt32LE(offset + 18);
    const uncompressedSize = zip.readUInt32LE(offset + 22);
    const nameLength = zip.readUInt16LE(offset + 26);
    const extraLength = zip.readUInt16LE(offset + 28);
    if (flags & 0x08) throw new Error('Unsupported ZIP data descriptor');

    const nameStart = offset + 30;
    const dataStart = nameStart + nameLength + extraLength;
    const name = zip.subarray(nameStart, nameStart + nameLength).toString('utf8');
    const compressed = zip.subarray(dataStart, dataStart + compressedSize);
    let data;
    if (method === 0) data = compressed;
    else if (method === 8) data = inflateRawSync(compressed);
    else throw new Error(`Unsupported ZIP method: ${method}`);
    if (data.length !== uncompressedSize) throw new Error(`Corrupt ZIP entry: ${name}`);
    if (name && !name.endsWith('/')) files.set(name, data.toString('utf8'));
    offset = dataStart + compressedSize;
  }

  archiveFiles = files;
  return files;
}

export async function loadLegacyHandler(name) {
  if (!/^[a-z0-9-]+$/.test(name)) throw new Error('Invalid handler name');
  if (!handlerCache.has(name)) {
    const source = extractArchive().get(`server/legacy/${name}.mjs`);
    if (!source) throw new Error(`Missing legacy handler: ${name}`);
    const url = `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
    handlerCache.set(name, import(url).then(module => module.default));
  }
  return handlerCache.get(name);
}

function requestHeaders(request) {
  const headers = {};
  request.headers.forEach((value, key) => { headers[key.toLowerCase()] = value; });
  const url = new URL(request.url);
  if (!headers.host) headers.host = url.host;
  return headers;
}

function requestQuery(url) {
  const query = {};
  for (const [key, value] of url.searchParams.entries()) {
    if (Object.prototype.hasOwnProperty.call(query, key)) {
      query[key] = Array.isArray(query[key]) ? [...query[key], value] : [query[key], value];
    } else query[key] = value;
  }
  return query;
}

async function requestBody(request) {
  if (request.method === 'GET' || request.method === 'HEAD') return undefined;
  const text = await request.text();
  if (!text) return {};
  if ((request.headers.get('content-type') || '').includes('application/json')) {
    try { return JSON.parse(text); } catch { return text; }
  }
  return text;
}

function responseAdapter() {
  let statusCode = 200;
  const headers = new Headers();
  let completed = null;
  const finish = body => {
    completed = new Response(body, { status: statusCode, headers });
    return completed;
  };
  return {
    setHeader(name, value) { headers.set(name, String(value)); return this; },
    status(code) { statusCode = Number(code) || 200; return this; },
    json(value) {
      if (!headers.has('Content-Type')) headers.set('Content-Type', 'application/json; charset=utf-8');
      return finish(JSON.stringify(value));
    },
    send(value) { return finish(value == null ? '' : String(value)); },
    get completed() { return completed; }
  };
}

export async function runLegacyHandler(handler, request) {
  const url = new URL(request.url);
  const req = {
    method: request.method,
    headers: requestHeaders(request),
    query: requestQuery(url),
    body: await requestBody(request),
    url: url.pathname + url.search
  };
  const res = responseAdapter();
  const result = await handler(req, res);
  if (result instanceof Response) return result;
  if (res.completed instanceof Response) return res.completed;
  return new Response(null, { status: 204 });
}
