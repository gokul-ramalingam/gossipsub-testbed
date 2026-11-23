package types

// Connections is the response of GET /connections.
type Connections struct {
	Count int             `json:"count"` // number of connected peers
	Peers []ConnectedPeer `json:"peers"` // connected peers, sorted by name
}
