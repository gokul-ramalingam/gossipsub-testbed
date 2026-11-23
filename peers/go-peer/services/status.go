package services

import (
	"sync/atomic"

	"go-peer/common"
)

// ready is true when the peer is ready to serve /readyz.
var ready atomic.Bool

// SetReady marks the peer as ready or not ready for /readyz.
func SetReady(value bool) {
	ready.Store(value)
}

// StatusService reports the readiness of the peer.
type StatusService struct{}

// NewStatusService returns a status service.
func NewStatusService() *StatusService {
	return &StatusService{}
}

// Ready returns ErrNotReady while the peer is starting.
func (s *StatusService) Ready() error {
	if !ready.Load() {
		return common.ErrNotReady
	}

	return nil
}
