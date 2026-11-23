package utils

import (
	"strings"

	ma "github.com/multiformats/go-multiaddr"
	"github.com/pkg/errors"

	"go-peer/common"
	"go-peer/common/types"
)

// ParsePeers parses a comma-separated list of <peer name>=<multiaddr> entries,
// for example "go-1=/ip4/127.0.0.1/tcp/4002,go-2=/ip4/127.0.0.1/tcp/4003".
// An empty list returns no peers.
func ParsePeers(list string) ([]types.Target, error) {
	var targets []types.Target

	for _, entry := range strings.Split(list, ",") {
		entry = strings.TrimSpace(entry)
		if entry == "" {
			continue
		}

		name, addr, found := strings.Cut(entry, "=")
		if !found || name == "" || addr == "" {
			return nil, errors.Wrap(common.ErrInvalidPeer, entry)
		}

		maddr, err := ma.NewMultiaddr(addr)
		if err != nil {
			return nil, errors.Wrapf(err, "invalid multiaddr for %s", name)
		}

		targets = append(targets, types.Target{Name: name, Addr: maddr})
	}

	return targets, nil
}
