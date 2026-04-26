import pool from '../config/database.js';

function mapProduct(row) {
  return {
    id: String(row.id),
    name: row.name,
    description: row.description || '',
    unit: row.unit,
    defaultPrice: Number(row.default_price),
    category: row.category,
    status: row.status,
    stockQuantity: Number(row.stock_quantity),
  };
}

export async function listProducts() {
  const [rows] = await pool.query(
    `SELECT id, name, description, unit, default_price, category, status, stock_quantity
     FROM products
     ORDER BY id DESC`
  );
  return rows.map(mapProduct);
}

export async function createProduct(payload) {
  const [result] = await pool.query(
    `INSERT INTO products (
      name, description, unit, default_price, category, status, stock_quantity
    ) VALUES (
      :name, :description, :unit, :defaultPrice, :category, :status, :stockQuantity
    )`,
    {
      name: payload.name.trim(),
      description: payload.description?.trim() || null,
      unit: payload.unit,
      defaultPrice: Math.max(0, Number(payload.defaultPrice) || 0),
      category: payload.category.trim(),
      status: payload.status || 'active',
      stockQuantity: Math.max(0, Number(payload.stockQuantity) || 0),
    }
  );

  const [rows] = await pool.query(
    `SELECT id, name, description, unit, default_price, category, status, stock_quantity
     FROM products WHERE id = :id`,
    { id: Number(result.insertId) }
  );
  return mapProduct(rows[0]);
}

export async function updateProduct(productId, payload) {
  const id = Number(productId);
  if (!id) {
    const err = new Error('Invalid product id');
    err.status = 400;
    throw err;
  }
  const sets = [];
  const params = { id };
  if (payload.name !== undefined) {
    sets.push('name = :name');
    params.name = String(payload.name).trim();
  }
  if (payload.description !== undefined) {
    sets.push('description = :description');
    params.description = payload.description ? String(payload.description).trim() : null;
  }
  if (payload.category !== undefined) {
    sets.push('category = :category');
    params.category = String(payload.category).trim();
  }
  if (payload.unit !== undefined) {
    sets.push('unit = :unit');
    params.unit = String(payload.unit).trim();
  }
  if (payload.defaultPrice !== undefined) {
    sets.push('default_price = :defaultPrice');
    params.defaultPrice = Math.max(0, Number(payload.defaultPrice) || 0);
  }
  if (payload.stockQuantity !== undefined) {
    sets.push('stock_quantity = :stockQuantity');
    params.stockQuantity = Math.max(0, Number(payload.stockQuantity) || 0);
  }
  if (payload.status !== undefined) {
    sets.push('status = :status');
    params.status = payload.status === 'inactive' ? 'inactive' : 'active';
  }
  if (!sets.length) {
    const err = new Error('No updatable fields provided');
    err.status = 400;
    throw err;
  }
  await pool.query(`UPDATE products SET ${sets.join(', ')} WHERE id = :id`, params);
  const [rows] = await pool.query(
    `SELECT id, name, description, unit, default_price, category, status, stock_quantity
     FROM products WHERE id = :id`,
    { id }
  );
  if (!rows.length) return null;
  return mapProduct(rows[0]);
}
