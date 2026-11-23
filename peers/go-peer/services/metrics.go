package services

import (
	"net/http"

	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promauto"
	"github.com/prometheus/client_golang/prometheus/promhttp"
)

// Publisher metrics (docs/plan.md, Metrics). The Go and JS peers use the same
// names and labels. Prometheus adds pod and impl from the scrape.
var (
	// publishAttempts counts the publish attempts per run.
	publishAttempts = promauto.NewCounterVec(prometheus.CounterOpts{
		Name: "gs_publish_attempts_total",
		Help: "Publish attempts by this peer.",
	}, []string{"run_id"})

	// publishSuccess counts the successful publications per run.
	publishSuccess = promauto.NewCounterVec(prometheus.CounterOpts{
		Name: "gs_publish_success_total",
		Help: "Successful publications by this peer.",
	}, []string{"run_id"})

	// publishErrors counts the failed publications per run and reason.
	publishErrors = promauto.NewCounterVec(prometheus.CounterOpts{
		Name: "gs_publish_errors_total",
		Help: "Failed publications by this peer.",
	}, []string{"run_id", "reason"})
)

// MetricsService exposes the Prometheus metrics.
type MetricsService struct{}

// NewMetricsService returns a metrics service.
func NewMetricsService() *MetricsService {
	return &MetricsService{}
}

// Handler returns the HTTP handler that serves the metrics.
func (s *MetricsService) Handler() http.Handler {
	return promhttp.Handler()
}

// capturePublishAttempt counts one publish attempt.
func capturePublishAttempt(runID string) {
	publishAttempts.WithLabelValues(runID).Inc()
}

// capturePublishSuccess counts one successful publication.
func capturePublishSuccess(runID string) {
	publishSuccess.WithLabelValues(runID).Inc()
}

// capturePublishError counts one failed publication with its reason.
func capturePublishError(runID, reason string) {
	publishErrors.WithLabelValues(runID, reason).Inc()
}
