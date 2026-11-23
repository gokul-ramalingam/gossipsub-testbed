import { multiaddr } from '@multiformats/multiaddr';

/**
 * @typedef {object} Target
 * @property {string} name - peer name, for example go-1
 * @property {import('@multiformats/multiaddr').Multiaddr} addr - address to dial, without the /p2p/<peer ID> part
 */

/**
 * Parses a comma-separated list of <peer name>=<multiaddr> entries, for
 * example "go-1=/ip4/127.0.0.1/tcp/4002,go-2=/ip4/127.0.0.1/tcp/4003". An
 * empty list returns no peers.
 *
 * @param {string} list - the list, as in the PEERS setting
 * @returns {Target[]} the peers, in the order of the list
 * @throws {Error} if an entry has no name or no address, or the address is not a multiaddr
 */
export function parsePeers(list) {
  const targets = [];

  for (const raw of list.split(',')) {
    const entry = raw.trim();
    if (entry === '') {
      continue;
    }

    const separator = entry.indexOf('=');
    const name = separator < 0 ? '' : entry.slice(0, separator);
    const addr = separator < 0 ? '' : entry.slice(separator + 1);

    if (name === '' || addr === '') {
      throw new Error(`${entry}: peer must be <peer name>=<multiaddr>`);
    }

    try {
      targets.push({ name, addr: multiaddr(addr) });
    } catch (err) {
      throw new Error(`invalid multiaddr for ${name}: ${err.message}`, { cause: err });
    }
  }

  return targets;
}
