import { Router } from 'express';
import { createProduct, listProducts, updateProduct } from '../services/productService.js';

const router = Router();

router.get('/', async (_req, res, next) => {
  try {
    const data = await listProducts();
    res.json({ data });
  } catch (e) {
    next(e);
  }
});

router.post('/', async (req, res, next) => {
  try {
    const body = req.body || {};
    const required = ['name', 'category', 'unit', 'defaultPrice'];
    for (const k of required) {
      if (body[k] === undefined || body[k] === null || String(body[k]).trim() === '') {
        return res.status(400).json({ error: `Missing field: ${k}` });
      }
    }
    const product = await createProduct({
      name: body.name,
      description: body.description,
      category: body.category,
      unit: body.unit,
      defaultPrice: body.defaultPrice,
      stockQuantity: body.stockQuantity,
      status: body.status,
    });
    res.status(201).json({ data: product });
  } catch (e) {
    next(e);
  }
});

router.patch('/:id', async (req, res, next) => {
  try {
    const body = req.body || {};
    const data = await updateProduct(req.params.id, {
      name: body.name,
      description: body.description,
      category: body.category,
      unit: body.unit,
      defaultPrice: body.defaultPrice,
      stockQuantity: body.stockQuantity,
      status: body.status,
    });
    if (!data) return res.status(404).json({ error: 'Product not found' });
    res.json({ data });
  } catch (e) {
    next(e);
  }
});

export default router;
