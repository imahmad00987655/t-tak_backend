import { Router } from 'express';
import { createEmployee, listEmployees, updateEmployee } from '../services/operationsService.js';

const router = Router();

router.get('/', async (_req, res, next) => {
  try {
    const data = await listEmployees();
    res.json({ data });
  } catch (e) {
    next(e);
  }
});

router.post('/', async (req, res, next) => {
  try {
    const body = req.body || {};
    const required = ['name', 'phone', 'role'];
    for (const k of required) {
      if (body[k] === undefined || body[k] === null || String(body[k]).trim() === '') {
        return res.status(400).json({ error: `Missing field: ${k}` });
      }
    }
    const allowedRoles = ['field_worker', 'staff', 'admin'];
    if (!allowedRoles.includes(String(body.role))) {
      return res.status(400).json({ error: 'Invalid role' });
    }
    const data = await createEmployee({
      name: body.name,
      phone: body.phone,
      email: body.email,
      role: body.role,
      assignedArea: body.assignedArea,
      assignedRoute: body.assignedRoute,
      loginPhone: body.loginPhone,
      loginEmail: body.loginEmail,
      loginPassword: body.loginPassword,
      actor: body.actor || 'Admin',
    });
    res.status(201).json({ data });
  } catch (e) {
    next(e);
  }
});

router.patch('/:id', async (req, res, next) => {
  try {
    const body = req.body || {};
    const data = await updateEmployee(req.params.id, {
      name: body.name,
      phone: body.phone,
      email: body.email,
      role: body.role,
      status: body.status,
      assignedArea: body.assignedArea,
      assignedRoute: body.assignedRoute,
      loginPhone: body.loginPhone,
      loginEmail: body.loginEmail,
      loginPassword: body.loginPassword,
      actor: body.actor || 'Admin',
    });
    if (!data) return res.status(404).json({ error: 'Employee not found' });
    res.json({ data });
  } catch (e) {
    next(e);
  }
});

export default router;
