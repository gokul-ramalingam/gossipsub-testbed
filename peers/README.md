# Peers

The testbed has two implementations of the same GossipSub peer, one in Go and one in JavaScript. Both follow the contract on this page, which is why Go and JS peers form a single network and why one set of scripts, one dashboard and one alert work for both. A third implementation can join the network by following the same contract.

| Peer | Built on | Details |
| --- | --- | --- |
| [go-peer](go-peer/) | go-libp2p v0.49.0 and go-libp2p-pubsub v0.15.0 | [README](go-peer/README.md) |
| [js-peer](js-peer/) | js-libp2p 3.5.1 and @libp2p/gossipsub 17.2.1 | [README](js-peer/README.md) |

## Settings

Each peer reads its settings from environment variables. An empty variable falls back to the default.

| Variable | Default | Meaning |
| --- | --- | --- |
| `PEER_NAME` | Required | The peer's name, such as `go-0`. In the cluster, this is the pod name |
| `HTTP_PORT` | `8080` | Port of the HTTP API |
| `P2P_PORT` | `4001` | libp2p TCP port |
| `KEY_SEED` | `gossipsub-testbed` | Seed for the peer keys, shared by all peers |
| `TOPIC` | `gossipsub-testbed` | GossipSub topic |
| `DISCOVERY` | `static` | `srv` for a DNS SRV lookup, or `static` for the `PEERS` list |
| `SRV_NAME` | | DNS name to look up in `srv` mode, such as `peers.dst.svc.cluster.local` |
| `PEERS` | | Peer list for `static` mode, such as `go-1=/ip4/127.0.0.1/tcp/4002,js-0=/ip4/127.0.0.1/tcp/4003` |
| `REDIAL_INTERVAL` | `5s` | Time between two discovery rounds |
| `LOG_LEVEL` | `info` | `debug`, `info`, `warn` or `error` |

## Identity and discovery

Each peer derives its Ed25519 key from `sha256(KEY_SEED + ":" + PEER_NAME)`, so a given name always produces the same peer ID, in Go and in JS alike. This lets any peer compute any other peer's ID without coordination. It also means any peer can compute any other peer's private key, so the scheme is for tests only.

Every `REDIAL_INTERVAL`, a peer looks up `_p2p._tcp.<SRV_NAME>`. Each answer is one peer: the peer computes its ID from the name and dials it if they are not yet connected.

Connections use TCP, Noise and yamux (with a 30-second keepalive), plus identify.

## GossipSub

| Setting | Value | Why |
| --- | --- | --- |
| Mesh | D=3, Dlo=3, Dhi=4, Dlazy=3, Dout=0 | With the default D=6, every peer in a six-peer network is in every mesh, and gossip never happens |
| Flood publishing | Off | The JS default is on |
| IDONTWANT threshold | 1,024 bytes | The JS default is 512 |
| Message ID | Publisher peer ID plus sequence number | This is the pubsub spec and the go-libp2p-pubsub default. The @libp2p/gossipsub default differs |
| Topic on shutdown | Not left | Leaving sends PRUNE, which would keep a restarted peer out of the meshes for a minute |

## Message

Each message is JSON, with its fields in this order. `payload` pads the message to the requested size.

```json
{"run_id":"base-20261124T112624Z-7df7","publisher":"go-1","seq":42,"ts_us":1795868818734935,"payload":"xxxx"}
```

`ts_us` is the publication time in Unix microseconds, taken just before the publish call. The publisher sends message n at `start + (n-1)/rate`, so after a delay it catches up by sending the late messages at once.

## HTTP API

| Request | What it does |
| --- | --- |
| `GET /healthz` | Returns 200 while the process runs. Used by the liveness and readiness probes |
| `GET /connections` | Lists the connected peers with their names, peer IDs and addresses |
| `POST /publish/start` | Starts a run. Body: `{"run_id": "r1", "rate": 10, "size": 1024, "duration_s": 300}`. A `duration_s` of 0 runs until stopped |
| `POST /publish/stop` | Ends the run and returns its counts |
| `GET /publish/status` | Returns the state and counts of the current or last run |
| `GET /metrics` | Prometheus metrics |

Every response has the same shape: `{"status", "data", "error": {"code", "message"}, "message"}`.

| Status | Code | When |
| --- | --- | --- |
| 400 | `BAD_REQUEST`, `VALIDATION_ERROR` | Invalid JSON, a wrong type, or a value out of range (rate 1 to 1000, size 256 to 524288) |
| 409 | `ALREADY_PUBLISHING` | A run is already in progress |
| 409 | `RUN_ID_USED` | The peer has already used this run ID |

## Metrics and logs

Both peers export the same metrics and write the same log events. See the [metric reference](../docs/metrics.md#metric-reference) and the [log events](../docs/logging.md#log-events).

---

[README](../README.md) | [go-peer](go-peer/README.md) | [js-peer](js-peer/README.md)
