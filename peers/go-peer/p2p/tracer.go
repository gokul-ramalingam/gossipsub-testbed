package p2p

import (
	"context"
	"log/slog"
	"sync"

	pubsub "github.com/libp2p/go-libp2p-pubsub"
	"github.com/libp2p/go-libp2p/core/peer"
	"github.com/libp2p/go-libp2p/core/protocol"

	"go-peer/common"
	"go-peer/common/utils"
	"go-peer/metrics"
)

// tracer receives the GossipSub events and converts them into metrics and log
// lines: duplicates, rejects, mesh changes and the IHAVE and IWANT control
// messages. GossipSub calls it from its event loop, so each method must return
// quickly and must not block.
//
// The unique deliveries are not counted here but in gossip.handle, at the
// subscription, which is the same point as gossipsub:message in the JS peer.
type tracer struct {
	logger *slog.Logger // logger of the peer
	names  *peerNames   // peer ID -> peer name, for the remote and source fields
	topic  string       // the topic of the testbed; mesh changes of other topics are ignored

	meshMu sync.Mutex           // guards mesh
	mesh   map[peer.ID]struct{} // peers in the mesh of this peer for the topic
}

// newTracer returns a tracer for the topic.
func newTracer(logger *slog.Logger, names *peerNames, topic string) *tracer {
	return &tracer{
		logger: logger,
		names:  names,
		topic:  topic,
		mesh:   make(map[peer.ID]struct{}),
	}
}

// Graft records that a remote peer joined the mesh.
func (t *tracer) Graft(p peer.ID, topic string) {
	if topic != t.topic {
		return
	}

	t.setMesh(p, true)
	t.logger.Info(common.EventGraft, "remote", t.names.name(p))
}

// Prune records that a remote peer left the mesh.
func (t *tracer) Prune(p peer.ID, topic string) {
	if topic != t.topic {
		return
	}

	t.setMesh(p, false)
	t.logger.Info(common.EventPrune, "remote", t.names.name(p))
}

// RemovePeer removes a peer that left GossipSub from the mesh. GossipSub does
// not call Prune for it.
func (t *tracer) RemovePeer(p peer.ID) {
	t.setMesh(p, false)
}

// DuplicateMessage counts and logs a copy of a message that this peer already had.
func (t *tracer) DuplicateMessage(msg *pubsub.Message) {
	source := t.names.name(msg.ReceivedFrom)

	decoded, err := utils.DecodeMessage(msg.Data)
	if err != nil {
		metrics.CaptureDuplicate("")
		t.logger.Info(common.EventDuplicate, "source", source)

		return
	}

	metrics.CaptureDuplicate(decoded.RunID)
	t.logger.Info(common.EventDuplicate, "run_id", decoded.RunID, "seq", decoded.Seq, "source", source)
}

// RejectMessage counts and logs a message that failed validation, with the GossipSub reason.
//
// A message of this peer that comes back is counted, but logged at debug
// level: it is not a fault. A JS peer forwards a message to its mesh peers
// except the one it came from, without a check of the publisher (go-libp2p-pubsub
// checks both), so in a mixed network a Go publisher can get its own message
// back, and GossipSub rejects it as "self originated message".
func (t *tracer) RejectMessage(msg *pubsub.Message, reason string) {
	metrics.CaptureRejected(reason)

	level := slog.LevelWarn
	if reason == pubsub.RejectSelfOrigin {
		level = slog.LevelDebug
	}

	t.logger.Log(context.Background(), level, common.EventRejected, "reason", reason, "source", t.names.name(msg.ReceivedFrom))
}

// UndeliverableMessage counts and logs a message that GossipSub could not deliver to the subscription.
func (t *tracer) UndeliverableMessage(msg *pubsub.Message) {
	metrics.CaptureRejected(common.ReasonUndeliverable)
	t.logger.Warn(common.EventRejected, "reason", common.ReasonUndeliverable, "source", t.names.name(msg.ReceivedFrom))
}

// RecvRPC counts the message IDs in the IHAVE and IWANT control messages of an incoming RPC.
func (t *tracer) RecvRPC(rpc *pubsub.RPC) {
	control := rpc.GetControl()
	if control == nil {
		return
	}

	ihave, iwant := 0, 0

	for _, msg := range control.GetIhave() {
		if msg.GetTopicID() == t.topic {
			ihave += len(msg.GetMessageIDs())
		}
	}

	for _, msg := range control.GetIwant() {
		iwant += len(msg.GetMessageIDs())
	}

	if ihave > 0 {
		metrics.CaptureRPCControl(common.ControlIHave, ihave)
	}

	if iwant > 0 {
		metrics.CaptureRPCControl(common.ControlIWant, iwant)
	}
}

// setMesh adds a peer to the mesh or removes it, and updates gs_mesh_peers.
func (t *tracer) setMesh(p peer.ID, in bool) {
	t.meshMu.Lock()
	defer t.meshMu.Unlock()

	if in {
		t.mesh[p] = struct{}{}
	} else {
		delete(t.mesh, p)
	}

	metrics.SetMeshPeers(len(t.mesh))
}

// AddPeer is not used: the topic peers are sampled from the topic instead.
func (t *tracer) AddPeer(peer.ID, protocol.ID) {}

// Join is not used: the peer joins one topic at start.
func (t *tracer) Join(string) {}

// Leave is not used: the peer leaves the topic only at shutdown.
func (t *tracer) Leave(string) {}

// ValidateMessage is not used: the testbed has no validator.
func (t *tracer) ValidateMessage(*pubsub.Message) {}

// DeliverMessage is not used: the deliveries are counted at the subscription (gossip.handle).
func (t *tracer) DeliverMessage(*pubsub.Message) {}

// ThrottlePeer is not used: peer scoring is off.
func (t *tracer) ThrottlePeer(peer.ID) {}

// SendRPC is not used: the plan counts only the received control messages.
func (t *tracer) SendRPC(*pubsub.RPC, peer.ID) {}

// DropRPC is not used: the JS peer has no matching metric, and the metric names must match.
func (t *tracer) DropRPC(*pubsub.RPC, peer.ID) {}
