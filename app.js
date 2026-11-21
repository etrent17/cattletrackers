// Builds the Express app without listening, so tests can import it (see test/helpers).
// server.js is the entry point that prepares the database and starts listening.
const path = require('path');
const express = require('express');
const helmet = require('helmet');
const morgan = require('morgan');
const session = require('express-session');
const pgSession = require('connect-pg-simple')(session);
const { pool } = require('./db');

const app = express();
app.set('trust proxy', 1);

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
        // The service worker fetches the CDN files itself to keep them for offline use; a worker's
        // fetch() is checked against connect-src whatever the file is (feature 14).
        connectSrc: ["'self'", 'https://cdn.jsdelivr.net', 'https://cdnjs.cloudflare.com'],
        upgradeInsecureRequests: null,
      },
    },
  })
);
app.use(express.json());
if (process.env.NODE_ENV !== 'test') app.use(morgan('dev'));

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

app.use(express.static(path.join(__dirname, 'public')));
app.use('/src', express.static(path.join(__dirname, 'src')));

app.use('/api/auth', require('./routes/auth'));
app.use('/api/users', require('./routes/users'));
// Event records: the nested router goes before /api/cattle so it sees /api/cattle/:cattleId/<records> first.
const calvings = require('./routes/calvings');
app.use('/api/cattle/:cattleId/calvings', calvings.forCattle);
app.use('/api/calvings', calvings.router);
const treatments = require('./routes/treatments');
app.use('/api/cattle/:cattleId/treatments', treatments.forCattle);
app.use('/api/treatments', treatments.router);
const breedings = require('./routes/breedings');
const pregnancyChecks = require('./routes/pregnancy-checks');
app.use('/api/cattle/:cattleId/breedings', breedings.forCattle);
app.use('/api/breedings', breedings.router);
app.use('/api/cattle/:cattleId/pregnancy-checks', pregnancyChecks.forCattle);
app.use('/api/pregnancy-checks', pregnancyChecks.router);
const weighings = require('./routes/weighings');
app.use('/api/cattle/:cattleId/weighings', weighings.forCattle);
app.use('/api/weighings', weighings.router);
app.use('/api/cattle', require('./routes/cattle'));
app.use('/api/transactions', require('./routes/transactions'));

app.use((err, req, res, next) => {
  // Body the JSON parser could not read (malformed JSON, too large): a client error, not a server error
  if (err.type && err.status >= 400 && err.status < 500) {
    return res.status(err.status).json({ error: err.status === 413 ? 'Request too large' : 'Invalid request body' });
  }
  // Thrown on purpose by a route (lib/records.js httpError), usually to roll back a transaction
  if (err.httpStatus) return res.status(err.httpStatus).json({ error: err.message });
  if (err.code === '23505') {
    const msg = err.constraint === 'users_email_key' ? 'That email is already registered' : 'Duplicate cow number';
    return res.status(409).json({ error: msg });
  }
  console.error(err);
  if (err.code === '23503') return res.status(401).json({ error: 'Session expired' });
  res.status(500).json({ error: 'Internal server error' });
});

module.exports = app;
