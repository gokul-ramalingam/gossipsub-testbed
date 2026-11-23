package metrics

import (
	"github.com/gin-gonic/gin"

	"go-peer/controllers"
)

// Register registers GET /metrics.
func Register(router gin.IRouter) {
	metricsController := controllers.NewMetricsController()

	router.GET("/metrics", metricsController.GetMetrics)
}
