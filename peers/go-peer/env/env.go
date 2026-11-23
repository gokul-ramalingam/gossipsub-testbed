package env

import (
	"os"
	"strconv"

	"github.com/pkg/errors"
)

// Peer settings, filled by LoadEnv.
var (
	HTTPPort string // HTTP API port (HTTP_PORT)
	P2PPort  string // libp2p port (P2P_PORT)
	PodName  string // pod name of this peer (POD_NAME)
)

// LoadEnv reads the peer settings from the environment. The ports have the plan
// defaults (HTTP 8080, libp2p 4001). POD_NAME is required: it is the publisher
// name in each message and, later, the seed of the peer key.
func LoadEnv() error {
	var err error

	HTTPPort, err = port("HTTP_PORT", "8080")
	if err != nil {
		return err
	}

	P2PPort, err = port("P2P_PORT", "4001")
	if err != nil {
		return err
	}

	PodName = os.Getenv("POD_NAME")
	if PodName == "" {
		return errors.New("pod name must be set")
	}

	return nil
}

// port reads a port number from key, or returns fallback if key is not set.
func port(key, fallback string) (string, error) {
	value := os.Getenv(key)
	if value == "" {
		return fallback, nil
	}

	n, err := strconv.Atoi(value)
	if err != nil || n < 1 || n > 65535 {
		return "", errors.Errorf("%s must be a port number, got %q", key, value)
	}

	return value, nil
}
