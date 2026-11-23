/**
 * Returns the handler of /metrics.
 *
 * @param {import('../services/metrics.js').MetricsService} service - the metrics of the peer
 * @returns {{ getMetrics: import('express').RequestHandler }} the handler
 */
export function metricsController(service) {
  return {
    /** Serves the Prometheus text format, not the JSON response body. */
    async getMetrics(req, res) {
      res
        .status(200)
        .type(service.contentType())
        .send(await service.metrics());
    },
  };
}
