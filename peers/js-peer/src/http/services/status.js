/**
 * @typedef {object} PeerLister
 * @property {() => import('../../p2p/index.js').ConnectedPeer[]} connectedPeers - the connected peers
 */

/** Reports the state of the peer. */
export class StatusService {
  /** @type {PeerLister} */
  #peers;

  /**
   * @param {PeerLister} peers - lists the connected peers
   */
  constructor(peers) {
    this.#peers = peers;
  }

  /** @returns {{ count: number, peers: import('../../p2p/index.js').ConnectedPeer[] }} the connected peers */
  connections() {
    const peers = this.#peers.connectedPeers() ?? [];

    return { count: peers.length, peers };
  }
}
