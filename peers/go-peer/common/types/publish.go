package types

import "time"

// StartParams is the body of POST /publish/start. The JSON fields are shared with the JS peer.
type StartParams struct {
	RunID     string  `json:"run_id" validate:"required"`         // run identifier, written to each message and metric
	Rate      float64 `json:"rate" validate:"gt=0,lte=1000"`      // messages per second
	Size      int     `json:"size" validate:"gte=256,lte=524288"` // bytes per encoded message
	DurationS int     `json:"duration_s" validate:"gte=0"`        // 0 = until POST /publish/stop
}

// PublishStatus is the response of the /publish/* endpoints.
type PublishStatus struct {
	Publishing bool      `json:"publishing"`          // true while a run is in progress
	RunID      string    `json:"run_id,omitempty"`    // current or last run
	Rate       float64   `json:"rate,omitempty"`      // messages per second of the run
	Size       int       `json:"size,omitempty"`      // bytes per encoded message of the run
	DurationS  int       `json:"duration_s"`          // run length in seconds, 0 = until stopped
	StartedAt  time.Time `json:"started_at,omitzero"` // start time of the run, UTC
	StoppedAt  time.Time `json:"stopped_at,omitzero"` // end time of the run, UTC
	Attempts   uint64    `json:"attempts"`            // publish attempts in the run
	Success    uint64    `json:"success"`             // successful publications in the run
	Errors     uint64    `json:"errors"`              // failed publications in the run
	LastSeq    uint64    `json:"last_seq"`            // sequence number of the last attempt
}
