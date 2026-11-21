require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const morgan = require('morgan');
const session = require('express-session');
const pgSession = require('connect-pg-simple')(session);
const { pool, initSchema, cleanupDemoUsers  } = require('./db');

if (!process.env.DATABASE_URL || !process.env.SESSION_SECRET) {
  console.error('DATABASE_URL and SESSION_SECRET must be set');
  process.exit(1);
}

const app = express();
app.set('trust proxy', 1);
const PORT = process.env.PORT || 3000;

app.use(
  helmet({
    // Strict-Transport-Security: enable with HSTS=true only once the site is served over HTTPS
    hsts: process.env.HSTS === 'true'
      ? { maxAge: Number(process.env.HSTS_MAX_AGE) || 31536000, includeSubDomains: false }
      : false,
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", 'https://cdn.jsdelivr.net'],
        styleSrc: ["'self'", "'unsafe-inline'", 'https://cdn.jsdelivr.net', 'https://cdnjs.cloudflare.com'],
        fontSrc: ["'self'", 'https://cdnjs.cloudflare.com'],
        imgSrc: ["'self'", 'data:'],
        upgradeInsecureRequests: null,
      },
    },
  })
);
app.use(express.json());
app.use(morgan('dev'));

// Registered before the session middleware so it never touches the session store.
// Returns 503 when PostgreSQL cannot answer within HEALTH_TIMEOUT_MS.
const HEALTH_TIMEOUT_MS = 3000;
app.get('/api/health', async (req, res) => {
  let timer;
  try {
    await Promise.race([
      pool.query('SELECT 1'),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('database health check timed out')), HEALTH_TIMEOUT_MS);
      }),
    ]);
    res.json({ status: 'healthy', database: 'up' });
  } catch (err) {
    console.error('Health check failed:', err.message);
    res.status(503).json({ status: 'unhealthy', database: 'down' });
  } finally {
    clearTimeout(timer);
  }
});

app.use(
  session({
    store: new pgSession({ pool, tableName: 'session', createTableIfMissing: true }),
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.COOKIE_SECURE === 'true',
      maxAge: 7 * 24 * 60 * 60 * 1000,
    },
  })
);

app.use(express.static('public'));
app.use('/src', express.static('src'));

app.use('/api/auth', require('./routes/auth'));
app.use('/api/users', require('./routes/users'));
app.use('/api/cattle', require('./routes/cattle'));

app.use((err, req, res, next) => {
  if (err.code === '23505') {
    const msg = err.constraint === 'users_email_key' ? 'That email is already registered' : 'Duplicate cow number';
    return res.status(409).json({ error: msg });
  }
  console.error(err);
  if (err.code === '23503') return res.status(401).json({ error: 'Session expired' });
  res.status(500).json({ error: 'Internal server error' });
});

initSchema()
  .then(() => {
    cleanupDemoUsers().catch(console.error);
    setInterval(() => cleanupDemoUsers().catch(console.error), 15 * 60 * 1000).unref();
    const server = app.listen(PORT, '0.0.0.0', () => console.log(`Server running on port ${PORT}`));
    const shutdown = () => server.close(() => pool.end().then(() => process.exit(0)));
    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);
  })
  .catch((err) => {
    console.error('Database initialization failed:', err);
    process.exit(1);
  });