import { Router } from 'express';
import { getReportsCharts, getReportsOverview } from '../services/operationsService.js';

const router = Router();

router.get('/overview', async (_req, res, next) => {
  try {
    const data = await getReportsOverview({
      from: _req.query.from ? String(_req.query.from) : undefined,
      to: _req.query.to ? String(_req.query.to) : undefined,
    });
    res.json({ data });
  } catch (e) {
    next(e);
  }
});

router.get('/charts', async (_req, res, next) => {
  try {
    const data = await getReportsCharts({
      from: _req.query.from ? String(_req.query.from) : undefined,
      to: _req.query.to ? String(_req.query.to) : undefined,
    });
    res.json({ data });
  } catch (e) {
    next(e);
  }
});

export default router;
