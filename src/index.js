import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import customersRouter, { publicCustomerRouter } from './routes/customers.routes.js';
import deliveriesRouter from './routes/deliveries.routes.js';
import lookupsRouter from './routes/lookups.routes.js';
import productsRouter from './routes/products.routes.js';
import routesRouter from './routes/routes.routes.js';
import inventoryRouter from './routes/inventory.routes.js';
import billingRouter from './routes/billing.routes.js';
import paymentsRouter from './routes/payments.routes.js';
import walletsRouter from './routes/wallets.routes.js';
import expensesRouter from './routes/expenses.routes.js';
import employeesRouter from './routes/employees.routes.js';
import reportsRouter from './routes/reports.routes.js';
import dailyClosingRouter from './routes/daily-closing.routes.js';
import auditLogsRouter from './routes/audit-logs.routes.js';
import dashboardsRouter from './routes/dashboards.routes.js';
import authRouter from './routes/auth.routes.js';
import settingsRouter from './routes/settings.routes.js';
import returnsDamagesRouter from './routes/returns-damages.routes.js';

dotenv.config();

const app = express();
const PORT = Number(process.env.PORT) || 3001;
const allowedOrigins = (process.env.CORS_ORIGINS || '')
  .split(',')
  .map((origin) => origin.trim().replace(/\/+$/, ''))
  .filter(Boolean);

app.use(
  cors({
    origin(origin, callback) {
      const normalizedOrigin = origin ? origin.replace(/\/+$/, '') : origin;
      if (!normalizedOrigin) return callback(null, true);
      if (allowedOrigins.length === 0 || allowedOrigins.includes(normalizedOrigin)) {
        return callback(null, true);
      }
      return callback(new Error('CORS origin not allowed'));
    },
    credentials: true,
  })
);
app.use(express.json({ limit: '1mb' }));

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, service: 'tiktakwater-api', time: new Date().toISOString() });
});

app.use('/api/customers', customersRouter);
app.use('/api/deliveries', deliveriesRouter);
app.use('/api/lookups', lookupsRouter);
app.use('/api/products', productsRouter);
app.use('/api/routes', routesRouter);
app.use('/api/inventory', inventoryRouter);
app.use('/api/billing', billingRouter);
app.use('/api/payments', paymentsRouter);
app.use('/api/wallets', walletsRouter);
app.use('/api/expenses', expensesRouter);
app.use('/api/employees', employeesRouter);
app.use('/api/reports', reportsRouter);
app.use('/api/daily-closing', dailyClosingRouter);
app.use('/api/audit-logs', auditLogsRouter);
app.use('/api/dashboards', dashboardsRouter);
app.use('/api/auth', authRouter);
app.use('/api/settings', settingsRouter);
app.use('/api/returns-damages', returnsDamagesRouter);
app.use('/api/public/customer', publicCustomerRouter);

app.use((err, _req, res, _next) => {
  console.error(err);
  const status = err.status || 500;
  const message = err.message || 'Internal server error';
  res.status(status).json({ error: message });
});

app.listen(PORT, () => {
  console.log(`API listening on http://127.0.0.1:${PORT}`);
});
