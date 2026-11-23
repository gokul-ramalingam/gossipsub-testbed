/**
 * Constants of the peer. The strings are the same as in the Go peer, because
 * the logs, the metrics and the API of both peers must match.
 */

/** Discovery mode: find the other peers with a DNS SRV lookup. */
export const DISCOVERY_SRV = 'srv';

/** Discovery mode: use the PEERS list. */
export const DISCOVERY_STATIC = 'static';

/** Implementation name in each log line. The Go peer writes "go". */
export const IMPL = 'js';

/** yamux keepalive interval in milliseconds, the same as the Go peer (30 s). It bounds how fast a dead connection is found. */
export const YAMUX_KEEPALIVE_MS = 30_000;

/** Time limit of one dial, so that a dial to an isolated peer does not block the next discovery round. */
export const DIAL_TIMEOUT_MS = 3_000;

/** Log event: once at start, with the peer name to peer ID mapping, the versions and the settings. */
export const EVENT_STARTED = 'started';

/** Log event: the peer cannot start; the process then exits. */
export const EVENT_STARTUP_FAILED = 'startup_failed';

/** Log event: the first connection to a remote peer. */
export const EVENT_PEER_CONNECTED = 'peer_connected';

/** Log event: the loss of the last connection to a remote peer. */
export const EVENT_PEER_DISCONNECTED = 'peer_disconnected';

/** Log event: a discovery round cannot find the peers. */
export const EVENT_DISCOVERY_FAILED = 'discovery_failed';

/** Log event: the peer ID of a discovered peer cannot be derived. */
export const EVENT_PEER_ID_FAILED = 'peer_id_failed';

/** Log event, at debug level: a dial fails. It repeats every round during an isolation. */
export const EVENT_DIAL_FAILED = 'dial_failed';

/** Log event: the p2p layer does not stop cleanly. */
export const EVENT_P2P_CLOSE_FAILED = 'p2p_close_failed';

/**
 * GossipSub settings of the JS peer. The Go peer uses the same values, so
 * that a Go publisher and a JS publisher spread a message in the same way:
 * - the mesh parameters of the testbed (MeshD … MeshDout in p2p/pubsub.go of
 *   the Go peer; see there why D = 3 and Dlo = 3 for the 6 peers);
 * - the values of go-libp2p-pubsub v0.15.0 where the defaults of the two
 *   implementations differ.
 */
export const GOSSIPSUB_OPTIONS = Object.freeze({
  /** Mesh peers to aim for. Default: 6. */
  D: 3,
  /** Lower bound of the mesh; below it, the heartbeat adds peers. Go default: 5, JS default: 4. */
  Dlo: 3,
  /** Upper bound of the mesh; above it, the heartbeat removes peers. Default: 12. */
  Dhi: 4,
  /** Peers outside the mesh that get IHAVE gossip at each heartbeat. Default: 6. */
  Dlazy: 3,
  /** Mesh places kept for peers that this peer dialed. Default: 2. 0 as in the Go peer, where Dout < D/2 is required. */
  Dout: 0,
  /** Go: false. JS default: true (the publisher sends to all topic peers, not only its mesh). */
  floodPublish: false,
  /** Go: GossipSubIDontWantMessageThreshold = 1024 bytes. JS default: 512. */
  idontwantMinDataSize: 1024,
  /** Go publishes without an error when no peer is subscribed yet; js-libp2p throws by default. */
  allowPublishToZeroTopicPeers: true,
});

/** Log event: one unique delivery. */
export const EVENT_RECEIVED = 'received';

/** Log event: a message rejected or not delivered. */
export const EVENT_REJECTED = 'rejected';

/** Reason of a rejected message: it does not decode. */
export const REASON_DECODE = 'decode';

/** Error code of a response: the request body is not valid JSON or a field has the wrong type. */
export const CODE_BAD_REQUEST = 'BAD_REQUEST';
/** Error code of a response: a request field fails validation. */
export const CODE_VALIDATION_ERROR = 'VALIDATION_ERROR';
/** Error code of a response: a run is already in progress. */
export const CODE_ALREADY_PUBLISHING = 'ALREADY_PUBLISHING';
/** Error code of a response: the API does not have the path. */
export const CODE_NOT_FOUND = 'NOT_FOUND';
/** Error code of a response: the path does not accept the method. */
export const CODE_METHOD_NOT_ALLOWED = 'METHOD_NOT_ALLOWED';
/** Error code of a response: a handler failed unexpectedly. */
export const CODE_INTERNAL_ERROR = 'INTERNAL_ERROR';

/** Reason of a failed publish: the message does not encode. */
export const REASON_ENCODE = 'encode';
/** Reason of a failed publish: the publish to the topic fails. */
export const REASON_PUBLISH = 'publish';

/** Largest publish rate, in messages per second (as the Go peer). */
export const MAX_RATE = 1000;
/** Smallest encoded message, in bytes (as the Go peer). */
export const MIN_SIZE = 256;
/** Largest encoded message, in bytes: below the GossipSub default limit of 1 MiB (as the Go peer). */
export const MAX_SIZE = 512 * 1024;

/** Log event: the publisher starts a run, with its settings. */
export const EVENT_RUN_STARTED = 'run_started';
/** Log event: a run ends, with its counts. */
export const EVENT_RUN_STOPPED = 'run_stopped';
/** Log event: the publisher publishes one message. */
export const EVENT_PUBLISHED = 'published';
/** Log event: the publisher could not publish one message. */
export const EVENT_PUBLISH_FAILED = 'publish_failed';
/** Log event: one API request, except /metrics, /healthz and /connections. */
export const EVENT_HTTP_REQUEST = 'http_request';
/** Log event: an API handler failed unexpectedly. */
export const EVENT_HTTP_PANIC = 'http_panic';
/** Log event: the HTTP server does not stop cleanly. */
export const EVENT_HTTP_SHUTDOWN_FAILED = 'http_shutdown_failed';

/** Log event: one duplicate copy of a message. */
export const EVENT_DUPLICATE = 'duplicate';
/** Log event: a remote peer joins the mesh of this peer. */
export const EVENT_GRAFT = 'graft';
/** Log event: a remote peer leaves the mesh of this peer. */
export const EVENT_PRUNE = 'prune';

/** Type of gs_rpc_control_total: message IDs in received IHAVE messages. */
export const CONTROL_IHAVE = 'IHAVE';
/** Type of gs_rpc_control_total: message IDs in received IWANT messages. */
export const CONTROL_IWANT = 'IWANT';

/** Bucket bounds of gs_delivery_latency_seconds, from 0.5 ms to 5 s: the same as the Go peer. */
export const LATENCY_BUCKETS = Object.freeze([0.0005, 0.001, 0.002, 0.005, 0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5]);

/** Time between two samples of the topic and mesh peer counts. */
export const SAMPLE_INTERVAL_MS = 1_000;

/** Time that a message ID is remembered for the duplicate count: the seen TTL of GossipSub (2 minutes). */
export const SEEN_TTL_MS = 2 * 60_000;
