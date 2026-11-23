package p2p

import (
	"crypto/ed25519"
	"crypto/sha256"

	"github.com/libp2p/go-libp2p/core/crypto"
	"github.com/libp2p/go-libp2p/core/peer"
	"github.com/pkg/errors"
)

// PrivateKey derives the Ed25519 key of a peer from its name. The 32-byte seed is
// sha256(keySeed + ":" + name), used as the Ed25519 seed (RFC 8032). The JS
// peer derives the same key from the same seed, so each peer can compute the
// peer ID of any other peer from its name.
//
// Test-only: any peer can compute the private key of any other peer.
func PrivateKey(keySeed, name string) (crypto.PrivKey, error) {
	seed := sha256.Sum256([]byte(keySeed + ":" + name))

	priv, err := crypto.UnmarshalEd25519PrivateKey(ed25519.NewKeyFromSeed(seed[:]))
	if err != nil {
		return nil, errors.Wrapf(err, "derive key for %s", name)
	}

	return priv, nil
}

// PeerID returns the peer ID of a peer from its name.
func PeerID(keySeed, name string) (peer.ID, error) {
	priv, err := PrivateKey(keySeed, name)
	if err != nil {
		return "", err
	}

	id, err := peer.IDFromPrivateKey(priv)
	if err != nil {
		return "", errors.Wrapf(err, "peer id for %s", name)
	}

	return id, nil
}
