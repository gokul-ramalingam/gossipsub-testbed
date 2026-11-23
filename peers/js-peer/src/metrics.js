import { collectDefaultMetrics, Counter, Gauge, Histogram } from '@prometheus-io/client';

import { CONTROL_IHAVE, CONTROL_IWANT, LATENCY_BUCKETS } from './constants.js';

/**
 * Metrics of the peer, in the default registry that GET /metrics serves. The
 * names, labels and buckets are the same as in the Go peer (metrics/metrics.go).
 * The p2p layer and the publish service write them; /metrics reads them. The
 * scraper adds the labels of the scrape target.
 */

/** Publish attempts per run. */
const publishAttempts = new Counter({
  name: 'gs_publish_attempts_total',
  help: 'Publish attempts by this peer.',
  labelNames: ['run_id'],
});

/** Successful publications per run. */
const publishSuccess = new Counter({
  name: 'gs_publish_success_total',
  help: 'Successful publications by this peer.',
  labelNames: ['run_id'],
});

/** Failed publications per run and reason. */
const publishErrors = new Counter({
  name: 'gs_publish_errors_total',
  help: 'Failed publications by this peer.',
  labelNames: ['run_id', 'reason'],
});

/** Unique deliveries per run and publisher. */
const messagesReceived = new Counter({
  name: 'gs_messages_received_total',
  help: 'Unique messages delivered to this peer.',
  labelNames: ['run_id', 'publisher'],
});

/** Copies of messages that this peer already had. */
const messagesDuplicate = new Counter({
  name: 'gs_messages_duplicate_total',
  help: 'Duplicate copies of messages received by this peer.',
  labelNames: ['run_id'],
});

/** Messages that this peer rejected or could not deliver. */
const messagesRejected = new Counter({
  name: 'gs_messages_rejected_total',
  help: 'Messages rejected or not delivered by this peer.',
  labelNames: ['reason'],
});

/** Time from publication to unique delivery. */
const deliveryLatency = new Histogram({
  name: 'gs_delivery_latency_seconds',
  help: 'Time from publication to delivery at this peer.',
  labelNames: ['run_id', 'publisher', 'source'],
  buckets: [...LATENCY_BUCKETS],
});

/** Deliveries with a receive time before the publication time; must stay at 0 when the peers share one clock. */
const latencyNegative = new Counter({
  name: 'gs_latency_negative_total',
  help: 'Deliveries with a negative latency (clock check).',
  labelNames: ['run_id'],
});

/** Message IDs in the received IHAVE and IWANT control messages. */
const rpcControl = new Counter({
  name: 'gs_rpc_control_total',
  help: 'Message IDs in the IHAVE and IWANT control messages received by this peer.',
  labelNames: ['type'],
});

/** Peers that this peer is connected to. */
const connectedPeers = new Gauge({ name: 'gs_connected_peers', help: 'Peers connected to this peer.' });

/** Peers subscribed to the topic, as this peer knows it. */
const topicPeers = new Gauge({ name: 'gs_topic_peers', help: 'Peers subscribed to the topic, as this peer knows it.' });

/** Peers in the GossipSub mesh of this peer for the topic. */
const meshPeers = new Gauge({ name: 'gs_mesh_peers', help: 'Peers in the GossipSub mesh of this peer for the topic.' });

// The two series of gs_rpc_control_total exist from the start, so that a
// panel shows 0, not "no data", when no IHAVE or IWANT arrives (as the Go peer).
rpcControl.labels(CONTROL_IHAVE).inc(0);
rpcControl.labels(CONTROL_IWANT).inc(0);

// Process and Node.js metrics (process_*, nodejs_*), as the Go peer has process_* and go_*.
collectDefaultMetrics();

/** @param {string} runId - the run */
export function capturePublishAttempt(runId) {
  publishAttempts.labels(runId).inc();
}

/** @param {string} runId - the run */
export function capturePublishSuccess(runId) {
  publishSuccess.labels(runId).inc();
}

/**
 * @param {string} runId - the run
 * @param {string} reason - encode or publish
 */
export function capturePublishError(runId, reason) {
  publishErrors.labels(runId, reason).inc();
}

/**
 * Counts one unique delivery and records its latency. A negative latency goes
 * to gs_latency_negative_total, not to the histogram.
 *
 * @param {string} runId - the run
 * @param {string} publisher - name of the publisher
 * @param {string} source - name of the peer that sent the first copy
 * @param {number} latencySeconds - receive time minus publication time
 */
export function captureDelivery(runId, publisher, source, latencySeconds) {
  messagesReceived.labels(runId, publisher).inc();

  if (latencySeconds < 0) {
    latencyNegative.labels(runId).inc();
    return;
  }

  deliveryLatency.labels(runId, publisher, source).observe(latencySeconds);
}

/** @param {string} runId - the run of the duplicate; empty if the message does not decode */
export function captureDuplicate(runId) {
  messagesDuplicate.labels(runId).inc();
}

/** @param {string} reason - why the message was rejected */
export function captureRejected(reason) {
  messagesRejected.labels(reason).inc();
}

/**
 * @param {string} type - IHAVE or IWANT
 * @param {number} count - message IDs in the control messages
 */
export function captureRpcControl(type, count) {
  rpcControl.labels(type).inc(count);
}

/** @param {number} count - connected peers */
export function setConnectedPeers(count) {
  connectedPeers.set(count);
}

/** @param {number} count - peers subscribed to the topic */
export function setTopicPeers(count) {
  topicPeers.set(count);
}

/** @param {number} count - peers in the mesh */
export function setMeshPeers(count) {
  meshPeers.set(count);
}

/**
 * Internal metrics of @libp2p/gossipsub that feed a gs_* metric. The library
 * has no tracer like go-libp2p-pubsub; its metricsRegister option is the
 * documented way to get these values.
 */
const GOSSIPSUB_METRICS = {
  /** Message IDs in received IHAVE messages, per topic (the testbed has one topic). */
  gossipsub_ihave_rcv_msgids_total: (labels, value) => captureRpcControl(CONTROL_IHAVE, value),
  /** Message IDs in received IWANT messages, per topic. */
  gossipsub_iwant_rcv_msgids_total: (labels, value) => captureRpcControl(CONTROL_IWANT, value),
  /** Invalid messages, by reason. */
  gossipsub_msg_received_invalid_total: (labels, value) => messagesRejected.labels(String(labels.error)).inc(value),
};

/**
 * Returns the metricsRegister of @libp2p/gossipsub: the metrics named in
 * GOSSIPSUB_METRICS go to their gs_* metric; the others are dropped, because
 * the dashboard uses only the gs_* metrics.
 *
 * @returns {object} a MetricsRegister of @libp2p/gossipsub
 */
export function gossipsubMetricsRegister() {
  /** A metric of the library that is not used. */
  const unused = { inc() {}, set() {}, observe() {}, addCollect() {}, reset() {}, startTimer: () => () => {} };

  return {
    gauge(config) {
      const capture = GOSSIPSUB_METRICS[config.name];
      if (capture === undefined) {
        return unused;
      }

      return {
        ...unused,
        // inc(value) or inc(labels, value), as the library calls it.
        inc(labelsOrValue, value) {
          const labels = typeof labelsOrValue === 'object' ? labelsOrValue : {};
          const amount = typeof labelsOrValue === 'object' ? (value ?? 1) : (labelsOrValue ?? 1);
          capture(labels, amount);
        },
      };
    },
    histogram: () => unused,
    avgMinMax: () => unused,
  };
}
