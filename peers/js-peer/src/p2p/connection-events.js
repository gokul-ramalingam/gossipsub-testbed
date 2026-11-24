import { EVENT_PEER_CONNECTED, EVENT_PEER_DISCONNECTED } from '../constants.js';
import { setConnectedPeers } from '../metrics.js';

/**
 * Logs peer_connected and peer_disconnected once per peer, and sets gs_connected_peers.
 *
 * @param {import('libp2p').Libp2p} node - the libp2p node
 * @param {import('./peer-names.js').PeerNames} names - peer names
 * @param {import('pino').Logger} logger - logger of the peer
 * @returns {() => void} stops the logging
 */
export const watchConnections = (node, names, logger) => {
  /**
   * Logs a new peer.
   *
   * @param {CustomEvent<import('@libp2p/interface').PeerId>} event - peer:connect
   */
  const onConnect = (event) => {
    setConnectedPeers(node.getPeers().length);
    logger.info({ remote: names.name(event.detail) }, EVENT_PEER_CONNECTED);
  };

  /**
   * Logs a lost peer.
   *
   * @param {CustomEvent<import('@libp2p/interface').PeerId>} event - peer:disconnect
   */
  const onDisconnect = (event) => {
    setConnectedPeers(node.getPeers().length);
    logger.info({ remote: names.name(event.detail) }, EVENT_PEER_DISCONNECTED);
  };

  node.addEventListener('peer:connect', onConnect);
  node.addEventListener('peer:disconnect', onDisconnect);

  return () => {
    node.removeEventListener('peer:connect', onConnect);
    node.removeEventListener('peer:disconnect', onDisconnect);
  };
};
