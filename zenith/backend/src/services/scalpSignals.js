import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(moduleDir, '../..');
const distPath = path.resolve(repoRoot, 'dist/packages/signals/src/index.js');
const srcPath = path.resolve(repoRoot, 'packages/signals/src/index.ts');

let cachedModulePromise = null;
let tsLoaderReady = false;

async function loadSignalsModule() {
  if (cachedModulePromise) {
    return cachedModulePromise;
  }

  const candidates = [];
  if (fs.existsSync(distPath)) {
    candidates.push({ type: 'js', path: distPath });
  }
  if (fs.existsSync(srcPath)) {
    candidates.push({ type: 'ts', path: srcPath });
  }

  let lastError = null;
  for (const candidate of candidates) {
    try {
      if (candidate.type === 'ts' && !tsLoaderReady) {
        await import('tsx/esm');
        tsLoaderReady = true;
      }
      cachedModulePromise = import(pathToFileURL(candidate.path).href);
      return cachedModulePromise;
    } catch (error) {
      lastError = error;
    }
  }

  const hint = `Signals build not found at ${distPath}. Run "npm run build --prefix zenith" before starting the backend.`;
  const error = new Error(hint);
  error.cause = lastError;
  throw error;
}

export async function runScalpLoop(exchange, symbol) {
  const mod = await loadSignalsModule();
  return mod.loop(exchange, symbol);
}

export async function getScalpRealized(symbol) {
  const mod = await loadSignalsModule();
  return mod.getRealizedPnl(symbol);
}

export async function updateScalpInterest(entries) {
  const mod = await loadSignalsModule();
  if (typeof mod.updateInterestHotlist === 'function') {
    mod.updateInterestHotlist(entries ?? []);
  }
}
