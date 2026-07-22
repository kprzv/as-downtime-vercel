import { loadLegacyHandler, runLegacyHandler } from '../server/runtime-loader.mjs';

const handlerPromise = loadLegacyHandler('health');

function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store, max-age=0'
    }
  });
}

async function diagnoseTmdb() {
  const token = String(process.env.TMDB_TOKEN || '').trim();
  const configured = token.length > 0;
  const looksLikeReadToken = token.startsWith('eyJ') && token.length > 100;

  if (!configured) {
    return json({
      ok: false,
      tmdbConfigured: false,
      tokenFormatLooksValid: false,
      tmdbReachable: false,
      reason: 'TMDB_TOKEN_MISSING',
      action: 'Add TMDB_TOKEN to the Vercel project for Production and create a new deployment.'
    }, 503);
  }

  try {
    const response = await fetch('https://api.themoviedb.org/3/configuration', {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json'
      },
      signal: AbortSignal.timeout(12000)
    });

    let upstream = null;
    try { upstream = await response.json(); } catch { upstream = null; }

    return json({
      ok: response.ok,
      tmdbConfigured: true,
      tokenFormatLooksValid: looksLikeReadToken,
      tmdbReachable: true,
      tmdbStatus: response.status,
      tmdbAuthenticated: response.ok,
      reason: response.ok ? 'OK' : (response.status === 401 || response.status === 403 ? 'TMDB_AUTH_FAILED' : 'TMDB_UPSTREAM_ERROR'),
      upstreamMessage: response.ok ? null : (upstream?.status_message || null)
    }, response.ok ? 200 : 502);
  } catch (error) {
    return json({
      ok: false,
      tmdbConfigured: true,
      tokenFormatLooksValid: looksLikeReadToken,
      tmdbReachable: false,
      reason: 'TMDB_NETWORK_ERROR',
      error: error?.name || 'Error'
    }, 502);
  }
}

export default async function handler(request) {
  const url = new URL(request.url);
  if (url.searchParams.get('diagnostic') === '1') {
    return diagnoseTmdb();
  }
  return runLegacyHandler(await handlerPromise, request);
}
