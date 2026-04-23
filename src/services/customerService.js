import { randomUUID } from 'crypto';
import pool from '../config/database.js';
import { mapCustomerRow, mapWalletRow } from '../utils/mapCustomer.js';

const PUBLIC_APP_URL = (process.env.PUBLIC_APP_URL || 'http://localhost:8080').replace(/\/$/, '');

function buildQrCardUrl(qrToken) {
  return `${PUBLIC_APP_URL}/card/${qrToken}`;
}

async function createCustomerAudit(action, details) {
  await pool.query(
    `INSERT INTO audit_logs (actor, action, details) VALUES ('Admin', :action, :details)`,
    { action, details }
  );
}

export async function listCustomers() {
  const [rows] = await pool.query(
    `SELECT id, customer_id, qr_token, name, phone, alt_phone, address, area, zone, route,
            customer_type, status, joining_date, wallet_balance, notes, assigned_worker_id,
            created_at, updated_at
     FROM customers
     ORDER BY id DESC`
  );
  return rows.map((row) => {
    const c = mapCustomerRow({ ...row, qr_card_url: buildQrCardUrl(row.qr_token) });
    return c;
  });
}

export async function getCustomerById(id) {
  const [rows] = await pool.query(
    `SELECT id, customer_id, qr_token, name, phone, alt_phone, address, area, zone, route,
            customer_type, status, joining_date, wallet_balance, notes, assigned_worker_id,
            created_at, updated_at
     FROM customers WHERE id = :id LIMIT 1`,
    { id: Number(id) }
  );
  const row = rows[0];
  if (!row) return null;
  return mapCustomerRow({ ...row, qr_card_url: buildQrCardUrl(row.qr_token) });
}

export async function getCustomerByQrToken(token) {
  const [rows] = await pool.query(
    `SELECT id, customer_id, qr_token, name, phone, alt_phone, address, area, zone, route,
            customer_type, status, joining_date, wallet_balance, notes, assigned_worker_id,
            created_at, updated_at
     FROM customers WHERE qr_token = :token LIMIT 1`,
    { token: String(token).trim() }
  );
  const row = rows[0];
  if (!row) return null;
  return mapCustomerRow({ ...row, qr_card_url: buildQrCardUrl(row.qr_token) });
}

export async function listWalletTransactions(customerId) {
  const [rows] = await pool.query(
    `SELECT id, customer_id, type, amount, description, reference_id, balance_after, created_at
     FROM wallet_transactions
     WHERE customer_id = :customerId
     ORDER BY created_at DESC, id DESC
     LIMIT 100`,
    { customerId: Number(customerId) }
  );
  return rows.map(mapWalletRow);
}

export async function createCustomer(payload) {
  const qrToken = randomUUID();
  const joiningDate = payload.joiningDate || new Date().toISOString().slice(0, 10);
  const walletBalance = Math.max(0, Number(payload.walletBalance) || 0);

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [result] = await conn.query(
      `INSERT INTO customers (
        customer_id, qr_token, name, phone, alt_phone, address, area, zone, route,
        customer_type, status, joining_date, wallet_balance, notes, assigned_worker_id
      ) VALUES (
        NULL, :qrToken, :name, :phone, :altPhone, :address, :area, :zone, :route,
        :customerType, 'active', :joiningDate, :walletBalance, :notes, :assignedWorkerId
      )`,
      {
        qrToken,
        name: payload.name.trim(),
        phone: payload.phone.trim(),
        altPhone: payload.altPhone?.trim() || null,
        address: payload.address.trim(),
        area: payload.area.trim(),
        zone: payload.zone?.trim() || '',
        route: payload.route?.trim() || '',
        customerType: payload.customerType,
        joiningDate,
        walletBalance,
        notes: payload.notes?.trim() || null,
        assignedWorkerId: payload.assignedWorker?.trim() || null,
      }
    );

    const insertId = result.insertId;
    const customerId = `WD-${1000 + insertId}`;

    await conn.query(`UPDATE customers SET customer_id = :customerId WHERE id = :id`, {
      customerId,
      id: insertId,
    });

    if (walletBalance > 0) {
      await conn.query(
        `INSERT INTO wallet_transactions (customer_id, type, amount, description, balance_after)
         VALUES (:customerId, 'credit', :amount, :description, :balanceAfter)`,
        {
          customerId: insertId,
          amount: walletBalance,
          description: 'Initial wallet balance',
          balanceAfter: walletBalance,
        }
      );
    }

    if (payload.loginPassword && payload.loginPassword.trim()) {
      await conn.query(
        `INSERT INTO users (name, email, phone, password_hash, role, status, customer_id)
         VALUES (:name, :email, :phone, :passwordHash, 'client', 'active', :customerId)`,
        {
          name: payload.name.trim(),
          email:
            payload.loginEmail?.trim().toLowerCase() ||
            `customer${insertId}@local.tiktakwater`,
          phone: payload.loginPhone?.trim() || payload.phone.trim(),
          passwordHash: payload.loginPassword,
          customerId: insertId,
        }
      );
    }

    await conn.commit();
    await createCustomerAudit('Customer added', `${payload.name} (${customerId})`);
    return getCustomerById(insertId);
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}

export async function updateCustomer(id, payload) {
  const existing = await getCustomerById(id);
  if (!existing) return null;

  const numericId = Number(id);
  const sets = [];
  const params = { id: numericId };

  if (payload.name !== undefined) {
    sets.push('name = :name');
    params.name = String(payload.name).trim();
  }
  if (payload.phone !== undefined) {
    sets.push('phone = :phone');
    params.phone = String(payload.phone).trim();
  }
  if (payload.altPhone !== undefined) {
    sets.push('alt_phone = :altPhone');
    params.altPhone = payload.altPhone ? String(payload.altPhone).trim() : null;
  }
  if (payload.address !== undefined) {
    sets.push('address = :address');
    params.address = String(payload.address).trim();
  }
  if (payload.area !== undefined) {
    sets.push('area = :area');
    params.area = String(payload.area).trim();
  }
  if (payload.zone !== undefined) {
    sets.push('zone = :zone');
    params.zone = String(payload.zone).trim();
  }
  if (payload.route !== undefined) {
    sets.push('route = :route');
    params.route = String(payload.route).trim();
  }
  if (payload.customerType !== undefined) {
    sets.push('customer_type = :customerType');
    params.customerType = payload.customerType;
  }
  if (payload.status !== undefined) {
    sets.push('status = :status');
    params.status = payload.status;
  }
  if (payload.notes !== undefined) {
    sets.push('notes = :notes');
    params.notes = payload.notes ? String(payload.notes).trim() : null;
  }
  if (payload.assignedWorker !== undefined) {
    sets.push('assigned_worker_id = :assignedWorkerId');
    params.assignedWorkerId = payload.assignedWorker ? String(payload.assignedWorker).trim() : null;
  }

  if (sets.length > 0) {
    await pool.query(`UPDATE customers SET ${sets.join(', ')} WHERE id = :id`, params);
    await createCustomerAudit('Customer updated', `Customer #${numericId} profile updated`);
  }

  return getCustomerById(id);
}

export { buildQrCardUrl, PUBLIC_APP_URL };
