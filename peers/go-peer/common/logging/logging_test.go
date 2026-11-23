package logging

import (
	"bytes"
	"encoding/json"
	"testing"
	"time"
)

// TestLineFields checks that a log line is one JSON object with the common fields.
func TestLineFields(t *testing.T) {
	var buf bytes.Buffer

	newLogger(&buf, "info", "go-0", "12D3KooWExample").Info("received", "seq", 7)

	var line map[string]any
	if err := json.Unmarshal(buf.Bytes(), &line); err != nil {
		t.Fatalf("not one JSON line: %q", buf.String())
	}

	want := map[string]any{"event": "received", "peer": "go-0", "impl": "go", "peer_id": "12D3KooWExample", "seq": 7.0, "level": "INFO"}
	for key, value := range want {
		if line[key] != value {
			t.Fatalf("field %s = %v, want %v (line %s)", key, line[key], value, buf.String())
		}
	}

	ts, ok := line["ts"].(string)
	if !ok {
		t.Fatalf("no ts field: %s", buf.String())
	}

	parsed, err := time.Parse(TimeFormat, ts)
	if err != nil || parsed.Location() != time.UTC {
		t.Fatalf("ts %q is not in TimeFormat in UTC", ts)
	}

	if len(ts) != len("2026-01-02T15:04:05.000000Z") {
		t.Fatalf("ts %q does not have the fixed width", ts)
	}

	if _, found := line["msg"]; found {
		t.Fatalf("msg field is still there: %s", buf.String())
	}
}

// TestLevel checks that the level filters the lines.
func TestLevel(t *testing.T) {
	var buf bytes.Buffer

	logger := newLogger(&buf, "warn", "go-0", "id")
	logger.Info("hidden")
	logger.Warn("shown")

	if bytes.Contains(buf.Bytes(), []byte("hidden")) || !bytes.Contains(buf.Bytes(), []byte("shown")) {
		t.Fatalf("level warn wrote %q", buf.String())
	}
}

// TestTimeSortsAsText checks that two times that differ only in trailing zeros
// keep their order when they are compared as text.
func TestTimeSortsAsText(t *testing.T) {
	earlier := time.Date(2026, 11, 23, 4, 52, 22, 279130000, time.UTC).Format(TimeFormat)
	later := time.Date(2026, 11, 23, 4, 52, 22, 279131000, time.UTC).Format(TimeFormat)

	if earlier >= later {
		t.Fatalf("%q sorts after %q", earlier, later)
	}
}
