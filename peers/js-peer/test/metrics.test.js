import assert from 'node:assert/strict';
import { test } from 'node:test';

import { register } from '@prometheus-io/client';

import { gossipsubMetricsRegister } from '../src/metrics.js';

/**
 * Returns the value of a series.
 *
 * @param {string} name - metric name
 * @param {Record<string, string>} labels - labels of the series
 * @returns {Promise<number>} the value, 0 if the series does not exist
 */
async function value(name, labels) {
  const metric = (await register.getMetricsAsJSON()).find((m) => m.name === name);
  const series = metric?.values.find((v) => Object.entries(labels).every(([k, l]) => v.labels[k] === l));

  return series?.value ?? 0;
}

test('the gs_* metrics have the names of the Go peer', async () => {
  const names = (await register.getMetricsAsJSON()).map((m) => m.name).filter((n) => n.startsWith('gs_'));

  assert.deepEqual(names.sort(), [
    'gs_connected_peers',
    'gs_delivery_latency_seconds',
    'gs_latency_negative_total',
    'gs_mesh_peers',
    'gs_messages_duplicate_total',
    'gs_messages_received_total',
    'gs_messages_rejected_total',
    'gs_publish_attempts_total',
    'gs_publish_errors_total',
    'gs_publish_success_total',
    'gs_rpc_control_total',
    'gs_topic_peers',
  ]);
});

test('the IHAVE and IWANT series exist at 0 from the start', async () => {
  const text = await register.metrics();

  assert.match(text, /^gs_rpc_control_total\{type="IHAVE"\} \d+/m);
  assert.match(text, /^gs_rpc_control_total\{type="IWANT"\} \d+/m);
});

test('the internal metrics of @libp2p/gossipsub feed the gs_* metrics', async () => {
  const metricsRegister = gossipsubMetricsRegister();
  const ihave = await value('gs_rpc_control_total', { type: 'IHAVE' });
  const iwant = await value('gs_rpc_control_total', { type: 'IWANT' });
  const invalid = await value('gs_messages_rejected_total', { reason: 'test reason' });

  metricsRegister.gauge({ name: 'gossipsub_ihave_rcv_msgids_total', help: '' }).inc({ topic: 't' }, 3);
  metricsRegister.gauge({ name: 'gossipsub_iwant_rcv_msgids_total', help: '' }).inc({ topic: 't' }, 2);
  metricsRegister.gauge({ name: 'gossipsub_msg_received_invalid_total', help: '' }).inc({ error: 'test reason' }, 1);
  metricsRegister.gauge({ name: 'gossipsub_some_other_metric', help: '' }).inc(5);
  metricsRegister.histogram({ name: 'gossipsub_histogram', help: '' }).observe(1);

  assert.equal((await value('gs_rpc_control_total', { type: 'IHAVE' })) - ihave, 3);
  assert.equal((await value('gs_rpc_control_total', { type: 'IWANT' })) - iwant, 2);
  assert.equal((await value('gs_messages_rejected_total', { reason: 'test reason' })) - invalid, 1);
});
