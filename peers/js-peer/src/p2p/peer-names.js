/** Maps peer IDs to peer names for the logs and metrics. */
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
   * Returns the name of a peer ID, or the short peer ID, as the Go peer, if unknown.
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
