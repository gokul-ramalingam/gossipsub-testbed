import { successResponse } from '../../utils/response.js';

/**
 * Returns the handlers of /healthz and /connections.
 *
 * @param {import('../services/status.js').StatusService} service - state of the peer
 * @returns {{ getHealth: import('express').RequestHandler, getConnections: import('express').RequestHandler }} the handlers
 */
export function statusController(service) {
  return {
    /** Reports that the process runs. */
    getHealth(req, res) {
      res.status(200).json(successResponse(undefined, 'Peer is up and running!'));
    },

    /** Returns the peers that this peer is connected to. */
    getConnections(req, res) {
      res.status(200).json(successResponse(service.connections(), 'Connected peers'));
    },
  };
}
