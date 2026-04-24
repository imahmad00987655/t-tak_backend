import pool from '../config/database.js';

function formatDate(d) {
  if (!d) return '';
  if (typeof d === 'string') return d.slice(0, 10);
  return d.toISOString().slice(0, 10);
}

function paymentId(numericId) {
  return `P-${String(numericId).padStart(6, '0')}`;
}

function invoiceId(numericId) {
  return `INV-${String(numericId).padStart(6, '0')}`;
}

async function createFinanceAudit({ actor = 'Admin', action, details }) {
  await pool.query(
    `INSERT INTO audit_logs (actor, action, details) VALUES (:actor, :action, :details)`,
    { actor, action, details: details || null }
  );
}

export async function listWalletCustomers() {
  const [rows] = await pool.query(
    `SELECT id, customer_id, name, phone, area, wallet_balance
     FROM customers
     WHERE status = 'active'
     ORDER BY name ASC`
  );
  return rows.map((r) => ({
    id: String(r.id),
    customerId: r.customer_id,
    name: r.name,
    phone: r.phone,
    area: r.area,
    walletBalance: Number(r.wallet_balance),
  }));
}

export async function rechargeWallet(payload) {
  const customerId = Number(payload.customerId);
  const amount = Math.max(0, Number(payload.amount) || 0);
  if (amount <= 0) {
    const err = new Error('Recharge amount must be greater than zero');
    err.status = 400;
    throw err;
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [rows] = await conn.query(
      `SELECT id, wallet_balance
       FROM customers
       WHERE id = :customerId
       LIMIT 1`,
      { customerId }
    );
    if (!rows.length) {
      const err = new Error('Customer not found');
      err.status = 404;
      throw err;
    }
    const currentBalance = Number(rows[0].wallet_balance);
    const nextBalance = Number((currentBalance + amount).toFixed(2));

    await conn.query(
      `UPDATE customers SET wallet_balance = :nextBalance WHERE id = :customerId`,
      { nextBalance, customerId }
    );

    await conn.query(
      `INSERT INTO wallet_transactions (
         customer_id, type, amount, description, reference_id, balance_after
       ) VALUES (
         :customerId, 'credit', :amount, :description, :referenceId, :balanceAfter
       )`,
      {
        customerId,
        amount,
        description: payload.notes?.trim() || 'Wallet recharge',
        referenceId: payload.referenceId?.trim() || null,
        balanceAfter: nextBalance,
      }
    );

    const [paymentResult] = await conn.query(
      `INSERT INTO payments (
         customer_id, amount, method, reference_id, notes, applied_to_wallet
       ) VALUES (
         :customerId, :amount, :method, :referenceId, :notes, 1
       )`,
      {
        customerId,
        amount,
        method: payload.method || 'cash',
        referenceId: payload.referenceId?.trim() || null,
        notes: payload.notes?.trim() || null,
      }
    );

    await conn.commit();
    await createFinanceAudit({
      actor: payload.actor || 'Admin',
      action: 'Wallet recharged',
      details: `Customer #${customerId} credited Rs ${amount}`,
    });

    return {
      id: paymentId(Number(paymentResult.insertId)),
      customerId: String(customerId),
      amount,
      method: payload.method || 'cash',
      referenceId: payload.referenceId?.trim() || undefined,
      notes: payload.notes?.trim() || undefined,
      newWalletBalance: nextBalance,
    };
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}

export async function listPayments({ from, to } = {}) {
  const clauses = [];
  const params = {};
  if (from) {
    clauses.push('DATE(p.created_at) >= :from');
    params.from = from;
  }
  if (to) {
    clauses.push('DATE(p.created_at) <= :to');
    params.to = to;
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const [rows] = await pool.query(
    `SELECT p.id, p.customer_id, c.name AS customer_name, p.walk_in_name, p.amount, p.method, p.reference_id, p.notes, p.created_at
     FROM payments p
     LEFT JOIN customers c ON c.id = p.customer_id
     ${where}
     ORDER BY p.created_at DESC, p.id DESC`
    ,
    params
  );
  return rows.map((r) => ({
    id: paymentId(Number(r.id)),
    dbId: String(r.id),
    customerId: r.customer_id ? String(r.customer_id) : 'walk-in',
    customerName: r.customer_name || r.walk_in_name || 'Walk-in Customer',
    amount: Number(r.amount),
    method: r.method,
    referenceId: r.reference_id || undefined,
    notes: r.notes || undefined,
    createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
  }));
}

export async function recordPayment(payload) {
  if (payload.customerId === 'walk-in') {
    if (Array.isArray(payload.items) && payload.items.length > 0) {
      const conn = await pool.getConnection();
      try {
        await conn.beginTransaction();

        const normalizedItems = payload.items
          .map((item) => ({
            productId: Number(item.productId),
            quantity: Math.max(1, Number(item.quantity) || 1),
            unitPrice: Number(item.unitPrice) > 0 ? Number(item.unitPrice) : null,
          }))
          .filter((item) => item.productId > 0);

        if (!normalizedItems.length) {
          const err = new Error('Select at least one product for walk-in billing');
          err.status = 400;
          throw err;
        }

        const ids = normalizedItems.map((i) => i.productId);
        const [productRows] = await conn.query(
          `SELECT id, name, default_price, inventory_item_id
           FROM products
           WHERE id IN (${ids.map(() => '?').join(',')}) AND status = 'active'`,
          ids
        );
        const productMap = new Map(productRows.map((row) => [Number(row.id), row]));
        if (productMap.size !== normalizedItems.length) {
          const err = new Error('One or more selected products are invalid');
          err.status = 400;
          throw err;
        }

        let total = 0;
        const lines = [];
        for (const item of normalizedItems) {
          const product = productMap.get(item.productId);
          const price = item.unitPrice ?? Number(product.default_price);
          const lineTotal = Number((price * item.quantity).toFixed(2));
          total += lineTotal;
          lines.push(`${item.quantity}x ${product.name}`);

          const inventoryItemId = Number(product.inventory_item_id || 0);
          if (!inventoryItemId) {
            const err = new Error(`Product ${product.name} is not linked with inventory`);
            err.status = 400;
            throw err;
          }
          const [invRows] = await conn.query(
            `SELECT id, current_stock FROM inventory_items WHERE id = :id AND status = 'active' LIMIT 1`,
            { id: inventoryItemId }
          );
          if (!invRows.length) {
            const err = new Error(`Inventory item missing for ${product.name}`);
            err.status = 400;
            throw err;
          }
          const currentStock = Number(invRows[0].current_stock || 0);
          const nextStock = currentStock - item.quantity;
          if (nextStock < 0) {
            const err = new Error(`Insufficient stock for ${product.name}`);
            err.status = 400;
            throw err;
          }
          await conn.query(
            `UPDATE inventory_items SET current_stock = :nextStock WHERE id = :id`,
            { id: inventoryItemId, nextStock }
          );
          await conn.query(
            `INSERT INTO inventory_transactions (inventory_item_id, type, quantity, notes, balance_after)
             VALUES (:inventoryItemId, 'stock_out', :quantity, :notes, :balanceAfter)`,
            {
              inventoryItemId,
              quantity: item.quantity,
              notes: `Walk-in sale: ${payload.walkInName?.trim() || 'Walk-in Customer'}`,
              balanceAfter: nextStock,
            }
          );
        }

        const finalTotal = Number(total.toFixed(2));
        const [result] = await conn.query(
          `INSERT INTO payments (
             customer_id, walk_in_name, amount, method, reference_id, notes, applied_to_wallet
           ) VALUES (
             NULL, :walkInName, :amount, :method, :referenceId, :notes, 0
           )`,
          {
            walkInName: payload.walkInName?.trim() || 'Walk-in Customer',
            amount: finalTotal,
            method: payload.method || 'cash',
            referenceId: payload.referenceId?.trim() || null,
            notes:
              payload.notes?.trim() ||
              `Walk-in sale (${lines.join(', ')})`,
          }
        );

        await conn.commit();
        await createFinanceAudit({
          actor: payload.actor || 'Admin',
          action: 'Walk-in sale recorded',
          details: `${payload.walkInName || 'Walk-in Customer'} billed Rs ${finalTotal}`,
        });
        return { id: paymentId(Number(result.insertId)) };
      } catch (e) {
        await conn.rollback();
        throw e;
      } finally {
        conn.release();
      }
    }

    const amount = Math.max(0, Number(payload.amount) || 0);
    if (amount <= 0) {
      const err = new Error('Payment amount must be greater than zero');
      err.status = 400;
      throw err;
    }
    const [result] = await pool.query(
      `INSERT INTO payments (
         customer_id, walk_in_name, amount, method, reference_id, notes, applied_to_wallet
       ) VALUES (
         NULL, :walkInName, :amount, :method, :referenceId, :notes, 0
       )`,
      {
        walkInName: payload.walkInName?.trim() || 'Walk-in Customer',
        amount,
        method: payload.method || 'cash',
        referenceId: payload.referenceId?.trim() || null,
        notes: payload.notes?.trim() || null,
      }
    );
    await createFinanceAudit({
      actor: payload.actor || 'Admin',
      action: 'Walk-in payment recorded',
      details: `${payload.walkInName || 'Walk-in Customer'} paid Rs ${amount}`,
    });
    return { id: paymentId(Number(result.insertId)) };
  }
  return rechargeWallet(payload);
}

function mapInvoices(rows) {
  const map = new Map();
  for (const row of rows) {
    if (!map.has(row.delivery_id)) {
      map.set(row.delivery_id, {
        id: invoiceId(Number(row.delivery_id)),
        deliveryId: row.delivery_code || `D-${String(row.delivery_id).padStart(6, '0')}`,
        customerName: row.customer_name,
        customerId: String(row.customer_id),
        area: row.area,
        workerName: row.worker_name,
        items: [],
        totalAmount: Number(row.total_amount),
        walletDeduction: Number(row.wallet_deduction),
        amountDue: Number(row.amount_due),
        paymentStatus: row.payment_status,
        date: formatDate(row.delivery_date),
      });
    }
    if (row.product_id) {
      map.get(row.delivery_id).items.push({
        productId: String(row.product_id),
        productName: row.product_name,
        quantity: Number(row.quantity),
        unitPrice: Number(row.unit_price),
        total: Number(row.item_total),
      });
    }
  }
  return Array.from(map.values());
}

export async function listInvoices({ from, to } = {}) {
  const clauses = [`d.status IN ('delivered', 'partially_delivered')`];
  const params = {};
  if (from) {
    clauses.push('d.delivery_date >= :from');
    params.from = from;
  }
  if (to) {
    clauses.push('d.delivery_date <= :to');
    params.to = to;
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const [rows] = await pool.query(
    `SELECT
      d.id AS delivery_id,
      d.delivery_code,
      d.customer_id,
      c.name AS customer_name,
      c.area,
      e.name AS worker_name,
      d.total_amount,
      d.wallet_deduction,
      d.amount_due,
      d.payment_status,
      d.delivery_date,
      di.product_id,
      p.name AS product_name,
      di.quantity,
      di.unit_price,
      di.total AS item_total
     FROM deliveries d
     INNER JOIN customers c ON c.id = d.customer_id
     INNER JOIN employees e ON e.id = d.worker_id
     LEFT JOIN delivery_items di ON di.delivery_id = d.id
     LEFT JOIN products p ON p.id = di.product_id
     ${where}
     ORDER BY d.delivery_date DESC, d.id DESC, di.id ASC`
    ,
    params
  );
  return mapInvoices(rows);
}

export async function getFinanceLookups() {
  const [customers] = await pool.query(
    `SELECT id, customer_id, name, wallet_balance
     FROM customers
     WHERE status = 'active'
     ORDER BY name ASC`
  );
  const [products] = await pool.query(
    `SELECT id, name, default_price, status
     FROM products
     WHERE status = 'active'
     ORDER BY name ASC`
  );
  return {
    customers: customers.map((c) => ({
      id: String(c.id),
      customerId: c.customer_id,
      name: c.name,
      walletBalance: Number(c.wallet_balance),
    })),
    products: products.map((p) => ({
      id: String(p.id),
      name: p.name,
      defaultPrice: Number(p.default_price),
      status: p.status,
    })),
    supportsWalkIn: true,
  };
}
