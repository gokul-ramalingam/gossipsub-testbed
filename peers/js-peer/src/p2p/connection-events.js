import { EVENT_PEER_CONNECTED, EVENT_PEER_DISCONNECTED } from '../constants.js';
import { setConnectedPeers } from '../metrics.js';

/**
 * Logs peer_connected and peer_disconnected, and sets gs_connected_peers. js-libp2p fires peer:connect on
 * the first connection to a peer and peer:disconnect when the last one
 * closes, so each pair of peers gives one event, also with two connections.
 * This is the same as the connectedness events of the Go peer.
 *
 * @param {import('libp2p').Libp2p} node - the libp2p node
 * @param {import('./peer-names.js').PeerNames} names - peer ID -> peer name
 * @param {import('pino').Logger} logger - logger of the peer
 * @returns {() => void} a function that stops the logging
 */
export function watchConnections(node, names, logger) {
  /** @param {CustomEvent<import('@libp2p/interface').PeerId>} event */
  const onConnect = (event) => {
    setConnectedPeers(node.getPeers().length);
    logger.info({ remote: names.name(event.detail) }, EVENT_PEER_CONNECTED);
  };

  /** @param {CustomEvent<import('@libp2p/interface').PeerId>} event */
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
}
