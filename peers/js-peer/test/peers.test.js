import assert from 'node:assert/strict';
import { test } from 'node:test';

import { parsePeers } from '../src/utils/peers.js';

test('a list of peers, with spaces and an empty entry', () => {
  const peers = parsePeers('go-1=/ip4/127.0.0.1/tcp/4002, ,go-2=/ip4/127.0.0.1/tcp/4003');

  assert.deepEqual(
    peers.map((peer) => [peer.name, peer.addr.toString()]),
    [
      ['go-1', '/ip4/127.0.0.1/tcp/4002'],
      ['go-2', '/ip4/127.0.0.1/tcp/4003'],
    ],
  );
});

test('an empty list gives no peers', () => {
  assert.deepEqual(parsePeers(''), []);
});

test('an entry without an address', () => {
  assert.throws(() => parsePeers('go-1'), /peer must be <peer name>=<multiaddr>/);
  assert.throws(() => parsePeers('=/ip4/127.0.0.1/tcp/4002'), /peer must be <peer name>=<multiaddr>/);
});
