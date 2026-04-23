import { Router } from 'express';
import { createExpense, listExpenses } from '../services/operationsService.js';

const router = Router();

router.get('/', async (_req, res, next) => {
  try {
    const data = await listExpenses();
    res.json({ data });
  } catch (e) {
    next(e);
  }
});

router.post('/', async (req, res, next) => {
  try {
    const body = req.body || {};
    const required = ['category', 'description', 'amount', 'date'];
    for (const k of required) {
      if (body[k] === undefined || body[k] === null || String(body[k]).trim() === '') {
        return res.status(400).json({ error: `Missing field: ${k}` });
      }
    }
    const data = await createExpense({
      category: body.category,
      description: body.description,
      amount: body.amount,
      date: body.date,
      actor: body.actor || 'Admin',
    });
    res.status(201).json({ data });
  } catch (e) {
    next(e);
  }
});

export default router;
