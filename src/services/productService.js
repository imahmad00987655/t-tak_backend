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
