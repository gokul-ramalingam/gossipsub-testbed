package publish

import (
	"github.com/gin-gonic/gin"

	"go-peer/controllers"
)

// Register registers the /publish/start, /publish/stop and /publish/status endpoints.
func Register(router gin.IRouter) {
	publishController := controllers.NewPublishController()

	rg := router.Group("/publish")

	rg.POST("/start", publishController.Start)
	rg.POST("/stop", publishController.Stop)
	rg.GET("/status", publishController.Status)
}
