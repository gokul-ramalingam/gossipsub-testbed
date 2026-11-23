package middlewares

import (
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"runtime/debug"

	"github.com/gin-gonic/gin"

	"go-peer/common"
	"go-peer/common/utils"
)

// Recovery turns a panic in a handler into a 500 response with the JSON
// response body, and logs it to logger as one http_panic line with the stack.
// It replaces gin.Recovery, which writes text lines.
func Recovery(logger *slog.Logger) gin.HandlerFunc {
	return gin.CustomRecoveryWithWriter(io.Discard, func(ctx *gin.Context, recovered any) {
		logger.Error(common.EventHTTPPanic,
			"method", ctx.Request.Method,
			"path", ctx.Request.URL.Path,
			"error", fmt.Sprint(recovered),
			"stack", string(debug.Stack()),
		)

		ctx.AbortWithStatusJSON(
			http.StatusInternalServerError,
			utils.ErrorResponse(common.InternalError, common.ErrInternal, "Internal server error"),
		)
	})
}
