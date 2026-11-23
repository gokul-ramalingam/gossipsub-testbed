package controllers

import (
	"net/http"

	"github.com/gin-gonic/gin"

	"go-peer/common/utils"
	"go-peer/http/services"
)

// StatusController handles the /healthz and /connections endpoints.
type StatusController struct {
	service *services.StatusService // state of the peer
}

// NewStatusController returns a controller with a new status service that
// lists the connected peers with peers.
func NewStatusController(peers services.PeerLister) *StatusController {
	return &StatusController{
		service: services.NewStatusService(peers),
	}
}

// GetHealth reports that the process runs.
func (c *StatusController) GetHealth(ctx *gin.Context) {
	ctx.JSON(http.StatusOK, utils.SuccessResponse(nil, "Peer is up and running!"))
}

// GetConnections returns the peers that this peer is connected to.
func (c *StatusController) GetConnections(ctx *gin.Context) {
	ctx.JSON(http.StatusOK, utils.SuccessResponse(c.service.Connections(), "Connected peers"))
}
