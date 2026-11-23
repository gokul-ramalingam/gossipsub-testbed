package types

// Message is the GossipSub payload. The JSON fields are shared with the JS peer.
type Message struct {
	RunID     string `json:"run_id"`    // run that the message belongs to
	Publisher string `json:"publisher"` // name of the publisher
	Seq       uint64 `json:"seq"`       // sequence number, from 1 in each run
	TsUs      int64  `json:"ts_us"`     // publication time, Unix microseconds
	Payload   string `json:"payload"`   // padding up to the requested size
}
