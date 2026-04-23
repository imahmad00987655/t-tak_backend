import { Router } from 'express';
import { listWalletCustomers, rechargeWallet } from '../services/financeService.js';

const router = Router();

router.get('/', async (_req, res, next) => {
  try {
    const data = await listWalletCustomers();
    res.json({ data });
  } catch (e) {
    next(e);
  }
});

router.post('/recharge', async (req, res, next) => {
  try {
    const body = req.body || {};
    const required = ['customerId', 'amount'];
    for (const k of required) {
      if (body[k] === undefined || body[k] === null || String(body[k]).trim() === '') {
        return res.status(400).json({ error: `Missing field: ${k}` });
      }
    }
    const data = await rechargeWallet({
      customerId: body.customerId,
      amount: body.amount,
      method: body.method || 'cash',
      referenceId: body.referenceId,
      notes: body.notes,
    });
    res.status(201).json({ data });
  } catch (e) {
    next(e);
  }
});

export default router;
