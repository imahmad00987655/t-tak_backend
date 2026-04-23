import { Router } from 'express';
import {
  getSettingsPayload,
  listManagedUsers,
  setManagedUserStatus,
  updateManagedUserPassword,
  updatePromotionSettings,
  updateBillingSettings,
  updateBusinessSettings,
  updateNotificationSettings,
} from '../services/settingsService.js';

const router = Router();

router.get('/', async (_req, res, next) => {
  try {
    const data = await getSettingsPayload();
    res.json({ data });
  } catch (e) {
    next(e);
  }
});

router.put('/business', async (req, res, next) => {
  try {
    const data = await updateBusinessSettings(req.body || {});
    res.json({ data });
  } catch (e) {
    next(e);
  }
});

router.put('/billing', async (req, res, next) => {
  try {
    const data = await updateBillingSettings(req.body || {});
    res.json({ data });
  } catch (e) {
    next(e);
  }
});

router.put('/notifications', async (req, res, next) => {
  try {
    const data = await updateNotificationSettings(req.body || {});
    res.json({ data });
  } catch (e) {
    next(e);
  }
});

router.put('/promotions', async (req, res, next) => {
  try {
    const data = await updatePromotionSettings(req.body || {});
    res.json({ data });
  } catch (e) {
    next(e);
  }
});

router.get('/users', async (_req, res, next) => {
  try {
    const data = await listManagedUsers();
    res.json({ data });
  } catch (e) {
    next(e);
  }
});

router.patch('/users/:id/status', async (req, res, next) => {
  try {
    const data = await setManagedUserStatus(req.params.id, req.body?.status);
    res.json({ data });
  } catch (e) {
    next(e);
  }
});

router.patch('/users/:id/password', async (req, res, next) => {
  try {
    const data = await updateManagedUserPassword(req.params.id, req.body?.password);
    res.json({ data });
  } catch (e) {
    next(e);
  }
});

export default router;
