# js-peer

The JavaScript implementation of the testbed peer, built on js-libp2p. It follows the shared [peer contract](../README.md).

| Component           | Version                                                                            |
| ------------------- | ---------------------------------------------------------------------------------- |
| Node.js             | 26 (image `node:26.13.1-alpine`)                                                   |
| js-libp2p           | 3.5.1                                                                              |
| @libp2p/gossipsub   | 17.2.1                                                                             |
| Transport           | @libp2p/tcp 11.0.32, @chainsafe/libp2p-noise 17.0.0, @chainsafe/libp2p-yamux 8.0.1 |
| HTTP, logs, metrics | Express 5.3.0, pino 10.4.0, @prometheus-io/client 0.16.1                           |

Every dependency version is exact in `package.json` and locked in `package-lock.json`.

## Build the image

```
docker build -t gossipsub-testbed/js-peer:0.1.0 .
```

The image runs as the unprivileged user `node`. To build both peers at once, run `make images` from the repository root.

## Run two peers on one machine

Install the dependencies once, then start each peer in its own terminal:

```
npm ci
PEER_NAME=js-0 HTTP_PORT=8080 P2P_PORT=4001 PEERS=js-1=/ip4/127.0.0.1/tcp/4002 npm start
PEER_NAME=js-1 HTTP_PORT=8081 P2P_PORT=4002 PEERS=js-0=/ip4/127.0.0.1/tcp/4001 npm start
```

JS and Go peers can run together: add the Go peers to `PEERS`.

## Run the tests and lint

```
npm test        # node --test
npm run lint    # eslint and prettier
```

## Code layout

| Path             | What it contains                                                                 |
| ---------------- | -------------------------------------------------------------------------------- |
| `src/index.js`   | Startup and shutdown                                                             |
| `src/config.js`  | Settings                                                                         |
| `src/p2p/`       | Host, identity, discovery, GossipSub, message ID and connection events           |
| `src/http/`      | The API: routes, controllers, services (including the publisher) and middlewares |
| `src/metrics.js` | Prometheus metrics                                                               |
| `src/utils/`     | Clock, durations, message encoding and the peer list                             |
| `test/`          | Unit and integration tests                                                       |

---

[README](../../README.md) | [Peer contract](../README.md) | [go-peer](../go-peer/README.md)
