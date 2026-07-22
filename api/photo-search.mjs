import { loadLegacyHandler, runLegacyHandler } from '../server/runtime-loader.mjs';
const handlerPromise = loadLegacyHandler('photo-search');
export default async function handler(request) {
  return runLegacyHandler(await handlerPromise, request);
}
