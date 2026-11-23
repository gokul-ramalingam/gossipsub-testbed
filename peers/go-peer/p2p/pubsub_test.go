package p2p

import (
	"context"
	"fmt"
	"log/slog"
	"sync"
	"testing"
	"time"

	pubsub "github.com/libp2p/go-libp2p-pubsub"
	ma "github.com/multiformats/go-multiaddr"
	"github.com/prometheus/client_golang/prometheus"

	"go-peer/common"
	"go-peer/common/types"
	"go-peer/common/utils"
)

// Run IDs of the test.
const (
	// warmupRunID marks the messages that check that the network delivers.
	warmupRunID = "warmup"
	// testRunID marks the messages that the test counts.
	testRunID = "test"
)

// receivedLog is a slog handler that records the received events: whether a
// warm-up message arrived, and the seq of each test message.
type receivedLog struct {
	mu     sync.Mutex     // guards the fields below
	warmed bool           // true after the first warm-up message
	seqs   map[uint64]int // seq of a test message -> number of received events
}

// newReceivedLog returns an empty record.
func newReceivedLog() *receivedLog {
	return &receivedLog{seqs: make(map[uint64]int)}
}

// Enabled accepts all levels.
func (r *receivedLog) Enabled(context.Context, slog.Level) bool { return true }

// Handle records the seq of a received event and ignores the other events.
func (r *receivedLog) Handle(_ context.Context, record slog.Record) error {
	if record.Message != common.EventReceived {
		return nil
	}

	var (
		runID string
		seq   uint64
	)

	record.Attrs(func(attr slog.Attr) bool {
		switch attr.Key {
		case "run_id":
			runID = attr.Value.String()
		case "seq":
			seq = attr.Value.Uint64()
		}

		return true
	})

	r.mu.Lock()
	defer r.mu.Unlock()

	switch runID {
	case warmupRunID:
		r.warmed = true
	case testRunID:
		r.seqs[seq]++
	}

	return nil
}

// WithAttrs returns the same handler, so that all loggers share one record.
func (r *receivedLog) WithAttrs([]slog.Attr) slog.Handler { return r }

// WithGroup returns the same handler, so that all loggers share one record.
func (r *receivedLog) WithGroup(string) slog.Handler { return r }

// isWarmed reports whether a warm-up message arrived.
func (r *receivedLog) isWarmed() bool {
	r.mu.Lock()
	defer r.mu.Unlock()

	return r.warmed
}

// counts returns the number of distinct seqs and the highest count of one seq.
func (r *receivedLog) counts() (distinct, maxCopies int) {
	r.mu.Lock()
	defer r.mu.Unlock()

	for _, n := range r.seqs {
		maxCopies = max(maxCopies, n)
	}

	return len(r.seqs), maxCopies
}

// missing returns the seqs from 1 to last that were not received.
func (r *receivedLog) missing(last uint64) []uint64 {
	r.mu.Lock()
	defer r.mu.Unlock()

	var seqs []uint64

	for seq := uint64(1); seq <= last; seq++ {
		if r.seqs[seq] == 0 {
			seqs = append(seqs, seq)
		}
	}

	return seqs
}

