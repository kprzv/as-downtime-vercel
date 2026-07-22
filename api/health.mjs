const VERSION='3.10.5';
const STAGE='7.1.5';
const CATALOG_POLICY={name:'curated-v34',target:1800,limit:2200,peopleTarget:300};
const json=(data,status=200,extra={})=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...extra}});
const env=(name,fallback='')=>String(process.env[name]||fallback).trim();
function sameOrigin(request){const origin=request.headers.get('origin');if(!origin)return true;try{return new URL(origin).host===new URL(request.url).host}catch{return false}}
async function probeTmdb(token){
  if(!token)return{status:'not_configured',ok:false,latencyMs:0,endpoint:'configuration'};
  const started=Date.now();
  try{
    const response=await fetch('https://api.themoviedb.org/3/configuration',{headers:{Authorization:`Bearer ${token}`,Accept:'application/json'},signal:AbortSignal.timeout(8000)});
    return{status:response.ok?'online':'error',ok:response.ok,httpStatus:response.status,latencyMs:Date.now()-started,endpoint:'configuration'};
  }catch(error){return{status:error?.name==='TimeoutError'?'timeout':'error',ok:false,latencyMs:Date.now()-started,endpoint:'configuration',error:error?.name||'Error'}}
}
export default async function handler(request){
  const started=Date.now();
  if(request.method!=='GET')return json({error:'Метод не поддерживается'},405);
  if(!sameOrigin(request))return json({error:'Запрос отклонён'},403);
  const url=new URL(request.url);
  const token=env('TMDB_TOKEN');
  const openaiKey=env('OPENAI_API_KEY');
  const diagnostic=url.searchParams.get('diagnostic')==='1';
  const deep=diagnostic||['1','true','yes'].includes(String(url.searchParams.get('deep')||'').toLowerCase());
  const probe=deep?await probeTmdb(token):{status:token?'configured':'not_configured',ok:Boolean(token),latencyMs:0,endpoint:'configuration'};
  if(diagnostic){
    const looksValid=token.startsWith('eyJ')&&token.length>100;
    return json({ok:Boolean(token)&&Boolean(probe.ok),tmdbConfigured:Boolean(token),tokenFormatLooksValid:looksValid,tmdbReachable:Boolean(token)&&probe.status!=='not_configured',tmdbStatus:probe.httpStatus||null,tmdbAuthenticated:Boolean(probe.ok),reason:!token?'TMDB_TOKEN_MISSING':probe.ok?'OK':(probe.httpStatus===401||probe.httpStatus===403)?'TMDB_AUTH_FAILED':'TMDB_NETWORK_OR_UPSTREAM_ERROR'},probe.ok?200:503);
  }
  const commit=env('VERCEL_GIT_COMMIT_SHA');
  const duration=Date.now()-started;
  return json({
    ok:true,version:VERSION,stage:STAGE,checkedAt:new Date().toISOString(),
    release:{version:env('ASD_RELEASE_VERSION',VERSION),stage:env('ASD_RELEASE_STAGE',STAGE),context:env('VERCEL_ENV','local'),siteName:env('VERCEL_PROJECT_PRODUCTION_URL'),deployId:env('VERCEL_DEPLOYMENT_ID'),deployUrl:env('VERCEL_URL'),commitRef:commit?commit.slice(0,12):''},
    services:{api:true,tmdb:Boolean(token),vision:Boolean(openaiKey),aiSearch:Boolean(openaiKey)},
    probes:{api:{status:'online',ok:true,latencyMs:duration},tmdb:probe,aiSearch:{status:openaiKey?'configured':'not_configured',ok:Boolean(openaiKey)}},
    catalog:CATALOG_POLICY,
    environment:{tmdbVariable:'TMDB_TOKEN',tmdbConfigured:Boolean(token),openaiVariable:'OPENAI_API_KEY',openaiConfigured:Boolean(openaiKey),openaiModel:env('OPENAI_MODEL','gpt-5-mini')}
  },200,{'Server-Timing':`app;dur=${duration}`});
}
