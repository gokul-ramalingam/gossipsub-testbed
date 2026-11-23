import { register } from '@prometheus-io/client';

/** Exposes the metrics of the peer in the Prometheus text format. */
export class MetricsService {
  /** @returns {string} the content type of the Prometheus text format */
  contentType() {
    return register.contentType;
  }

  /** @returns {Promise<string>} the current values of all metrics */
  async metrics() {
    return register.metrics();
  }
}
