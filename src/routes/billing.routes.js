import { Router } from 'express';
import { listInvoices } from '../services/financeService.js';

const router = Router();

router.get('/invoices', async (_req, res, next) => {
  try {
    const data = await listInvoices({
      from: _req.query.from ? String(_req.query.from) : undefined,
      to: _req.query.to ? String(_req.query.to) : undefined,
    });
    res.json({ data });
  } catch (e) {
    next(e);
  }
});

export default router;
