import assert from 'node:assert/strict';
import { test } from 'node:test';
import { setTimeout as sleep } from 'node:timers/promises';

import { multiaddr } from '@multiformats/multiaddr';

import { EVENT_DISCOVERY_FAILED } from '../src/constants.js';
import { Discovery } from '../src/p2p/discovery.js';

test('a round that fails is logged, and the loop goes on with the next round', async () => {
  // The first round fails. The loop must log it and continue.
  let rounds = 0;
  const node = {
    getConnections() {
      rounds++;
      if (rounds === 1) {
        throw new Error('connection manager not ready');
      }
      return [{}]; // connected: no dial
    },
    async dial() {},
  };
  const warnings = [];
  const logger = {
    debug() {},
    info() {},
    error() {},
    warn: (fields, event) => warnings.push([event, fields]),
  };
  const config = {
    discovery: 'static',
    peers: [{ name: 'go-1', addr: multiaddr('/ip4/127.0.0.1/tcp/4001') }],
    peerName: 'go-0',
    keySeed: 'gossipsub-testbed',
    redialIntervalMs: 20,
  };

  const discovery = new Discovery(node, { add() {} }, config, logger);
  discovery.start();
  await sleep(150);
  discovery.stop();

  assert.deepEqual(warnings[0], [EVENT_DISCOVERY_FAILED, { error: 'connection manager not ready' }]);
  assert.ok(rounds >= 3, `only ${rounds} rounds ran`);
});
