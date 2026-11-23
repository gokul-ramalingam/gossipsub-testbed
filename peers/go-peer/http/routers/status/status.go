package status

import (
	"github.com/gin-gonic/gin"

	"go-peer/http/controllers"
	"go-peer/http/services"
)

// Register registers GET /healthz and GET /connections. The status service
// lists the connected peers with peers.
func Register(router gin.IRouter, peers services.PeerLister) {
	statusController := controllers.NewStatusController(peers)

	router.GET("/healthz", statusController.GetHealth)
	router.GET("/connections", statusController.GetConnections)
}
