const { test } = require('node:test');
const assert = require('node:assert/strict');
const net = require('node:net');
const express = require('express');
const { listenOnFreePort } = require('../../lib/listen');

// Occupies a free port and returns { port, close }.
function occupy(port = 0) {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once('error', reject);
    s.listen(port, '127.0.0.1', () => resolve({ port: s.address().port, close: () => new Promise((r) => s.close(r)) }));
  });
}

test('uses the preferred port when it is free', async () => {
  const probe = await occupy();
  const port = probe.port;
  await probe.close();
  const server = await listenOnFreePort(express(), port, { host: '127.0.0.1' });
  try {
    assert.equal(server.address().port, port);
  } finally {
    await new Promise((r) => server.close(r));
  }
});

test('moves to the next free port when the preferred one is taken', async () => {
  const busy = await occupy();
  try {
    const server = await listenOnFreePort(express(), busy.port, { host: '127.0.0.1' });
    try {
      assert.ok(server.address().port > busy.port, `expected a port above ${busy.port}, got ${server.address().port}`);
    } finally {
      await new Promise((r) => server.close(r));
    }
  } finally {
    await busy.close();
  }
});

test('gives up with a clear error after maxTries taken ports', async () => {
  const busy = await occupy();
  try {
    await assert.rejects(
      listenOnFreePort(express(), busy.port, { host: '127.0.0.1', maxTries: 1 }),
      /No free port found/
    );
  } finally {
    await busy.close();
  }
});

test('rejects an invalid port', async () => {
  await assert.rejects(listenOnFreePort(express(), 'abc'), /Invalid port/);
  await assert.rejects(listenOnFreePort(express(), 70000), /Invalid port/);
});
