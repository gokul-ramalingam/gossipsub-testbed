package routers

import (
	"net/http"

	"github.com/gin-gonic/gin"

	"go-peer/common"
	"go-peer/common/utils"
	"go-peer/routers/metrics"
	"go-peer/routers/publish"
	"go-peer/routers/status"
)

// Init registers the peer API on the server. The paths are at the root, with no
// /api prefix: the Go and JS peers share the same paths (docs/plan.md, HTTP API).
func Init(server *gin.Engine) {
	status.Register(server)
	publish.Register(server)
	metrics.Register(server)

	// Unknown paths and methods get the same JSON response body as the API.
	server.HandleMethodNotAllowed = true
	server.NoRoute(notFound)
	server.NoMethod(methodNotAllowed)
}

// notFound answers a request to a path that the API does not have.
func notFound(ctx *gin.Context) {
	ctx.JSON(
		http.StatusNotFound,
		utils.ErrorResponse(common.NotFound, common.ErrNotFound, "Path not found"),
	)
}

// methodNotAllowed answers a request to a known path with a method that the path does not accept.
func methodNotAllowed(ctx *gin.Context) {
	ctx.JSON(
		http.StatusMethodNotAllowed,
		utils.ErrorResponse(common.MethodNotAllowed, common.ErrMethodNotAllowed, "Method not allowed on this path"),
	)
}
