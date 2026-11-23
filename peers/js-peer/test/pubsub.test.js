import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { test } from 'node:test';
import { setTimeout as sleep } from 'node:timers/promises';

import { register } from '@prometheus-io/client';

import { loadConfig } from '../src/config.js';
import { EVENT_RECEIVED } from '../src/constants.js';
import { createP2PServer } from '../src/p2p/index.js';
import { nowMicros } from '../src/utils/clock.js';
import { encodeMessage } from '../src/utils/message.js';

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
 * Returns a logger with the pino methods that records the received events.
 *
 * @returns {{ logger: object, received: object[] }} the logger and the fields of each received event
 */
function receivedLogger() {
  const received = [];
  const record = (fields, event) => event === EVENT_RECEIVED && received.push(fields);
  const logger = { debug: record, info: record, warn: record, error: record };

  return { logger, received };
}

/**
 * Publishes one message of 1 KiB from server.
 *
 * @param {import('../src/p2p/index.js').P2PServer} server - the publisher
 * @param {string} runId - run of the message
 * @param {number} seq - sequence number
 */
async function publish(server, runId, seq) {
  await server.publish(encodeMessage({ run_id: runId, publisher: 'js-0', seq, ts_us: nowMicros() }, 1024));
}

test('three JS peers: a run from js-0 reaches js-1 and js-2 once per message', async () => {
  const messages = 50;
  const ports = [await freePort(), await freePort(), await freePort()];
  const peers = ports.map((port, i) => `js-${i}=/ip4/127.0.0.1/tcp/${port}`).join(',');
  const logs = [receivedLogger(), receivedLogger(), receivedLogger()];
  const servers = [];

  for (const [i, port] of ports.entries()) {
    const config = loadConfig({ PEER_NAME: `js-${i}`, P2P_PORT: String(port), PEERS: peers, REDIAL_INTERVAL: '100ms' });
    servers.push(await createP2PServer(config, logs[i].logger));
  }

  try {
    await Promise.all(servers.map((server) => server.start()));

    // As in the Go test: publish warm-up messages until each receiver has one,
    // because GossipSub loses the messages to a peer that has only just joined.
    const deadline = Date.now() + 10_000;
    for (let seq = 1; !logs.slice(1).every((log) => log.received.some((f) => f.run_id === 'warmup')); seq++) {
      assert.ok(Date.now() < deadline, 'the network did not deliver a warm-up message within 10 s');
      await publish(servers[0], 'warmup', seq);
      await sleep(50);
    }

    for (let seq = 1; seq <= messages; seq++) {
      await publish(servers[0], 'test', seq);
      await sleep(20);
    }

    await sleep(500);

    for (const i of [1, 2]) {
      const seqs = logs[i].received.filter((f) => f.run_id === 'test').map((f) => f.seq);
      assert.equal(new Set(seqs).size, messages, `js-${i} received ${new Set(seqs).size} of ${messages}`);
      assert.equal(seqs.length, messages, `js-${i} logged a message more than once`);
      assert.ok(
        logs[i].received.every((f) => f.publisher === 'js-0' && f.latency_us >= 0),
        'publisher or latency',
      );
    }

    assert.equal(logs[0].received.length, 0, 'js-0 logged its own messages as received');

    // The metrics count the same deliveries: 2 receivers × 50 messages, no negative latency.
    const metrics = await register.getMetricsAsJSON();
    const series = (name, suffix = '') =>
      metrics
        .find((m) => m.name === name)
        ?.values.filter((v) => v.labels.run_id === 'test' && (v.metricName ?? name).endsWith(suffix)) ?? [];
    assert.equal(
      series('gs_messages_received_total').reduce((sum, v) => sum + v.value, 0),
      2 * messages,
    );
    assert.equal(
      series('gs_delivery_latency_seconds', '_count').reduce((sum, v) => sum + v.value, 0),
      2 * messages,
    );
    assert.equal(
      series('gs_latency_negative_total').reduce((sum, v) => sum + v.value, 0),
      0,
    );
  } finally {
    await Promise.allSettled(servers.map((server) => server.stop()));
  }
});
