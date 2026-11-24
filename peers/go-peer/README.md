# go-peer

The Go implementation of the testbed peer, built on go-libp2p. It follows the shared [peer contract](../README.md).

| Component | Version |
| --- | --- |
| Go | 1.26.11 (built with `golang:1.26.11-bookworm`, runs on `alpine:3.24.4`) |
| go-libp2p | v0.49.0 |
| go-libp2p-pubsub | v0.15.0 |
| HTTP, logs, metrics | Gin v1.12.0, log/slog, client_golang v1.24.1 |

## Build the image

```
docker build -t gossipsub-testbed/go-peer:0.1.0 .
```

The image runs as the unprivileged user `nobody`. To build both peers at once, run `make images` from the repository root.

## Run three peers on one machine

Start each peer in its own terminal:

```
PEER_NAME=go-0 HTTP_PORT=8080 P2P_PORT=4001 PEERS=go-1=/ip4/127.0.0.1/tcp/4002,go-2=/ip4/127.0.0.1/tcp/4003 go run .
PEER_NAME=go-1 HTTP_PORT=8081 P2P_PORT=4002 PEERS=go-0=/ip4/127.0.0.1/tcp/4001,go-2=/ip4/127.0.0.1/tcp/4003 go run .
PEER_NAME=go-2 HTTP_PORT=8082 P2P_PORT=4003 PEERS=go-0=/ip4/127.0.0.1/tcp/4001,go-1=/ip4/127.0.0.1/tcp/4002 go run .
```

Then publish 50 messages from go-1 and count them at go-0:

```
curl -X POST localhost:8081/publish/start -d '{"run_id":"local-1","rate":10,"size":1024,"duration_s":5}'
curl -s localhost:8080/metrics | grep gs_messages_received_total
```

After about 5 seconds, go-0 should report 50 messages received from go-1.

## Run the tests

```
go test -race ./...
```

## Code layout

| Path | What it contains |
| --- | --- |
| `main.go` | Startup and shutdown |
| `env/` | Settings |
| `p2p/` | Host, identity, discovery, GossipSub, connection events and tracer |
| `http/` | The API: routers, controllers, services (including the publisher) and middlewares |
| `metrics/` | Prometheus metrics |
| `common/` | Constants, errors, logging, types and message encoding |

---

[README](../../README.md) | [Peer contract](../README.md) | [js-peer](../js-peer/README.md)
