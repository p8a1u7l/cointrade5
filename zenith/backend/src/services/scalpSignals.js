import '../utils/polyfills.js';
import fs from 'fs';
import path from 'path';
import Module from 'node:module';
import { fileURLToPath, pathToFileURL } from 'url';

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(moduleDir, '../../..');
const distRoot = path.resolve(repoRoot, 'dist');
const distPath = path.resolve(distRoot, 'packages/signals/src/index.js');
const srcPath = path.resolve(repoRoot, 'packages/signals/src/index.ts');
const tsconfigPath = path.resolve(repoRoot, 'tsconfig.json');

let cachedModulePromise = null;
let tsApiPromise = null;
let aliasesRegistered = false;

const aliasPrefixMap = [
  {
    prefix: '@repo/core/',
    roots: [
      path.join(distRoot, 'packages/core/'),
      path.join(repoRoot, 'packages/core/'),
    ],
  },
  {
    prefix: '@repo/executor/',
    roots: [
      path.join(distRoot, 'packages/executor/src/'),
      path.join(repoRoot, 'packages/executor/src/'),
    ],
  },
  {
    prefix: '@repo/risk/',
    roots: [
      path.join(distRoot, 'packages/risk/src/'),
      path.join(repoRoot, 'packages/risk/src/'),
    ],
  },
  {
    prefix: '@repo/signals/',
    roots: [
      path.join(distRoot, 'packages/signals/src/'),
      path.join(repoRoot, 'packages/signals/src/'),
    ],
  },
  {
    prefix: '@repo/packages/',
    roots: [
      path.join(distRoot, 'packages/'),
      path.join(repoRoot, 'packages/'),
    ],
  },
  {
    prefix: '@repo/models-dl/',
    roots: [
      path.join(distRoot, 'packages/models-dl/src/'),
      path.join(repoRoot, 'packages/models-dl/src/'),
    ],
  },
  {
    prefix: '@repo/models-llm/',
    roots: [
      path.join(distRoot, 'packages/models-llm/src/'),
      path.join(repoRoot, 'packages/models-llm/src/'),
    ],
  },
  {
    prefix: '@repo/interest-watcher/',
    roots: [
      path.join(distRoot, 'packages/interest-watcher/src/'),
      path.join(repoRoot, 'packages/interest-watcher/src/'),
    ],
  },
];

const aliasExactMap = [
  {
    spec: '@repo/exchange-binance',
    candidates: [
      path.join(distRoot, 'packages/exchange-binance/index.js'),
      path.join(repoRoot, 'packages/exchange-binance/index.ts'),
    ],
  },
  {
    spec: '@repo/interest-watcher',
    candidates: [
      path.join(distRoot, 'packages/interest-watcher/index.js'),
      path.join(repoRoot, 'packages/interest-watcher/index.ts'),
    ],
  },
];

function resolveWithExtensions(basePath) {
  const candidates = [basePath];
  if (!/\.[a-z0-9]+$/i.test(basePath)) {
    candidates.push(
      `${basePath}.js`,
      `${basePath}.cjs`,
      `${basePath}.mjs`,
      `${basePath}.ts`,
      `${basePath}.tsx`,
      path.join(basePath, 'index.js'),
      path.join(basePath, 'index.cjs'),
      path.join(basePath, 'index.mjs'),
      path.join(basePath, 'index.ts'),
      path.join(basePath, 'index.tsx'),
    );
  }

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

function resolveRepoAlias(specifier) {
  for (const entry of aliasExactMap) {
    if (specifier === entry.spec) {
      for (const candidate of entry.candidates) {
        const resolved = resolveWithExtensions(candidate);
        if (resolved) {
          return resolved;
        }
      }
      return null;
    }
  }

  for (const entry of aliasPrefixMap) {
    if (!specifier.startsWith(entry.prefix)) {
      continue;
    }
    const fragment = specifier.slice(entry.prefix.length);
    for (const root of entry.roots) {
      const resolved = resolveWithExtensions(path.join(root, fragment));
      if (resolved) {
        return resolved;
      }
    }
  }

  return null;
}

function registerRepoAliases() {
  if (aliasesRegistered) {
    return;
  }

  const originalResolve = Module._resolveFilename;
  Module._resolveFilename = function patchedResolve(request, parent, isMain, options) {
    if (typeof request === 'string' && request.startsWith('@repo/')) {
      const mapped = resolveRepoAlias(request);
      if (mapped) {
        return originalResolve.call(this, mapped, parent, isMain, options);
      }
    }
    return originalResolve.call(this, request, parent, isMain, options);
  };
  aliasesRegistered = true;
}

async function loadTsSource(filePath) {
  registerRepoAliases();
  if (!tsApiPromise) {
    tsApiPromise = import('tsx/esm/api')
      .then((api) => {
        if (typeof api?.tsImport !== 'function') {
          throw new Error('tsx runtime does not expose tsImport()');
        }
        return api;
      })
      .catch((error) => {
        tsApiPromise = null;
        throw error;
      });
  }

  const api = await tsApiPromise;
  const parentURL = pathToFileURL(path.join(moduleDir, 'signals-ts-loader.mjs')).href;
  return api.tsImport(filePath, { parentURL, tsconfig: tsconfigPath });
}

async function loadSignalsModule() {
  if (!cachedModulePromise) {
    cachedModulePromise = (async () => {
      registerRepoAliases();
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

      const hints = [
        `Signals build not found at ${distPath}. Run "npm run build --prefix zenith" before starting the backend.`,
      ];
      if (lastError?.code === 'ERR_MODULE_NOT_FOUND' && /'tsx'/.test(lastError?.message ?? '')) {
        hints.push('Install workspace dependencies with "npm install --prefix zenith" to enable TypeScript fallbacks.');
      }
      const error = new Error(hints.join(' '));
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
