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

export async function listPayments() {
  const [rows] = await pool.query(
    `SELECT p.id, p.customer_id, c.name AS customer_name, p.walk_in_name, p.amount, p.method, p.reference_id, p.notes, p.created_at
     FROM payments p
     LEFT JOIN customers c ON c.id = p.customer_id
     ORDER BY p.created_at DESC, p.id DESC`
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

export async function listInvoices() {
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
     WHERE d.status IN ('delivered', 'partially_delivered')
     ORDER BY d.delivery_date DESC, d.id DESC, di.id ASC`
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
  return {
    customers: customers.map((c) => ({
      id: String(c.id),
      customerId: c.customer_id,
      name: c.name,
      walletBalance: Number(c.wallet_balance),
    })),
    supportsWalkIn: true,
  };
}
