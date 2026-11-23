package p2p

import (
	"context"
	"fmt"
	"log/slog"
	"net"
	"strings"
	"sync"
	"time"

	"github.com/libp2p/go-libp2p/core/host"
	"github.com/libp2p/go-libp2p/core/network"
	"github.com/libp2p/go-libp2p/core/peer"
	ma "github.com/multiformats/go-multiaddr"
	"github.com/pkg/errors"

	"go-peer/common"
	"go-peer/common/types"
)

// dialTimeout bounds one dial, so that a dial to an isolated peer does not
// block the next discovery round.
const dialTimeout = 3 * time.Second

// discovery finds the other peers and dials each one that is not connected,
// once at start and then every RedialInterval.
//
// Dials use WithForceDirectDial, which skips the libp2p dial backoff. Without
// it, the failed dials during an isolation put the peer in backoff, and the
// recovery lag would measure the backoff instead of GossipSub.
type discovery struct {
	logger *slog.Logger // logger of the peer
	host   host.Host    // host that dials
	names  *peerNames   // filled with the peer name of each target
	cfg    Config       // discovery mode, SRV name, static peers, redial interval

	inflightMu sync.Mutex           // guards inflight
	inflight   map[peer.ID]struct{} // peers with a dial in progress
}

// newDiscovery returns the discovery of the host.
func newDiscovery(logger *slog.Logger, h host.Host, names *peerNames, cfg Config) *discovery {
	return &discovery{
		logger:   logger,
		host:     h,
		names:    names,
		cfg:      cfg,
		inflight: make(map[peer.ID]struct{}),
	}
}

// run does one discovery round at once and then one every RedialInterval, until ctx is done.
func (d *discovery) run(ctx context.Context) {
	ticker := time.NewTicker(d.cfg.RedialInterval)
	defer ticker.Stop()

	for {
		d.round(ctx)

		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}

// round finds the targets and starts a dial to each one that is not connected.
func (d *discovery) round(ctx context.Context) {
	targets, err := d.targets(ctx)
	if err != nil {
		d.logger.Warn(common.EventDiscoveryFailed, "error", err.Error())

		return
	}

	for _, target := range targets {
		if target.Name == d.cfg.PeerName {
			continue
		}

		id, err := PeerID(d.cfg.KeySeed, target.Name)
		if err != nil {
			d.logger.Error(common.EventPeerIDFailed, "remote", target.Name, "error", err.Error())

			continue
		}

		d.names.add(id, target.Name)

		if d.host.Network().Connectedness(id) == network.Connected {
			continue
		}

		go d.dial(ctx, target.Name, peer.AddrInfo{ID: id, Addrs: []ma.Multiaddr{target.Addr}})
	}
}

// dial connects to one peer. It returns at once if a dial to the peer is in progress.
func (d *discovery) dial(ctx context.Context, name string, info peer.AddrInfo) {
	if !d.startDial(info.ID) {
		return
	}
	defer d.endDial(info.ID)

	ctx, cancel := context.WithTimeout(ctx, dialTimeout)
	defer cancel()

	ctx = network.WithForceDirectDial(ctx, "redial")

	if err := d.host.Connect(ctx, info); err != nil {
		d.logger.Debug(common.EventDialFailed, "remote", name, "addr", info.Addrs[0].String(), "error", err.Error())
	}
}

// startDial marks a dial to the peer as in progress. It returns false if one already is.
func (d *discovery) startDial(id peer.ID) bool {
	d.inflightMu.Lock()
	defer d.inflightMu.Unlock()

	if _, ok := d.inflight[id]; ok {
		return false
	}

	d.inflight[id] = struct{}{}

	return true
}

// endDial marks the dial to the peer as done.
func (d *discovery) endDial(id peer.ID) {
	d.inflightMu.Lock()
	defer d.inflightMu.Unlock()

	delete(d.inflight, id)
}

// targets returns the peers to dial: the static list, or the answers of the SRV lookup.
func (d *discovery) targets(ctx context.Context) ([]types.Target, error) {
	if d.cfg.Discovery == common.DiscoveryStatic {
		return d.cfg.StaticPeers, nil
	}

	return lookupSRV(ctx, d.cfg.SRVName)
}

// lookupSRV resolves _p2p._tcp.<srvName>. Each answer is the hostname of one
// peer, such as "js-1.peers.dst.svc.cluster.local.", and the first label of
// the hostname is the peer name.
func lookupSRV(ctx context.Context, srvName string) ([]types.Target, error) {
	_, records, err := net.DefaultResolver.LookupSRV(ctx, "p2p", "tcp", srvName)
	if err != nil {
		return nil, errors.Wrapf(err, "srv lookup %s", srvName)
	}

	targets := make([]types.Target, 0, len(records))

	for _, record := range records {
		target, err := srvTarget(record.Target, record.Port)
		if err != nil {
			return nil, err
		}

		targets = append(targets, target)
	}

	return targets, nil
}

// srvTarget converts one SRV answer into a target: the peer name and a /dns4 address.
func srvTarget(hostname string, port uint16) (types.Target, error) {
	hostname = strings.TrimSuffix(hostname, ".")
	name, _, _ := strings.Cut(hostname, ".")

	addr, err := ma.NewMultiaddr(fmt.Sprintf("/dns4/%s/tcp/%d", hostname, port))
	if err != nil {
		return types.Target{}, errors.Wrapf(err, "srv target %s", hostname)
	}

	return types.Target{Name: name, Addr: addr}, nil
}
