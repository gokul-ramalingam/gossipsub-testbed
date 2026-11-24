import { collectDefaultMetrics, Counter, Gauge, Histogram } from '@prometheus-io/client';

import { CONTROL_IHAVE, CONTROL_IWANT, LATENCY_BUCKETS } from './constants.js';

// Metrics of the peer. Names, labels and buckets match the Go peer.

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

/** Deliveries received before their publication time; 0 when the peers share one clock. */
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

// Create both series now, so that a panel shows 0, not "no data".
rpcControl.labels(CONTROL_IHAVE).inc(0);
rpcControl.labels(CONTROL_IWANT).inc(0);

// process_* and nodejs_* metrics.
collectDefaultMetrics();

/**
 * Counts one publish attempt.
 *
 * @param {string} runId - run ID
 */
export const capturePublishAttempt = (runId) => {
  publishAttempts.labels(runId).inc();
};

/**
 * Counts one successful publish.
 *
 * @param {string} runId - run ID
 */
export const capturePublishSuccess = (runId) => {
  publishSuccess.labels(runId).inc();
};

/**
 * Counts one failed publish.
 *
 * @param {string} runId - run ID
 * @param {string} reason - encode or publish
 */
export const capturePublishError = (runId, reason) => {
  publishErrors.labels(runId, reason).inc();
};

/**
 * Counts one unique delivery and records its latency. A negative latency is counted apart.
 *
 * @param {string} runId - run ID
 * @param {string} publisher - publisher name
 * @param {string} source - peer that sent the first copy
 * @param {number} latencySeconds - receive time minus publication time
 */
export const captureDelivery = (runId, publisher, source, latencySeconds) => {
  messagesReceived.labels(runId, publisher).inc();

  if (latencySeconds < 0) {
    latencyNegative.labels(runId).inc();
    return;
  }

  deliveryLatency.labels(runId, publisher, source).observe(latencySeconds);
};

/**
 * Counts one duplicate.
 *
 * @param {string} runId - run ID; empty if the message does not decode
 */
export const captureDuplicate = (runId) => {
  messagesDuplicate.labels(runId).inc();
};

/**
 * Counts one rejected message.
 *
 * @param {string} reason - why the message was rejected
 */
export const captureRejected = (reason) => {
  messagesRejected.labels(reason).inc();
};

/**
 * Counts the message IDs of received control messages.
 *
 * @param {string} type - IHAVE or IWANT
 * @param {number} count - message IDs
 */
export const captureRpcControl = (type, count) => {
  rpcControl.labels(type).inc(count);
};

/**
 * Sets the connected peer count.
 *
 * @param {number} count - connected peers
 */
export const setConnectedPeers = (count) => {
  connectedPeers.set(count);
};

/**
 * Sets the topic peer count.
 *
 * @param {number} count - peers subscribed to the topic
 */
export const setTopicPeers = (count) => {
  topicPeers.set(count);
};

/**
 * Sets the mesh peer count.
 *
 * @param {number} count - peers in the mesh
 */
export const setMeshPeers = (count) => {
  meshPeers.set(count);
};

/** Metrics of @libp2p/gossipsub that feed a gs_* metric. The others are dropped. */
const GOSSIPSUB_METRICS = {
  gossipsub_ihave_rcv_msgids_total: (labels, value) => captureRpcControl(CONTROL_IHAVE, value),
  gossipsub_iwant_rcv_msgids_total: (labels, value) => captureRpcControl(CONTROL_IWANT, value),
  gossipsub_msg_received_invalid_total: (labels, value) => messagesRejected.labels(String(labels.error)).inc(value),
};

/**
 * Returns the metricsRegister for @libp2p/gossipsub. It sends GOSSIPSUB_METRICS to the gs_* metrics.
 *
 * @returns {object} a MetricsRegister of @libp2p/gossipsub
 */
export const gossipsubMetricsRegister = () => {
  const unused = { inc() {}, set() {}, observe() {}, addCollect() {}, reset() {}, startTimer: () => () => {} };

  return {
    gauge(config) {
      const capture = GOSSIPSUB_METRICS[config.name];
      if (capture === undefined) {
        return unused;
      }

      return {
        ...unused,
        // The library calls inc(value) or inc(labels, value).
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
};
