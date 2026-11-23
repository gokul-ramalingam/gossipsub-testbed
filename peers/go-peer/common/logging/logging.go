package logging

import (
	"io"
	"log/slog"
	"os"
	"strings"

	"go-peer/env"
)

// Impl is the implementation name in each log line. The JS peer writes "js".
const Impl = "go"

// TimeFormat is the format of the ts field: RFC 3339 in UTC with exactly six
// fraction digits. The fixed width keeps the lines in time order when they are
// sorted as text; time.RFC3339Nano drops trailing zeros and does not.
const TimeFormat = "2006-01-02T15:04:05.000000Z07:00"

// Field names of each log line. The Go and JS peers use the same names.
const (
	// FieldTime is the time of the event, in TimeFormat.
	FieldTime = "ts"
	// FieldEvent is the event name, for example received.
	FieldEvent = "event"
	// FieldPeer is the name of the peer that writes the line.
	FieldPeer = "peer"
	// FieldImpl is the implementation of the peer: go or js.
	FieldImpl = "impl"
	// FieldPeerID is the libp2p peer ID of the peer that writes the line.
	FieldPeerID = "peer_id"
)

// New returns the logger of this peer: JSON lines on stdout, with the peer
// name and the level from env, and the given peer ID. Before the peer ID is
// known, for example when the settings are invalid, peerID is empty.
func New(peerID string) *slog.Logger {
	return newLogger(os.Stdout, env.LogLevel.GetValue(), env.PeerName.GetValue(), peerID)
}

// newLogger returns a logger that writes one JSON line per event to w, with
// the common fields ts, event, peer, impl and peer_id on each line. level is
// debug, info, warn or error; any other value means info.
func newLogger(w io.Writer, level, peerName, peerID string) *slog.Logger {
	handler := slog.NewJSONHandler(w, &slog.HandlerOptions{
		Level:       parseLevel(level),
		ReplaceAttr: replaceAttr,
	})

	return slog.New(handler).With(FieldPeer, peerName, FieldImpl, Impl, FieldPeerID, peerID)
}

// replaceAttr renames the built-in fields of slog: time becomes ts, in UTC, and
// msg becomes event. The level stays.
func replaceAttr(groups []string, attr slog.Attr) slog.Attr {
	if len(groups) > 0 {
		return attr
	}

	switch attr.Key {
	case slog.TimeKey:
		return slog.String(FieldTime, attr.Value.Time().UTC().Format(TimeFormat))
	case slog.MessageKey:
		return slog.String(FieldEvent, attr.Value.String())
	}

	return attr
}

// parseLevel converts a level name into a slog level. Unknown names give info.
func parseLevel(level string) slog.Level {
	switch strings.ToLower(level) {
	case "debug":
		return slog.LevelDebug
	case "warn":
		return slog.LevelWarn
	case "error":
		return slog.LevelError
	default:
		return slog.LevelInfo
	}
}
