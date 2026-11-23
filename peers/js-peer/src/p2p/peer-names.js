/**
 * Maps peer IDs to peer names, so that the logs and the metrics name a remote
 * peer by its name (go-1) instead of its peer ID. Discovery fills it.
 */
export class PeerNames {
  /** @type {Map<string, string>} peer ID -> peer name */
  #names = new Map();

  /**
   * Records the name of a peer ID.
   *
   * @param {import('@libp2p/interface').PeerId} id - the peer ID
   * @param {string} name - the peer name
   */
  add(id, name) {
    this.#names.set(id.toString(), name);
  }

  /**
   * Returns the name of a peer ID, or the short peer ID if the peer is unknown.
   * The short form is the same as ShortString of the Go peer: <peer.ID 12*xxxxxx>.
   *
   * @param {import('@libp2p/interface').PeerId} id - the peer ID
   * @returns {string} the name
   */
  name(id) {
    const key = id.toString();
    const name = this.#names.get(key);

    if (name !== undefined) {
      return name;
    }

    return key.length <= 10 ? `<peer.ID ${key}>` : `<peer.ID ${key.slice(0, 2)}*${key.slice(-6)}>`;
  }
}
