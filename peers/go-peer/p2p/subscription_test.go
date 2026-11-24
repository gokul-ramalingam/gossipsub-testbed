package p2p

import (
	"context"
	"log/slog"
	"testing"
	"time"

	"github.com/libp2p/go-libp2p/core/host"

	"go-peer/common"
)

// newRawTestHost starts a host for name on a free port; the test closes it.
func newRawTestHost(t *testing.T, name string) host.Host {
	t.Helper()

	priv, err := PrivateKey(testKeySeed, name)
	if err != nil {
		t.Fatal(err)
	}

	h, err := NewHost(priv, 0)
	if err != nil {
		t.Fatal(err)
	}

	return h
}

// waitDone fails the test if done is not closed within 5 s.
func waitDone(t *testing.T, done <-chan struct{}, what string) {
	t.Helper()

	select {
	case <-done:
	case <-time.After(5 * time.Second):
		t.Fatalf("%s did not end within 5 s", what)
	}
}

// TestSubscriptionEndLogged checks that the subscription reader logs
// subscription_ended when the subscription ends while the peer runs, and
// logs nothing when it ends because ctx is done (shutdown).
func TestSubscriptionEndLogged(t *testing.T) {
	for _, tc := range []struct {
		name string
		stop func(context.CancelFunc, *gossip)
		want int
	}{
		{"subscription cancelled while running", func(_ context.CancelFunc, g *gossip) { g.sub.Cancel() }, 1},
		{"shutdown", func(cancel context.CancelFunc, _ *gossip) { cancel() }, 0},
	} {
		t.Run(tc.name, func(t *testing.T) {
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()

			h := newRawTestHost(t, "go-0")
			t.Cleanup(func() { _ = h.Close() })

			log := newEventLog()

			g, err := newGossip(ctx, slog.New(log), h, newPeerNames(), testTopic)
			if err != nil {
				t.Fatal(err)
			}

			done := make(chan struct{})
			go func() {
				g.run(ctx)
				close(done)
			}()

			tc.stop(cancel, g)
			waitDone(t, done, "the subscription reader")

			if got := log.count(common.EventSubscriptionEnded, ""); got != tc.want {
				t.Fatalf("%s logged %d times, want %d", common.EventSubscriptionEnded, got, tc.want)
			}
		})
	}
}
