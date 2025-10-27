import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(moduleDir, '../../..');
const distPath = path.resolve(repoRoot, 'dist/packages/signals/src/index.js');
const srcPath = path.resolve(repoRoot, 'packages/signals/src/index.ts');
const tsconfigPath = path.resolve(repoRoot, 'tsconfig.json');

let cachedModulePromise = null;
let tsApiPromise = null;

async function loadTsSource(filePath) {
  if (!tsApiPromise) {
    tsApiPromise = import('tsx/esm/api').then((api) => {
      if (typeof api.register === 'function') {
        api.register({ namespace: 'zenith-backend-signals', tsconfig: tsconfigPath });
      }
      return api;
    });
  }

  const api = await tsApiPromise;
  const parentURL = pathToFileURL(path.join(moduleDir, 'signals-ts-loader.mjs')).href;
  return api.tsImport(filePath, { parentURL, tsconfig: tsconfigPath });
}

async function loadSignalsModule() {
  if (!cachedModulePromise) {
    cachedModulePromise = (async () => {
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
          if (candidate.type === 'ts') {
            return await loadTsSource(candidate.path);
          }
          return await import(pathToFileURL(candidate.path).href);
        } catch (error) {
          lastError = error;
        }
      }

      const hint = `Signals build not found at ${distPath}. Run "npm run build --prefix zenith" before starting the backend.`;
      const error = new Error(hint);
      error.cause = lastError;
      throw error;
    })();
  }

  try {
    return await cachedModulePromise;
  } catch (error) {
    cachedModulePromise = null;
    throw error;
  }
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
