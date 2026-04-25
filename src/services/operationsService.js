import pool from '../config/database.js';

function formatDate(d) {
  if (!d) return '';
  if (typeof d === 'string') return d.slice(0, 10);
  return d.toISOString().slice(0, 10);
}

export async function createAuditLog({ actor, action, details }) {
  await pool.query(
    `INSERT INTO audit_logs (actor, action, details) VALUES (:actor, :action, :details)`,
    {
      actor: actor || 'System',
      action,
      details: details || null,
    }
  );
}

export async function listExpenses({ from, to } = {}) {
  const clauses = [];
  const params = {};
  if (from) {
    clauses.push('expense_date >= :from');
    params.from = from;
  }
  if (to) {
    clauses.push('expense_date <= :to');
    params.to = to;
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const [rows] = await pool.query(
    `SELECT id, category, description, amount, expense_date
     FROM expenses
     ${where}
     ORDER BY expense_date DESC, id DESC`,
    params
  );
  return rows.map((r) => ({
    id: `E-${String(r.id).padStart(6, '0')}`,
    dbId: String(r.id),
    category: r.category,
    description: r.description,
    amount: Number(r.amount),
    date: formatDate(r.expense_date),
  }));
}

export async function listExpenseCategories() {
  const [rows] = await pool.query(
    `SELECT DISTINCT name
     FROM (
       SELECT name FROM expense_categories WHERE status = 'active'
       UNION
       SELECT category AS name FROM products WHERE status = 'active' AND category IS NOT NULL AND TRIM(category) <> ''
     ) x
     ORDER BY name ASC`
  );
  return rows.map((row, idx) => ({ id: `cat-${idx + 1}`, name: row.name }));
}

export async function createExpenseCategory(name) {
  const trimmed = String(name || '').trim();
  if (!trimmed) {
    const err = new Error('Category name is required');
    err.status = 400;
    throw err;
  }
  const [result] = await pool.query(
    `INSERT INTO expense_categories (name, status) VALUES (:name, 'active')`,
    { name: trimmed }
  );
  return { id: String(result.insertId), name: trimmed };
}

export async function createExpense(payload) {
  const [result] = await pool.query(
    `INSERT INTO expenses (category, description, amount, expense_date)
     VALUES (:category, :description, :amount, :expenseDate)`,
    {
      category: payload.category.trim(),
      description: payload.description.trim(),
      amount: Math.max(0, Number(payload.amount) || 0),
      expenseDate: payload.date,
    }
  );
  await createAuditLog({
    actor: payload.actor || 'Admin',
    action: 'Expense recorded',
    details: `Rs ${Number(payload.amount)} in ${payload.category}`,
  });
  return { id: String(result.insertId) };
}

export async function listEmployees() {
  const [rows] = await pool.query(
    `SELECT
      e.id, e.name, e.phone, e.email, e.role, e.status, e.assigned_area,
      COALESCE((
        SELECT GROUP_CONCAT(r.name ORDER BY r.name SEPARATOR ', ')
        FROM route_workers rw
        INNER JOIN routes r ON r.id = rw.route_id
        WHERE rw.worker_id = e.id
      ), '') AS assigned_route,
      COALESCE((
        SELECT COUNT(*)
        FROM deliveries d
        WHERE d.worker_id = e.id AND d.status IN ('delivered', 'partially_delivered')
      ), 0) AS deliveries_completed,
      COALESCE((
        SELECT COUNT(*)
        FROM deliveries d
        WHERE d.worker_id = e.id AND d.status = 'failed'
      ), 0) AS failed_deliveries,
      COALESCE((
        SELECT SUM(d.total_amount)
        FROM deliveries d
        WHERE d.worker_id = e.id AND d.status IN ('delivered', 'partially_delivered')
      ), 0) AS total_sales,
      COALESCE((
        SELECT SUM(d.wallet_deduction)
        FROM deliveries d
        WHERE d.worker_id = e.id AND d.status IN ('delivered', 'partially_delivered')
      ), 0) AS collected_payments
     FROM employees e
     ORDER BY e.id DESC`
  );
  return rows.map((r) => ({
    id: String(r.id),
    name: r.name,
    phone: r.phone,
    email: r.email || '',
    role: r.role,
    status: r.status,
    assignedArea: r.assigned_area || '',
    assignedRoute: r.assigned_route || '',
    joiningDate: new Date().toISOString().slice(0, 10),
    deliveriesCompleted: Number(r.deliveries_completed),
    failedDeliveries: Number(r.failed_deliveries),
    totalSales: Number(r.total_sales),
    collectedPayments: Number(r.collected_payments),
  }));
}

export async function createEmployee(payload) {
  const [result] = await pool.query(
    `INSERT INTO employees (name, phone, email, role, status, assigned_area)
     VALUES (:name, :phone, :email, :role, 'active', :assignedArea)`,
    {
      name: payload.name.trim(),
      phone: payload.phone.trim(),
      email: payload.email?.trim() || null,
      role: payload.role,
      assignedArea: payload.assignedArea?.trim() || null,
    }
  );
  const employeeId = Number(result.insertId);
  if (payload.assignedRoute && payload.assignedRoute.trim()) {
    const routeNames = payload.assignedRoute
      .split(',')
      .map((x) => x.trim())
      .filter(Boolean);
    if (routeNames.length > 0) {
      const [routeRows] = await pool.query(
        `SELECT id FROM routes WHERE name IN (${routeNames.map(() => '?').join(',')})`,
        routeNames
      );
      for (const row of routeRows) {
        await pool.query(
          `INSERT IGNORE INTO route_workers (route_id, worker_id) VALUES (:routeId, :workerId)`,
          { routeId: Number(row.id), workerId: employeeId }
        );
      }
    }
  }
  if (payload.loginPassword && payload.loginPassword.trim()) {
    await pool.query(
      `INSERT INTO users (name, email, phone, password_hash, role, status, employee_id)
       VALUES (:name, :email, :phone, :passwordHash, :role, 'active', :employeeId)`,
      {
        name: payload.name.trim(),
        email:
          payload.loginEmail?.trim().toLowerCase() ||
          payload.email?.trim().toLowerCase() ||
          `employee${employeeId}@local.tiktakwater`,
        phone: payload.loginPhone?.trim() || payload.phone.trim(),
        passwordHash: payload.loginPassword,
        role: payload.role,
        employeeId,
      }
    );
  }
  await createAuditLog({
    actor: payload.actor || 'Admin',
    action: 'Employee added',
    details: `${payload.name} (${payload.role})`,
  });
  return { id: String(employeeId) };
}

export async function updateEmployee(employeeId, payload) {
  const id = Number(employeeId);
  if (!id) {
    const err = new Error('Invalid employee id');
    err.status = 400;
    throw err;
  }
  const sets = [];
  const params = { id };
  if (payload.status !== undefined) {
    sets.push('status = :status');
    params.status = payload.status === 'inactive' ? 'inactive' : 'active';
  }
  if (payload.assignedArea !== undefined) {
    sets.push('assigned_area = :assignedArea');
    params.assignedArea = payload.assignedArea ? String(payload.assignedArea).trim() : null;
  }
  if (!sets.length) {
    const err = new Error('No fields to update');
    err.status = 400;
    throw err;
  }
  await pool.query(`UPDATE employees SET ${sets.join(', ')} WHERE id = :id`, params);
  await createAuditLog({
    actor: payload.actor || 'Admin',
    action: 'Employee updated',
    details: `Employee #${id} updated`,
  });
  const rows = await listEmployees();
  return rows.find((r) => Number(r.id) === id) || null;
}

export async function getReportsOverview({ from, to } = {}) {
  const hasRange = !!(from && to);
  const deliveryRangeClause = hasRange
    ? `delivery_date BETWEEN :from AND :to`
    : `DATE_FORMAT(delivery_date, '%Y-%m') = DATE_FORMAT(CURDATE(), '%Y-%m')`;
  const expenseRangeClause = hasRange
    ? `expense_date BETWEEN :from AND :to`
    : `DATE_FORMAT(expense_date, '%Y-%m') = DATE_FORMAT(CURDATE(), '%Y-%m')`;
  const rangeParams = hasRange ? { from, to } : {};

  const [monthlyRevenueRows] = await pool.query(
    `SELECT COALESCE(SUM(total_amount), 0) AS monthly_revenue
     FROM deliveries
     WHERE status IN ('delivered', 'partially_delivered')
       AND ${deliveryRangeClause}`,
    rangeParams
  );
  const [monthlyDeliveriesRows] = await pool.query(
    `SELECT COUNT(*) AS total_deliveries
     FROM deliveries
     WHERE ${deliveryRangeClause}`,
    rangeParams
  );
  const [duesRows] = await pool.query(
    `SELECT COALESCE(SUM(amount_due), 0) AS outstanding_dues
     FROM deliveries
     WHERE status IN ('delivered', 'partially_delivered', 'pending', 'assigned', 'in_progress')`
  );
  const [monthlyExpenseRows] = await pool.query(
    `SELECT COALESCE(SUM(amount), 0) AS monthly_expenses
     FROM expenses
     WHERE ${expenseRangeClause}`,
    rangeParams
  );
  const [paymentMethodRows] = await pool.query(
    `SELECT method, COALESCE(SUM(amount), 0) AS total
     FROM payments
     WHERE ${hasRange ? 'DATE(created_at) BETWEEN :from AND :to' : "DATE_FORMAT(created_at, '%Y-%m') = DATE_FORMAT(CURDATE(), '%Y-%m')"}
     GROUP BY method`,
    rangeParams
  );
  const paymentMap = Object.fromEntries(paymentMethodRows.map((row) => [row.method, Number(row.total)]));
  const monthlyRevenue = Number(monthlyRevenueRows[0].monthly_revenue);
  const monthlyExpenses = Number(monthlyExpenseRows[0].monthly_expenses);
  return {
    monthlyRevenue,
    totalDeliveries: Number(monthlyDeliveriesRows[0].total_deliveries),
    outstandingDues: Number(duesRows[0].outstanding_dues),
    netProfit: monthlyRevenue - monthlyExpenses,
    monthlyExpenses,
    paymentBreakdown: {
      cash: paymentMap.cash || 0,
      online: paymentMap.online || 0,
      card: paymentMap.card || 0,
    },
  };
}

export async function getReportsCharts({ from, to } = {}) {
  const hasRange = !!(from && to);
  const condition = hasRange
    ? `delivery_date BETWEEN :from AND :to`
    : `delivery_date >= DATE_SUB(CURDATE(), INTERVAL 13 DAY)`;
  const params = hasRange ? { from, to } : {};
  const [revenueRows] = await pool.query(
    `SELECT
       DATE_FORMAT(delivery_date, '%Y-%m-%d') AS day,
       COALESCE(SUM(CASE WHEN status IN ('delivered', 'partially_delivered') THEN total_amount ELSE 0 END), 0) AS revenue
     FROM deliveries
     WHERE ${condition}
     GROUP BY DATE_FORMAT(delivery_date, '%Y-%m-%d')
     ORDER BY day ASC`,
    params
  );
  const [volumeRows] = await pool.query(
    `SELECT
       DATE_FORMAT(delivery_date, '%Y-%m-%d') AS day,
       COUNT(*) AS total_deliveries
     FROM deliveries
     WHERE ${condition}
     GROUP BY DATE_FORMAT(delivery_date, '%Y-%m-%d')
     ORDER BY day ASC`,
    params
  );
  return {
    revenueTrend: revenueRows.map((r) => ({
      day: r.day,
      revenue: Number(r.revenue),
    })),
    deliveryVolume: volumeRows.map((r) => ({
      day: r.day,
      deliveries: Number(r.total_deliveries),
    })),
  };
}

/**
 * Admin home dashboard: KPIs for today + month, lists, inventory alert count.
 */
export async function getAdminDashboard() {
  const reports = await getReportsOverview();

  const [custAgg] = await pool.query(
    `SELECT
       COUNT(*) AS total_customers,
       SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) AS active_customers
     FROM customers`
  );
  const totalCustomers = Number(custAgg[0].total_customers || 0);
  const activeCustomers = Number(custAgg[0].active_customers || 0);

  const [walletSum] = await pool.query(
    `SELECT COALESCE(SUM(wallet_balance), 0) AS total_wallet
     FROM customers
     WHERE status = 'active'`
  );
  const totalWalletBalance = Number(walletSum[0].total_wallet || 0);

  const [lowStockRows] = await pool.query(
    `SELECT COUNT(*) AS c
     FROM inventory_items
     WHERE status = 'active' AND current_stock <= min_stock_level`
  );
  const lowStockItems = Number(lowStockRows[0].c || 0);

  const [todayDelRows] = await pool.query(
    `SELECT status, total_amount
     FROM deliveries
     WHERE delivery_date = CURDATE()`
  );
  const todayDeliveries = todayDelRows.length;
  const completedDeliveries = todayDelRows.filter((d) =>
    ['delivered', 'partially_delivered'].includes(d.status)
  ).length;
  const pendingDeliveries = todayDelRows.filter((d) =>
    ['pending', 'assigned'].includes(d.status)
  ).length;
  const inProgressDeliveries = todayDelRows.filter((d) => d.status === 'in_progress').length;
  const failedDeliveries = todayDelRows.filter((d) => d.status === 'failed').length;
  const todayRevenue = todayDelRows
    .filter((d) => ['delivered', 'partially_delivered'].includes(d.status))
    .reduce((sum, d) => sum + Number(d.total_amount || 0), 0);

  const [todayListRows] = await pool.query(
    `SELECT d.id, d.delivery_code, c.name AS customer_name, c.area, e.name AS worker_name,
            d.total_amount, d.status
     FROM deliveries d
     INNER JOIN customers c ON c.id = d.customer_id
     INNER JOIN employees e ON e.id = d.worker_id
     WHERE d.delivery_date = CURDATE()
     ORDER BY d.id DESC
     LIMIT 5`
  );
  const todayDeliveryList = todayListRows.map((r) => ({
    id: r.delivery_code || `D-${String(r.id).padStart(6, '0')}`,
    customerName: r.customer_name,
    area: r.area,
    workerName: r.worker_name,
    totalAmount: Number(r.total_amount),
    status: r.status,
  }));

  const [recentExpenseRows] = await pool.query(
    `SELECT id, category, description, amount, expense_date
     FROM expenses
     ORDER BY expense_date DESC, id DESC
     LIMIT 3`
  );
  const recentExpenses = recentExpenseRows.map((r) => ({
    id: `E-${String(r.id).padStart(6, '0')}`,
    category: r.category,
    description: r.description,
    amount: Number(r.amount),
    date: formatDate(r.expense_date),
  }));

  return {
    summary: {
      totalCustomers,
      activeCustomers,
      todayDeliveries,
      completedDeliveries,
      pendingDeliveries,
      inProgressDeliveries,
      failedDeliveries,
      todayRevenue,
      monthlyRevenue: reports.monthlyRevenue,
      outstandingDues: reports.outstandingDues,
      totalWalletBalance,
      lowStockItems,
    },
    todayDeliveries: todayDeliveryList,
    recentExpenses,
  };
}

export async function getDailyClosingSummary(targetDate) {
  const day = targetDate || new Date().toISOString().slice(0, 10);
  const [delRows] = await pool.query(
    `SELECT status, total_amount
     FROM deliveries
     WHERE delivery_date = :day`,
    { day }
  );
  const [expenseRows] = await pool.query(
    `SELECT COALESCE(SUM(amount), 0) AS total_expenses
     FROM expenses
     WHERE expense_date = :day`,
    { day }
  );
  const [closedRows] = await pool.query(
    `SELECT id, closing_date, closed_by, created_at
     FROM daily_closings
     WHERE closing_date = :day
     LIMIT 1`,
    { day }
  );
  const totalDeliveries = delRows.length;
  const completed = delRows.filter((d) => ['delivered', 'partially_delivered'].includes(d.status)).length;
  const failed = delRows.filter((d) => d.status === 'failed').length;
  const pending = delRows.filter((d) => ['pending', 'assigned', 'in_progress'].includes(d.status)).length;
  const revenue = delRows
    .filter((d) => ['delivered', 'partially_delivered'].includes(d.status))
    .reduce((s, d) => s + Number(d.total_amount), 0);
  const expenses = Number(expenseRows[0].total_expenses);
  return {
    date: day,
    totalDeliveries,
    completed,
    failed,
    pending,
    revenue,
    expenses,
    net: revenue - expenses,
    isClosed: !!closedRows.length,
    closedRecord: closedRows[0]
      ? {
          id: String(closedRows[0].id),
          closedBy: closedRows[0].closed_by,
          closedAt:
            closedRows[0].created_at instanceof Date
              ? closedRows[0].created_at.toISOString()
              : String(closedRows[0].created_at),
        }
      : null,
  };
}

export async function closeDay({ date, actor }) {
  const summary = await getDailyClosingSummary(date);
  if (summary.isClosed) {
    const err = new Error('This day is already closed');
    err.status = 409;
    throw err;
  }
  await pool.query(
    `INSERT INTO daily_closings (
      closing_date, total_deliveries, completed_deliveries, failed_deliveries, pending_deliveries,
      revenue, expenses, net_amount, closed_by
    ) VALUES (
      :closingDate, :totalDeliveries, :completed, :failed, :pending, :revenue, :expenses, :net, :closedBy
    )`,
    {
      closingDate: summary.date,
      totalDeliveries: summary.totalDeliveries,
      completed: summary.completed,
      failed: summary.failed,
      pending: summary.pending,
      revenue: summary.revenue,
      expenses: summary.expenses,
      net: summary.net,
      closedBy: actor || 'Admin',
    }
  );
  await createAuditLog({
    actor: actor || 'Admin',
    action: 'Day closed',
    details: `Closed ${summary.date} with net Rs ${summary.net}`,
  });
  return getDailyClosingSummary(summary.date);
}

export async function listAuditLogs(limit = 100) {
  const safeLimit = Math.min(500, Math.max(1, Number(limit) || 100));
  const [rows] = await pool.query(
    `SELECT id, actor, action, details, created_at
     FROM audit_logs
     ORDER BY created_at DESC, id DESC
     LIMIT ${safeLimit}`
  );
  return rows.map((r) => ({
    id: String(r.id),
    timestamp:
      r.created_at instanceof Date
        ? r.created_at.toISOString().replace('T', ' ').slice(0, 16)
        : String(r.created_at).replace('T', ' ').slice(0, 16),
    user: r.actor,
    action: r.action,
    details: r.details || '',
  }));
}

export async function getWorkerDashboard(workerId) {
  const [rows] = await pool.query(
    `SELECT
      d.id,
      d.delivery_code,
      d.customer_id,
      c.name AS customer_name,
      c.address AS customer_address,
      d.status,
      d.total_amount,
      d.delivery_date,
      d.period_start_date,
      d.period_end_date,
      d.advance_amount,
      di.quantity,
      p.name AS product_name
     FROM deliveries d
     INNER JOIN customers c ON c.id = d.customer_id
     LEFT JOIN delivery_items di ON di.delivery_id = d.id
     LEFT JOIN products p ON p.id = di.product_id
     WHERE d.worker_id = :workerId
     ORDER BY d.delivery_date DESC, d.id DESC, di.id ASC`,
    { workerId: Number(workerId) }
  );
  const map = new Map();
  for (const row of rows) {
    if (!map.has(row.id)) {
      map.set(row.id, {
        id: row.delivery_code || `D-${String(row.id).padStart(6, '0')}`,
        customerId: String(row.customer_id),
        customerName: row.customer_name,
        customerAddress: row.customer_address,
        status: row.status,
        totalAmount: Number(row.total_amount),
        deliveryDate: formatDate(row.delivery_date),
        periodStartDate: formatDate(row.period_start_date),
        periodEndDate: formatDate(row.period_end_date),
        advanceAmount: Number(row.advance_amount || 0),
        items: [],
      });
    }
    if (row.product_name) {
      map.get(row.id).items.push({
        quantity: Number(row.quantity),
        productName: row.product_name,
      });
    }
  }
  const deliveries = Array.from(map.values());
  return {
    deliveries,
    completed: deliveries.filter((d) => d.status === 'delivered').length,
    pending: deliveries.filter((d) => ['pending', 'assigned', 'in_progress'].includes(d.status)).length,
    failed: deliveries.filter((d) => d.status === 'failed').length,
  };
}

export async function getClientDashboard(customerId) {
  const [customerRows] = await pool.query(
    `SELECT id, customer_id, name, phone, address, area, route, customer_type, wallet_balance
     FROM customers
     WHERE id = :customerId
     LIMIT 1`,
    { customerId: Number(customerId) }
  );
  if (!customerRows.length) {
    const err = new Error('Customer not found');
    err.status = 404;
    throw err;
  }
  const c = customerRows[0];
  const [deliveryRows] = await pool.query(
    `SELECT
      d.id, d.delivery_code, d.status, d.total_amount, d.delivery_date, d.delivery_time,
      di.quantity, di.total, di.unit_price, p.name AS product_name
     FROM deliveries d
     LEFT JOIN delivery_items di ON di.delivery_id = d.id
     LEFT JOIN products p ON p.id = di.product_id
     WHERE d.customer_id = :customerId
     ORDER BY d.delivery_date DESC, d.id DESC, di.id ASC`,
    { customerId: Number(customerId) }
  );
  const [walletRows] = await pool.query(
    `SELECT id, type, amount, description, created_at
     FROM wallet_transactions
     WHERE customer_id = :customerId
     ORDER BY created_at DESC, id DESC
     LIMIT 50`,
    { customerId: Number(customerId) }
  );
  const map = new Map();
  for (const row of deliveryRows) {
    if (!map.has(row.id)) {
      map.set(row.id, {
        id: row.delivery_code || `D-${String(row.id).padStart(6, '0')}`,
        status: row.status,
        totalAmount: Number(row.total_amount),
        deliveryDate: formatDate(row.delivery_date),
        deliveryTime: row.delivery_time ? String(row.delivery_time).slice(0, 5) : undefined,
        items: [],
      });
    }
    if (row.product_name) {
      map.get(row.id).items.push({
        quantity: Number(row.quantity),
        productName: row.product_name,
        total: Number(row.total),
        unitPrice: Number(row.unit_price),
      });
    }
  }
  return {
    customer: {
      id: String(c.id),
      customerId: c.customer_id,
      name: c.name,
      phone: c.phone,
      address: c.address,
      area: c.area,
      route: c.route,
      customerType: c.customer_type,
      walletBalance: Number(c.wallet_balance),
    },
    deliveries: Array.from(map.values()),
    transactions: walletRows.map((w) => ({
      id: `WT-${w.id}`,
      type: w.type,
      amount: Number(w.amount),
      description: w.description,
      createdAt: w.created_at instanceof Date ? w.created_at.toISOString() : String(w.created_at),
    })),
  };
}
