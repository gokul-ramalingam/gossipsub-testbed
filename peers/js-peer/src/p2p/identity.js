import { createHash } from 'node:crypto';

import { generateKeyPairFromSeed } from '@libp2p/crypto/keys';
import { peerIdFromPrivateKey } from '@libp2p/peer-id';

/**
 * Derives the Ed25519 key of a peer from sha256(keySeed:name), as the Go peer.
 * For tests only: any peer can compute the key of any other peer.
 *
 * @param {string} keySeed - seed of the peer keys
 * @param {string} name - peer name, such as js-0
 * @returns {Promise<import('@libp2p/interface').Ed25519PrivateKey>} the private key
 */
export const privateKey = async (keySeed, name) => {
  const seed = createHash('sha256').update(`${keySeed}:${name}`).digest();

  return generateKeyPairFromSeed('Ed25519', seed);
};

/**
 * Returns the peer ID of a peer from its name.
 *
 * @param {string} keySeed - seed of the peer keys
 * @param {string} name - peer name, such as go-0
 * @returns {Promise<import('@libp2p/interface').PeerId>} the peer ID
 */
export const peerId = async (keySeed, name) => {
  return peerIdFromPrivateKey(await privateKey(keySeed, name));
};
