const VERSION = '3.10.5';
const POLICY = 'curated-v34';
const GENRES = {12:'Приключения',14:'Фэнтези',16:'Анимация',18:'Драма',27:'Ужасы',28:'Боевик',35:'Комедия',36:'История',37:'Вестерн',53:'Триллер',80:'Криминал',99:'Документальный',878:'Фантастика',9648:'Детектив',10402:'Музыка',10749:'Романтика',10751:'Семейный',10752:'Военный'};

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
  res.setHeader('X-Content-Type-Options', 'nosniff');
  for (const [name, value] of Object.entries(extraHeaders)) res.setHeader(name, value);
  res.end(JSON.stringify(data));
}

const image = (path, size) => path ? `https://image.tmdb.org/t/p/${size}${path}` : '';

function normalizeType(row, kind) {
  if (kind === 'tv') {
    const anime = (row.genre_ids || []).includes(16) && ((row.origin_country || []).includes('JP') || row.original_language === 'ja');
    return anime ? 'Аниме' : 'Сериал';
  }
  if ((row.genre_ids || []).includes(16)) return row.original_language === 'ja' ? 'Аниме' : 'Мультфильм';
  return 'Фильм';
}

function normalizeMedia(row, kind) {
  if (!row?.id || !['movie', 'tv'].includes(kind) || row.adult || !row.poster_path) return null;
  const title = row.title || row.name || row.original_title || row.original_name;
  const desc = String(row.overview || '').replace(/\s+/g, ' ').trim();
  const votes = Number(row.vote_count) || 0;
  const rating = Number(row.vote_average) || 0;
  if (!title || desc.length < 20 || votes < 25 || rating < 4.8) return null;
  const date = row.release_date || row.first_air_date || '';
  return {
    id: `tmdb-${kind}-${row.id}`,
    tmdbId: Number(row.id),
    mediaType: kind,
    source: 'tmdb',
    title,
    originalTitle: row.original_title || row.original_name || '',
    type: normalizeType(row, kind),
    year: Number(String(date).slice(0, 4)) || 0,
    genres: (row.genre_ids || []).map(id => GENRES[id]).filter(Boolean),
    desc,
    image: image(row.poster_path, 'w342'),
    backdrop: image(row.backdrop_path || row.poster_path, 'w780'),
    rating: Number(rating.toFixed(1)),
    voteCount: votes,
    popularity: Number(row.popularity) || 0,
    originalLanguage: row.original_language || '',
    originCountry: Array.isArray(row.origin_country) ? row.origin_country : [],
    actors: [],
    runtime: 0,
    seasons: 0,
    episodes: 0,
    match: Math.max(62, Math.min(99, Math.round(65 + rating * 2.4 + Math.min(Number(row.popularity) || 0, 180) / 25)))
  };
}

function normalizePerson(row) {
  if (!row?.id || row.adult || !row.name || !row.profile_path) return null;
  return {
    id: String(row.id),
    name: row.name,
    image: image(row.profile_path, 'w185'),
    knownFor: row.known_for_department || 'Кино',
    popularity: Number(row.popularity) || 0
  };
}

function buildJobs() {
  const jobs = [{ path: 'trending/all/week', kind: 'multi' }, { path: 'trending/all/day', kind: 'multi' }];
  for (let page = 1; page <= 40; page += 1) {
    jobs.push({ path: 'movie/popular', kind: 'movie', page }, { path: 'tv/popular', kind: 'tv', page });
    if (page <= 20) jobs.push({ path: 'movie/top_rated', kind: 'movie', page }, { path: 'tv/top_rated', kind: 'tv', page });
    if (page <= 12) jobs.push({ path: 'movie/now_playing', kind: 'movie', page }, { path: 'tv/on_the_air', kind: 'tv', page }, { path: 'person/popular', kind: 'person', page });
    if (page <= 20) jobs.push(
      { path: 'discover/movie', kind: 'movie', page, params: { sort_by: 'popularity.desc', with_origin_country: 'RU', 'vote_count.gte': 30 } },
      { path: 'discover/tv', kind: 'tv', page, params: { sort_by: 'popularity.desc', with_original_language: 'ru', 'vote_count.gte': 20 } }
    );
    if (page <= 8) jobs.push({ path: 'discover/tv', kind: 'tv', page, params: { sort_by: 'popularity.desc', with_original_language: 'ja', with_genres: '16', 'vote_average.gte': 7, 'vote_count.gte': 500 } });
  }
  return jobs;
}

const JOBS = buildJobs();

async function fetchJob(job, token) {
  const url = new URL(`https://api.themoviedb.org/3/${job.path}`);
  url.searchParams.set('language', 'ru-RU');
  url.searchParams.set('region', 'RU');
  url.searchParams.set('page', String(job.page || 1));
  url.searchParams.set('include_adult', 'false');
  for (const [key, value] of Object.entries(job.params || {})) url.searchParams.set(key, String(value));
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    signal: AbortSignal.timeout(12000)
  });
  if (!response.ok) throw new Error(`TMDB ${response.status}`);
  return response.json();
}

export default async function handler(req, res) {
  try {
    if (req.method !== 'GET') return sendJson(res, 405, { error: 'Метод не поддерживается' });
    if (!sameOrigin(req)) return sendJson(res, 403, { error: 'Запрос отклонён' });

    const token = String(process.env.TMDB_TOKEN || header(req, 'x-tmdb-token') || '').trim();
    if (token.length < 40) return sendJson(res, 503, { code: 'TMDB_NOT_CONFIGURED', error: 'TMDB_TOKEN не настроен' });

    const url = requestUrl(req);
    const size = Math.max(1, Math.min(10, Number(url.searchParams.get('size')) || 8));
    const totalBatches = Math.ceil(JOBS.length / size);
    const batch = Math.max(0, Math.min(totalBatches - 1, Number(url.searchParams.get('batch')) || 0));
    const selected = JOBS.slice(batch * size, batch * size + size);
    const started = Date.now();
    const results = await Promise.allSettled(selected.map(job => fetchJob(job, token)));
    const media = new Map();
    const people = new Map();

    results.forEach((result, index) => {
      if (result.status !== 'fulfilled') return;
      const job = selected[index];
      const rows = Array.isArray(result.value?.results) ? result.value.results : [];
      if (job.kind === 'person') {
        rows.forEach(raw => { const row = normalizePerson(raw); if (row) people.set(row.id, row); });
      } else {
        rows.forEach(raw => {
          const kind = job.kind === 'multi' ? (raw.media_type || 'movie') : job.kind;
          const row = normalizeMedia(raw, kind);
          if (row) media.set(row.id, row);
        });
      }
    });

    const nextBatch = batch + 1;
    return sendJson(res, 200, {
      ok: true,
      version: VERSION,
      policy: POLICY,
      generatedAt: new Date().toISOString(),
      latencyMs: Date.now() - started,
      media: [...media.values()],
      people: [...people.values()],
      batch,
      nextBatch,
      totalBatches,
      done: nextBatch >= totalBatches,
      jobsProcessed: selected.length,
      jobsFailed: results.filter(item => item.status === 'rejected').length,
      quality: {
        acceptedMedia: media.size,
        acceptedPeople: people.size,
        rejected: { request_failed: results.filter(item => item.status === 'rejected').length }
      }
    }, { 'Cache-Control': 's-maxage=21600, stale-while-revalidate=86400' });
  } catch (error) {
    return sendJson(res, 500, {
      ok: false,
      code: 'CATALOG_RUNTIME_ERROR',
      error: error?.message || 'Не удалось загрузить каталог'
    });
  }
}
