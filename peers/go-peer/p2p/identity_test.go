package p2p

import (
	"testing"
)

// Values used by the tests.
const (
	// testKeySeed is the key seed used by the tests.
	testKeySeed = "gossipsub-testbed"
	// testTopic is the GossipSub topic used by the tests.
	testTopic = "gossipsub-testbed"
	// goldenPeerID is the peer ID of go-0 with testKeySeed.
	goldenPeerID = "12D3KooWHZAu1VmTeA2Zh2CFgBUUoFaYKYp9yppWygjjSPEaA3Mu"
)

// TestPeerIDIsStable checks that a name always gets the same peer ID.
func TestPeerIDIsStable(t *testing.T) {
	first, err := PeerID(testKeySeed, "go-0")
	if err != nil {
		t.Fatal(err)
	}

	second, err := PeerID(testKeySeed, "go-0")
	if err != nil {
		t.Fatal(err)
	}

	if first != second {
		t.Fatalf("peer id changed: %s, then %s", first, second)
	}
}

// TestPeerIDDiffers checks that the peer name and the key seed both change the peer ID.
func TestPeerIDDiffers(t *testing.T) {
	base, err := PeerID(testKeySeed, "go-0")
	if err != nil {
		t.Fatal(err)
	}

	otherName, err := PeerID(testKeySeed, "go-1")
	if err != nil {
		t.Fatal(err)
	}

	otherSeed, err := PeerID("other-seed", "go-0")
	if err != nil {
		t.Fatal(err)
	}

	if base == otherName {
		t.Fatalf("go-0 and go-1 have the same peer id %s", base)
	}

	if base == otherSeed {
		t.Fatalf("two key seeds give the same peer id %s", base)
	}
}

// TestPeerIDGolden pins the peer ID of go-0. The JS peer must derive the same
// value from the same seed; if this test changes, the JS peer must change too.
func TestPeerIDGolden(t *testing.T) {
	id, err := PeerID(testKeySeed, "go-0")
	if err != nil {
		t.Fatal(err)
	}

	if id.String() != goldenPeerID {
		t.Fatalf("peer id of go-0 is %s, want %s", id, goldenPeerID)
	}
}
