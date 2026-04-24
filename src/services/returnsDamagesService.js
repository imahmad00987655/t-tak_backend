import pool from '../config/database.js';

export async function listReturnsDamages({ from, to } = {}) {
  const clauses = [];
  const params = {};
  if (from) {
    clauses.push('DATE(rd.created_at) >= :from');
    params.from = from;
  }
  if (to) {
    clauses.push('DATE(rd.created_at) <= :to');
    params.to = to;
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const [rows] = await pool.query(
    `SELECT rd.id, rd.entry_type, rd.customer_id, rd.walk_in_name, rd.product_id, rd.quantity,
            rd.unit_price, rd.adjustment_amount, rd.reason, rd.notes, rd.created_at,
            c.name AS customer_name, p.name AS product_name
     FROM returns_damages rd
     LEFT JOIN customers c ON c.id = rd.customer_id
     INNER JOIN products p ON p.id = rd.product_id
     ${where}
     ORDER BY rd.created_at DESC, rd.id DESC`,
    params
  );
  return rows.map((row) => ({
    id: String(row.id),
    entryType: row.entry_type,
    customerId: row.customer_id ? String(row.customer_id) : 'walk-in',
    customerName: row.customer_name || row.walk_in_name || 'Walk-in Customer',
    productId: String(row.product_id),
    productName: row.product_name,
    quantity: Number(row.quantity),
    unitPrice: Number(row.unit_price),
    adjustmentAmount: Number(row.adjustment_amount),
    reason: row.reason,
    notes: row.notes || '',
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
  }));
}

export async function createReturnDamage(payload) {
  const entryType = payload.entryType === 'damage' ? 'damage' : 'return';
  const quantity = Math.max(1, Number(payload.quantity) || 1);
  const productId = Number(payload.productId);
  const customerId = payload.customerId === 'walk-in' ? null : Number(payload.customerId);
  const unitPrice = Math.max(0, Number(payload.unitPrice) || 0);
  const adjustmentAmount = Number((unitPrice * quantity).toFixed(2));

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [productRows] = await conn.query(
      `SELECT id, name, inventory_item_id FROM products WHERE id = :id LIMIT 1`,
      { id: productId }
    );
    if (!productRows.length) {
      const err = new Error('Product not found');
      err.status = 404;
      throw err;
    }
    const product = productRows[0];
    const inventoryItemId = Number(product.inventory_item_id || 0);
    if (!inventoryItemId) {
      const err = new Error('Product is not linked with inventory');
      err.status = 400;
      throw err;
    }
    const [invRows] = await conn.query(
      `SELECT id, current_stock FROM inventory_items WHERE id = :id AND status = 'active' LIMIT 1`,
      { id: inventoryItemId }
    );
    if (!invRows.length) {
      const err = new Error('Inventory item not found');
      err.status = 404;
      throw err;
    }
    const currentStock = Number(invRows[0].current_stock || 0);
    const nextStock = entryType === 'return' ? currentStock + quantity : currentStock - quantity;
    if (nextStock < 0) {
      const err = new Error('Insufficient stock to mark this damage');
      err.status = 400;
      throw err;
    }
    await conn.query(
      `UPDATE inventory_items SET current_stock = :nextStock WHERE id = :id`,
      { id: inventoryItemId, nextStock }
    );
    await conn.query(
      `INSERT INTO inventory_transactions (inventory_item_id, type, quantity, notes, balance_after)
       VALUES (:inventoryItemId, :type, :quantity, :notes, :balanceAfter)`,
      {
        inventoryItemId,
        type: entryType === 'return' ? 'stock_in' : 'damage',
        quantity,
        notes: `${entryType.toUpperCase()} ${payload.reason || ''}`.trim(),
        balanceAfter: nextStock,
      }
    );

    if (customerId) {
      const [custRows] = await conn.query(
        `SELECT wallet_balance FROM customers WHERE id = :id LIMIT 1`,
        { id: customerId }
      );
      if (custRows.length) {
        const currentBalance = Number(custRows[0].wallet_balance || 0);
        const nextBalance =
          entryType === 'return'
            ? Number((currentBalance + adjustmentAmount).toFixed(2))
            : Number((Math.max(0, currentBalance - adjustmentAmount)).toFixed(2));
        await conn.query(`UPDATE customers SET wallet_balance = :balance WHERE id = :id`, {
          id: customerId,
          balance: nextBalance,
        });
        await conn.query(
          `INSERT INTO wallet_transactions (customer_id, type, amount, description, reference_id, balance_after)
           VALUES (:customerId, :type, :amount, :description, :referenceId, :balanceAfter)`,
          {
            customerId,
            type: entryType === 'return' ? 'credit' : 'debit',
            amount: adjustmentAmount,
            description: `${entryType === 'return' ? 'Product return' : 'Damaged items'} adjustment`,
            referenceId: null,
            balanceAfter: nextBalance,
          }
        );
      }
    }

    const [result] = await conn.query(
      `INSERT INTO returns_damages (
        entry_type, customer_id, walk_in_name, product_id, quantity, unit_price, adjustment_amount, reason, notes
      ) VALUES (
        :entryType, :customerId, :walkInName, :productId, :quantity, :unitPrice, :adjustmentAmount, :reason, :notes
      )`,
      {
        entryType,
        customerId,
        walkInName: customerId ? null : payload.walkInName?.trim() || 'Walk-in Customer',
        productId,
        quantity,
        unitPrice,
        adjustmentAmount,
        reason: payload.reason?.trim() || null,
        notes: payload.notes?.trim() || null,
      }
    );
    await conn.commit();
    return { id: String(result.insertId) };
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}
