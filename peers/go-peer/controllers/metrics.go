package controllers

import (
	"net/http"

	"github.com/gin-gonic/gin"

	"go-peer/services"
)

// MetricsController handles the /metrics endpoint.
type MetricsController struct {
	handler http.Handler // Prometheus handler
}

// NewMetricsController returns a controller with the Prometheus handler.
func NewMetricsController() *MetricsController {
	return &MetricsController{
		handler: services.NewMetricsService().Handler(),
	}
}

// GetMetrics serves the Prometheus text format, not the JSON response body.
func (c *MetricsController) GetMetrics(ctx *gin.Context) {
	c.handler.ServeHTTP(ctx.Writer, ctx.Request)
}
