package p2p

import (
	"context"
	"fmt"
	"io"
	"log/slog"
	"net"
	"testing"
	"time"

	ma "github.com/multiformats/go-multiaddr"

	"go-peer/common"
	"go-peer/common/types"
)

// TestSRVTarget checks that an SRV answer gives the peer name and a /dns4 address.
func TestSRVTarget(t *testing.T) {
	target, err := srvTarget("js-1.peers.dst.svc.cluster.local.", 4001)
	if err != nil {
		t.Fatal(err)
	}

	if target.Name != "js-1" {
		t.Fatalf("name %q, want js-1", target.Name)
	}

	if want := "/dns4/js-1.peers.dst.svc.cluster.local/tcp/4001"; target.Addr.String() != want {
		t.Fatalf("addr %s, want %s", target.Addr, want)
	}
}

// TestStaticDiscoveryConnectsAll starts three servers with the static
// discovery and checks that each one connects to the two others.
func TestStaticDiscoveryConnectsAll(t *testing.T) {
	names := []string{"go-0", "go-1", "go-2"}
	ports := make([]int, len(names))
	peers := make([]types.Target, len(names))

	for i, name := range names {
		ports[i] = freePort(t)
		peers[i] = types.Target{Name: name, Addr: ma.StringCast(fmt.Sprintf("/ip4/127.0.0.1/tcp/%d", ports[i]))}
	}

	ctx, cancel := context.WithCancel(context.Background())
	t.Cleanup(cancel)

	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	servers := make([]*Server, len(names))

	for i, name := range names {
		server, err := New(ctx, Config{
			PeerName:       name,
			KeySeed:        testKeySeed,
			Port:           ports[i],
			Topic:          testTopic,
			Discovery:      common.DiscoveryStatic,
			StaticPeers:    peers,
			RedialInterval: 200 * time.Millisecond,
		}, logger)
		if err != nil {
			t.Fatal(err)
		}

		t.Cleanup(func() { _ = server.Close() })

		server.Start(ctx)
		servers[i] = server
	}

	deadline := time.Now().Add(10 * time.Second)

	for _, server := range servers {
		for len(server.ConnectedPeers()) < len(names)-1 {
			if time.Now().After(deadline) {
				t.Fatalf("%s has %d connected peers, want %d", server.ID(), len(server.ConnectedPeers()), len(names)-1)
			}

			time.Sleep(50 * time.Millisecond)
		}
	}

	// go-0 lists the two others by name, sorted, with their peer IDs and addresses.
	listed := servers[0].ConnectedPeers()
	for i, want := range []string{"go-1", "go-2"} {
		id, err := PeerID(testKeySeed, want)
		if err != nil {
			t.Fatal(err)
		}

		if listed[i].Name != want || listed[i].PeerID != id.String() || len(listed[i].Addrs) == 0 {
			t.Fatalf("connected peer %d is %+v, want %s with peer ID %s and an address", i, listed[i], want, id)
		}
	}
}

// TestSimultaneousDial starts two servers at the same time with redial timers
// in phase, so that they dial each other at the same moment, and checks that
// they connect. With TCP port reuse on, they never do.
func TestSimultaneousDial(t *testing.T) {
	for trial := range 3 {
		ports := []int{freePort(t), freePort(t)}
		peers := []types.Target{
			{Name: "go-0", Addr: ma.StringCast(fmt.Sprintf("/ip4/127.0.0.1/tcp/%d", ports[0]))},
			{Name: "go-1", Addr: ma.StringCast(fmt.Sprintf("/ip4/127.0.0.1/tcp/%d", ports[1]))},
		}

		ctx, cancel := context.WithCancel(context.Background())
		logger := slog.New(slog.NewTextHandler(io.Discard, nil))
		servers := make([]*Server, len(peers))

		for i, target := range peers {
			server, err := New(ctx, Config{
				PeerName:       target.Name,
				KeySeed:        testKeySeed,
				Port:           ports[i],
				Topic:          testTopic,
				Discovery:      common.DiscoveryStatic,
				StaticPeers:    peers,
				RedialInterval: time.Second,
			}, logger)
			if err != nil {
				t.Fatal(err)
			}

			servers[i] = server
		}

		for _, server := range servers {
			server.Start(ctx)
		}

		deadline := time.Now().Add(3 * time.Second)
		for len(servers[0].ConnectedPeers()) < 1 && time.Now().Before(deadline) {
			time.Sleep(50 * time.Millisecond)
		}

		connected := len(servers[0].ConnectedPeers())

		cancel()

		for _, server := range servers {
			_ = server.Close()
		}

		if connected < 1 {
			t.Fatalf("trial %d: go-0 and go-1 did not connect within 3 s", trial)
		}
	}
}

// freePort returns a TCP port that is free at the time of the call.
func freePort(t *testing.T) int {
	t.Helper()

	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer listener.Close()

	addr, ok := listener.Addr().(*net.TCPAddr)
	if !ok {
		t.Fatalf("unexpected address type %T", listener.Addr())
	}

	return addr.Port
}
