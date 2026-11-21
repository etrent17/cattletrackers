require('dotenv').config();

if (!process.env.DATABASE_URL || !process.env.SESSION_SECRET) {
  console.error('DATABASE_URL and SESSION_SECRET must be set');
  process.exit(1);
}

const { pool, initSchema, cleanupDemoUsers } = require('./db');
const app = require('./app');

const PORT = process.env.PORT || 3000;

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
