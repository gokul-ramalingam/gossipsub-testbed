package common

// Error codes of the API responses.
const (
	// BadRequest is returned when the request body is not valid JSON.
	BadRequest = "BAD_REQUEST"
	// ValidationError is returned when a request field fails validation.
	ValidationError = "VALIDATION_ERROR"
	// AlreadyPublishing is returned when a run is already in progress.
	AlreadyPublishing = "ALREADY_PUBLISHING"
	// NotFound is returned for a path that the API does not have.
	NotFound = "NOT_FOUND"
	// MethodNotAllowed is returned for a method that the path does not accept.
	MethodNotAllowed = "METHOD_NOT_ALLOWED"
	// InternalError is returned when a handler panics.
	InternalError = "INTERNAL_ERROR"
)

// Reasons of gs_publish_errors_total.
const (
	// ReasonEncode counts the messages that failed to encode.
	ReasonEncode = "encode"
	// ReasonPublish counts the messages that failed to publish to the topic.
	ReasonPublish = "publish"
)

// Reasons of gs_messages_rejected_total, in addition to the reasons of GossipSub.
const (
	// ReasonDecode counts the messages that this peer could not decode.
	ReasonDecode = "decode"
	// ReasonUndeliverable counts the messages that GossipSub could not deliver to a subscriber.
	ReasonUndeliverable = "undeliverable"
)

// Types of gs_rpc_control_total.
const (
	// ControlIHave counts the message IDs in received IHAVE messages.
	ControlIHave = "IHAVE"
	// ControlIWant counts the message IDs in received IWANT messages.
	ControlIWant = "IWANT"
)

// Log events. Each event is one log line; the Go and JS peers use the same names.
const (
	// EventStarted is logged once at start: the peer name to peer ID mapping, the versions and the settings.
	EventStarted = "started"
	// EventStartupFailed is logged when the peer cannot start; the process then exits.
	EventStartupFailed = "startup_failed"
	// EventRunStarted is logged when the publisher starts a run, with its settings.
	EventRunStarted = "run_started"
	// EventRunStopped is logged when a run ends, with its counts.
	EventRunStopped = "run_stopped"
	// EventPublished is logged for each message that the publisher publishes.
	EventPublished = "published"
	// EventPublishFailed is logged for each message that the publisher could not publish.
	EventPublishFailed = "publish_failed"
	// EventHTTPRequest is logged for each API request, except /metrics and the probes.
	EventHTTPRequest = "http_request"
	// EventHTTPPanic is logged when an API handler panics.
	EventHTTPPanic = "http_panic"
	// EventHTTPServeFailed is logged when the HTTP server stops with an error.
	EventHTTPServeFailed = "http_serve_failed"
	// EventHTTPShutdownFailed is logged when the HTTP server does not stop in time.
	EventHTTPShutdownFailed = "http_shutdown_failed"
	// EventP2PCloseFailed is logged when the p2p layer does not close cleanly.
	EventP2PCloseFailed = "p2p_close_failed"
	// EventReceived is logged for each unique delivery.
	EventReceived = "received"
	// EventDuplicate is logged for each duplicate copy of a message.
	EventDuplicate = "duplicate"
	// EventRejected is logged for each rejected or undeliverable message.
	EventRejected = "rejected"
	// EventPeerConnected is logged when a peer gets its first connection to a remote peer.
	EventPeerConnected = "peer_connected"
	// EventPeerDisconnected is logged when a peer loses its last connection to a remote peer.
	EventPeerDisconnected = "peer_disconnected"
	// EventDiscoveryFailed is logged when a discovery round cannot find the peers.
	EventDiscoveryFailed = "discovery_failed"
	// EventPeerIDFailed is logged when the peer ID of a discovered peer cannot be derived.
	EventPeerIDFailed = "peer_id_failed"
	// EventDialFailed is logged at debug level when a dial fails; it repeats every round during an isolation.
	EventDialFailed = "dial_failed"
	// EventGraft is logged when a remote peer joins the mesh of this peer.
	EventGraft = "graft"
	// EventPrune is logged when a remote peer leaves the mesh of this peer.
	EventPrune = "prune"
)

// Discovery modes of the p2p layer.
const (
	// DiscoverySRV finds the other peers with a DNS SRV lookup.
	DiscoverySRV = "srv"
	// DiscoveryStatic uses the PEERS list.
	DiscoveryStatic = "static"
)
