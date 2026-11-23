package env

import (
	"os"
	"strconv"
	"time"

	"github.com/pkg/errors"

	"go-peer/common"
	"go-peer/common/types"
	"go-peer/common/utils"
)

// Key is the name of one environment variable of the peer.
type Key string

// Settings of the peer.
const (
	// PeerName is the name of this peer, for example go-0. Required: it is the
	// publisher name in each message and the seed of the peer key.
	PeerName Key = "PEER_NAME"
	// HTTPPort is the port of the HTTP API.
	HTTPPort Key = "HTTP_PORT"
	// P2PPort is the libp2p TCP port.
	P2PPort Key = "P2P_PORT"
	// KeySeed is the seed of the peer keys, the same on all peers.
	KeySeed Key = "KEY_SEED"
	// Topic is the GossipSub topic of the testbed.
	Topic Key = "TOPIC"
	// Discovery is the discovery mode: static (the PEERS list) or srv (a DNS SRV lookup).
	Discovery Key = "DISCOVERY"
	// SRVName is the DNS name of the SRV lookup. Required when Discovery is srv.
	SRVName Key = "SRV_NAME"
	// Peers is the list of the static discovery: <peer name>=<multiaddr>, separated by commas.
	Peers Key = "PEERS"
	// RedialInterval is the time between two discovery rounds, for example 5s.
	RedialInterval Key = "REDIAL_INTERVAL"
	// LogLevel is debug, info, warn or error. Any other value means info.
	LogLevel Key = "LOG_LEVEL"
)

// defaults are the values of the keys that are not set. A key without a default is empty.
var defaults = map[Key]string{
	HTTPPort:       "8080",
	P2PPort:        "4001",
	KeySeed:        "gossipsub-testbed",
	Topic:          "gossipsub-testbed",
	Discovery:      common.DiscoveryStatic,
	RedialInterval: "5s",
	LogLevel:       "info",
}

// GetValue returns the value of the key, or its default if it is not set.
func (key Key) GetValue() string {
	if value := os.Getenv(string(key)); value != "" {
		return value
	}

	return defaults[key]
}

// GetInt returns the value of the key as an integer.
func (key Key) GetInt() (int, error) {
	n, err := strconv.Atoi(key.GetValue())
	if err != nil {
		return 0, errors.Errorf("%s must be an integer, got %q", key, key.GetValue())
	}

	return n, nil
}

// GetDuration returns the value of the key as a duration, for example 5s.
func (key Key) GetDuration() (time.Duration, error) {
	d, err := time.ParseDuration(key.GetValue())
	if err != nil {
		return 0, errors.Errorf("%s must be a duration, got %q", key, key.GetValue())
	}

	return d, nil
}

// GetPeers returns the value of the key as a list of peers: <peer name>=<multiaddr>, separated by commas.
func (key Key) GetPeers() ([]types.Target, error) {
	peers, err := utils.ParsePeers(key.GetValue())
	if err != nil {
		return nil, errors.Wrap(err, string(key))
	}

	return peers, nil
}

// Validate checks all settings once at start, so that the getters cannot fail
// later: the required keys, the port ranges, the discovery mode, the PEERS list
// and the redial interval.
func Validate() error {
	if PeerName.GetValue() == "" {
		return errors.Errorf("%s must be set", PeerName)
	}

	for _, key := range []Key{HTTPPort, P2PPort} {
		port, err := key.GetInt()
		if err != nil {
			return err
		}

		if port < 1 || port > 65535 {
			return errors.Errorf("%s must be a port number, got %d", key, port)
		}
	}

	switch Discovery.GetValue() {
	case common.DiscoveryStatic:
	case common.DiscoverySRV:
		if SRVName.GetValue() == "" {
			return errors.Errorf("%s must be set when %s is %s", SRVName, Discovery, common.DiscoverySRV)
		}
	default:
		return errors.Wrap(common.ErrInvalidDiscovery, Discovery.GetValue())
	}

	if _, err := Peers.GetPeers(); err != nil {
		return err
	}

	interval, err := RedialInterval.GetDuration()
	if err != nil {
		return err
	}

	if interval <= 0 {
		return errors.Errorf("%s must be positive, got %s", RedialInterval, interval)
	}

	return nil
}
