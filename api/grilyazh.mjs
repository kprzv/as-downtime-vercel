import { gunzipSync } from 'node:zlib';
import '../payload/gril-p1.mjs';
import '../payload/gril-p2.mjs';
import '../payload/gril-p3.mjs';
import '../payload/gril-p4.mjs';

const html = gunzipSync(Buffer.from(globalThis.__G || '', 'base64')).toString('utf8');

export default function handler(req, res) {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.status(200).send(html);
}
