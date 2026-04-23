import { Router } from 'express';
import { listAuditLogs } from '../services/operationsService.js';

const router = Router();

router.get('/', async (req, res, next) => {
  try {
    const limit = req.query.limit ? Number(req.query.limit) : 100;
    const data = await listAuditLogs(limit);
    res.json({ data });
  } catch (e) {
    next(e);
  }
});

export default router;
