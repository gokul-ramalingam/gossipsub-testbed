package types

import ma "github.com/multiformats/go-multiaddr"

// Target is one peer found by discovery.
type Target struct {
	Name string       // peer name, for example go-1
	Addr ma.Multiaddr // address to dial, without the /p2p/<peer ID> part
}

// ConnectedPeer is one remote peer that this peer is connected to.
type ConnectedPeer struct {
	Name   string   `json:"name"`    // peer name, or the short peer ID if the peer is unknown
	PeerID string   `json:"peer_id"` // libp2p peer ID
	Addrs  []string `json:"addrs"`   // remote address of each connection, without /p2p/<peer ID>; a pair can have two
}
