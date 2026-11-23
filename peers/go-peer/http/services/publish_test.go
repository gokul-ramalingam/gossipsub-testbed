package services

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"strings"
	"sync"
	"testing"
	"time"

	"go-peer/common"
	"go-peer/common/types"
	"go-peer/common/utils"
)

// fakePublisher records the published messages, or fails each publish with err.
type fakePublisher struct {
	err     error         // returned by each Publish; nil means success
	stallAt uint64        // seq of the message whose publish stalls; 0 means none
	stall   time.Duration // how long the publish of message stallAt takes

	mu       sync.Mutex      // guards messages
	messages []types.Message // decoded messages, in publish order
}

// Publish decodes and records one message, or returns err.
func (f *fakePublisher) Publish(_ context.Context, data []byte) error {
	if f.err != nil {
		return f.err
	}

	msg, err := utils.DecodeMessage(data)
	if err != nil {
		return err
	}

	if f.stallAt != 0 && msg.Seq == f.stallAt {
		time.Sleep(f.stall)
	}

	f.mu.Lock()
	defer f.mu.Unlock()

	f.messages = append(f.messages, msg)

	return nil
}

// published returns a copy of the recorded messages.
func (f *fakePublisher) published() []types.Message {
	f.mu.Lock()
	defer f.mu.Unlock()

	return append([]types.Message(nil), f.messages...)
}

// newTestService returns a publish service with publisher and a logger that discards its lines.
func newTestService(t *testing.T, publisher Publisher) *PublishService {
	t.Helper()
	t.Setenv("PEER_NAME", "go-0")

	return NewPublishService(publisher, slog.New(slog.NewTextHandler(io.Discard, nil)))
}

// waitIdle waits up to 5 s until the run of service has ended, and returns its status.
func waitIdle(t *testing.T, service *PublishService) types.PublishStatus {
	t.Helper()

	deadline := time.Now().Add(5 * time.Second)

	for service.Status().Publishing {
		if time.Now().After(deadline) {
			t.Fatal("the run did not end within 5 s")
		}

		time.Sleep(10 * time.Millisecond)
	}

	return service.Status()
}

// TestTimedRun checks that a run of 1 s at 50 msg/s publishes 50 messages,
// with seq 1 to 50, the publisher name and the requested size.
func TestTimedRun(t *testing.T) {
	publisher := &fakePublisher{}
	service := newTestService(t, publisher)

	if _, err := service.Start(types.StartParams{RunID: "t1", Rate: 50, Size: 1024, DurationS: 1}); err != nil {
		t.Fatal(err)
	}

	status := waitIdle(t, service)
	if status.Attempts != 50 || status.Success != 50 || status.Errors != 0 || status.LastSeq != 50 {
		t.Fatalf("status %+v, want 50 attempts, 50 success, 0 errors, last seq 50", status)
	}

	messages := publisher.published()
	for i, msg := range messages {
		if msg.Seq != uint64(i+1) || msg.RunID != "t1" || msg.Publisher != "go-0" {
			t.Fatalf("message %d is %+v, want seq %d of run t1 from go-0", i, msg, i+1)
		}
	}

	if len(messages) != 50 {
		t.Fatalf("published %d messages, want 50", len(messages))
	}
}

// TestStallCatchUp checks that a run catches up after a stall: one publish of
// 300 ms (15 send times at 50 msg/s) in a run of 1 s still gives 50 messages,
// and the run ends on time. A time.Ticker would drop the ticks of the stall.
func TestStallCatchUp(t *testing.T) {
	publisher := &fakePublisher{stallAt: 10, stall: 300 * time.Millisecond}
	service := newTestService(t, publisher)

	if _, err := service.Start(types.StartParams{RunID: "t5", Rate: 50, Size: 512, DurationS: 1}); err != nil {
		t.Fatal(err)
	}

	status := waitIdle(t, service)
	if status.Success != 50 || status.LastSeq != 50 {
		t.Fatalf("status %+v, want 50 success, last seq 50", status)
	}

	if took := status.StoppedAt.Sub(status.StartedAt); took > 1100*time.Millisecond {
		t.Fatalf("run took %s, want about 1 s", took)
	}
}

// TestSendTime checks the send times of a run at 10 msg/s: the first message
// at the start, message 200 at 19.9 s, so a run of 20 s has 200 messages.
func TestSendTime(t *testing.T) {
	start := time.Now()

	for seq, want := range map[uint64]time.Duration{1: 0, 2: 100 * time.Millisecond, 200: 19900 * time.Millisecond, 201: 20 * time.Second} {
		if got := sendTime(start, seq, 10).Sub(start); got != want {
			t.Fatalf("message %d is due %s after the start, want %s", seq, got, want)
		}
	}
}

// TestPublishErrors checks that failed publishes count as errors, not successes.
func TestPublishErrors(t *testing.T) {
	service := newTestService(t, &fakePublisher{err: errors.New("no topic")})

	if _, err := service.Start(types.StartParams{RunID: "t2", Rate: 50, Size: 512, DurationS: 1}); err != nil {
		t.Fatal(err)
	}

	status := waitIdle(t, service)
	if status.Attempts != 50 || status.Success != 0 || status.Errors != 50 {
		t.Fatalf("status %+v, want 50 attempts, 0 success, 50 errors", status)
	}
}

// TestOneRunAtATime checks that a second start during a run fails, and that
// Stop ends the run.
func TestOneRunAtATime(t *testing.T) {
	service := newTestService(t, &fakePublisher{})

	if _, err := service.Start(types.StartParams{RunID: "t3", Rate: 10, Size: 512}); err != nil {
		t.Fatal(err)
	}

	if _, err := service.Start(types.StartParams{RunID: "t4", Rate: 10, Size: 512}); !errors.Is(err, common.ErrAlreadyPublishing) {
		t.Fatalf("second start gave %v, want ErrAlreadyPublishing", err)
	}

	// Stop only after the first publish; a stop before it ends the run with 0 attempts.
	deadline := time.Now().Add(5 * time.Second)
	for service.Status().Attempts < 1 {
		if time.Now().After(deadline) {
			t.Fatal("no publish within 5 s")
		}

		time.Sleep(5 * time.Millisecond)
	}

	status := service.Stop()
	if status.Publishing || status.RunID != "t3" || status.Attempts < 1 {
		t.Fatalf("status after stop %+v, want run t3 stopped after at least 1 attempt", status)
	}
}

// TestRunDeadline checks that a timed run gets a deadline with the monotonic
// clock reading of its start (Go writes it as "m=" in String), and a run
// without a duration none. A deadline from time.Now().UTC() has no monotonic
// reading, and the tick check then depends on the wall clock.
func TestRunDeadline(t *testing.T) {
	start := time.Now()

	deadline := runDeadline(start, 20)
	if got := deadline.Sub(start); got != 20*time.Second {
		t.Fatalf("deadline is %s after the start, want 20s", got)
	}

	if !strings.Contains(deadline.String(), "m=") {
		t.Fatalf("deadline %s has no monotonic clock reading", deadline)
	}

	if strings.Contains(runDeadline(start.UTC(), 20).String(), "m=") {
		t.Fatal("a start from UTC() has a monotonic reading; the test does not check what it should")
	}

	if !runDeadline(start, 0).IsZero() {
		t.Fatal("a run without a duration has a deadline")
	}
}
