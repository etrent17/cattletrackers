require('dotenv').config({ quiet: true });

if (!process.env.DATABASE_URL || !process.env.SESSION_SECRET) {
  console.error(
    'DATABASE_URL and SESSION_SECRET must be set.\n' +
      'Cattle Trackers needs a PostgreSQL database. To run the Docker image, use deploy/start.sh\n' +
      '(or deploy/docker-compose.dev.yml), which starts PostgreSQL alongside the app.\n' +
      'See docs/deployment.md.'
  );
  process.exit(1);
}

const { pool, initSchema, cleanupDemoUsers } = require('./db');
const app = require('./app');
const { listenOnFreePort } = require('./lib/listen');

const PREFERRED_PORT = Number(process.env.PORT) || 3000;

initSchema()
  .then(() => listenOnFreePort(app, PREFERRED_PORT))
  .then((server) => {
    const { port } = server.address();
    if (port !== PREFERRED_PORT) console.log(`Port ${PREFERRED_PORT} is in use; using port ${port} instead.`);
    console.log(`Server running on port ${port}`);
    cleanupDemoUsers().catch(console.error);
    setInterval(() => cleanupDemoUsers().catch(console.error), 15 * 60 * 1000).unref();
    const shutdown = () => server.close(() => pool.end().then(() => process.exit(0)));
    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);
  })
  .catch((err) => {
    console.error('Startup failed:', err.message || err);
    process.exit(1);
  });
