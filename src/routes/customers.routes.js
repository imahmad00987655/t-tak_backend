import { Router } from 'express';
import {
  listCustomers,
  getCustomerById,
  getCustomerByQrToken,
  createCustomer,
  updateCustomer,
  listWalletTransactions,
} from '../services/customerService.js';

const router = Router();

router.get('/', async (_req, res, next) => {
  try {
    const data = await listCustomers();
    res.json({ data });
  } catch (e) {
    next(e);
  }
});

router.post('/', async (req, res, next) => {
  try {
    const body = req.body || {};
    const required = ['name', 'phone', 'address', 'area', 'customerType'];
    for (const k of required) {
      if (!body[k] || String(body[k]).trim() === '') {
        return res.status(400).json({ error: `Missing or empty field: ${k}` });
      }
    }
    const allowedTypes = ['residential', 'commercial', 'industrial'];
    if (!allowedTypes.includes(String(body.customerType))) {
      return res.status(400).json({ error: 'Invalid customerType' });
    }
    const customer = await createCustomer({
      name: body.name,
      phone: body.phone,
      altPhone: body.altPhone,
      address: body.address,
      area: body.area,
      zone: body.zone,
      route: body.route,
      customerType: body.customerType,
      walletBalance: body.walletBalance,
      notes: body.notes,
      assignedWorker: body.assignedWorker,
      joiningDate: body.joiningDate,
      loginPhone: body.loginPhone,
      loginEmail: body.loginEmail,
      loginPassword: body.loginPassword,
    });
    res.status(201).json({ data: customer });
  } catch (e) {
    next(e);
  }
});

router.get('/:id/wallet-transactions', async (req, res, next) => {
  try {
    const customer = await getCustomerById(req.params.id);
    if (!customer) return res.status(404).json({ error: 'Customer not found' });
    const data = await listWalletTransactions(req.params.id);
    res.json({ data });
  } catch (e) {
    next(e);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const customer = await getCustomerById(req.params.id);
    if (!customer) return res.status(404).json({ error: 'Customer not found' });
    res.json({ data: customer });
  } catch (e) {
    next(e);
  }
});

router.put('/:id', async (req, res, next) => {
  try {
    const customer = await updateCustomer(req.params.id, req.body || {});
    if (!customer) return res.status(404).json({ error: 'Customer not found' });
    res.json({ data: customer });
  } catch (e) {
    next(e);
  }
});

export const publicCustomerRouter = Router();

publicCustomerRouter.get('/:token', async (req, res, next) => {
  try {
    const customer = await getCustomerByQrToken(req.params.token);
    if (!customer) return res.status(404).json({ error: 'Customer card not found' });
    res.json({ data: customer });
  } catch (e) {
    next(e);
  }
});

export default router;
