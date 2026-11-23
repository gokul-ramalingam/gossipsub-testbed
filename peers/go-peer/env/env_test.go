package env

import (
	"strings"
	"testing"
	"time"
)

// TestDefaults checks the values of the keys that are not set.
func TestDefaults(t *testing.T) {
	t.Setenv(string(PeerName), "go-0")

	if err := Validate(); err != nil {
		t.Fatal(err)
	}

	if port, _ := P2PPort.GetInt(); port != 4001 {
		t.Fatalf("P2P_PORT default %d, want 4001", port)
	}

	if interval, _ := RedialInterval.GetDuration(); interval != 5*time.Second {
		t.Fatalf("REDIAL_INTERVAL default %s, want 5s", interval)
	}

	if mode := Discovery.GetValue(); mode != "static" {
		t.Fatalf("DISCOVERY default %q, want static", mode)
	}

	if name := SRVName.GetValue(); name != "" {
		t.Fatalf("SRV_NAME default %q, want empty", name)
	}
}

// TestValidate checks that each invalid setting stops the peer with an error that names the key.
func TestValidate(t *testing.T) {
	cases := []struct {
		name string            // what the case checks
		env  map[string]string // settings in addition to PEER_NAME=go-0
		key  string            // key that the error must name
	}{
		{"peer name missing", map[string]string{"PEER_NAME": ""}, "PEER_NAME"},
		{"port not a number", map[string]string{"P2P_PORT": "abc"}, "P2P_PORT"},
		{"port out of range", map[string]string{"HTTP_PORT": "70000"}, "HTTP_PORT"},
		{"unknown discovery", map[string]string{"DISCOVERY": "dht"}, "dht"},
		{"srv without name", map[string]string{"DISCOVERY": "srv"}, "SRV_NAME"},
		{"invalid peer", map[string]string{"PEERS": "go-1"}, "PEERS"},
		{"invalid interval", map[string]string{"REDIAL_INTERVAL": "soon"}, "REDIAL_INTERVAL"},
		{"zero interval", map[string]string{"REDIAL_INTERVAL": "0s"}, "REDIAL_INTERVAL"},
	}

	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			t.Setenv(string(PeerName), "go-0")

			for key, value := range c.env {
				t.Setenv(key, value)
			}

			err := Validate()
			if err == nil || !strings.Contains(err.Error(), c.key) {
				t.Fatalf("Validate() = %v, want an error that names %s", err, c.key)
			}
		})
	}
}
