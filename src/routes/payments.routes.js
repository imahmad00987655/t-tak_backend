import { Router } from 'express';
import { listPayments, recordPayment } from '../services/financeService.js';

const router = Router();

router.get('/', async (_req, res, next) => {
  try {
    const data = await listPayments();
    res.json({ data });
  } catch (e) {
    next(e);
  }
});

router.post('/', async (req, res, next) => {
  try {
    const body = req.body || {};
    const isWalkIn = body.customerId === 'walk-in';
    const required = isWalkIn ? ['amount', 'method'] : ['customerId', 'amount', 'method'];
    for (const k of required) {
      if (body[k] === undefined || body[k] === null || String(body[k]).trim() === '') {
        return res.status(400).json({ error: `Missing field: ${k}` });
      }
    }
    const data = await recordPayment({
      customerId: body.customerId,
      amount: body.amount,
      items: body.items,
      method: body.method,
      referenceId: body.referenceId,
      notes: body.notes,
      walkInName: body.walkInName,
      actor: body.actor,
    });
    res.status(201).json({ data });
  } catch (e) {
    next(e);
  }
});

export default router;
