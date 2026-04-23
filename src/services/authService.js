import pool from '../config/database.js';

function mapUser(row) {
  return {
    id: row.id ? String(row.id) : '',
    name: row.name,
    email: row.email,
    phone: row.phone,
    role: row.role,
    status: row.status,
    employeeId: row.employee_id ? String(row.employee_id) : undefined,
    customerId: row.customer_id ? String(row.customer_id) : undefined,
  };
}

async function updateLastLogin(userId) {
  await pool.query(
    `UPDATE users SET last_login_at = CURRENT_TIMESTAMP WHERE id = :id`,
    { id: Number(userId) }
  );
}

export async function loginByCredentials({ identifier, password }) {
  const [rows] = await pool.query(
    `SELECT id, name, email, phone, role, status, password_hash, employee_id, customer_id
     FROM users
     WHERE (LOWER(email) = :identifier OR phone = :rawIdentifier)
     LIMIT 1`,
    {
      identifier: String(identifier).trim().toLowerCase(),
      rawIdentifier: String(identifier).trim(),
    }
  );
  const row = rows[0];
  if (!row) return null;
  if (row.status !== 'active') return null;

  // For this local setup we accept exact text match. In production use hashed passwords.
  const isValid = String(password) === String(row.password_hash);
  if (!isValid) return null;

  await updateLastLogin(row.id);
  return mapUser(row);
}

export async function loginByRole(role) {
  const [rows] = await pool.query(
    `SELECT id, name, email, phone, role, status, employee_id, customer_id
     FROM users
     WHERE role = :role AND status = 'active'
     ORDER BY id ASC
     LIMIT 1`,
    { role }
  );
  const row = rows[0];
  if (!row) return null;
  await updateLastLogin(row.id);
  return mapUser(row);
}

export async function listUsersByRole() {
  const [rows] = await pool.query(
    `SELECT role, COUNT(*) AS users
     FROM users
     WHERE status = 'active'
     GROUP BY role`
  );
  const map = Object.fromEntries(rows.map((r) => [r.role, Number(r.users)]));
  const adminUsers = (map.admin || 0) + (map.super_admin || 0);
  return {
    admin: adminUsers,
    staff: map.staff || 0,
    field_worker: map.field_worker || 0,
    client: map.client || 0,
  };
}
