import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { setTimeout as sleep } from 'node:timers/promises';

import { EVENT_HTTP_REQUEST } from '../src/constants.js';
import { createHttpServer } from '../src/http/index.js';
import { decodeMessage } from '../src/utils/message.js';

/** A fake p2p node: records the published messages and lists two peers. */
const node = {
  published: [],
  async publish(data) {
    this.published.push(decodeMessage(data));
  },
  connectedPeers() {
    return [
      {
        name: 'go-0',
        peer_id: '12D3KooWHZAu1VmTeA2Zh2CFgBUUoFaYKYp9yppWygjjSPEaA3Mu',
        addrs: ['/ip4/127.0.0.1/tcp/4001'],
      },
    ];
  },
};

/** Events logged by the API, as [event, fields]. */
const events = [];
const record = (fields, event) => events.push([event, fields]);
const logger = { debug: record, info: record, warn: record, error: record };

const server = createHttpServer({ node, peerName: 'js-0', port: 0, logger });
let base;

before(async () => {
  await server.start();
  base = `http://127.0.0.1:${server.port}`;
});

after(() => server.stop());

/**
 * Sends a request and returns the status and the JSON body.
 *
 * @param {string} method - HTTP method
 * @param {string} path - path
 * @param {string} [body] - raw request body
 * @returns {Promise<{ status: number, body: any }>} the response
 */
async function call(method, path, body) {
  const res = await fetch(base + path, { method, body, headers: body ? { 'content-type': 'application/json' } : {} });
  const text = await res.text();

  return { status: res.status, body: text.startsWith('{') ? JSON.parse(text) : text };
}

/**
 * Starts a run with the given body.
 *
 * @param {object} params - the start request
 * @returns {Promise<{ status: number, body: any }>} the response
 */
const start = (params) => call('POST', '/publish/start', JSON.stringify(params));

test('GET /healthz and GET /connections', async () => {
  assert.deepEqual(await call('GET', '/healthz'), {
    status: 200,
    body: { status: 'success', message: 'Peer is up and running!' },
  });

  const { status, body } = await call('GET', '/connections');
  assert.equal(status, 200);
  assert.equal(body.data.count, 1);
  assert.equal(body.data.peers[0].name, 'go-0');
});

test('unknown paths and methods get 404 and 405 in the JSON body', async () => {
  const notFound = await call('GET', '/nope');
  assert.equal(notFound.status, 404);
  assert.deepEqual(notFound.body.error, { code: 'NOT_FOUND', message: 'path not found' });

  for (const [method, path] of [
    ['DELETE', '/healthz'],
    ['GET', '/publish/start'],
    ['POST', '/publish/status'],
  ]) {
    const res = await call(method, path);
    assert.equal(res.status, 405, `${method} ${path}`);
    assert.equal(res.body.error.code, 'METHOD_NOT_ALLOWED');
  }
});

test('invalid start requests', async () => {
  const cases = [
    ['not json', 'BAD_REQUEST'],
    ['', 'BAD_REQUEST'],
    ['[1]', 'BAD_REQUEST'],
    ['{"run_id":"r","rate":"10","size":1024}', 'BAD_REQUEST'],
    ['{"run_id":"r","rate":10,"size":1024.5}', 'BAD_REQUEST'],
    ['{"rate":10,"size":1024}', 'VALIDATION_ERROR'],
    ['{"run_id":"r","rate":0,"size":1024}', 'VALIDATION_ERROR'],
    ['{"run_id":"r","rate":1001,"size":1024}', 'VALIDATION_ERROR'],
    ['{"run_id":"r","rate":10,"size":100}', 'VALIDATION_ERROR'],
    ['{"run_id":"r","rate":10,"size":1024,"duration_s":-1}', 'VALIDATION_ERROR'],
  ];

  for (const [body, code] of cases) {
    const res = await call('POST', '/publish/start', body);
    assert.equal(res.status, 400, body);
    assert.equal(res.body.status, 'failed', body);
    assert.equal(res.body.error.code, code, body);
  }
});

test('a timed run publishes rate × duration messages, a second start gets 409', async () => {
  node.published.length = 0;

  const started = await start({ run_id: 'h1', rate: 50, size: 512, duration_s: 1 });
  assert.equal(started.status, 200);
  assert.equal(started.body.data.publishing, true);
  assert.equal(started.body.data.run_id, 'h1');

  const conflict = await start({ run_id: 'h2', rate: 10, size: 512 });
  assert.equal(conflict.status, 409);
  assert.equal(conflict.body.error.code, 'ALREADY_PUBLISHING');

  await sleep(1300);

  const { body } = await call('GET', '/publish/status');
  assert.equal(body.data.publishing, false);
  assert.equal(body.data.attempts, 50);
  assert.equal(body.data.success, 50);
  assert.equal(body.data.errors, 0);
  assert.equal(body.data.last_seq, 50);
  assert.match(body.data.started_at, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{6}Z$/);

  assert.deepEqual(
    node.published.map((msg) => msg.seq),
    Array.from({ length: 50 }, (_, i) => i + 1),
  );
  assert.ok(node.published.every((msg) => msg.run_id === 'h1' && msg.publisher === 'js-0'));
});

test('stop ends a run without a duration', async () => {
  await start({ run_id: 'h3', rate: 20, size: 512 });
  await sleep(220);

  const { status, body } = await call('POST', '/publish/stop');
  assert.equal(status, 200);
  assert.equal(body.data.publishing, false);
  assert.ok(
    body.data.attempts >= 4 && body.data.attempts <= 6,
    `${body.data.attempts} attempts in about 220 ms at 20 msg/s`,
  );
  assert.ok(body.data.stopped_at);
});

test('GET /metrics serves the Prometheus text format', async () => {
  const res = await fetch(`${base}/metrics`);

  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /^text\/plain/);
});

test('API requests are logged, except /metrics, /healthz and /connections', async () => {
  events.length = 0;

  for (const path of ['/metrics', '/healthz', '/connections', '/publish/status']) {
    await fetch(base + path);
  }

  await sleep(50);

  const paths = events.filter(([event]) => event === EVENT_HTTP_REQUEST).map(([, fields]) => fields.path);
  assert.deepEqual(paths, ['/publish/status']);
});
