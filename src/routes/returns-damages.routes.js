import { Router } from 'express';
import { createReturnDamage, listReturnsDamages } from '../services/returnsDamagesService.js';

const router = Router();

router.get('/', async (req, res, next) => {
  try {
    const data = await listReturnsDamages({
      from: req.query.from ? String(req.query.from) : undefined,
      to: req.query.to ? String(req.query.to) : undefined,
    });
    res.json({ data });
  } catch (e) {
    next(e);
  }
});

router.post('/', async (req, res, next) => {
  try {
    const body = req.body || {};
    const required = ['entryType', 'customerId', 'productId', 'quantity', 'unitPrice'];
    for (const key of required) {
      if (body[key] === undefined || body[key] === null || String(body[key]).trim() === '') {
        return res.status(400).json({ error: `Missing field: ${key}` });
      }
    }
    const data = await createReturnDamage({
      entryType: body.entryType,
      customerId: body.customerId,
      walkInName: body.walkInName,
      productId: body.productId,
      quantity: body.quantity,
      unitPrice: body.unitPrice,
      reason: body.reason,
      notes: body.notes,
    });
    res.status(201).json({ data });
  } catch (e) {
    next(e);
  }
});

export default router;
