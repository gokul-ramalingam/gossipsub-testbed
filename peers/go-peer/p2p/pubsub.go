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

// newGossip starts GossipSub on the host, with the tracer, joins the topic and
// subscribes to it. GossipSub runs until ctx is done.
func newGossip(ctx context.Context, logger *slog.Logger, h host.Host, names *peerNames, topicName string) (*gossip, error) {
	ps, err := pubsub.NewGossipSub(ctx, h, pubsub.WithRawTracer(newTracer(logger, names, topicName)))
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
