package publish

import (
	"log/slog"

	"github.com/gin-gonic/gin"

	"go-peer/http/controllers"
	"go-peer/http/services"
)

// Register registers the /publish/start, /publish/stop and /publish/status
// endpoints. The publish service publishes with publisher and logs to logger.
func Register(router gin.IRouter, publisher services.Publisher, logger *slog.Logger) {
	publishController := controllers.NewPublishController(publisher, logger)

	rg := router.Group("/publish")

	rg.POST("/start", publishController.Start)
	rg.POST("/stop", publishController.Stop)
	rg.GET("/status", publishController.Status)
}