// TestPublishReachesAllPeers starts three servers, publishes from go-0 and
// checks that go-1 and go-2 each receive every message exactly once.
//
// The test first waits until the network delivers. For a short time after a
// peer appears as a topic peer, GossipSub loses the messages to it (about
// 200 ms to 1 s in local tests). The test run starts only after each peer has
// received a warm-up message, like the run script waits for a steady network.
func TestPublishReachesAllPeers(t *testing.T) {
	// 50 messages at 50 msg/s, five times the plan rate.
	const (
		messages        = 50
		publishInterval = 20 * time.Millisecond
	)

	names := []string{"go-0", "go-1", "go-2"}
	peers := make([]types.Target, len(names))
	ports := make([]int, len(names))

	for i, name := range names {
		ports[i] = freePort(t)
		peers[i] = types.Target{Name: name, Addr: ma.StringCast(fmt.Sprintf("/ip4/127.0.0.1/tcp/%d", ports[i]))}
	}

	ctx, cancel := context.WithCancel(context.Background())
	t.Cleanup(cancel)

	servers := make([]*Server, len(names))
	logs := make([]*receivedLog, len(names))

	for i, name := range names {
		logs[i] = newReceivedLog()

		server, err := New(ctx, Config{
			PeerName:       name,
			KeySeed:        testKeySeed,
			Port:           ports[i],
			Topic:          testTopic,
			Discovery:      common.DiscoveryStatic,
			StaticPeers:    peers,
			RedialInterval: 200 * time.Millisecond,
		}, slog.New(logs[i]))
		if err != nil {
			t.Fatal(err)
		}

		t.Cleanup(func() { _ = server.Close() })

		server.Start(ctx)
		servers[i] = server
	}

	waitUntilDelivering(ctx, t, servers[0], logs[1:])

	// The metrics are global to the test process, so the test compares them
	// with their values before the run.
	receivedBefore := metricSum(t, "gs_messages_received_total", testRunID)
	samplesBefore := metricSum(t, "gs_delivery_latency_seconds", testRunID)
	negativeBefore := metricSum(t, "gs_latency_negative_total", testRunID)

	for seq := uint64(1); seq <= messages; seq++ {
		publishTestMessage(ctx, t, servers[0], testRunID, seq)
		time.Sleep(publishInterval)
	}

	deadline := time.Now().Add(5 * time.Second)

	for i := 1; i < len(names); i++ {
		for {
			distinct, maxCopies := logs[i].counts()
			if maxCopies > 1 {
				t.Fatalf("%s logged a seq %d times, want once", names[i], maxCopies)
			}

			if distinct == messages {
				break
			}

			if time.Now().After(deadline) {
				t.Fatalf("%s received %d of %d messages, missing seq %v", names[i], distinct, messages, logs[i].missing(messages))
			}

			time.Sleep(50 * time.Millisecond)
		}
	}

	// The publisher must not log its own messages as received.
	if distinct, _ := logs[0].counts(); distinct != 0 {
		t.Fatalf("go-0 logged %d of its own messages as received", distinct)
	}

	// The metrics count the same deliveries as the logs: 2 receivers × 50 messages.
	// Each receiver logs its seqs only once, so the counts are not inflated by duplicates.
	if got := metricSum(t, "gs_messages_received_total", testRunID) - receivedBefore; got != 2*messages {
		t.Fatalf("gs_messages_received_total{run_id=%q} = %v, want %d", testRunID, got, 2*messages)
	}

	if got := metricSum(t, "gs_delivery_latency_seconds", testRunID) - samplesBefore; got != 2*messages {
		t.Fatalf("gs_delivery_latency_seconds{run_id=%q} has %v samples, want %d", testRunID, got, 2*messages)
	}

	if got := metricSum(t, "gs_latency_negative_total", testRunID) - negativeBefore; got != 0 {
		t.Fatalf("gs_latency_negative_total{run_id=%q} = %v, want 0", testRunID, got)
	}
}

// metricSum returns the sum of a counter, or the sample count of a histogram,
// over the series of the metric with the run_id label runID.
func metricSum(t *testing.T, name, runID string) float64 {
	t.Helper()

	families, err := prometheus.DefaultGatherer.Gather()
	if err != nil {
		t.Fatal(err)
	}

	sum := 0.0

	for _, family := range families {
		if family.GetName() != name {
			continue
		}

		for _, metric := range family.GetMetric() {
			for _, label := range metric.GetLabel() {
				if label.GetName() == "run_id" && label.GetValue() == runID {
					sum += metric.GetCounter().GetValue() + float64(metric.GetHistogram().GetSampleCount())
				}
			}
		}
	}

	return sum
}

