import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { test } from 'node:test';
import { setTimeout as sleep } from 'node:timers/promises';

import { loadConfig } from '../src/config.js';
import { EVENT_PEER_CONNECTED, EVENT_PEER_DISCONNECTED } from '../src/constants.js';
import { createP2PServer } from '../src/p2p/index.js';
import { peerId } from '../src/p2p/identity.js';

/**
 * Returns a TCP port that is free at the time of the call.
 *
 * @returns {Promise<number>} the port
 */
async function freePort() {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  await new Promise((resolve) => server.close(resolve));

  return port;
}

/**
 * Returns a logger with the pino methods that records the events as [event, fields].
 *
 * @returns {{ logger: object, events: Array<[string, object]> }} the logger and its records
 */
function recordingLogger() {
  const events = [];
  const record = (fields, event) => events.push([event, fields]);
  const logger = { debug: record, info: record, warn: record, error: record };

  return { logger, events };
}

/**
 * Polls cond every 20 ms for up to 5 s.
 *
 * @param {string} what - what the test waits for
 * @param {() => boolean} cond - the condition
 */
async function waitFor(what, cond) {
  const deadline = Date.now() + 5000;

  while (!cond()) {
    assert.ok(Date.now() < deadline, `timeout: ${what}`);
    await sleep(20);
  }
}

test('two JS peers connect, list each other and log one event per peer', async () => {
  const ports = [await freePort(), await freePort()];
  const peers = `js-0=/ip4/127.0.0.1/tcp/${ports[0]},js-1=/ip4/127.0.0.1/tcp/${ports[1]}`;
  const logs = [recordingLogger(), recordingLogger()];
  const servers = [];

  for (const [i, name] of ['js-0', 'js-1'].entries()) {
    const config = loadConfig({ PEER_NAME: name, P2P_PORT: String(ports[i]), PEERS: peers, REDIAL_INTERVAL: '100ms' });
    servers.push(await createP2PServer(config, logs[i].logger));
  }

  try {
    await Promise.all(servers.map((server) => server.start()));

    /** @param {number} i @param {string} event @param {string} remote */
    const count = (i, event, remote) => logs[i].events.filter(([e, f]) => e === event && f.remote === remote).length;

    await waitFor(
      'both peers log peer_connected',
      () => count(0, EVENT_PEER_CONNECTED, 'js-1') >= 1 && count(1, EVENT_PEER_CONNECTED, 'js-0') >= 1,
    );

    // Let further redial rounds happen; they must not log again.
    await sleep(400);
    assert.equal(count(0, EVENT_PEER_CONNECTED, 'js-1'), 1);
    assert.equal(count(1, EVENT_PEER_CONNECTED, 'js-0'), 1);

    const listed = servers[0].connectedPeers();
    assert.equal(listed.length, 1);
    assert.equal(listed[0].name, 'js-1');
    const js1 = (await peerId('gossipsub-testbed', 'js-1')).toString();
    assert.deepEqual(Object.keys(listed[0]).sort(), ['addrs', 'name'], 'no separate peer ID field');
    assert.ok(listed[0].addrs.length >= 1);
    assert.ok(
      listed[0].addrs.every((addr) => addr.endsWith(`/p2p/${js1}`)),
      `addresses with /p2p/<peer ID>: ${listed[0].addrs}`,
    );

    await servers[1].stop();
    await waitFor('js-0 logs peer_disconnected', () => count(0, EVENT_PEER_DISCONNECTED, 'js-1') >= 1);
    assert.equal(count(0, EVENT_PEER_DISCONNECTED, 'js-1'), 1);
    assert.equal(servers[0].connectedPeers().length, 0);
  } finally {
    await Promise.allSettled(servers.map((server) => server.stop()));
  }
});

test('the started event names the peer, the versions and the settings', async () => {
  const { logger, events } = recordingLogger();
  const config = loadConfig({ PEER_NAME: 'js-0', P2P_PORT: String(await freePort()) });
  const server = await createP2PServer(config, logger);

  try {
    await server.start();

    const [, fields] = events.find(([event]) => event === 'started');
    assert.equal(fields.libp2p_version, '3.5.1');
    assert.equal(fields.pubsub_version, '17.2.1');
    assert.equal(fields.yamux_keepalive, '30s');
    assert.equal(fields.redial_interval, '5s');
    assert.ok(fields.addrs.every((addr) => !addr.includes('/p2p/')));
    assert.deepEqual(
      [fields.mesh_d, fields.mesh_dlo, fields.mesh_dhi, fields.mesh_dlazy, fields.mesh_dout],
      [3, 3, 4, 3, 0],
      'the mesh parameters of the Go peer',
    );
  } finally {
    await server.stop();
  }
});
