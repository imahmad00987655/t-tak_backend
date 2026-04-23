import { Router } from 'express';
import { getDeliveryLookups } from '../services/deliveryService.js';
import { listInventoryItems } from '../services/inventoryService.js';
import { getActiveWorkers, getRouteAreaLookups } from '../services/routeService.js';
import { getFinanceLookups } from '../services/financeService.js';

const router = Router();

router.get('/delivery-form', async (_req, res, next) => {
  try {
    const data = await getDeliveryLookups();
    res.json({ data });
  } catch (e) {
    next(e);
  }
});

router.get('/routes-form', async (_req, res, next) => {
  try {
    const workers = await getActiveWorkers();
    res.json({ data: { workers } });
  } catch (e) {
    next(e);
  }
});

router.get('/inventory-form', async (_req, res, next) => {
  try {
    const items = await listInventoryItems();
    res.json({ data: { items } });
  } catch (e) {
    next(e);
  }
});

router.get('/finance-form', async (_req, res, next) => {
  try {
    const data = await getFinanceLookups();
    res.json({ data });
  } catch (e) {
    next(e);
  }
});

router.get('/employee-form', async (_req, res, next) => {
  try {
    const data = await getRouteAreaLookups();
    res.json({ data });
  } catch (e) {
    next(e);
  }
});

export default router;
