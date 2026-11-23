package p2p

import (
	"sync"

	"github.com/libp2p/go-libp2p/core/peer"
)

// peerNames maps peer IDs to peer names, so that the logs and the metrics name
// a remote peer by its name (go-1) instead of its peer ID. Discovery fills it.
type peerNames struct {
	mu    sync.RWMutex       // guards names
	names map[peer.ID]string // peer ID -> peer name
}

// newPeerNames returns an empty table.
func newPeerNames() *peerNames {
	return &peerNames{names: make(map[peer.ID]string)}
}

// add records the peer name of a peer ID.
func (p *peerNames) add(id peer.ID, name string) {
	p.mu.Lock()
	defer p.mu.Unlock()

	p.names[id] = name
}

// name returns the peer name of a peer ID, or the short peer ID if the peer is unknown.
func (p *peerNames) name(id peer.ID) string {
	p.mu.RLock()
	defer p.mu.RUnlock()

	if name, ok := p.names[id]; ok {
		return name
	}

	return id.ShortString()
}
