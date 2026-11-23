package p2p

import (
	"context"
	"testing"
	"time"

	"github.com/libp2p/go-libp2p/core/network"
	"github.com/libp2p/go-libp2p/core/peer"
)

// newTestHost starts a host for name on a free port and closes it at the end of the test.
func newTestHost(t *testing.T, name string) peer.AddrInfo {
	t.Helper()

	priv, err := PrivateKey(testKeySeed, name)
	if err != nil {
		t.Fatal(err)
	}

	h, err := NewHost(priv, 0)
	if err != nil {
		t.Fatal(err)
	}

	t.Cleanup(func() { _ = h.Close() })

	return peer.AddrInfo{ID: h.ID(), Addrs: h.Addrs()}
}

// TestHostIDMatchesPeerID checks that a host gets the peer ID that other peers compute for it.
func TestHostIDMatchesPeerID(t *testing.T) {
	info := newTestHost(t, "go-0")

	want, err := PeerID(testKeySeed, "go-0")
	if err != nil {
		t.Fatal(err)
	}

	if info.ID != want {
		t.Fatalf("host id %s, computed id %s", info.ID, want)
	}
}

// TestHostsConnect checks that two hosts connect over TCP, Noise and yamux.
func TestHostsConnect(t *testing.T) {
	priv, err := PrivateKey(testKeySeed, "go-0")
	if err != nil {
		t.Fatal(err)
	}

	h0, err := NewHost(priv, 0)
	if err != nil {
		t.Fatal(err)
	}

	t.Cleanup(func() { _ = h0.Close() })

	target := newTestHost(t, "go-1")

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	if err := h0.Connect(ctx, target); err != nil {
		t.Fatal(err)
	}

	if h0.Network().Connectedness(target.ID) != network.Connected {
		t.Fatalf("go-0 is not connected to go-1")
	}
}

// TestYamuxKeepAlive checks the keepalive value that the report records.
func TestYamuxKeepAlive(t *testing.T) {
	if got := YamuxKeepAlive(); got != 30*time.Second {
		t.Fatalf("yamux keepalive %s, want 30s", got)
	}
}
