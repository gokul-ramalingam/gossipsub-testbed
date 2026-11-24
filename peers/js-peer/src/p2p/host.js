import { noise } from '@chainsafe/libp2p-noise';
import { yamux } from '@chainsafe/libp2p-yamux';
import { identify } from '@libp2p/identify';
import { tcp } from '@libp2p/tcp';
import { createLibp2p } from 'libp2p';

import { YAMUX_KEEPALIVE_MS } from '../constants.js';

/**
 * Returns a libp2p node on TCP port, with the same stack as the Go peer: TCP, Noise, yamux and identify.
 *
 * @param {import('@libp2p/interface').PrivateKey} privateKey - key of the peer
 * @param {number} port - TCP port
 * @param {Record<string, Function>} [services] - more services, such as GossipSub
 * @returns {Promise<import('libp2p').Libp2p>} the node, not started
 */
export const createHost = async (privateKey, port, services = {}) => {
  return createLibp2p({
    privateKey,
    start: false,
    addresses: { listen: [`/ip4/0.0.0.0/tcp/${port}`] },
    transports: [tcp()],
    connectionEncrypters: [noise()],
    streamMuxers: [yamux({ enableKeepAlive: true, keepAliveInterval: YAMUX_KEEPALIVE_MS })],
    services: { identify: identify(), ...services },
  });
};
