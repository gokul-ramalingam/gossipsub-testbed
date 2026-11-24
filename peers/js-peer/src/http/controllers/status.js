import { successResponse } from '../../utils/response.js';

/**
 * Returns the handlers of /healthz and /connections.
 *
 * @param {import('../services/status.js').StatusService} service - the status service
 * @returns {{ getHealth: import('express').RequestHandler, getConnections: import('express').RequestHandler }} the handlers
 */
export const statusController = (service) => {
  return {
    /** Reports that the process runs. */
    getHealth(req, res) {
      res.status(200).json(successResponse(undefined, 'Peer is up and running!'));
    },

    /** Returns the connected peers. */
    getConnections(req, res) {
      res.status(200).json(successResponse(service.connections(), 'Connected peers'));
    },
  };
};
