package services

import (
	"go-peer/common/types"
)

// StatusService reports the state of the peer.
type StatusService struct {
	peers PeerLister // lists the connected peers
}

// NewStatusService returns a status service that lists the connected peers with peers.
func NewStatusService(peers PeerLister) *StatusService {
	return &StatusService{peers: peers}
}

// Connections returns the connected peers and their number.
func (s *StatusService) Connections() types.Connections {
	peers := s.peers.ConnectedPeers()
	if peers == nil {
		peers = []types.ConnectedPeer{}
	}

	return types.Connections{Count: len(peers), Peers: peers}
}
