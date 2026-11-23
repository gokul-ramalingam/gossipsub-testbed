package p2p

import (
	"context"
	"log/slog"
	"sync"
	"testing"

	pubsub "github.com/libp2p/go-libp2p-pubsub"
	pb "github.com/libp2p/go-libp2p-pubsub/pb"

	"go-peer/common"
)

// levelLog is a slog handler that records the level of each rejected event.
type levelLog struct {
	mu     sync.Mutex   // guards levels
	levels []slog.Level // level of each rejected event, in order
}

// Enabled accepts all levels.
func (l *levelLog) Enabled(context.Context, slog.Level) bool { return true }

// Handle records the level of a rejected event and ignores the other events.
func (l *levelLog) Handle(_ context.Context, record slog.Record) error {
	if record.Message == common.EventRejected {
		l.mu.Lock()
		l.levels = append(l.levels, record.Level)
		l.mu.Unlock()
	}

	return nil
}

// WithAttrs returns the same handler.
func (l *levelLog) WithAttrs([]slog.Attr) slog.Handler { return l }

// WithGroup returns the same handler.
func (l *levelLog) WithGroup(string) slog.Handler { return l }

// TestRejectLevels checks that a self-originated message is logged at debug
// level and another reject at warn level, and that both are counted.
func TestRejectLevels(t *testing.T) {
	log := &levelLog{}
	tr := newTracer(slog.New(log), newPeerNames(), testTopic)
	msg := &pubsub.Message{Message: &pb.Message{}}

	selfBefore := rejectedCount(t, pubsub.RejectSelfOrigin)
	otherBefore := rejectedCount(t, pubsub.RejectInvalidSignature)

	tr.RejectMessage(msg, pubsub.RejectSelfOrigin)
	tr.RejectMessage(msg, pubsub.RejectInvalidSignature)

	if len(log.levels) != 2 || log.levels[0] != slog.LevelDebug || log.levels[1] != slog.LevelWarn {
		t.Fatalf("levels %v, want [DEBUG WARN]", log.levels)
	}

	if got := rejectedCount(t, pubsub.RejectSelfOrigin) - selfBefore; got != 1 {
		t.Fatalf("self-originated rejects counted %v, want 1", got)
	}

	if got := rejectedCount(t, pubsub.RejectInvalidSignature) - otherBefore; got != 1 {
		t.Fatalf("invalid-signature rejects counted %v, want 1", got)
	}
}

// rejectedCount returns gs_messages_rejected_total for a reason.
func rejectedCount(t *testing.T, reason string) float64 {
	t.Helper()

	return metricWithLabel(t, "gs_messages_rejected_total", "reason", reason)
}
