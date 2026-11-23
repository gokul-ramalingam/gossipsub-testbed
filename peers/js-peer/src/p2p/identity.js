import { createHash } from 'node:crypto';

import { generateKeyPairFromSeed } from '@libp2p/crypto/keys';
import { peerIdFromPrivateKey } from '@libp2p/peer-id';

/**
 * Derives the Ed25519 key of a peer from its name. The 32-byte seed is
 * sha256(keySeed + ":" + name), used as the Ed25519 seed (RFC 8032). The Go
 * peer derives the same key from the same seed, so each peer can compute the
 * peer ID of any other peer, Go or JS, from its name.
 *
 * Test-only: any peer can compute the private key of any other peer.
 *
 * @param {string} keySeed - seed of the peer keys, the same on all peers
 * @param {string} name - peer name, for example js-0
 * @returns {Promise<import('@libp2p/interface').Ed25519PrivateKey>} the private key
 */
export async function privateKey(keySeed, name) {
  const seed = createHash('sha256').update(`${keySeed}:${name}`).digest();

  return generateKeyPairFromSeed('Ed25519', seed);
}

/**
 * Returns the peer ID of a peer from its name.
 *
 * @param {string} keySeed - seed of the peer keys, the same on all peers
 * @param {string} name - peer name, for example go-0
 * @returns {Promise<import('@libp2p/interface').PeerId>} the peer ID
 */
export async function peerId(keySeed, name) {
  return peerIdFromPrivateKey(await privateKey(keySeed, name));
}
