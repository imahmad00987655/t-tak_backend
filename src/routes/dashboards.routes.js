import { Router } from 'express';
import {
  getAdminDashboard,
  getClientDashboard,
  getWorkerDashboard,
} from '../services/operationsService.js';

const router = Router();

router.get('/admin', async (_req, res, next) => {
  try {
    const data = await getAdminDashboard();
    res.json({ data });
  } catch (e) {
    next(e);
  }
});

router.get('/worker/:workerId', async (req, res, next) => {
  try {
    const data = await getWorkerDashboard(req.params.workerId);
    res.json({ data });
  } catch (e) {
    next(e);
  }
});

router.get('/client/:customerId', async (req, res, next) => {
  try {
    const data = await getClientDashboard(req.params.customerId);
    res.json({ data });
  } catch (e) {
    next(e);
  }
});

export default router;
