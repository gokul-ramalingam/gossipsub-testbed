package services

import (
	"context"
	"sync"
	"time"

	"go-peer/common"
	"go-peer/common/types"
	"go-peer/common/utils"
	"go-peer/env"
)

// PublishFunc publishes one encoded message to the topic.
type PublishFunc func(ctx context.Context, data []byte) error

// publishToTopic is a placeholder. It is replaced by the GossipSub topic publish
// when the libp2p layer is added. Until then, each attempt counts as an error.
var publishToTopic PublishFunc = func(ctx context.Context, data []byte) error {
	return common.ErrGossipSubNotReady
}

// PublishService publishes one run at a time. Sequence numbers start at 1 in each run.
type PublishService struct {
	publish PublishFunc // publishes one message to the topic

	mu     sync.Mutex          // guards the fields below
	status types.PublishStatus // state and counts of the current or last run
	cancel context.CancelFunc  // ends the current run, nil when idle
	done   chan struct{}       // closed when the publish loop exits, nil when idle
}

// NewPublishService returns an idle publish service.
func NewPublishService() *PublishService {
	return &PublishService{
		publish: publishToTopic,
	}
}

// Start begins a run in the background and returns its initial status. It
// returns ErrAlreadyPublishing if a run is in progress.
func (s *PublishService) Start(params types.StartParams) (types.PublishStatus, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	if s.status.Publishing {
		return s.status, common.ErrAlreadyPublishing
	}

	var (
		ctx    context.Context
		cancel context.CancelFunc
	)

	if params.DurationS > 0 {
		ctx, cancel = context.WithTimeout(context.Background(), time.Duration(params.DurationS)*time.Second)
	} else {
		ctx, cancel = context.WithCancel(context.Background())
	}

	s.status = types.PublishStatus{
		Publishing: true,
		RunID:      params.RunID,
		Rate:       params.Rate,
		Size:       params.Size,
		DurationS:  params.DurationS,
		StartedAt:  time.Now().UTC(),
	}
	s.cancel = cancel
	s.done = make(chan struct{})

	go s.run(ctx, params, s.done)

	return s.status, nil
}

// Stop ends the current run and waits for the publish loop to exit. It returns
// the final status. If no run is in progress, it returns the last status.
func (s *PublishService) Stop() types.PublishStatus {
	s.mu.Lock()
	cancel, done := s.cancel, s.done
	s.mu.Unlock()

	if cancel != nil {
		cancel()
		<-done
	}

	return s.Status()
}

// Status returns the state and counts of the current or last run.
func (s *PublishService) Status() types.PublishStatus {
	s.mu.Lock()
	defer s.mu.Unlock()

	return s.status
}

// run publishes one message per tick until ctx is done, by Stop or by the
// run duration.
func (s *PublishService) run(ctx context.Context, params types.StartParams, done chan struct{}) {
	defer close(done)
	defer s.finish()

	ticker := time.NewTicker(time.Duration(float64(time.Second) / params.Rate))
	defer ticker.Stop()

	for seq := uint64(1); ; seq++ {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}

		s.publishOne(ctx, params, seq)
	}
}

// publishOne encodes and publishes one message, and updates the metrics and counts.
func (s *PublishService) publishOne(ctx context.Context, params types.StartParams, seq uint64) {
	capturePublishAttempt(params.RunID)

	msg := types.Message{
		RunID:     params.RunID,
		Publisher: env.PodName,
		Seq:       seq,
		TsUs:      time.Now().UnixMicro(), // taken just before the publish
	}

	data, err := utils.EncodeMessage(msg, params.Size)
	if err == nil {
		err = s.publish(ctx, data)
		if err != nil {
			capturePublishError(params.RunID, common.ReasonPublish)
		}
	} else {
		capturePublishError(params.RunID, common.ReasonEncode)
	}

	if err == nil {
		capturePublishSuccess(params.RunID)
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

// finish marks the run as stopped and clears the run handles.
func (s *PublishService) finish() {
	s.mu.Lock()
	defer s.mu.Unlock()

	s.status.Publishing = false
	s.status.StoppedAt = time.Now().UTC()
	s.cancel()
	s.cancel = nil
	s.done = nil
}
