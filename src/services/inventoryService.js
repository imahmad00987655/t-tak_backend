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

export async function listInventoryItems() {
  const [rows] = await pool.query(
    `SELECT id, name, category, unit, current_stock, min_stock_level, unit_cost, last_restocked
     FROM inventory_items
     WHERE status = 'active'
     ORDER BY name ASC`
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
