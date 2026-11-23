package metrics

import (
	"net/http"

	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promauto"
	"github.com/prometheus/client_golang/prometheus/promhttp"

	"go-peer/common"
)

// Metrics of the peer (docs/plan.md, Metrics). The p2p layer and the publish
// service write them, and the /metrics API reads them. The Go and JS peers use
// the same names and labels. The scraper adds the labels of the scrape target.
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

	// messagesReceived counts the unique deliveries per run and publisher.
	messagesReceived = promauto.NewCounterVec(prometheus.CounterOpts{
		Name: "gs_messages_received_total",
		Help: "Unique messages delivered to this peer.",
	}, []string{"run_id", "publisher"})

	// messagesDuplicate counts the copies of messages that this peer already had.
	messagesDuplicate = promauto.NewCounterVec(prometheus.CounterOpts{
		Name: "gs_messages_duplicate_total",
		Help: "Duplicate copies of messages received by this peer.",
	}, []string{"run_id"})

	// messagesRejected counts the messages that this peer rejected or could not deliver.
	messagesRejected = promauto.NewCounterVec(prometheus.CounterOpts{
		Name: "gs_messages_rejected_total",
		Help: "Messages rejected or not delivered by this peer.",
	}, []string{"reason"})

	// deliveryLatency is the time from publication to unique delivery.
	deliveryLatency = promauto.NewHistogramVec(prometheus.HistogramOpts{
		Name:    "gs_delivery_latency_seconds",
		Help:    "Time from publication to delivery at this peer.",
		Buckets: LatencyBuckets,
	}, []string{"run_id", "publisher", "source"})

	// latencyNegative counts the deliveries with a receive time before the
	// publication time. It must stay at 0 when the peers share one clock.
	latencyNegative = promauto.NewCounterVec(prometheus.CounterOpts{
		Name: "gs_latency_negative_total",
		Help: "Deliveries with a negative latency (clock check).",
	}, []string{"run_id"})

	// rpcControl counts the message IDs in the received IHAVE and IWANT control messages.
	rpcControl = promauto.NewCounterVec(prometheus.CounterOpts{
		Name: "gs_rpc_control_total",
		Help: "Message IDs in the IHAVE and IWANT control messages received by this peer.",
	}, []string{"type"})

	// connectedPeers is the number of peers that this peer is connected to.
	connectedPeers = promauto.NewGauge(prometheus.GaugeOpts{
		Name: "gs_connected_peers",
		Help: "Peers connected to this peer.",
	})

	// topicPeers is the number of peers subscribed to the topic, as this peer knows it.
	topicPeers = promauto.NewGauge(prometheus.GaugeOpts{
		Name: "gs_topic_peers",
		Help: "Peers subscribed to the topic, as this peer knows it.",
	})

	// meshPeers is the number of peers in the GossipSub mesh of this peer for the topic.
	meshPeers = promauto.NewGauge(prometheus.GaugeOpts{
		Name: "gs_mesh_peers",
		Help: "Peers in the GossipSub mesh of this peer for the topic.",
	})
)

// LatencyBuckets are the bucket bounds of gs_delivery_latency_seconds, from
// 0.5 ms to 5 s. The JS peer uses the same bounds.
var LatencyBuckets = []float64{0.0005, 0.001, 0.002, 0.005, 0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5}

// init creates the series of gs_rpc_control_total at 0. Its label values are
// fixed, and a counter series exists only after its first change, so without
// this a dashboard shows "no data" instead of 0 when no IHAVE or IWANT arrives.
func init() {
	rpcControl.WithLabelValues(common.ControlIHave)
	rpcControl.WithLabelValues(common.ControlIWant)
}

// Handler returns the HTTP handler that serves the metrics in the Prometheus text format.
func Handler() http.Handler {
	return promhttp.Handler()
}

// CapturePublishAttempt counts one publish attempt.
func CapturePublishAttempt(runID string) {
	publishAttempts.WithLabelValues(runID).Inc()
}

// CapturePublishSuccess counts one successful publication.
func CapturePublishSuccess(runID string) {
	publishSuccess.WithLabelValues(runID).Inc()
}

// CapturePublishError counts one failed publication with its reason.
func CapturePublishError(runID, reason string) {
	publishErrors.WithLabelValues(runID, reason).Inc()
}

// CaptureDelivery counts one unique delivery and records its latency. A
// negative latency is counted by gs_latency_negative_total, not in the histogram.
func CaptureDelivery(runID, publisher, source string, latencySeconds float64) {
	messagesReceived.WithLabelValues(runID, publisher).Inc()

	if latencySeconds < 0 {
		latencyNegative.WithLabelValues(runID).Inc()

		return
	}

	deliveryLatency.WithLabelValues(runID, publisher, source).Observe(latencySeconds)
}

// CaptureDuplicate counts one duplicate copy of a message.
func CaptureDuplicate(runID string) {
	messagesDuplicate.WithLabelValues(runID).Inc()
}

// CaptureRejected counts one rejected or undeliverable message with its reason.
func CaptureRejected(reason string) {
	messagesRejected.WithLabelValues(reason).Inc()
}

// CaptureRPCControl counts the message IDs of one type of control message.
func CaptureRPCControl(controlType string, count int) {
	rpcControl.WithLabelValues(controlType).Add(float64(count))
}

// SetConnectedPeers sets the number of connected peers.
func SetConnectedPeers(count int) {
	connectedPeers.Set(float64(count))
}

// SetTopicPeers sets the number of peers subscribed to the topic.
func SetTopicPeers(count int) {
	topicPeers.Set(float64(count))
}

// SetMeshPeers sets the number of peers in the mesh.
func SetMeshPeers(count int) {
	meshPeers.Set(float64(count))
}
