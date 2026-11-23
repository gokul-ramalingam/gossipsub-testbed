package p2p

import (
	"fmt"
	"time"

	"github.com/libp2p/go-libp2p"
	"github.com/libp2p/go-libp2p/core/crypto"
	"github.com/libp2p/go-libp2p/core/host"
	"github.com/libp2p/go-libp2p/p2p/muxer/yamux"
	"github.com/libp2p/go-libp2p/p2p/security/noise"
	"github.com/libp2p/go-libp2p/p2p/transport/tcp"
	yamuxconfig "github.com/libp2p/go-yamux/v5"
	"github.com/pkg/errors"
)

// NewHost returns a libp2p host with the key priv, listening on TCP port on all
// interfaces. The stack is fixed so that the Go and JS peers agree on it: TCP,
// Noise and yamux. Relay and NAT traversal are off, because all peers are in
// one cluster network.
//
// TCP port reuse is off. With it, a dial leaves from the listen port, so when
// two peers dial each other at the same time, the two dials become one TCP
// simultaneous open and both sides start the Noise handshake as the initiator.
// The handshake fails, and peers with redial timers in phase never connect.
// Port reuse only helps NAT traversal, which this network does not need.
func NewHost(priv crypto.PrivKey, port int) (host.Host, error) {
	h, err := libp2p.New(
		libp2p.Identity(priv),
		libp2p.ListenAddrStrings(fmt.Sprintf("/ip4/0.0.0.0/tcp/%d", port)),
		libp2p.Transport(tcp.NewTCPTransport, tcp.DisableReuseport()),
		libp2p.Security(noise.ID, noise.New),
		libp2p.Muxer(yamux.ID, yamux.DefaultTransport),
		libp2p.DisableRelay(),
	)
	if err != nil {
		return nil, errors.Wrapf(err, "create libp2p host on port %d", port)
	}

	return h, nil
}

// YamuxKeepAlive returns the yamux keepalive interval of the host. It bounds
// how fast a peer detects a dead connection, so the report records it.
func YamuxKeepAlive() time.Duration {
	return (*yamuxconfig.Config)(yamux.DefaultTransport).KeepAliveInterval
}
