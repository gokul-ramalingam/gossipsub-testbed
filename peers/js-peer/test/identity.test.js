import assert from 'node:assert/strict';
import { test } from 'node:test';

import { peerId } from '../src/p2p/identity.js';

/** Default KEY_SEED. */
const KEY_SEED = 'gossipsub-testbed';

/** Peer IDs from the Go peer for the same seed. The JS peer must match them. */
const GO_PEER_IDS = {
  'go-0': '12D3KooWHZAu1VmTeA2Zh2CFgBUUoFaYKYp9yppWygjjSPEaA3Mu',
  'go-1': '12D3KooWJww7rkc22H2Bsx31rewaZtbR98FhsuEeSGrSnEswPTMQ',
  'js-0': '12D3KooWRZYqdkfvecFFRnNrHT6ytWN7ajfWtZVQYRc7xgVxU8Sk',
  'js-1': '12D3KooWMnRPe5E2HUUwfARBAA9Uo1go4CcYFzeCXPxreAx31CDE',
  'js-2': '12D3KooWNXMrsCt5EBxRAPwjknK9fKPVnMjsY4EE3ywYDzDzoHb9',
};

test('peer IDs match the Go peer', async () => {
  for (const [name, want] of Object.entries(GO_PEER_IDS)) {
    assert.equal((await peerId(KEY_SEED, name)).toString(), want, name);
  }
});

test('another key seed gives the peer ID of the Go peer for that seed', async () => {
  const id = await peerId('other-seed', 'go-0');

  assert.equal(id.toString(), '12D3KooWL3CUAXCBb58Jj21CVLNbZqQ21P1YXGaGSpqvsjcCJmcN');
});

test('the same name always gives the same peer ID', async () => {
  const first = await peerId(KEY_SEED, 'js-0');
  const second = await peerId(KEY_SEED, 'js-0');

  assert.ok(first.equals(second));
});
