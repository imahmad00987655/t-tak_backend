import pool from '../config/database.js';

function formatDate(d) {
  if (!d) return '';
  if (typeof d === 'string') return d.slice(0, 10);
  return d.toISOString().slice(0, 10);
}

function mapItem(row) {
  return {
    id: String(row.id),
    name: row.name,
    category: row.category,
    unit: row.unit,
    currentStock: Number(row.current_stock),
    minStockLevel: Number(row.min_stock_level),
    unitCost: Number(row.unit_cost),
    lastRestocked: formatDate(row.last_restocked),
  };
}

async function ensureProductInventoryLinks() {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [products] = await conn.query(
      `SELECT id, name, category, unit, default_price, stock_quantity, status
       FROM products
       WHERE inventory_item_id IS NULL`
    );

    for (const product of products) {
      const [inventoryInsert] = await conn.query(
        `INSERT INTO inventory_items (
           name, category, unit, current_stock, min_stock_level, unit_cost, status
         ) VALUES (
           :name, :category, :unit, :currentStock, 0, :unitCost, :status
         )`,
        {
          name: product.name,
          category: product.category || '',
          unit: product.unit || 'piece',
          currentStock: Math.max(0, Number(product.stock_quantity) || 0),
          unitCost: Math.max(0, Number(product.default_price) || 0),
          status: product.status === 'inactive' ? 'inactive' : 'active',
        }
      );

      await conn.query(
        `UPDATE products
         SET inventory_item_id = :inventoryItemId
         WHERE id = :productId`,
        {
          inventoryItemId: Number(inventoryInsert.insertId),
          productId: Number(product.id),
        }
      );
    }
    await conn.commit();
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}

export async function listInventoryItems() {
  const [rows] = await pool.query(
    `SELECT id, name, category, unit, current_stock, min_stock_level, unit_cost, last_restocked
     FROM inventory_items
     WHERE status = 'active'
     ORDER BY name ASC`
  );
  return rows.map(mapItem);
}

export async function listInventoryFormItems() {
  await ensureProductInventoryLinks();
  const [rows] = await pool.query(
    `SELECT DISTINCT
       ii.id,
       p.name,
       p.category,
       p.unit,
       ii.current_stock,
       ii.min_stock_level,
       ii.unit_cost,
       ii.last_restocked
     FROM products p
     INNER JOIN inventory_items ii ON ii.id = p.inventory_item_id
     WHERE p.status = 'active' AND ii.status = 'active'
     ORDER BY p.name ASC`
  );
  return rows.map(mapItem);
}

export async function recordInventoryTransaction(payload) {
  const itemId = Number(payload.itemId);
  const qty = Math.max(1, Number(payload.quantity) || 1);
  const type = payload.type;
  const allowed = ['stock_in', 'stock_out', 'damage', 'loss'];
  if (!allowed.includes(type)) {
    const err = new Error('Invalid inventory transaction type');
    err.status = 400;
    throw err;
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [itemRows] = await conn.query(
      `SELECT id, current_stock
       FROM inventory_items
       WHERE id = :id AND status = 'active'
       LIMIT 1`,
      { id: itemId }
    );
    if (!itemRows.length) {
      const err = new Error('Inventory item not found');
      err.status = 404;
      throw err;
    }

    const current = Number(itemRows[0].current_stock);
    const delta = type === 'stock_in' ? qty : -qty;
    const next = current + delta;
    if (next < 0) {
      const err = new Error('Insufficient stock for this transaction');
      err.status = 400;
      throw err;
    }

    await conn.query(
      `UPDATE inventory_items
       SET current_stock = :next,
           last_restocked = CASE WHEN :type = 'stock_in' THEN CURDATE() ELSE last_restocked END
       WHERE id = :id`,
      { id: itemId, next, type }
    );

    await conn.query(
      `INSERT INTO inventory_transactions (
         inventory_item_id, type, quantity, notes, balance_after
       ) VALUES (
         :itemId, :type, :quantity, :notes, :balanceAfter
       )`,
      {
        itemId,
        type,
        quantity: qty,
        notes: payload.notes?.trim() || null,
        balanceAfter: next,
      }
    );

    await conn.commit();
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }

  const [rows] = await pool.query(
    `SELECT id, name, category, unit, current_stock, min_stock_level, unit_cost, last_restocked
     FROM inventory_items
     WHERE id = :id`,
    { id: itemId }
  );
  return mapItem(rows[0]);
}

export async function updateInventoryItem(itemId, payload) {
  const id = Number(itemId);
  if (!id) {
    const err = new Error('Invalid inventory item id');
    err.status = 400;
    throw err;
  }
  const sets = [];
  const params = { id };
  if (payload.name !== undefined) {
    sets.push('name = :name');
    params.name = String(payload.name).trim();
  }
  if (payload.category !== undefined) {
    sets.push('category = :category');
    params.category = String(payload.category).trim();
  }
  if (payload.unit !== undefined) {
    sets.push('unit = :unit');
    params.unit = String(payload.unit).trim();
  }
  if (payload.minStockLevel !== undefined) {
    sets.push('min_stock_level = :minStockLevel');
    params.minStockLevel = Math.max(0, Number(payload.minStockLevel) || 0);
  }
  if (payload.unitCost !== undefined) {
    sets.push('unit_cost = :unitCost');
    params.unitCost = Math.max(0, Number(payload.unitCost) || 0);
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
  await pool.query(`UPDATE inventory_items SET ${sets.join(', ')} WHERE id = :id`, params);
  const [rows] = await pool.query(
    `SELECT id, name, category, unit, current_stock, min_stock_level, unit_cost, last_restocked
     FROM inventory_items
     WHERE id = :id`,
    { id }
  );
  if (!rows.length) return null;
  return mapItem(rows[0]);
}
