// Starts the HTTP server on the preferred port, or the next free one above it.
// If the preferred port is taken (another app, a second copy of this one), it
// tries preferred + 1, + 2, ... up to `maxTries` ports and logs which one it used,
// instead of crashing with EADDRINUSE.

function listenOnFreePort(app, preferredPort, { host = '0.0.0.0', maxTries = 100 } = {}) {
  const first = Number(preferredPort);
  if (!Number.isInteger(first) || first < 0 || first > 65535) {
    return Promise.reject(new Error(`Invalid port: ${preferredPort}`));
  }
  return new Promise((resolve, reject) => {
    const attempt = (port, triesLeft) => {
      const server = app.listen(port, host);
      server.once('listening', () => {
        server.removeAllListeners('error');
        resolve(server);
      });
      server.once('error', (err) => {
        server.close();
        if (err.code === 'EADDRINUSE' && triesLeft > 1 && port !== 0 && port < 65535) {
          attempt(port + 1, triesLeft - 1);
        } else if (err.code === 'EADDRINUSE') {
          reject(new Error(`No free port found from ${first} to ${port}`));
        } else {
          reject(err);
        }
      });
    };
    attempt(first, maxTries);
  });
}

module.exports = { listenOnFreePort };
