// A stand-in for the two CDNs (cdn.jsdelivr.net, cdnjs.cloudflare.com) that a browser reaches
// over real HTTPS requests, for the one test that needs the service worker to fetch from them.
//
// Why not the usual route stubs (helpers/browser.js)? Playwright cannot answer requests a service
// worker makes itself, and the worker's requests are also subject to the app's content security
// policy, which a stub would bypass. Here Chromium resolves the CDN host names to a local HTTPS
// server instead, so the worker, its cache and the policy all behave as they do in production.
//
// The server's certificate is self-signed and made on the spot with the `openssl` command (the
// same tool install.sh needs); the browser is started with certificate errors ignored.
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const https = require('node:https');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require('playwright');

const BOOTSTRAP_DIST = path.join(__dirname, '..', '..', 'node_modules', 'bootstrap', 'dist');
const HOSTS = ['cdn.jsdelivr.net', 'cdnjs.cloudflare.com'];

function selfSignedCertificate() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cattle-e2e-cdn-'));
  const key = path.join(dir, 'key.pem');
  const cert = path.join(dir, 'cert.pem');
  try {
    execFileSync('openssl', [
      'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '2', '-keyout', key, '-out', cert,
      '-subj', `/CN=${HOSTS[0]}`, '-addext', `subjectAltName=${HOSTS.map((h) => `DNS:${h}`).join(',')}`,
    ], { stdio: 'pipe' });
    return { key: fs.readFileSync(key), cert: fs.readFileSync(cert) };
  } catch (err) {
    throw new Error(`The offline browser test needs the openssl command to make a test certificate: ${err.message}`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// Starts the stand-in. Resolves to { port, requests, close() }; `requests` lists every URL asked for.
async function startCdn() {
  const requests = [];
  const server = https.createServer(selfSignedCertificate(), (req, res) => {
    requests.push(req.url);
    res.setHeader('access-control-allow-origin', '*');
    const match = /^\/npm\/bootstrap@[^/]+\/dist\/(css|js)\/([\w.-]+)$/.exec(req.url);
    const file = match && path.join(BOOTSTRAP_DIST, match[1], match[2]);
    if (file && fs.existsSync(file)) {
      res.setHeader('content-type', match[1] === 'css' ? 'text/css' : 'application/javascript');
      return res.end(fs.readFileSync(file));
    }
    // Font Awesome: an empty stylesheet (icons are decoration only).
    res.setHeader('content-type', req.url.endsWith('.js') ? 'application/javascript' : 'text/css');
    return res.end('');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    port: server.address().port,
    requests,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

// Launches Chromium so that the CDN host names lead to the stand-in on `port`. Proxy settings
// from the environment are dropped: every address the test uses is on this machine.
function launchWithCdn(port) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !/^(https?|all)_proxy$/i.test(name)));
  return chromium.launch({
    env,
    args: [
      `--host-resolver-rules=${HOSTS.map((h) => `MAP ${h} 127.0.0.1:${port}`).join(', ')}`,
      '--ignore-certificate-errors',
    ],
  });
}

module.exports = { startCdn, launchWithCdn };
