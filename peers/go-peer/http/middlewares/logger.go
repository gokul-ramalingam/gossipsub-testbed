package middlewares

import (
	"log/slog"
	"time"

	"github.com/gin-gonic/gin"

	"go-peer/common"
)

// quietPaths are the paths that are not logged. Prometheus scrapes /metrics
// every few seconds, the probes call /healthz often, and the run script polls
// /connections until the network is ready, so their lines would hide the
// events of the experiment.
var quietPaths = map[string]struct{}{
	"/metrics":     {},
	"/healthz":     {},
	"/connections": {},
}

// RequestLogger logs one http_request line to logger for each API request,
// after the handler, with the method, path, status and duration.
func RequestLogger(logger *slog.Logger) gin.HandlerFunc {
	return func(ctx *gin.Context) {
		start := time.Now()

		ctx.Next()

		if _, quiet := quietPaths[ctx.Request.URL.Path]; quiet {
			return
		}

		logger.Info(common.EventHTTPRequest,
			"method", ctx.Request.Method,
			"path", ctx.Request.URL.Path,
			"status", ctx.Writer.Status(),
			"duration_us", time.Since(start).Microseconds(),
		)
	}
}
