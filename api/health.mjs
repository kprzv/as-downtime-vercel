import { loadLegacyHandler, runLegacyHandler } from '../server/runtime-loader.mjs';
const handlerPromise = loadLegacyHandler('health');
export default async function handler(request) {
  return runLegacyHandler(await handlerPromise, request);
}
