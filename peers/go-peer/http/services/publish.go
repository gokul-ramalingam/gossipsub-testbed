package services

import (
	"context"
	"log/slog"
	"sync"
	"time"

	"go-peer/common"
	"go-peer/common/types"
	"go-peer/common/utils"
	"go-peer/env"
	"go-peer/metrics"
)

// Publisher publishes one encoded message to the topic. The p2p server
// satisfies it; the tests use a fake.
type Publisher interface {
	Publish(ctx context.Context, data []byte) error
}

// PeerLister lists the peers that this peer is connected to. The p2p server
// satisfies it.
type PeerLister interface {
	ConnectedPeers() []types.ConnectedPeer
}

// Node is what the HTTP API needs from the p2p layer: publish to the topic and
// list the connected peers. The p2p server satisfies it.
type Node interface {
	Publisher
	PeerLister
}

// PublishService publishes one run at a time. Sequence numbers start at 1 in
// each run, so each run needs its own run ID: a run ID is accepted once.
type PublishService struct {
	publisher Publisher    // publishes each message to the topic
	logger    *slog.Logger // logger of the peer

	mu     sync.Mutex          // guards the fields below
	status types.PublishStatus // state and counts of the current or last run
	cancel context.CancelFunc  // ends the current run, nil when idle
	done   chan struct{}       // closed when the publish loop exits, nil when idle
	used   map[string]struct{} // run IDs of the runs started so far
}

// NewPublishService returns an idle publish service that publishes with
// publisher and logs to logger.
func NewPublishService(publisher Publisher, logger *slog.Logger) *PublishService {
	return &PublishService{publisher: publisher, logger: logger, used: make(map[string]struct{})}
}

// Start begins a run in the background and returns its initial status. It
// returns ErrAlreadyPublishing if a run is in progress, and ErrRunIDUsed if
// this peer has already started a run with the same run ID.
func (s *PublishService) Start(params types.StartParams) (types.PublishStatus, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	if s.status.Publishing {
		return s.status, common.ErrAlreadyPublishing
	}

	if _, ok := s.used[params.RunID]; ok {
		return s.status, common.ErrRunIDUsed
	}

	s.used[params.RunID] = struct{}{}

	ctx, cancel := context.WithCancel(context.Background())
	start := time.Now()
	deadline := runDeadline(start, params.DurationS)

	s.status = types.PublishStatus{
		Publishing: true,
		RunID:      params.RunID,
		Rate:       params.Rate,
		Size:       params.Size,
		DurationS:  params.DurationS,
		StartedAt:  start.UTC(),
	}
	s.cancel = cancel
	s.done = make(chan struct{})

	s.logger.Info(common.EventRunStarted,
		"run_id", params.RunID,
		"rate", params.Rate,
		"size", params.Size,
		"duration_s", params.DurationS,
	)

	go s.run(ctx, params, start, deadline, s.done)

	return s.status, nil
}

// Stop ends the current run and waits for the publish loop to exit. It returns
// the final status, and whether a run was in progress. If no run is in
// progress, it returns the last status and false.
func (s *PublishService) Stop() (types.PublishStatus, bool) {
	s.mu.Lock()
	cancel, done := s.cancel, s.done
	s.mu.Unlock()

	if cancel == nil {
		return s.Status(), false
	}

	cancel()
	<-done

	return s.Status(), true
}

// Status returns the state and counts of the current or last run.
func (s *PublishService) Status() types.PublishStatus {
	s.mu.Lock()
	defer s.mu.Unlock()

	return s.status
}

