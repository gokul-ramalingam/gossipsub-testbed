package status

import (
	"github.com/gin-gonic/gin"

	"go-peer/controllers"
)

// Register registers GET /healthz and GET /readyz.
func Register(router gin.IRouter) {
	statusController := controllers.NewStatusController()

	router.GET("/healthz", statusController.GetHealth)
	router.GET("/readyz", statusController.IsPeerReady)
}
