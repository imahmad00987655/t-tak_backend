import { Router } from 'express';
import { listInventoryItems, recordInventoryTransaction } from '../services/inventoryService.js';

const router = Router();

router.get('/items', async (_req, res, next) => {
  try {
    const data = await listInventoryItems();
    res.json({ data });
  } catch (e) {
    next(e);
  }
});

router.post('/transactions', async (req, res, next) => {
  try {
    const body = req.body || {};
    const required = ['itemId', 'type', 'quantity'];
    for (const k of required) {
      if (body[k] === undefined || body[k] === null || String(body[k]).trim() === '') {
        return res.status(400).json({ error: `Missing field: ${k}` });
      }
    }
    const item = await recordInventoryTransaction({
      itemId: body.itemId,
      type: body.type,
      quantity: body.quantity,
      notes: body.notes,
    });
    res.status(201).json({ data: item });
  } catch (e) {
    next(e);
  }
});

export default router;
