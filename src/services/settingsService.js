import pool from '../config/database.js';
import { listUsersByRole } from './authService.js';

async function getSettingMap() {
  const [rows] = await pool.query(`SELECT setting_key, setting_value FROM app_settings`);
  return Object.fromEntries(rows.map((r) => [r.setting_key, r.setting_value]));
}

async function getNotificationMap() {
  const [rows] = await pool.query(`SELECT setting_key, enabled FROM notification_settings`);
  return Object.fromEntries(rows.map((r) => [r.setting_key, !!r.enabled]));
}

async function addSettingsAudit(action) {
  await pool.query(
    `INSERT INTO audit_logs (actor, action, details) VALUES ('Admin', :action, 'Settings updated')`,
    { action }
  );
}

export async function getSettingsPayload() {
  const settings = await getSettingMap();
  const notifications = await getNotificationMap();
  const userCounts = await listUsersByRole();

  const [permRows] = await pool.query(
    `SELECT role, permission_key
     FROM role_permissions
     ORDER BY role, permission_key`
  );
  const rolePerms = {};
  for (const row of permRows) {
    if (!rolePerms[row.role]) rolePerms[row.role] = [];
    rolePerms[row.role].push(row.permission_key);
  }

  return {
    business: {
      businessName: settings.business_name || '',
      contactPhone: settings.business_phone || '',
      emailAddress: settings.business_email || '',
      city: settings.business_city || '',
      fullAddress: settings.business_address || '',
    },
    billing: {
      allowCredit: (settings.allow_credit || 'false') === 'true',
      autoInvoice: (settings.auto_invoice || 'false') === 'true',
      clientReportMode: settings.client_report_mode || 'daily',
      defaultPaymentMethod: settings.default_payment_method || 'cash',
    },
    promotions: {
      buyXGetYEnabled: (settings.promo_buy_x_get_y_enabled || 'false') === 'true',
      buyXQty: Number(settings.promo_buy_x_qty || 0),
      buyYQty: Number(settings.promo_buy_y_qty || 0),
      spendXGetYEnabled: (settings.promo_spend_x_get_y_enabled || 'false') === 'true',
      spendAmount: Number(settings.promo_spend_amount || 0),
      spendFreeQty: Number(settings.promo_spend_free_qty || 0),
    },
    notifications: {
      lowStockAlert: !!notifications.low_stock_alert,
      emailNotify: !!notifications.email_notify,
      failedDeliveryAlert: !!notifications.failed_delivery_alert,
      paymentReceivedAlert: !!notifications.payment_received_alert,
    },
    roles: [
      { role: 'admin', label: 'Admin', users: userCounts.admin, permissions: rolePerms.admin || ['all'] },
      { role: 'staff', label: 'Plant Staff', users: userCounts.staff, permissions: rolePerms.staff || [] },
      { role: 'field_worker', label: 'Field Worker', users: userCounts.field_worker, permissions: rolePerms.field_worker || [] },
      { role: 'client', label: 'Customer', users: userCounts.client, permissions: rolePerms.client || [] },
    ],
  };
}

export async function updateBusinessSettings(payload) {
  const entries = [
    ['business_name', payload.businessName],
    ['business_phone', payload.contactPhone],
    ['business_email', payload.emailAddress],
    ['business_city', payload.city],
    ['business_address', payload.fullAddress],
  ];
  for (const [k, v] of entries) {
    await pool.query(
      `INSERT INTO app_settings (setting_key, setting_value) VALUES (:k, :v)
       ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)`,
      { k, v: String(v ?? '').trim() }
    );
  }
  await addSettingsAudit('Business settings updated');
  return getSettingsPayload();
}

export async function updateBillingSettings(payload) {
  const entries = [
    ['allow_credit', String(!!payload.allowCredit)],
    ['auto_invoice', String(!!payload.autoInvoice)],
    ['client_report_mode', payload.clientReportMode],
    ['default_payment_method', payload.defaultPaymentMethod],
  ];
  for (const [k, v] of entries) {
    await pool.query(
      `INSERT INTO app_settings (setting_key, setting_value) VALUES (:k, :v)
       ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)`,
      { k, v: String(v ?? '').trim() }
    );
  }
  await addSettingsAudit('Billing settings updated');
  return getSettingsPayload();
}

export async function updatePromotionSettings(payload) {
  const entries = [
    ['promo_buy_x_get_y_enabled', String(!!payload.buyXGetYEnabled)],
    ['promo_buy_x_qty', String(Number(payload.buyXQty) || 0)],
    ['promo_buy_y_qty', String(Number(payload.buyYQty) || 0)],
    ['promo_spend_x_get_y_enabled', String(!!payload.spendXGetYEnabled)],
    ['promo_spend_amount', String(Number(payload.spendAmount) || 0)],
    ['promo_spend_free_qty', String(Number(payload.spendFreeQty) || 0)],
  ];
  for (const [k, v] of entries) {
    await pool.query(
      `INSERT INTO app_settings (setting_key, setting_value) VALUES (:k, :v)
       ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)`,
      { k, v }
    );
  }
  await addSettingsAudit('Promotion settings updated');
  return getSettingsPayload();
}

export async function updateNotificationSettings(payload) {
  const entries = [
    ['low_stock_alert', payload.lowStockAlert],
    ['email_notify', payload.emailNotify],
    ['failed_delivery_alert', payload.failedDeliveryAlert],
    ['payment_received_alert', payload.paymentReceivedAlert],
  ];
  for (const [k, enabled] of entries) {
    await pool.query(
      `INSERT INTO notification_settings (setting_key, enabled) VALUES (:k, :enabled)
       ON DUPLICATE KEY UPDATE enabled = VALUES(enabled)`,
      { k, enabled: enabled ? 1 : 0 }
    );
  }
  await addSettingsAudit('Notification settings updated');
  return getSettingsPayload();
}

export async function listManagedUsers() {
  const [rows] = await pool.query(
    `SELECT id, name, email, phone, role, status
     FROM users
     WHERE role IN ('admin', 'staff', 'field_worker', 'client')
     ORDER BY role ASC, name ASC`
  );
  return rows.map((r) => ({
    id: String(r.id),
    name: r.name,
    email: r.email,
    phone: r.phone,
    role: r.role,
    status: r.status,
  }));
}

export async function setManagedUserStatus(userId, status) {
  const nextStatus = status === 'inactive' ? 'inactive' : 'active';
  await pool.query(`UPDATE users SET status = :status WHERE id = :id`, {
    id: Number(userId),
    status: nextStatus,
  });
  await addSettingsAudit('User status updated');
  return listManagedUsers();
}

export async function updateManagedUserPassword(userId, password) {
  const next = String(password || '').trim();
  if (next.length < 4) {
    const err = new Error('Password must be at least 4 characters');
    err.status = 400;
    throw err;
  }
  await pool.query(`UPDATE users SET password_hash = :password WHERE id = :id`, {
    id: Number(userId),
    password: next,
  });
  await addSettingsAudit('User password changed');
  return { ok: true };
}
