package p2p

import (
	"context"
	"fmt"
	"log/slog"
	"sync"
	"testing"
	"time"

	ma "github.com/multiformats/go-multiaddr"

	"go-peer/common"
	"go-peer/common/types"
)

// eventLog is a slog handler that counts the log events per event name and remote peer.
type eventLog struct {
	mu     sync.Mutex     // guards counts
	counts map[string]int // "<event> <remote>" -> number of log lines
}

// newEventLog returns an empty record.
func newEventLog() *eventLog {
	return &eventLog{counts: make(map[string]int)}
}

// Enabled accepts all levels.
func (e *eventLog) Enabled(context.Context, slog.Level) bool { return true }

// Handle counts one log line by its event name and remote field.
func (e *eventLog) Handle(_ context.Context, record slog.Record) error {
	remote := ""

	record.Attrs(func(attr slog.Attr) bool {
		if attr.Key == "remote" {
			remote = attr.Value.String()
		}

		return true
	})

	e.mu.Lock()
	defer e.mu.Unlock()

	e.counts[record.Message+" "+remote]++

	return nil
}

// WithAttrs returns the same handler, so that all loggers share one record.
func (e *eventLog) WithAttrs([]slog.Attr) slog.Handler { return e }

// WithGroup returns the same handler, so that all loggers share one record.
func (e *eventLog) WithGroup(string) slog.Handler { return e }

// count returns the number of log lines of an event for a remote peer.
func (e *eventLog) count(event, remote string) int {
	e.mu.Lock()
	defer e.mu.Unlock()

	return e.counts[event+" "+remote]
}

// TestConnectionEventsOncePerPeer starts two servers that both dial each
// other, so that the pair can have two connections. It checks that each side
// logs peer_connected once, and that the remaining side logs peer_disconnected
// once when the other side closes.
func TestConnectionEventsOncePerPeer(t *testing.T) {
	ports := []int{freePort(t), freePort(t)}
	peers := []types.Target{
		{Name: "go-0", Addr: ma.StringCast(fmt.Sprintf("/ip4/127.0.0.1/tcp/%d", ports[0]))},
		{Name: "go-1", Addr: ma.StringCast(fmt.Sprintf("/ip4/127.0.0.1/tcp/%d", ports[1]))},
	}

	ctx, cancel := context.WithCancel(context.Background())
	t.Cleanup(cancel)

	logs := []*eventLog{newEventLog(), newEventLog()}
	servers := make([]*Server, len(peers))

	for i, target := range peers {
		server, err := New(ctx, Config{
			PeerName:       target.Name,
			KeySeed:        testKeySeed,
			Port:           ports[i],
			Topic:          testTopic,
			Discovery:      common.DiscoveryStatic,
			StaticPeers:    peers,
			RedialInterval: 100 * time.Millisecond,
		}, slog.New(logs[i]))
		if err != nil {
			t.Fatal(err)
		}

		servers[i] = server
	}

	t.Cleanup(func() { _ = servers[0].Close() })

	for _, server := range servers {
		server.Start(ctx)
	}

	waitFor(t, "go-0 and go-1 log peer_connected", func() bool {
		return logs[0].count(common.EventPeerConnected, "go-1") >= 1 && logs[1].count(common.EventPeerConnected, "go-0") >= 1
	})

	// Let further dials of the redial loop happen; they must not log again.
	time.Sleep(500 * time.Millisecond)

	conns := len(servers[0].host.Network().ConnsToPeer(servers[1].ID()))

	if n := logs[0].count(common.EventPeerConnected, "go-1"); n != 1 {
		t.Fatalf("go-0 logged peer_connected for go-1 %d times with %d connections, want once", n, conns)
	}

	if n := logs[1].count(common.EventPeerConnected, "go-0"); n != 1 {
		t.Fatalf("go-1 logged peer_connected for go-0 %d times with %d connections, want once", n, conns)
	}

	if err := servers[1].Close(); err != nil {
		t.Fatal(err)
	}

	waitFor(t, "go-0 logs peer_disconnected", func() bool {
		return logs[0].count(common.EventPeerDisconnected, "go-1") >= 1
	})

	if n := logs[0].count(common.EventPeerDisconnected, "go-1"); n != 1 {
		t.Fatalf("go-0 logged peer_disconnected for go-1 %d times, want once", n)
	}

	t.Logf("connections between go-0 and go-1 before the close: %d", conns)
}

// waitFor polls cond every 20 ms for up to 5 s and fails the test if it stays false.
func waitFor(t *testing.T, what string, cond func() bool) {
	t.Helper()

	deadline := time.Now().Add(5 * time.Second)

	for !cond() {
		if time.Now().After(deadline) {
			t.Fatalf("timeout: %s", what)
		}

		time.Sleep(20 * time.Millisecond)
	}
}

// TestRestartJoinsMeshAtOnce stops go-1 and starts it again with the same name
// (so the same peer ID) and port, and checks that go-0 takes it back into its
// mesh within a few seconds, not after the prune backoff (1 minute). Close
// does not leave the topic, so it sends no PRUNE. The test passes also with a
// Close that leaves the topic: go-libp2p-pubsub leaves in the background, and
// in this test go-0 set no backoff either way. It guards the restart; the
// case that needed the change is the JS peer (its test, p2p.test.js).
func TestRestartJoinsMeshAtOnce(t *testing.T) {
	ports := []int{freePort(t), freePort(t)}
	peers := []types.Target{
		{Name: "go-0", Addr: ma.StringCast(fmt.Sprintf("/ip4/127.0.0.1/tcp/%d", ports[0]))},
		{Name: "go-1", Addr: ma.StringCast(fmt.Sprintf("/ip4/127.0.0.1/tcp/%d", ports[1]))},
	}

	ctx, cancel := context.WithCancel(context.Background())
	t.Cleanup(cancel)

	start := func(i int, log *eventLog) (*Server, context.CancelFunc) {
		peerCtx, peerCancel := context.WithCancel(ctx)

		server, err := New(peerCtx, Config{
			PeerName:       peers[i].Name,
			KeySeed:        testKeySeed,
			Port:           ports[i],
			Topic:          testTopic,
			Discovery:      common.DiscoveryStatic,
			StaticPeers:    peers,
			RedialInterval: 100 * time.Millisecond,
		}, slog.New(log))
		if err != nil {
			t.Fatal(err)
		}

		server.Start(peerCtx)

		return server, peerCancel
	}

	log0 := newEventLog()
	go0, _ := start(0, log0)
	t.Cleanup(func() { _ = go0.Close() })

	go1, stop1 := start(1, newEventLog())

	waitFor(t, "go-0 grafts go-1", func() bool { return log0.count(common.EventGraft, "go-1") >= 1 })

	// Stop go-1 as main does: cancel its context, then close it.
	stop1()

	if err := go1.Close(); err != nil {
		t.Fatal(err)
	}

	waitFor(t, "go-0 logs peer_disconnected for go-1", func() bool {
		return log0.count(common.EventPeerDisconnected, "go-1") >= 1
	})

	if n := log0.count(common.EventPrune, "go-1"); n != 0 {
		t.Fatalf("go-0 logged %d prunes of go-1 after its close, want 0", n)
	}

	restarted, stopRestarted := start(1, newEventLog())
	t.Cleanup(func() { stopRestarted(); _ = restarted.Close() })

	waitFor(t, "go-0 grafts the restarted go-1 again", func() bool { return log0.count(common.EventGraft, "go-1") >= 2 })
}
