import { Router } from '../http/router.js';

const VALID_RISK_LEVELS = [1, 2, 3, 4, 5];

export function createControlRouter(engine) {
  const router = new Router();

  router.post('/start', async (_req, res) => {
    await engine.start();
    res.status(200).json({ status: 'started' });
  });

  router.post('/stop', (_req, res) => {
    engine.stop();
    res.status(200).json({ status: 'stopped' });
  });

  router.post('/risk/:level', (req, res) => {
    const level = Number(req.params.level);
    if (!VALID_RISK_LEVELS.includes(level)) {
      res.status(400).json({ error: 'Risk level must be between 1 and 5' });
      return;
    }
    engine.setRiskLevel(level);
    res.status(200).json({
      riskLevel: level,
      leverage: engine.getUserLeverage(),
      allocationPct: engine.getAllocationPercent(),
    });
  });

  router.post('/leverage/:value', (req, res) => {
    const value = Number(req.params.value);
    if (!Number.isFinite(value)) {
      res.status(400).json({ error: 'Leverage must be numeric' });
      return;
    }
    try {
      const leverage = engine.setUserLeverage(value);
      res.status(200).json({ leverage, allocationPct: engine.getAllocationPercent() });
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : 'Failed to set leverage' });
    }
  });

  router.post('/allocation/:percent', (req, res) => {
    const value = Number(req.params.percent);
    if (!Number.isFinite(value)) {
      res.status(400).json({ error: 'Allocation percent must be numeric' });
      return;
    }
    try {
      const allocationPct = engine.setAllocationPercent(value);
      res.status(200).json({ allocationPct, leverage: engine.getUserLeverage() });
    } catch (error) {
      res
        .status(400)
        .json({ error: error instanceof Error ? error.message : 'Failed to set allocation percent' });
    }
  });

  router.get('/interest-watcher', (_req, res) => {
    const status = engine.getInterestWatcherStatus();
    res.json({
      enabled: status.enabled,
      reason: status.reason ?? null,
      strategyMode: engine.getStrategyMode(),
    });
  });

  router.post('/interest-watcher/:state', (req, res) => {
    const state = String(req.params.state ?? '').toLowerCase();
    if (state !== 'enable' && state !== 'disable') {
      res.status(400).json({ error: 'State must be either "enable" or "disable"' });
      return;
    }

    const toggled = engine.setInterestWatcherEnabled(state === 'enable');
    res.status(200).json({
      enabled: toggled.enabled,
      reason: toggled.reason ?? null,
      strategyMode: toggled.strategyMode,
    });
  });

  router.get('/state', (_req, res) => {
    res.json({
      running: engine.isRunning(),
      riskLevel: engine.getRiskLevel(),
      leverage: engine.getUserLeverage(),
      allocationPct: engine.getAllocationPercent(),
    });
  });

  return router;
}
