import { loadLegacyHandler, runLegacyHandler } from '../server/runtime-loader.mjs';
const handlerPromise = loadLegacyHandler('catalog-batch');
export default async function handler(request) {
  return runLegacyHandler(await handlerPromise, request);
}
