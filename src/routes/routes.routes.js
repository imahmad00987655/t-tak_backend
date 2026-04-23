import { Router } from 'express';
import { createRoute, listRoutes } from '../services/routeService.js';

const router = Router();

router.get('/', async (_req, res, next) => {
  try {
    const data = await listRoutes();
    res.json({ data });
  } catch (e) {
    next(e);
  }
});

router.post('/', async (req, res, next) => {
  try {
    const body = req.body || {};
    if (!body.name || !String(body.name).trim()) {
      return res.status(400).json({ error: 'Route name is required' });
    }
    if (!body.area || !String(body.area).trim()) {
      return res.status(400).json({ error: 'Area is required' });
    }
    const route = await createRoute({
      name: body.name,
      area: body.area,
      workerIds: body.workerIds || [],
    });
    res.status(201).json({ data: route });
  } catch (e) {
    next(e);
  }
});

export default router;
