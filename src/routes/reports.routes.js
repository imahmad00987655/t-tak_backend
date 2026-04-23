import { Router } from 'express';
import { getReportsCharts, getReportsOverview } from '../services/operationsService.js';

const router = Router();

router.get('/overview', async (_req, res, next) => {
  try {
    const data = await getReportsOverview();
    res.json({ data });
  } catch (e) {
    next(e);
  }
});

router.get('/charts', async (_req, res, next) => {
  try {
    const data = await getReportsCharts();
    res.json({ data });
  } catch (e) {
    next(e);
  }
});

export default router;
