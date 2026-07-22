const ALLOWED=[/^authentication$/,/^configuration(?:\/.*)?$/,/^trending\/(?:all|movie|tv)\/(?:day|week)$/,/^discover\/(?:movie|tv)$/,/^search\/(?:multi|movie|tv|person)$/,/^(?:movie|tv)\/(?:popular|top_rated|now_playing|upcoming|on_the_air|airing_today)$/,/^(?:movie|tv)\/\d+(?:\/(?:credits|videos|watch\/providers|images|keywords|release_dates|content_ratings|similar|recommendations))?$/,/^person\/\d+(?:\/(?:combined_credits|external_ids))?$/,/^person\/popular$/];
const QUERY_KEYS=new Set(['query','page','year','primary_release_year','first_air_date_year','include_adult','include_video','sort_by','with_genres','without_genres','with_people','with_cast','with_crew','with_original_language','with_origin_country','region','release_date.gte','release_date.lte','first_air_date.gte','first_air_date.lte','vote_average.gte','vote_average.lte','vote_count.gte','with_runtime.gte','with_runtime.lte','timezone','append_to_response','include_image_language','language']);
const APPEND_ALLOWED={movie:new Set(['credits','videos','watch/providers','images','keywords','release_dates','recommendations']),tv:new Set(['credits','videos','watch/providers','images','keywords','content_ratings','recommendations']),person:new Set(['combined_credits','external_ids'])};
const json=(data,status=200,headers={})=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...headers}});
function sameOrigin(request){const origin=request.headers.get('origin');if(!origin)return true;try{return new URL(origin).host===new URL(request.url).host}catch{return false}}
function normalizeAppend(path,value){const type=path.startsWith('movie/')?'movie':path.startsWith('tv/')?'tv':path.startsWith('person/')?'person':'';if(!type)return'';return String(value||'').split(',').map(x=>x.trim()).filter(x=>APPEND_ALLOWED[type].has(x)).slice(0,8).join(',')}
export default async function handler(request){
  const started=Date.now();
  if(request.method!=='GET')return json({error:'Метод не поддерживается'},405);
  if(!sameOrigin(request))return json({error:'Запрос отклонён'},403);
  const token=String(process.env.TMDB_TOKEN||'').trim();
  if(!token)return json({code:'TMDB_NOT_CONFIGURED',error:'TMDB_TOKEN не настроен в переменных окружения Vercel'},503);
  const incoming=new URL(request.url);
  const path=String(incoming.searchParams.get('path')||'').replace(/^\/+|\/+$/g,'');
  if(!ALLOWED.some(rule=>rule.test(path)))return json({code:'TMDB_PATH_NOT_ALLOWED',error:'Недопустимый путь TMDB'},400);
  const url=new URL(`https://api.themoviedb.org/3/${path}`);
  const language=/^(?:ru-RU|en-US)$/.test(incoming.searchParams.get('language')||'')?incoming.searchParams.get('language'):'ru-RU';
  url.searchParams.set('language',language);
  for(const [key,raw] of incoming.searchParams.entries()){
    if(key==='path'||key==='language'||!QUERY_KEYS.has(key))continue;
    let value=String(raw).trim();
    if(key==='append_to_response')value=normalizeAppend(path,value);
    if(key==='include_image_language')value=value.split(',').map(x=>x.trim()).filter(x=>/^(?:ru|en|null)$/.test(x)).slice(0,3).join(',');
    if(value&&value.length<=400)url.searchParams.set(key,value);
  }
  if(path.startsWith('search/')||path.startsWith('discover/'))url.searchParams.set('include_adult','false');
  try{
    const upstream=await fetch(url,{headers:{Authorization:`Bearer ${token}`,Accept:'application/json'},signal:AbortSignal.timeout(10000)});
    const text=await upstream.text();
    const duration=Date.now()-started;
    if(upstream.ok)return new Response(text,{status:upstream.status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':path.startsWith('search/')?'public, s-maxage=120, stale-while-revalidate=600':'public, s-maxage=900, stale-while-revalidate=86400','X-Content-Type-Options':'nosniff','Server-Timing':`tmdb;dur=${duration}`}});
    if(upstream.status===401||upstream.status===403)return json({code:'TMDB_AUTH_FAILED',error:'TMDB отклонил серверный токен',upstreamStatus:upstream.status},502,{'Server-Timing':`tmdb;dur=${duration}`});
    return new Response(text||JSON.stringify({code:'TMDB_UPSTREAM_ERROR',error:'TMDB временно недоступен'}),{status:upstream.status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','Server-Timing':`tmdb;dur=${duration}`}});
  }catch(error){const timeout=error?.name==='TimeoutError'||error?.name==='AbortError';return json({code:timeout?'TMDB_TIMEOUT':'TMDB_NETWORK_ERROR',error:timeout?'TMDB не ответил вовремя':'TMDB временно недоступен'},timeout?504:502)}
}
