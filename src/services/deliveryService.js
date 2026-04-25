import pool from '../config/database.js';

function formatDate(d) {
  if (!d) return '';
  if (typeof d === 'string') return d.slice(0, 10);
  return d.toISOString().slice(0, 10);
}

function formatTime(t) {
  if (!t) return undefined;
  if (typeof t === 'string') return t.slice(0, 5);
  return String(t).slice(0, 5);
}

function mapDeliveryRows(rows) {
  const map = new Map();
  for (const row of rows) {
    if (!map.has(row.id)) {
      map.set(row.id, {
        id: row.delivery_code || `D-${String(row.id).padStart(6, '0')}`,
        dbId: String(row.id),
        customerId: String(row.customer_id),
        customerName: row.customer_name,
        customerAddress: row.customer_address,
        area: row.customer_area,
        workerId: String(row.worker_id),
        workerName: row.worker_name,
        status: row.status,
        items: [],
        totalAmount: Number(row.total_amount),
        walletDeduction: Number(row.wallet_deduction),
        amountDue: Number(row.amount_due),
        paymentStatus: row.payment_status,
        deliveryDate: formatDate(row.delivery_date),
        deliveryTime: formatTime(row.delivery_time),
        periodStartDate: formatDate(row.period_start_date),
        periodEndDate: formatDate(row.period_end_date),
        advanceAmount: Number(row.advance_amount || 0),
        notes: row.notes || undefined,
        createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
      });
    }
    if (row.product_id) {
      map.get(row.id).items.push({
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

async function getAllowCredit(conn) {
  const [rows] = await conn.query(
    `SELECT setting_value FROM app_settings WHERE setting_key = 'allow_credit' LIMIT 1`
  );
  if (!rows.length) return true;
  return String(rows[0].setting_value || 'true').toLowerCase() === 'true';
}

export async function listDeliveries() {
  const [rows] = await pool.query(
    `SELECT
      d.id,
      d.delivery_code,
      d.customer_id,
      c.name AS customer_name,
      c.address AS customer_address,
      c.area AS customer_area,
      d.worker_id,
      e.name AS worker_name,
      d.status,
      d.total_amount,
      d.wallet_deduction,
      d.amount_due,
      d.payment_status,
      d.delivery_date,
      d.delivery_time,
      d.period_start_date,
      d.period_end_date,
      d.advance_amount,
      d.notes,
      d.created_at,
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
    ORDER BY d.delivery_date DESC, d.id DESC, di.id ASC`
  );
  return mapDeliveryRows(rows);
}

export async function getDeliveryLookups() {
  const [customers] = await pool.query(
    `SELECT id, customer_id, name, area, status, wallet_balance
     FROM customers
     WHERE status = 'active'
     ORDER BY name ASC`
  );
  const [workers] = await pool.query(
    `SELECT id, name, assigned_area
     FROM employees
     WHERE role = 'field_worker' AND status = 'active'
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
      area: c.area,
      status: c.status,
      walletBalance: Number(c.wallet_balance || 0),
    })),
    workers: workers.map((w) => ({
      id: String(w.id),
      name: w.name,
      assignedArea: w.assigned_area || '',
    })),
    products: products.map((p) => ({
      id: String(p.id),
      name: p.name,
      defaultPrice: Number(p.default_price),
      status: p.status,
    })),
  };
}

export async function createDelivery(payload) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const customerId = Number(payload.customerId);
    const workerId = Number(payload.workerId);
    const status = payload.status || 'pending';

    const [customerRows] = await conn.query(
      `SELECT id, wallet_balance, qr_token
       FROM customers
       WHERE id = :id AND status = 'active'
       LIMIT 1`,
      { id: customerId }
    );
    if (!customerRows.length) {
      const err = new Error('Invalid active customer');
      err.status = 400;
      throw err;
    }

    const [workerRows] = await conn.query(
      `SELECT id FROM employees WHERE id = :id AND role = 'field_worker' AND status = 'active' LIMIT 1`,
      { id: workerId }
    );
    if (!workerRows.length) {
      const err = new Error('Invalid active worker');
      err.status = 400;
      throw err;
    }

    if (payload.requireQrVerification) {
      const suppliedToken = String(payload.qrToken || '').trim();
      const customerToken = String(customerRows[0].qr_token || '').trim();
      if (!suppliedToken || suppliedToken !== customerToken) {
        const err = new Error('QR verification required: scan customer QR before delivery');
        err.status = 403;
        throw err;
      }
    }

    const normalizedItems = payload.items.map((i) => ({
      productId: Number(i.productId),
      quantity: Math.max(1, Number(i.quantity) || 1),
      unitPrice: Number(i.unitPrice) >= 0 ? Number(i.unitPrice) : null,
    }));

    const productIds = normalizedItems.map((i) => i.productId);
    const [productRows] = await conn.query(
      `SELECT id, name, default_price, inventory_item_id FROM products
       WHERE id IN (${productIds.map(() => '?').join(',')}) AND status = 'active'`,
      productIds
    );
    const productMap = new Map(productRows.map((p) => [Number(p.id), p]));

    if (productMap.size !== normalizedItems.length) {
      const err = new Error('One or more products are invalid/inactive');
      err.status = 400;
      throw err;
    }

    const calculatedItems = normalizedItems.map((i) => {
      const product = productMap.get(i.productId);
      const unitPrice = i.unitPrice === null ? Number(product.default_price) : i.unitPrice;
      return {
        productId: i.productId,
        quantity: i.quantity,
        unitPrice,
        total: Number((unitPrice * i.quantity).toFixed(2)),
      };
    });

    const totalAmount = Number(calculatedItems.reduce((sum, i) => sum + i.total, 0).toFixed(2));
    const advanceAmount = Number(Math.max(0, Number(payload.advanceAmount) || 0).toFixed(2));
    const adjustedTotal = Number(Math.max(0, totalAmount - advanceAmount).toFixed(2));
    const customerWalletBalance = Number(customerRows[0].wallet_balance || 0);
    const allowCredit = await getAllowCredit(conn);
    if (!allowCredit && adjustedTotal > customerWalletBalance) {
      const err = new Error('Insufficient wallet balance and credit is disabled');
      err.status = 400;
      throw err;
    }
    const walletDeduction = Number(Math.min(adjustedTotal, customerWalletBalance).toFixed(2));
    const amountDue = Number(Math.max(0, adjustedTotal - walletDeduction).toFixed(2));
    const resolvedPaymentStatus = amountDue <= 0 ? 'paid' : walletDeduction > 0 ? 'partial' : 'unpaid';

    const [deliveryResult] = await conn.query(
      `INSERT INTO deliveries (
        delivery_code, customer_id, worker_id, status, payment_status,
        wallet_deduction, amount_due, total_amount, delivery_date, delivery_time, period_start_date, period_end_date, advance_amount, notes
      ) VALUES (
        NULL, :customerId, :workerId, :status, :paymentStatus,
        :walletDeduction, :amountDue, :totalAmount, :deliveryDate, :deliveryTime, :periodStartDate, :periodEndDate, :advanceAmount, :notes
      )`,
      {
        customerId,
        workerId,
        status,
        paymentStatus: resolvedPaymentStatus,
        walletDeduction,
        amountDue,
        totalAmount: adjustedTotal,
        deliveryDate: payload.deliveryDate,
        deliveryTime: payload.deliveryTime || null,
        periodStartDate: payload.periodStartDate || null,
        periodEndDate: payload.periodEndDate || null,
        advanceAmount,
        notes: payload.notes?.trim() || null,
      }
    );

    const deliveryId = Number(deliveryResult.insertId);
    const deliveryCode = `D-${String(deliveryId).padStart(6, '0')}`;
    await conn.query(`UPDATE deliveries SET delivery_code = :deliveryCode WHERE id = :id`, {
      deliveryCode,
      id: deliveryId,
    });

    for (const item of calculatedItems) {
      await conn.query(
        `INSERT INTO delivery_items (delivery_id, product_id, quantity, unit_price, total)
         VALUES (:deliveryId, :productId, :quantity, :unitPrice, :total)`,
        {
          deliveryId,
          productId: item.productId,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          total: item.total,
        }
      );

      const product = productMap.get(item.productId);
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
        const err = new Error(`Inventory item for product ${product.name} was not found`);
        err.status = 400;
        throw err;
      }
      const currentStock = Number(invRows[0].current_stock || 0);
      const nextStock = currentStock - item.quantity;
      if (nextStock < 0) {
        const err = new Error(`Insufficient inventory for ${product.name}`);
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
          notes: `Delivery ${deliveryCode}`,
          balanceAfter: nextStock,
        }
      );
    }

    if (walletDeduction > 0) {
      const nextWalletBalance = Number((customerWalletBalance - walletDeduction).toFixed(2));
      await conn.query(
        `UPDATE customers SET wallet_balance = :walletBalance WHERE id = :customerId`,
        {
          walletBalance: nextWalletBalance,
          customerId,
        }
      );
      await conn.query(
        `INSERT INTO wallet_transactions (customer_id, type, amount, description, reference_id, balance_after)
         VALUES (:customerId, 'debit', :amount, :description, :referenceId, :balanceAfter)`,
        {
          customerId,
          amount: walletDeduction,
          description: `Delivery ${deliveryCode}`,
          referenceId: deliveryCode,
          balanceAfter: nextWalletBalance,
        }
      );
    }

    await conn.commit();

    const [rows] = await pool.query(
      `SELECT
        d.id,
        d.delivery_code,
        d.customer_id,
        c.name AS customer_name,
        c.address AS customer_address,
        c.area AS customer_area,
        d.worker_id,
        e.name AS worker_name,
        d.status,
        d.total_amount,
        d.wallet_deduction,
        d.amount_due,
        d.payment_status,
        d.delivery_date,
        d.delivery_time,
        d.period_start_date,
        d.period_end_date,
        d.advance_amount,
        d.notes,
        d.created_at,
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
      WHERE d.id = :id
      ORDER BY di.id ASC`,
      { id: deliveryId }
    );
    return mapDeliveryRows(rows)[0];
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}

export async function updateDelivery(deliveryId, payload) {
  const id = Number(deliveryId);
  if (!id) {
    const err = new Error('Invalid delivery id');
    err.status = 400;
    throw err;
  }
  const sets = [];
  const params = { id };
  if (payload.status !== undefined) {
    sets.push('status = :status');
    params.status = payload.status;
  }
  if (payload.notes !== undefined) {
    sets.push('notes = :notes');
    params.notes = payload.notes ? String(payload.notes).trim() : null;
  }
  if (payload.deliveryDate !== undefined) {
    sets.push('delivery_date = :deliveryDate');
    params.deliveryDate = payload.deliveryDate || null;
  }
  if (payload.workerId !== undefined) {
    sets.push('worker_id = :workerId');
    params.workerId = Number(payload.workerId);
  }
  if (!sets.length) {
    const err = new Error('No updatable fields provided');
    err.status = 400;
    throw err;
  }
  await pool.query(`UPDATE deliveries SET ${sets.join(', ')} WHERE id = :id`, params);
  const data = await listDeliveries();
  return data.find((d) => Number(d.dbId) === id) || null;
}