// run publishes message seq at its send time (sendTime), the first one at
// once, until Stop cancels ctx or the next send time reaches the deadline. A
// timed run thus publishes rate × duration messages. After a stall (CPU
// throttling, a slow publish), the late messages go out at once, one after the
// other, until the run is back on schedule. A time.Ticker instead drops the
// ticks it cannot deliver: a stall of 0.6 s on the cluster lost 5 of 200
// messages.
func (s *PublishService) run(ctx context.Context, params types.StartParams, start, deadline time.Time, done chan struct{}) {
	defer close(done)
	defer s.finish()

	for seq := uint64(1); ; seq++ {
		at := sendTime(start, seq, params.Rate)
		if !deadline.IsZero() && !at.Before(deadline) {
			return
		}

		// Wait until the send time; a message that is already late goes out at once.
		if wait := time.Until(at); wait > 0 {
			select {
			case <-ctx.Done():
				return
			case <-time.After(wait):
			}
		}

		// select picks at random when Stop and the timer are both ready, and a
		// late message does not wait at all, so check ctx before each publish.
		if ctx.Err() != nil {
			return
		}

		s.publishOne(ctx, params, seq)
	}
}

// publishOne encodes and publishes one message, logs it, and updates the
// metrics and counts.
func (s *PublishService) publishOne(ctx context.Context, params types.StartParams, seq uint64) {
	metrics.CapturePublishAttempt(params.RunID)

	msg := types.Message{
		RunID:     params.RunID,
		Publisher: env.PeerName.GetValue(),
		Seq:       seq,
		TsUs:      time.Now().UnixMicro(), // taken just before the publish
	}

	reason, err := s.send(ctx, msg, params.Size)
	if err != nil {
		metrics.CapturePublishError(params.RunID, reason)
		s.logger.Warn(common.EventPublishFailed, "run_id", params.RunID, "seq", seq, "reason", reason, "error", err.Error())
	} else {
		metrics.CapturePublishSuccess(params.RunID)
		s.logger.Info(common.EventPublished, "run_id", params.RunID, "seq", seq, "ts_us", msg.TsUs)
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	s.status.Attempts++
	s.status.LastSeq = seq

	if err != nil {
		s.status.Errors++

		return
	}

	s.status.Success++
}

// finish marks the run as stopped, clears the run handles and logs the run counts.
func (s *PublishService) finish() {
	s.mu.Lock()
	s.status.Publishing = false
	s.status.StoppedAt = time.Now().UTC()
	s.cancel()
	s.cancel = nil
	s.done = nil
	status := s.status
	s.mu.Unlock()

	s.logger.Info(common.EventRunStopped,
		"run_id", status.RunID,
		"attempts", status.Attempts,
		"success", status.Success,
		"errors", status.Errors,
		"last_seq", status.LastSeq,
	)
}

// send encodes and publishes one message. On failure, it returns the reason
// for gs_publish_errors_total with the error.
func (s *PublishService) send(ctx context.Context, msg types.Message, size int) (string, error) {
	data, err := utils.EncodeMessage(msg, size)
	if err != nil {
		return common.ReasonEncode, err
	}

	if err := s.publisher.Publish(ctx, data); err != nil {
		return common.ReasonPublish, err
	}

	return "", nil
}

// sendTime returns when message seq (from 1) of a run that starts at start is
// due: start + (seq-1)/rate. It is computed from the start for each message,
// not added up interval by interval, so rounding does not accumulate, and it
// keeps the monotonic clock reading of start (see runDeadline).
func sendTime(start time.Time, seq uint64, rate float64) time.Time {
	return start.Add(time.Duration(float64(seq-1) * float64(time.Second) / rate))
}

// runDeadline returns the end of a timed run that starts at start, or the zero
// time for a run without a duration (until Stop). The deadline keeps the
// monotonic clock reading of start, so the check of each tick against it does
// not depend on the wall clock, which a VM can change during a run. A time
// from UTC() has no monotonic reading: with it, a change of the wall clock
// moved the last tick before the deadline, and a run of 20 s at 10 msg/s
// published 201 messages on the cluster.
func runDeadline(start time.Time, durationS int) time.Time {
	if durationS <= 0 {
		return time.Time{}
	}

	return start.Add(time.Duration(durationS) * time.Second)
}
