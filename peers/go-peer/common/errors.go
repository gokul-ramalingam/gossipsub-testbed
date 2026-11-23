package common

import "github.com/pkg/errors"

// Errors returned by the services, the routers, the settings and the p2p layer.
var (
	// ErrAlreadyPublishing is returned when a run starts while another run is in progress.
	ErrAlreadyPublishing = errors.New("already publishing")

	// ErrNotFound is returned for a path that the API does not have.
	ErrNotFound = errors.New("path not found")

	// ErrMethodNotAllowed is returned for a method that the path does not accept.
	ErrMethodNotAllowed = errors.New("method not allowed")

	// ErrInternal is returned when a handler panics.
	ErrInternal = errors.New("internal error")

	// ErrInvalidDiscovery is returned when DISCOVERY is not srv or static.
	ErrInvalidDiscovery = errors.New("discovery must be srv or static")

	// ErrInvalidPeer is returned when a PEERS entry is not <peer name>=<multiaddr>.
	ErrInvalidPeer = errors.New("peer must be <peer name>=<multiaddr>")
)
