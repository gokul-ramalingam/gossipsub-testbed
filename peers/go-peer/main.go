package main

import (
	"context"
	"log/slog"
	"os"
	"os/signal"
	"syscall"
	"time"

	"go-peer/common"
	"go-peer/common/logging"
	"go-peer/env"
	"go-peer/http"
	"go-peer/p2p"
)

// shutdownTimeout bounds the graceful shutdown of the HTTP server.
const shutdownTimeout = 5 * time.Second

// main checks the settings, starts the p2p layer and the HTTP API, and shuts
// both down on SIGINT or SIGTERM. All output is one JSON line per event on stdout.
func main() {
	if err := env.Validate(); err != nil {
		fatal(logging.New(""), err)
	}

	peerID, err := p2p.LocalPeerID()
	if err != nil {
		fatal(logging.New(""), err)
	}

	logger := logging.New(peerID.String())

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	p2pServer, err := p2p.NewP2PServer(ctx, logger)
	if err != nil {
		fatal(logger, err)
	}

	p2pServer.Start(ctx)

	httpServer, err := http.NewHTTPServer(p2pServer, logger)
	if err != nil {
		fatal(logger, err)
	}

	if err := httpServer.Start(); err != nil {
		fatal(logger, err)
	}

	<-ctx.Done()
	shutdown(httpServer, p2pServer, logger)
}

// shutdown stops the HTTP server first, so that no new request arrives, and
// then closes the p2p layer.
func shutdown(httpServer *http.Server, p2pServer *p2p.Server, logger *slog.Logger) {
	ctx, cancel := context.WithTimeout(context.Background(), shutdownTimeout)
	defer cancel()

	if err := httpServer.Shutdown(ctx); err != nil {
		logger.Warn(common.EventHTTPShutdownFailed, "error", err.Error())
	}

	if err := p2pServer.Close(); err != nil {
		logger.Warn(common.EventP2PCloseFailed, "error", err.Error())
	}
}

// fatal logs startup_failed and exits with status 1.
func fatal(logger *slog.Logger, err error) {
	logger.Error(common.EventStartupFailed, "error", err.Error())
	os.Exit(1)
}
