package controllers

import (
	"net/http"

	"github.com/gin-gonic/gin"

	"go-peer/common"
	"go-peer/common/utils"
	"go-peer/services"
)

// StatusController handles the /healthz and /readyz endpoints.
type StatusController struct {
	service *services.StatusService // readiness state
}

// NewStatusController returns a controller with a new status service.
func NewStatusController() *StatusController {
	return &StatusController{
		service: services.NewStatusService(),
	}
}

// GetHealth reports that the process runs.
func (c *StatusController) GetHealth(ctx *gin.Context) {
	ctx.JSON(http.StatusOK, utils.SuccessResponse(nil, "Peer is up and running!"))
}

// IsPeerReady reports that the peer is ready. It does not depend on the peer
// connections: the run script checks the connections before a run starts.
func (c *StatusController) IsPeerReady(ctx *gin.Context) {
	if err := c.service.Ready(); err != nil {
		ctx.JSON(
			http.StatusServiceUnavailable,
			utils.ErrorResponse(common.NotReady, err, "Peer is not ready yet"),
		)

		return
	}

	ctx.JSON(http.StatusOK, utils.SuccessResponse(nil, "Peer is ready!"))
}
