import { Router } from 'express';
import { closeDay, getDailyClosingSummary } from '../services/operationsService.js';

const router = Router();

router.get('/today', async (req, res, next) => {
  try {
    const data = await getDailyClosingSummary(req.query.date ? String(req.query.date) : undefined);
    res.json({ data });
  } catch (e) {
    next(e);
  }
});

router.post('/close', async (req, res, next) => {
  try {
    const body = req.body || {};
    const data = await closeDay({
      date: body.date,
      actor: body.actor || 'Admin',
    });
    res.json({ data });
  } catch (e) {
    next(e);
  }
});

export default router;
