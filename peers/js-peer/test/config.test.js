import assert from 'node:assert/strict';
import { test } from 'node:test';

import { loadConfig } from '../src/config.js';
import { ConfigError } from '../src/errors.js';

test('defaults of the settings that are not set', () => {
  const config = loadConfig({ PEER_NAME: 'js-0' });

  assert.equal(config.peerName, 'js-0');
  assert.equal(config.httpPort, 8080);
  assert.equal(config.p2pPort, 4001);
  assert.equal(config.keySeed, 'gossipsub-testbed');
  assert.equal(config.topic, 'gossipsub-testbed');
  assert.equal(config.discovery, 'static');
  assert.equal(config.srvName, '');
  assert.deepEqual(config.peers, []);
  assert.equal(config.redialIntervalMs, 5000);
  assert.equal(config.logLevel, 'info');
});

test('the settings are read and the result is frozen', () => {
  const config = loadConfig({
    PEER_NAME: 'js-1',
    P2P_PORT: '4012',
    DISCOVERY: 'srv',
    SRV_NAME: 'peers.example',
    PEERS: 'go-0=/ip4/127.0.0.1/tcp/4001',
    REDIAL_INTERVAL: '1m30s',
  });

  assert.equal(config.p2pPort, 4012);
  assert.equal(config.discovery, 'srv');
  assert.equal(config.srvName, 'peers.example');
  assert.equal(config.peers[0].name, 'go-0');
  assert.equal(config.peers[0].addr.toString(), '/ip4/127.0.0.1/tcp/4001');
  assert.equal(config.redialIntervalMs, 90_000);
  assert.ok(Object.isFrozen(config) && Object.isFrozen(config.peers));
});

test('an empty variable counts as not set', () => {
  assert.equal(loadConfig({ PEER_NAME: 'js-0', HTTP_PORT: '' }).httpPort, 8080);
});

test('each invalid setting stops the peer with an error that names it', () => {
  const cases = [
    [{ PEER_NAME: '' }, 'PEER_NAME must be set'],
    [{ P2P_PORT: 'abc' }, 'P2P_PORT must be an integer, got "abc"'],
    [{ HTTP_PORT: '70000' }, 'HTTP_PORT must be a port number, got 70000'],
    [{ DISCOVERY: 'dht' }, 'dht: discovery must be srv or static'],
    [{ DISCOVERY: 'srv' }, 'SRV_NAME must be set when DISCOVERY is srv'],
    [{ PEERS: 'go-1' }, 'PEERS: go-1: peer must be <peer name>=<multiaddr>'],
    [{ PEERS: 'go-1=/nope' }, /^PEERS: invalid multiaddr for go-1/],
    [{ REDIAL_INTERVAL: 'soon' }, 'REDIAL_INTERVAL must be a duration, got "soon"'],
    [{ REDIAL_INTERVAL: '5' }, 'REDIAL_INTERVAL must be a duration, got "5"'],
    [{ REDIAL_INTERVAL: '0s' }, 'REDIAL_INTERVAL must be positive, got 0s'],
  ];

  for (const [env, message] of cases) {
    assert.throws(
      () => loadConfig({ PEER_NAME: 'js-0', ...env }),
      (err) =>
        err instanceof ConfigError &&
        (typeof message === 'string' ? err.message === message : message.test(err.message)),
      JSON.stringify(env),
    );
  }
});
