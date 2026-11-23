package p2p

import (
	"context"
	"log/slog"
	"runtime"
	"runtime/debug"
	"sort"
	"time"

	"github.com/libp2p/go-libp2p/core/host"
	"github.com/libp2p/go-libp2p/core/peer"

	"go-peer/common"
	"go-peer/common/types"
	"go-peer/env"
)

// Config holds the settings of the p2p layer. NewP2PServer builds it from
// env; the tests build it directly.
type Config struct {
	PeerName       string         // peer name of this peer
	KeySeed        string         // seed of the peer keys, the same on all peers
	Port           int            // libp2p TCP port
	Topic          string         // GossipSub topic of the testbed
	Discovery      string         // common.DiscoverySRV or common.DiscoveryStatic
	SRVName        string         // service name of the SRV lookup
	StaticPeers    []types.Target // peers of the static discovery
	RedialInterval time.Duration  // time between two discovery rounds
}

// Server is the p2p layer of the peer: the libp2p host, the discovery that
// connects it to the other peers, the connection events, and GossipSub on the
// topic of the testbed.
type Server struct {
	logger    *slog.Logger // logger of the peer, with the peer_id field
	cfg       Config       // settings of the p2p layer
	host      host.Host    // libp2p host
	names     *peerNames   // peer ID -> peer name
	discovery *discovery   // finds and dials the other peers
	events    *connEvents  // peer_connected and peer_disconnected
	gossip    *gossip      // GossipSub topic and subscription
}

// NewP2PServer returns the p2p layer with the settings from env. env.Validate
// must have checked them.
func NewP2PServer(ctx context.Context, logger *slog.Logger) (*Server, error) {
	cfg, err := configFromEnv()
	if err != nil {
		return nil, err
	}

	return New(ctx, cfg, logger)
}

// LocalPeerID returns the peer ID of this peer, derived from the peer name and
// the key seed in env. It is known before the host starts, so that the logger
// can write it on every line.
func LocalPeerID() (peer.ID, error) {
	return PeerID(env.KeySeed.GetValue(), env.PeerName.GetValue())
}

// configFromEnv builds the settings of the p2p layer from env.
func configFromEnv() (Config, error) {
	port, err := env.P2PPort.GetInt()
	if err != nil {
		return Config{}, err
	}

	peers, err := env.Peers.GetPeers()
	if err != nil {
		return Config{}, err
	}

	interval, err := env.RedialInterval.GetDuration()
	if err != nil {
		return Config{}, err
	}

	return Config{
		PeerName:       env.PeerName.GetValue(),
		KeySeed:        env.KeySeed.GetValue(),
		Port:           port,
		Topic:          env.Topic.GetValue(),
		Discovery:      env.Discovery.GetValue(),
		SRVName:        env.SRVName.GetValue(),
		StaticPeers:    peers,
		RedialInterval: interval,
	}, nil
}

// New creates the host with the key of the peer and joins the topic. The host
// listens at once, but it dials the other peers only after Start. GossipSub
// runs until ctx is done. The logger must carry the common fields of the peer
// (see common/logger).
func New(ctx context.Context, cfg Config, logger *slog.Logger) (*Server, error) {
	priv, err := PrivateKey(cfg.KeySeed, cfg.PeerName)
	if err != nil {
		return nil, err
	}

	h, err := NewHost(priv, cfg.Port)
	if err != nil {
		return nil, err
	}

	names := newPeerNames()
	names.add(h.ID(), cfg.PeerName)

	// Static peers are known before any connection, so that the first
	// connection events already name them.
	for _, target := range cfg.StaticPeers {
		if id, err := PeerID(cfg.KeySeed, target.Name); err == nil {
			names.add(id, target.Name)
		}
	}

	events, err := newConnEvents(logger, h, names)
	if err != nil {
		_ = h.Close()

		return nil, err
	}

	g, err := newGossip(ctx, logger, h, names, cfg.Topic)
	if err != nil {
		_ = h.Close()

		return nil, err
	}

	return &Server{
		logger:    logger,
		cfg:       cfg,
		host:      h,
		names:     names,
		discovery: newDiscovery(logger, h, names, cfg),
		events:    events,
		gossip:    g,
	}, nil
}

// Start starts the connection events, the discovery and the subscription
// reader in the background, until ctx is done, and logs the started event.
func (s *Server) Start(ctx context.Context) {
	go s.events.run(ctx)
	go s.discovery.run(ctx)
	go s.gossip.run(ctx)

	s.logStarted()
}

// Close leaves the topic, then closes the host and all its connections.
func (s *Server) Close() error {
	s.gossip.close()

	return s.host.Close()
}

// Publish publishes one encoded message to the topic. With it, the server
// satisfies the Publisher interface of the HTTP services.
func (s *Server) Publish(ctx context.Context, data []byte) error {
	return s.gossip.publish(ctx, data)
}

// ID returns the peer ID of the host.
func (s *Server) ID() peer.ID {
	return s.host.ID()
}

// ConnectedPeers returns the peers that the host is connected to, sorted by
// name, with the remote address of each connection. With it, the server
// satisfies the PeerLister interface of the HTTP services.
func (s *Server) ConnectedPeers() []types.ConnectedPeer {
	network := s.host.Network()
	peers := make([]types.ConnectedPeer, 0, len(network.Peers()))

	for _, id := range network.Peers() {
		conns := network.ConnsToPeer(id)
		addrs := make([]string, 0, len(conns))

		for _, conn := range conns {
			addrs = append(addrs, conn.RemoteMultiaddr().String())
		}

		peers = append(peers, types.ConnectedPeer{Name: s.names.name(id), PeerID: id.String(), Addrs: addrs})
	}

	sort.Slice(peers, func(i, j int) bool { return peers[i].Name < peers[j].Name })

	return peers
}

// TopicPeers returns the number of peers that are subscribed to the topic.
func (s *Server) TopicPeers() int {
	return s.gossip.topicPeers()
}

// logStarted writes the started event: the peer name to peer ID mapping and the
// settings that the report records.
func (s *Server) logStarted() {
	addrs := make([]string, 0, len(s.host.Addrs()))
	for _, addr := range s.host.Addrs() {
		addrs = append(addrs, addr.String())
	}

	s.logger.Info(common.EventStarted,
		"addrs", addrs,
		"go_version", runtime.Version(),
		"libp2p_version", moduleVersion("github.com/libp2p/go-libp2p"),
		"pubsub_version", moduleVersion("github.com/libp2p/go-libp2p-pubsub"),
		"topic", s.cfg.Topic,
		"discovery", s.cfg.Discovery,
		"redial_interval", s.cfg.RedialInterval.String(),
		"yamux_keepalive", YamuxKeepAlive().String(),
	)
}

// moduleVersion returns the version of a module in the build, or "unknown".
func moduleVersion(path string) string {
	info, ok := debug.ReadBuildInfo()
	if !ok {
		return "unknown"
	}

	for _, dep := range info.Deps {
		if dep.Path == path {
			return dep.Version
		}
	}

	return "unknown"
}
