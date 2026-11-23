package p2p

import (
	"context"
	"log/slog"
	"time"

	pubsub "github.com/libp2p/go-libp2p-pubsub"
	"github.com/libp2p/go-libp2p/core/host"
	"github.com/pkg/errors"

	"go-peer/common"
	"go-peer/common/utils"
	"go-peer/metrics"
)

// sampleInterval is the time between two samples of the topic peer count.
const sampleInterval = time.Second

// gossip is the GossipSub part of the peer: one topic, with the default
// GossipSub parameters. It publishes to the topic and reads the subscription.
type gossip struct {
	logger *slog.Logger         // logger of the peer
	host   host.Host            // host of the peer, to skip its own messages
	names  *peerNames           // peer ID -> peer name, for the source field
	topic  *pubsub.Topic        // the topic of the testbed
	sub    *pubsub.Subscription // subscription to the topic
}

// Mesh parameters of the testbed. The JS peer uses the same values
// (GOSSIPSUB_OPTIONS in src/constants.js).
//
// With the defaults (D = 6) and the 6 peers of the testbed, every peer has
// the 5 others in its mesh: no gossip is used, almost every message comes
// directly from the publisher, and each receiver gets about 4 duplicates per
// message. With D = 3, a peer gets full messages from 3 peers and only gossip
// (IHAVE) from the 2 others, so relays and the gossip path are part of the
// experiment.
const (
	// MeshD is the number of mesh peers to aim for. Default: 6.
	MeshD = 3
	// MeshDlo is the lower bound: below it, the heartbeat adds mesh peers.
	// Default: 5. Equal to MeshD, so that every peer keeps 3 mesh peers: with
	// 6 peers, a mesh in which every peer has 3 mesh peers cannot split in
	// two (each part would need at least 4 peers). With a lower bound of 2,
	// two triangles would be a stable mesh, and a message would reach the
	// other triangle only through gossip, a heartbeat (1 s) later.
	MeshDlo = 3
	// MeshDhi is the upper bound: above it, the heartbeat removes mesh peers.
	// Default: 12. Low, so that the grafts of the other peers do not grow the
	// mesh back to 5.
	MeshDhi = 4
	// MeshDlazy is the number of peers outside the mesh that get IHAVE gossip
	// at each heartbeat. Default: 6. Here only 2 peers are outside the mesh.
	MeshDlazy = 3
	// MeshDout is the number of mesh places kept for peers that this peer
	// dialed (a protection against an eclipse attack). Default: 2.
	// go-libp2p-pubsub requires Dout < Dlo and Dout < D/2 (integer
	// division), which is 0 for D = 3.
	MeshDout = 0
)

// gossipSubParams returns the default GossipSub parameters with the mesh
// parameters of the testbed.
func gossipSubParams() pubsub.GossipSubParams {
	params := pubsub.DefaultGossipSubParams()
	params.D = MeshD
	params.Dlo = MeshDlo
	params.Dhi = MeshDhi
	params.Dlazy = MeshDlazy
	params.Dout = MeshDout

	return params
}

// newGossip starts GossipSub on the host, with the mesh parameters of the
// testbed and the tracer, joins the topic and subscribes to it. GossipSub runs
// until ctx is done.
func newGossip(ctx context.Context, logger *slog.Logger, h host.Host, names *peerNames, topicName string) (*gossip, error) {
	ps, err := pubsub.NewGossipSub(ctx, h,
		pubsub.WithGossipSubParams(gossipSubParams()),
		pubsub.WithRawTracer(newTracer(logger, names, topicName)),
	)
	if err != nil {
		return nil, errors.Wrap(err, "create gossipsub")
	}

	topic, err := ps.Join(topicName)
	if err != nil {
		return nil, errors.Wrapf(err, "join topic %s", topicName)
	}

	sub, err := topic.Subscribe()
	if err != nil {
		return nil, errors.Wrapf(err, "subscribe to topic %s", topicName)
	}

	return &gossip{
		logger: logger,
		host:   h,
		names:  names,
		topic:  topic,
		sub:    sub,
	}, nil
}

// publish publishes one encoded message to the topic.
func (g *gossip) publish(ctx context.Context, data []byte) error {
	if err := g.topic.Publish(ctx, data); err != nil {
		return errors.Wrap(err, "publish to topic")
	}

	return nil
}

// topicPeers returns the number of peers that are subscribed to the topic.
func (g *gossip) topicPeers() int {
	return len(g.topic.ListPeers())
}

// run reads the subscription until ctx is done or the subscription is
// cancelled. It also samples the topic peer count every second.
func (g *gossip) run(ctx context.Context) {
	go g.sample(ctx)

	for {
		msg, err := g.sub.Next(ctx)
		if err != nil {
			return
		}

		g.handle(msg, time.Now())
	}
}

// handle records one delivery. The subscription returns only the first copy of
// each message, after validation, so each call is a unique delivery. The
// latency is the receive time minus the publication timestamp. It is exact
// only when the publisher and this peer share one clock (one machine) or have
// synchronised clocks.
func (g *gossip) handle(msg *pubsub.Message, receivedAt time.Time) {
	// The subscription also returns the messages that this peer publishes.
	if msg.ReceivedFrom == g.host.ID() {
		return
	}

	source := g.names.name(msg.ReceivedFrom)

	decoded, err := utils.DecodeMessage(msg.Data)
	if err != nil {
		metrics.CaptureRejected(common.ReasonDecode)
		g.logger.Warn(common.EventRejected, "reason", common.ReasonDecode, "source", source, "error", err.Error())

		return
	}

	latencyUs := receivedAt.UnixMicro() - decoded.TsUs

	metrics.CaptureDelivery(decoded.RunID, decoded.Publisher, source, float64(latencyUs)/1e6)
	g.logger.Info(common.EventReceived,
		"run_id", decoded.RunID,
		"publisher", decoded.Publisher,
		"seq", decoded.Seq,
		"latency_us", latencyUs,
		"source", source,
	)
}

// sample sets gs_topic_peers every sampleInterval, until ctx is done.
// GossipSub has no tracer event for a subscription change, so the count is
// sampled from the topic.
func (g *gossip) sample(ctx context.Context) {
	ticker := time.NewTicker(sampleInterval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			metrics.SetTopicPeers(g.topicPeers())
		}
	}
}

// close cancels the subscription and leaves the topic.
func (g *gossip) close() {
	g.sub.Cancel()
	_ = g.topic.Close()
}
