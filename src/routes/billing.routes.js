import { Router } from 'express';
import { listInvoices } from '../services/financeService.js';

const router = Router();

router.get('/invoices', async (_req, res, next) => {
  try {
    const data = await listInvoices();
    res.json({ data });
  } catch (e) {
    next(e);
  }
});

export default router;
