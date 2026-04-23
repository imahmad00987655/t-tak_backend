import { Router } from 'express';
import { loginByCredentials, loginByRole } from '../services/authService.js';

const router = Router();

router.post('/login', async (req, res, next) => {
  try {
    const body = req.body || {};
    if ((!body.email && !body.identifier) || !body.password) {
      return res.status(400).json({ error: 'Phone/email and password are required' });
    }
    const user = await loginByCredentials({
      identifier: body.identifier || body.email,
      password: body.password,
    });
    if (!user) return res.status(401).json({ error: 'Invalid credentials' });
    res.json({ data: { user } });
  } catch (e) {
    next(e);
  }
});

router.post('/quick-login', async (req, res, next) => {
  try {
    const role = req.body?.role;
    if (!role) return res.status(400).json({ error: 'Role is required' });
    const user = await loginByRole(role);
    if (!user) return res.status(404).json({ error: 'No active user for this role' });
    res.json({ data: { user } });
  } catch (e) {
    next(e);
  }
});

export default router;
