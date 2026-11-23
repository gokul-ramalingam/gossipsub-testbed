package p2p

import (
	"context"
	"log/slog"

	"github.com/libp2p/go-libp2p/core/event"
	"github.com/libp2p/go-libp2p/core/host"
	"github.com/libp2p/go-libp2p/core/network"
	"github.com/pkg/errors"

	"go-peer/common"
	"go-peer/metrics"
)

// connEvents logs peer_connected and peer_disconnected and sets gs_connected_peers.
//
// It reads EvtPeerConnectednessChanged from the host event bus, not the
// per-connection notifications. Each pair of peers can have two connections,
// because both sides dial, and the event bus reports one change per peer: the
// first connection to a peer and the loss of the last one.
type connEvents struct {
	logger *slog.Logger       // logger of the peer
	host   host.Host          // host whose connections are reported
	names  *peerNames         // peer ID -> peer name, for the remote field
	sub    event.Subscription // subscription to the connectedness changes
}

// newConnEvents subscribes to the connectedness changes of the host. It
// subscribes at once, so that no change is lost before run starts.
func newConnEvents(logger *slog.Logger, h host.Host, names *peerNames) (*connEvents, error) {
	sub, err := h.EventBus().Subscribe(new(event.EvtPeerConnectednessChanged))
	if err != nil {
		return nil, errors.Wrap(err, "subscribe to connectedness events")
	}

	return &connEvents{
		logger: logger,
		host:   h,
		names:  names,
		sub:    sub,
	}, nil
}

// run handles the connectedness changes until ctx is done.
func (e *connEvents) run(ctx context.Context) {
	defer e.sub.Close()

	for {
		select {
		case <-ctx.Done():
			return
		case evt, ok := <-e.sub.Out():
			if !ok {
				return
			}

			changed, isChange := evt.(event.EvtPeerConnectednessChanged)
			if isChange {
				e.handle(changed)
			}
		}
	}
}

// handle logs one change and updates the connected peer count.
func (e *connEvents) handle(evt event.EvtPeerConnectednessChanged) {
	metrics.SetConnectedPeers(len(e.host.Network().Peers()))

	switch evt.Connectedness {
	case network.Connected:
		e.logger.Info(common.EventPeerConnected, "remote", e.names.name(evt.Peer))
	case network.NotConnected:
		e.logger.Info(common.EventPeerDisconnected, "remote", e.names.name(evt.Peer))
	default:
		// Limited connections (relay) are off in this network.
	}
}
