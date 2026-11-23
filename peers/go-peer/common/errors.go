package common

import "github.com/pkg/errors"

// Errors returned by the services and the routers.
var (
	// ErrAlreadyPublishing is returned when a run starts while another run is in progress.
	ErrAlreadyPublishing = errors.New("already publishing")

	// ErrNotReady is returned by the readiness check while the peer is starting.
	ErrNotReady = errors.New("peer is starting")

	// ErrNotFound is returned for a path that the API does not have.
	ErrNotFound = errors.New("path not found")

	// ErrMethodNotAllowed is returned for a method that the path does not accept.
	ErrMethodNotAllowed = errors.New("method not allowed")

	// ErrGossipSubNotReady is returned by the publish placeholder until the
	// GossipSub router is wired in.
	ErrGossipSubNotReady = errors.New("gossipsub topic is not wired yet")
)
