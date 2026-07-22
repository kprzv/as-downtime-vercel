const ALLOWED = [
  /^authentication$/,
  /^configuration(?:\/.*)?$/,
  /^trending\/(?:all|movie|tv)\/(?:day|week)$/,
  /^discover\/(?:movie|tv)$/,
  /^search\/(?:multi|movie|tv|person)$/,
  /^(?:movie|tv)\/(?:popular|top_rated|now_playing|upcoming|on_the_air|airing_today)$/,
  /^(?:movie|tv)\/\d+(?:\/(?:credits|videos|watch\/providers|images|keywords|release_dates|content_ratings|similar|recommendations))?$/,
  /^person\/\d+(?:\/(?:combined_credits|external_ids))?$/,
  /^person\/popular$/
];

const QUERY_KEYS = new Set([
  'query','page','year','primary_release_year','first_air_date_year','include_adult','include_video','sort_by',
  'with_genres','without_genres','with_people','with_cast','with_crew','with_original_language','with_origin_country',
  'region','release_date.gte','release_date.lte','first_air_date.gte','first_air_date.lte','vote_average.gte',
  'vote_average.lte','vote_count.gte','with_runtime.gte','with_runtime.lte','timezone','append_to_response',
  'include_image_language','language'
]);

const APPEND_ALLOWED = {
  movie: new Set(['credits','videos','watch/providers','images','keywords','release_dates','recommendations']),
  tv: new Set(['credits','videos','watch/providers','images','keywords','content_ratings','recommendations']),
  person: new Set(['combined_credits','external_ids'])
};

const header = (req, name) => {
  const value = req?.headers?.[String(name).toLowerCase()];
  return Array.isArray(value) ? value[0] : String(value || '');
};

function requestUrl(req) {
  return new URL(req?.url || '/', `https://${header(req, 'host') || 'localhost'}`);
}

function sameOrigin(req) {
  const origin = header(req, 'origin');
  if (!origin) return true;
  try { return new URL(origin).host === requestUrl(req).host; } catch { return false; }
}

function sendJson(res, status, data, extraHeaders = {}) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  for (const [name, value] of Object.entries(extraHeaders)) res.setHeader(name, value);
  res.end(JSON.stringify(data));
}

function normalizeAppend(path, value) {
  const type = path.startsWith('movie/') ? 'movie' : path.startsWith('tv/') ? 'tv' : path.startsWith('person/') ? 'person' : '';
  if (!type) return '';
  return String(value || '')
    .split(',')
    .map(item => item.trim())
    .filter(item => APPEND_ALLOWED[type].has(item))
    .slice(0, 8)
    .join(',');
}

export default async function handler(req, res) {
  try {
    const started = Date.now();
    if (req.method !== 'GET') return sendJson(res, 405, { error: 'Метод не поддерживается' });
    if (!sameOrigin(req)) return sendJson(res, 403, { error: 'Запрос отклонён' });

    const token = String(process.env.TMDB_TOKEN || '').trim();
    if (!token) return sendJson(res, 503, { code: 'TMDB_NOT_CONFIGURED', error: 'TMDB_TOKEN не настроен в переменных окружения Vercel' });

    const incoming = requestUrl(req);
    const path = String(incoming.searchParams.get('path') || '').replace(/^\/+|\/+$/g, '');
    if (!ALLOWED.some(rule => rule.test(path))) {
      return sendJson(res, 400, { code: 'TMDB_PATH_NOT_ALLOWED', error: 'Недопустимый путь TMDB' });
    }

    const url = new URL(`https://api.themoviedb.org/3/${path}`);
    const requestedLanguage = incoming.searchParams.get('language') || '';
    const language = /^(?:ru-RU|en-US)$/.test(requestedLanguage) ? requestedLanguage : 'ru-RU';
    url.searchParams.set('language', language);

    for (const [key, raw] of incoming.searchParams.entries()) {
      if (key === 'path' || key === 'language' || !QUERY_KEYS.has(key)) continue;
      let value = String(raw).trim();
      if (key === 'append_to_response') value = normalizeAppend(path, value);
      if (key === 'include_image_language') {
        value = value.split(',').map(item => item.trim()).filter(item => /^(?:ru|en|null)$/.test(item)).slice(0, 3).join(',');
      }
      if (value && value.length <= 400) url.searchParams.set(key, value);
    }

    if (path.startsWith('search/') || path.startsWith('discover/')) url.searchParams.set('include_adult', 'false');

    const upstream = await fetch(url, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(12000)
    });

    const text = await upstream.text();
    const duration = Date.now() - started;

    if (upstream.ok) {
      res.statusCode = upstream.status;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Cache-Control', path.startsWith('search/') ? 'public, s-maxage=120, stale-while-revalidate=600' : 'public, s-maxage=900, stale-while-revalidate=86400');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Server-Timing', `tmdb;dur=${duration}`);
      return res.end(text);
    }

    if (upstream.status === 401 || upstream.status === 403) {
      return sendJson(res, 502, {
        code: 'TMDB_AUTH_FAILED',
        error: 'TMDB отклонил серверный токен',
        upstreamStatus: upstream.status
      }, { 'Server-Timing': `tmdb;dur=${duration}` });
    }

    res.statusCode = upstream.status;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Server-Timing', `tmdb;dur=${duration}`);
    return res.end(text || JSON.stringify({ code: 'TMDB_UPSTREAM_ERROR', error: 'TMDB временно недоступен' }));
  } catch (error) {
    const timeout = error?.name === 'TimeoutError' || error?.name === 'AbortError';
    return sendJson(res, timeout ? 504 : 502, {
      code: timeout ? 'TMDB_TIMEOUT' : 'TMDB_NETWORK_ERROR',
      error: timeout ? 'TMDB не ответил вовремя' : 'TMDB временно недоступен',
      detail: error?.message || null
    });
  }
}
