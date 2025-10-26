import fs from 'fs';
import { fileURLToPath, pathToFileURL } from 'url';

const DIST_RELATIVE = '../../dist/packages/signals/src/index.js';

const modulePath = fileURLToPath(new URL(DIST_RELATIVE, import.meta.url));
let cachedModulePromise = null;

function ensureBuiltArtifact() {
  if (!fs.existsSync(modulePath)) {
    throw new Error(
      `Signals build not found at ${modulePath}. Run "npm run build --prefix zenith" before starting the backend.`
    );
  }
}

async function loadSignalsModule() {
  if (!cachedModulePromise) {
    ensureBuiltArtifact();
    cachedModulePromise = import(pathToFileURL(modulePath).href);
  }
  return cachedModulePromise;
}

export async function runScalpLoop(exchange, symbol) {
  const mod = await loadSignalsModule();
  return mod.loop(exchange, symbol);
}

export async function getScalpRealized(symbol) {
  const mod = await loadSignalsModule();
  return mod.getRealizedPnl(symbol);
}
