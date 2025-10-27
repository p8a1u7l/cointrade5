import fs from 'fs';
import path from 'path';
import { GlobalState } from './types';

export function ensureDir(dir: string) {
  fs.mkdirSync(dir, { recursive: true });
}

export function readState(stateDir: string): GlobalState {
  ensureDir(stateDir);
  const file = path.join(stateDir, 'state.json');
  if (!fs.existsSync(file)) return { symbols: {}, lastRun: 0 };
  return JSON.parse(fs.readFileSync(file, 'utf-8'));
}

export function writeState(stateDir: string, state: GlobalState) {
  ensureDir(stateDir);
  const file = path.join(stateDir, 'state.json');
  fs.writeFileSync(file, JSON.stringify(state, null, 2));
}

export function writeDailyJson(outDir: string, payload: unknown): string {
  ensureDir(outDir);
  const date = new Date().toISOString().slice(0, 10);
  const file = path.join(outDir, `${date}.json`);
  fs.writeFileSync(file, JSON.stringify(payload, null, 2));
  return file;
}
