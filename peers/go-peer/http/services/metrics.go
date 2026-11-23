package services

import (
	"net/http"

	"go-peer/metrics"
)

// MetricsService exposes the metrics of the shared metrics package.
type MetricsService struct{}

// NewMetricsService returns a metrics service.
func NewMetricsService() *MetricsService {
	return &MetricsService{}
}

// Handler returns the HTTP handler that serves the metrics.
func (s *MetricsService) Handler() http.Handler {
	return metrics.Handler()
}
