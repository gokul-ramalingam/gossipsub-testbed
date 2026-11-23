import { noise } from '@chainsafe/libp2p-noise';
import { yamux } from '@chainsafe/libp2p-yamux';
import { identify } from '@libp2p/identify';
import { tcp } from '@libp2p/tcp';
import { createLibp2p } from 'libp2p';

import { YAMUX_KEEPALIVE_MS } from '../constants.js';

/**
 * Returns a libp2p node with the key privateKey, listening on TCP port on all
 * interfaces. The stack is fixed so that the Go and JS peers agree on it: TCP,
 * Noise and yamux, with the same yamux keepalive as the Go peer. Identify is
 * on, because GossipSub uses it to learn the protocols of a peer.
 *
 * The Node.js TCP transport dials from a temporary port, so it has no port
 * reuse; the Go peer turns its port reuse off for the same result (see
 * p2p/host.go of the Go peer).
 *
 * @param {import('@libp2p/interface').PrivateKey} privateKey - key of the peer
 * @param {number} port - TCP port
 * @param {Record<string, Function>} [services] - more libp2p services, for example GossipSub
 * @returns {Promise<import('libp2p').Libp2p>} the node, not started
 */
export async function createHost(privateKey, port, services = {}) {
  return createLibp2p({
    privateKey,
    start: false,
    addresses: { listen: [`/ip4/0.0.0.0/tcp/${port}`] },
    transports: [tcp()],
    connectionEncrypters: [noise()],
    streamMuxers: [yamux({ enableKeepAlive: true, keepAliveInterval: YAMUX_KEEPALIVE_MS })],
    services: { identify: identify(), ...services },
  });
}
