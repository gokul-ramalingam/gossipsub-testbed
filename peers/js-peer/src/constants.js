// Constants of the peer. The strings match the Go peer: logs, metrics and API must be the same.

// Discovery modes: DNS SRV lookup, or the PEERS list.
export const DISCOVERY_SRV = 'srv';
export const DISCOVERY_STATIC = 'static';

/** Implementation name in each log line. */
export const IMPL = 'js';

/** yamux keepalive interval, as the Go peer. It bounds how fast a dead connection is found. */
export const YAMUX_KEEPALIVE_MS = 30_000;

/** Time limit of one dial, so that a dial to an isolated peer does not block the next round. */
export const DIAL_TIMEOUT_MS = 3_000;

// Log events of the p2p layer.
export const EVENT_STARTED = 'started';
export const EVENT_STARTUP_FAILED = 'startup_failed';
export const EVENT_PEER_CONNECTED = 'peer_connected';
export const EVENT_PEER_DISCONNECTED = 'peer_disconnected';
export const EVENT_DISCOVERY_FAILED = 'discovery_failed';
export const EVENT_PEER_ID_FAILED = 'peer_id_failed';
export const EVENT_DIAL_FAILED = 'dial_failed';
export const EVENT_P2P_CLOSE_FAILED = 'p2p_close_failed';

/** GossipSub settings. The Go peer uses the same values; comments give the library defaults. */
export const GOSSIPSUB_OPTIONS = Object.freeze({
  /** Default: 6. */
  D: 3,
  /** Go default: 5, JS default: 4. */
  Dlo: 3,
  /** Default: 12. */
  Dhi: 4,
  /** Default: 6. */
  Dlazy: 3,
  /** Default: 2. The Go peer requires Dout < D/2. */
  Dout: 0,
  /** As Go. JS default: true. */
  floodPublish: false,
  /** As Go. JS default: 512. */
  idontwantMinDataSize: 1024,
  /** As Go: no error when no peer is subscribed yet. */
  allowPublishToZeroTopicPeers: true,
});

// Log events and reason of the deliveries.
export const EVENT_RECEIVED = 'received';
export const EVENT_REJECTED = 'rejected';
export const REASON_DECODE = 'decode';

// Error codes of the API responses.
export const CODE_BAD_REQUEST = 'BAD_REQUEST';
export const CODE_VALIDATION_ERROR = 'VALIDATION_ERROR';
export const CODE_ALREADY_PUBLISHING = 'ALREADY_PUBLISHING';
export const CODE_RUN_ID_USED = 'RUN_ID_USED';
export const CODE_NOT_FOUND = 'NOT_FOUND';
export const CODE_METHOD_NOT_ALLOWED = 'METHOD_NOT_ALLOWED';
export const CODE_INTERNAL_ERROR = 'INTERNAL_ERROR';

// Reasons of a failed publish.
export const REASON_ENCODE = 'encode';
export const REASON_PUBLISH = 'publish';

// Limits of a run, as the Go peer.
export const MAX_RATE = 1000;
export const MIN_SIZE = 256;
/** Below the GossipSub message limit of 1 MiB. */
export const MAX_SIZE = 512 * 1024;

// Log events of the publisher and the HTTP API.
export const EVENT_RUN_STARTED = 'run_started';
export const EVENT_RUN_STOPPED = 'run_stopped';
export const EVENT_RUN_FAILED = 'run_failed';
export const EVENT_PUBLISHED = 'published';
export const EVENT_PUBLISH_FAILED = 'publish_failed';
export const EVENT_HTTP_REQUEST = 'http_request';
export const EVENT_HTTP_PANIC = 'http_panic';
export const EVENT_HTTP_SHUTDOWN_FAILED = 'http_shutdown_failed';

// Log events of the duplicates and the mesh.
export const EVENT_DUPLICATE = 'duplicate';
export const EVENT_GRAFT = 'graft';
export const EVENT_PRUNE = 'prune';

// Types of gs_rpc_control_total.
export const CONTROL_IHAVE = 'IHAVE';
export const CONTROL_IWANT = 'IWANT';

/** Buckets of gs_delivery_latency_seconds, 0.5 ms to 5 s, as the Go peer. */
export const LATENCY_BUCKETS = Object.freeze([0.0005, 0.001, 0.002, 0.005, 0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5]);

/** Interval of the topic and mesh peer samples. */
export const SAMPLE_INTERVAL_MS = 1_000;

/** Time a message ID is kept for the duplicate count: the GossipSub seen TTL. */
export const SEEN_TTL_MS = 2 * 60_000;
