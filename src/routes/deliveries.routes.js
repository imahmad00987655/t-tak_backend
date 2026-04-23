import { Router } from 'express';
import { createDelivery, listDeliveries } from '../services/deliveryService.js';

const router = Router();

router.get('/', async (_req, res, next) => {
  try {
    const data = await listDeliveries();
    res.json({ data });
  } catch (e) {
    next(e);
  }
});

router.post('/', async (req, res, next) => {
  try {
    const body = req.body || {};
    const required = ['customerId', 'workerId', 'deliveryDate', 'items'];
    for (const field of required) {
      if (body[field] === undefined || body[field] === null || body[field] === '') {
        return res.status(400).json({ error: `Missing field: ${field}` });
      }
    }
    if (!Array.isArray(body.items) || body.items.length === 0) {
      return res.status(400).json({ error: 'At least one delivery item is required' });
    }
    for (const [index, item] of body.items.entries()) {
      if (!item?.productId || Number(item.quantity) <= 0) {
        return res.status(400).json({ error: `Invalid item at index ${index}` });
      }
    }
    const delivery = await createDelivery({
      customerId: body.customerId,
      workerId: body.workerId,
      status: body.status,
      paymentStatus: body.paymentStatus,
      walletDeduction: body.walletDeduction,
      deliveryDate: body.deliveryDate,
      deliveryTime: body.deliveryTime,
      periodStartDate: body.periodStartDate,
      periodEndDate: body.periodEndDate,
      advanceAmount: body.advanceAmount,
      notes: body.notes,
      items: body.items,
    });
    res.status(201).json({ data: delivery });
  } catch (e) {
    next(e);
  }
});

export default router;