// waitUntilDelivering publishes a warm-up message every 50 ms from publisher
// until each log has received one.
func waitUntilDelivering(ctx context.Context, t *testing.T, publisher *Server, logs []*receivedLog) {
	t.Helper()

	deadline := time.Now().Add(10 * time.Second)

	for seq := uint64(1); ; seq++ {
		warmed := true
		for _, log := range logs {
			warmed = warmed && log.isWarmed()
		}

		if warmed {
			return
		}

		if time.Now().After(deadline) {
			t.Fatal("the network did not deliver a warm-up message within 10 s")
		}

		publishTestMessage(ctx, t, publisher, warmupRunID, seq)
		time.Sleep(50 * time.Millisecond)
	}
}

// publishTestMessage publishes one 1 KiB message of runID from publisher.
func publishTestMessage(ctx context.Context, t *testing.T, publisher *Server, runID string, seq uint64) {
	t.Helper()

	msg := types.Message{RunID: runID, Publisher: "go-0", Seq: seq, TsUs: time.Now().UnixMicro()}

	data, err := utils.EncodeMessage(msg, 1024)
	if err != nil {
		t.Fatal(err)
	}

	if err := publisher.Publish(ctx, data); err != nil {
		t.Fatal(err)
	}
}

// metricWithLabel returns the sum of a counter over its series with the label name=value.
func metricWithLabel(t *testing.T, name, labelName, labelValue string) float64 {
	t.Helper()

	families, err := prometheus.DefaultGatherer.Gather()
	if err != nil {
		t.Fatal(err)
	}

	sum := 0.0

	for _, family := range families {
		if family.GetName() != name {
			continue
		}

		for _, metric := range family.GetMetric() {
			for _, label := range metric.GetLabel() {
				if label.GetName() == labelName && label.GetValue() == labelValue {
					sum += metric.GetCounter().GetValue()
				}
			}
		}
	}

	return sum
}

// TestMeshParams checks that go-libp2p-pubsub accepts the mesh parameters of
// the testbed: NewGossipSub validates them and fails on an invalid set.
func TestMeshParams(t *testing.T) {
	priv, err := PrivateKey(testKeySeed, "go-0")
	if err != nil {
		t.Fatal(err)
	}

	h, err := NewHost(priv, 0)
	if err != nil {
		t.Fatal(err)
	}

	t.Cleanup(func() { _ = h.Close() })

	ctx, cancel := context.WithCancel(context.Background())
	t.Cleanup(cancel)

	if _, err := pubsub.NewGossipSub(ctx, h, pubsub.WithGossipSubParams(gossipSubParams())); err != nil {
		t.Fatalf("the mesh parameters are rejected: %v", err)
	}

	params := gossipSubParams()
	if params.D != 3 || params.Dlo != 3 || params.Dhi != 4 || params.Dlazy != 3 || params.Dout != 0 {
		t.Fatalf("mesh parameters %d/%d/%d/%d/%d, want D=3 Dlo=3 Dhi=4 Dlazy=3 Dout=0", params.D, params.Dlo, params.Dhi, params.Dlazy, params.Dout)
	}
}

// TestMeshDoutRule checks the rule of go-libp2p-pubsub that makes Dout 0 for
// D = 3: with Dout = 1, NewGossipSub fails.
func TestMeshDoutRule(t *testing.T) {
	priv, err := PrivateKey(testKeySeed, "go-1")
	if err != nil {
		t.Fatal(err)
	}

	h, err := NewHost(priv, 0)
	if err != nil {
		t.Fatal(err)
	}

	t.Cleanup(func() { _ = h.Close() })

	ctx, cancel := context.WithCancel(context.Background())
	t.Cleanup(cancel)

	params := gossipSubParams()
	params.Dout = 1

	if _, err := pubsub.NewGossipSub(ctx, h, pubsub.WithGossipSubParams(params)); err == nil {
		t.Fatal("Dout = 1 with D = 3 was accepted, want an error")
	}
}
