const VERSION = '3.10.5';
const STAGE = '7.1.5';
const CATALOG_POLICY = { name: 'curated-v34', target: 1800, limit: 2200, peopleTarget: 300 };

const env = (name, fallback = '') => String(process.env[name] || fallback).trim();
const header = (req, name) => {
  const value = req?.headers?.[String(name).toLowerCase()];
  return Array.isArray(value) ? value[0] : String(value || '');
};

function requestUrl(req) {
  const host = header(req, 'host') || 'localhost';
  return new URL(req?.url || '/', `https://${host}`);
}

function sameOrigin(req) {
  const origin = header(req, 'origin');
  if (!origin) return true;
  try { return new URL(origin).host === requestUrl(req).host; } catch { return false; }
}

function sendJson(res, status, data, extraHeaders = {}) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  for (const [name, value] of Object.entries(extraHeaders)) res.setHeader(name, value);
  res.end(JSON.stringify(data));
}

async function probeTmdb(token) {
  if (!token) return { status: 'not_configured', ok: false, latencyMs: 0, endpoint: 'configuration' };
  const started = Date.now();
  try {
    const response = await fetch('https://api.themoviedb.org/3/configuration', {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(10000)
    });
    return {
      status: response.ok ? 'online' : 'error',
      ok: response.ok,
      httpStatus: response.status,
      latencyMs: Date.now() - started,
      endpoint: 'configuration'
    };
  } catch (error) {
    return {
      status: error?.name === 'TimeoutError' || error?.name === 'AbortError' ? 'timeout' : 'error',
      ok: false,
      latencyMs: Date.now() - started,
      endpoint: 'configuration',
      error: error?.name || 'Error'
    };
  }
}

export default async function handler(req, res) {
  try {
    const started = Date.now();
    if (req.method !== 'GET') return sendJson(res, 405, { error: 'Метод не поддерживается' });
    if (!sameOrigin(req)) return sendJson(res, 403, { error: 'Запрос отклонён' });

    const url = requestUrl(req);
    const token = env('TMDB_TOKEN');
    const openaiKey = env('OPENAI_API_KEY');
    const diagnostic = url.searchParams.get('diagnostic') === '1';
    const deep = diagnostic || ['1', 'true', 'yes'].includes(String(url.searchParams.get('deep') || '').toLowerCase());
    const probe = deep
      ? await probeTmdb(token)
      : { status: token ? 'configured' : 'not_configured', ok: Boolean(token), latencyMs: 0, endpoint: 'configuration' };

    if (diagnostic) {
      const looksValid = token.startsWith('eyJ') && token.length > 100;
      const reason = !token
        ? 'TMDB_TOKEN_MISSING'
        : probe.ok
          ? 'OK'
          : (probe.httpStatus === 401 || probe.httpStatus === 403)
            ? 'TMDB_AUTH_FAILED'
            : 'TMDB_NETWORK_OR_UPSTREAM_ERROR';
      return sendJson(res, probe.ok ? 200 : 503, {
        ok: Boolean(token) && Boolean(probe.ok),
        tmdbConfigured: Boolean(token),
        tokenFormatLooksValid: looksValid,
        tmdbReachable: Boolean(token) && probe.status !== 'not_configured',
        tmdbStatus: probe.httpStatus || null,
        tmdbAuthenticated: Boolean(probe.ok),
        reason
      });
    }

    const commit = env('VERCEL_GIT_COMMIT_SHA');
    const duration = Date.now() - started;
    return sendJson(res, 200, {
      ok: true,
      version: VERSION,
      stage: STAGE,
      checkedAt: new Date().toISOString(),
      release: {
        version: env('ASD_RELEASE_VERSION', VERSION),
        stage: env('ASD_RELEASE_STAGE', STAGE),
        context: env('VERCEL_ENV', 'local'),
        siteName: env('VERCEL_PROJECT_PRODUCTION_URL'),
        deployId: env('VERCEL_DEPLOYMENT_ID'),
        deployUrl: env('VERCEL_URL'),
        commitRef: commit ? commit.slice(0, 12) : ''
      },
      services: { api: true, tmdb: Boolean(token), vision: Boolean(openaiKey), aiSearch: Boolean(openaiKey) },
      probes: {
        api: { status: 'online', ok: true, latencyMs: duration },
        tmdb: probe,
        aiSearch: { status: openaiKey ? 'configured' : 'not_configured', ok: Boolean(openaiKey) }
      },
      catalog: CATALOG_POLICY,
      environment: {
        tmdbVariable: 'TMDB_TOKEN',
        tmdbConfigured: Boolean(token),
        openaiVariable: 'OPENAI_API_KEY',
        openaiConfigured: Boolean(openaiKey),
        openaiModel: env('OPENAI_MODEL', 'gpt-5-mini')
      }
    }, { 'Server-Timing': `app;dur=${duration}` });
  } catch (error) {
    return sendJson(res, 500, {
      ok: false,
      code: 'HEALTH_RUNTIME_ERROR',
      error: error?.message || 'Внутренняя ошибка сервера'
    });
  }
}
