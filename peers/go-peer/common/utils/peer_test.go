package utils

import (
	"errors"
	"testing"

	"go-peer/common"
)

// TestParsePeers checks a valid list, an empty list and an invalid entry.
func TestParsePeers(t *testing.T) {
	targets, err := ParsePeers("go-1=/ip4/127.0.0.1/tcp/4002, go-2=/ip4/127.0.0.1/tcp/4003")
	if err != nil {
		t.Fatal(err)
	}

	if len(targets) != 2 || targets[0].Name != "go-1" || targets[1].Addr.String() != "/ip4/127.0.0.1/tcp/4003" {
		t.Fatalf("unexpected targets %v", targets)
	}

	empty, err := ParsePeers("")
	if err != nil || len(empty) != 0 {
		t.Fatalf("empty list gave %v, %v", empty, err)
	}

	if _, err := ParsePeers("go-1"); !errors.Is(err, common.ErrInvalidPeer) {
		t.Fatalf("missing address gave %v, want ErrInvalidPeer", err)
	}
}
