package http

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net"
	nethttp "net/http"
	"os"
	"time"

	"github.com/gin-gonic/gin"

	"go-peer/common"
	"go-peer/env"
	"go-peer/http/middlewares"
	"go-peer/http/routers"
	"go-peer/http/services"
)

// readHeaderTimeout bounds the time to read the headers of a request.
const readHeaderTimeout = 5 * time.Second

// Server is the HTTP API of the peer.
type Server struct {
	logger *slog.Logger    // logger of the peer
	server *nethttp.Server // HTTP server with the Gin engine as handler
}

// NewHTTPServer returns the HTTP API on HTTP_PORT. The API publishes and lists
// the connected peers with node (the p2p server), and logs to logger.
func NewHTTPServer(node services.Node, logger *slog.Logger) (*Server, error) {
	port, err := env.HTTPPort.GetInt()
	if err != nil {
		return nil, err
	}

	return &Server{
		logger: logger,
		server: &nethttp.Server{
			Addr:              fmt.Sprintf(":%d", port),
			Handler:           newEngine(node, logger),
			ReadHeaderTimeout: readHeaderTimeout,
		},
	}, nil
}

// Start binds the port and serves in the background. It returns an error if
// the port cannot be bound.
func (s *Server) Start() error {
	listener, err := net.Listen("tcp", s.server.Addr)
	if err != nil {
		return err
	}

	go func() {
		if err := s.server.Serve(listener); err != nil && !errors.Is(err, nethttp.ErrServerClosed) {
			s.logger.Error(common.EventHTTPServeFailed, "error", err.Error())
		}
	}()

	return nil
}

// Shutdown stops the server. It waits for the requests in progress until ctx is done.
func (s *Server) Shutdown(ctx context.Context) error {
	return s.server.Shutdown(ctx)
}

// newEngine returns the Gin engine of the API, with the JSON request log and
// panic recovery instead of the text ones of gin.Default, both writing to
// logger. The handlers publish and list the connected peers with node. Gin runs
// in release mode unless GIN_MODE is set, so that it does not print its route list.
func newEngine(node services.Node, logger *slog.Logger) *gin.Engine {
	if os.Getenv(gin.EnvGinMode) == "" {
		gin.SetMode(gin.ReleaseMode)
	}

	engine := gin.New()
	engine.Use(middlewares.Recovery(logger), middlewares.RequestLogger(logger))
	routers.Init(engine, node, logger)

	return engine
}
