package services

import (
	"testing"

	"go-peer/common/types"
)

// fakePeerLister returns a fixed list of connected peers.
type fakePeerLister struct {
	peers []types.ConnectedPeer // returned by ConnectedPeers
}

// ConnectedPeers returns the fixed list.
func (f fakePeerLister) ConnectedPeers() []types.ConnectedPeer {
	return f.peers
}

// TestConnections checks the count and the list, and that no peers gives an
// empty list, not null, in the JSON response.
func TestConnections(t *testing.T) {
	none := NewStatusService(fakePeerLister{}).Connections()
	if none.Count != 0 || none.Peers == nil {
		t.Fatalf("no peers gave %+v, want count 0 and an empty list", none)
	}

	two := NewStatusService(fakePeerLister{peers: []types.ConnectedPeer{{Name: "go-1"}, {Name: "go-2"}}}).Connections()
	if two.Count != 2 || two.Peers[0].Name != "go-1" || two.Peers[1].Name != "go-2" {
		t.Fatalf("two peers gave %+v", two)
	}
}
