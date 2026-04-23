import pool from '../config/database.js';

function mapRouteRows(rows) {
  const map = new Map();
  for (const row of rows) {
    if (!map.has(row.id)) {
      map.set(row.id, {
        id: String(row.id),
        name: row.name,
        area: row.area,
        customerCount: Number(row.customer_count || 0),
        assignedWorkers: [],
        workerNames: [],
      });
    }
    if (row.worker_id) {
      map.get(row.id).assignedWorkers.push(String(row.worker_id));
      map.get(row.id).workerNames.push(row.worker_name);
    }
  }
  return Array.from(map.values());
}

export async function listRoutes() {
  const [rows] = await pool.query(
    `SELECT
      r.id,
      r.name,
      r.area,
      (
        SELECT COUNT(*)
        FROM customers c
        WHERE c.route = r.name AND c.status = 'active'
      ) AS customer_count,
      rw.worker_id,
      e.name AS worker_name
    FROM routes r
    LEFT JOIN route_workers rw ON rw.route_id = r.id
    LEFT JOIN employees e ON e.id = rw.worker_id
    WHERE r.status = 'active'
    ORDER BY r.name ASC`
  );
  return mapRouteRows(rows);
}

export async function createRoute(payload) {
  const workerIds = (payload.workerIds || [])
    .map((w) => Number(w))
    .filter((n) => Number.isInteger(n) && n > 0);

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [result] = await conn.query(
      `INSERT INTO routes (name, area, status)
       VALUES (:name, :area, 'active')`,
      {
        name: payload.name.trim(),
        area: payload.area.trim(),
      }
    );
    const routeId = Number(result.insertId);

    if (workerIds.length > 0) {
      const [workerRows] = await conn.query(
        `SELECT id FROM employees
         WHERE role = 'field_worker' AND status = 'active' AND id IN (${workerIds.map(() => '?').join(',')})`,
        workerIds
      );
      const validIds = workerRows.map((w) => Number(w.id));
      for (const workerId of validIds) {
        await conn.query(
          `INSERT INTO route_workers (route_id, worker_id) VALUES (:routeId, :workerId)`,
          { routeId, workerId }
        );
      }
    }

    await conn.commit();
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }

  const all = await listRoutes();
  return all.find((r) => r.name === payload.name.trim()) || null;
}

export async function getActiveWorkers() {
  const [rows] = await pool.query(
    `SELECT id, name
     FROM employees
     WHERE role = 'field_worker' AND status = 'active'
     ORDER BY name ASC`
  );
  return rows.map((r) => ({ id: String(r.id), name: r.name }));
}

export async function getRouteAreaLookups() {
  const [rows] = await pool.query(
    `SELECT id, name, area
     FROM routes
     WHERE status = 'active'
     ORDER BY area ASC, name ASC`
  );
  const areas = Array.from(new Set(rows.map((r) => r.area).filter(Boolean)));
  return {
    areas,
    routes: rows.map((r) => ({
      id: String(r.id),
      name: r.name,
      area: r.area,
    })),
  };
}
