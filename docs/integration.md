# Integration of the two implementations

go-libp2p and js-libp2p peers in one GossipSub network. Experiment results: [report.md](report.md).

## Implementations and versions

Primary implementation: Go.

| | Go peer (`peers/go-peer`) | JS peer (`peers/js-peer`) |
| --- | --- | --- |
| Runtime | Go 1.26.11 | Node.js 26 (`node:26.13.1-alpine`) |
| libp2p | go-libp2p v0.49.0 | js-libp2p 3.5.1 |
| GossipSub | go-libp2p-pubsub v0.15.0 | @libp2p/gossipsub 17.2.1 |
| Transport, security, muxer | TCP, Noise, yamux (go-yamux v5.1.0) | @libp2p/tcp 11.0.32, @chainsafe/libp2p-noise 17.0.0, @chainsafe/libp2p-yamux 8.0.1 |
| HTTP API, logs, metrics | Gin, log/slog, client_golang | Express 5, pino, @prometheus-io/client |

All versions are pinned (`go.mod`, `go.sum`, `package-lock.json`). Both images run as non-root.

## What both peers share


- **Identity.** The Ed25519 key comes from sha256 of `KEY_SEED:<peer name>`. The same name gives the same peer ID in Go and JS (tested with known vectors).
- **Message format.** The same JSON fields (`run_id`, `publisher`, `seq`, `ts_us`, padding) and the same encoded size. The bytes are equal for the same input.
- **GossipSub settings.** D=3, Dlo=3, Dhi=4, Dlazy=3, Dout=0, flood publish off, IDONTWANT threshold 1024 bytes. The JS defaults differ from the Go defaults (flood publish on, Dlo 4, threshold 512), so the JS peer sets the Go values.
- **Message ID.** Peer ID of the sender + libp2p sequence number, as in the pubsub spec and in go-libp2p-pubsub. The JS default is different (issue 2 below), so the JS peer sets its own ID function.
- **HTTP API, metrics and log events.** The same paths, the same `gs_*` metric names and labels, and the same event names and fields.
- **Discovery.** A DNS SRV lookup of the headless Service, a dial every 5 s to the peers that are not connected.

## Evidence of delivery across the implementations

**On one machine, before Kubernetes** (3 Go + 3 JS processes, static discovery). 200 messages at 10 msg/s from go-0, then from js-0: each of the 5 receivers got 200 of 200. Receipt timeline of go-0 message 100: go-2 0.44 ms (from go-0), js-0 1.22 ms (from go-0), js-2 1.30 ms (from go-0), js-1 1.31 ms (from go-2), go-1 1.46 ms (from js-2).

**On the cluster** (kind, 3 workers, SRV discovery):

| Run (200 messages, 10 msg/s, 1 KiB) | Each receiver | Go receivers p50 / p99 | JS receivers p50 / p99 |
| --- | --- | --- | --- |
| from go-0 | 200 of 200 | 1.89 / 8.67 ms | 2.33 / 8.76 ms |
| from js-0 | 200 of 200 | 1.90 / 7.85 ms | 3.37 / 9.46 ms |

**Gossip across the implementations.** After a restart, js-0 had no mesh peer for one minute (issue 7). During that time it received all 201 messages of a run only through gossip: IHAVE from Go and JS peers, then IWANT. Latency was 38 to 348 ms instead of about 3 ms.

**Final runs.** go-1 publishes to five subscribers of both implementations. The baseline has 15000 of 15000 deliveries, and Go and JS peers relay for each other ([report.md](report.md)). For JS to Go, see the cluster run from js-0 above.

## Issues found

**1. Simultaneous dials between two Go peers never connected.**
Symptom: two Go peers that dial each other in the same redial round stay disconnected.
Evidence: `TestSimultaneousDial`, 3 trials each. With TCP port reuse on: connected in 0 of 3. With port reuse off: 3 of 3.
Confirmed: port reuse causes it. Hypothesis: with port reuse, both dials use the same port pair and become one TCP simultaneous open. Both sides then start Noise as the initiator.
Fix: `tcp.DisableReuseport()` in `p2p/host.go` (port reuse only helps NAT traversal). The test stays as a regression test.

**2. Go and JS compute different message IDs.**
Evidence: go-libp2p-pubsub `DefaultMsgIdFn` = peer ID bytes + seqno. @libp2p/gossipsub `msgIdFnStrictSign` = protobuf public key + seqno. For go-0 the Go ID starts with `0024` + public key (38 bytes) and the JS ID with the public key only (36 bytes). The JS ID is the Go ID without the 2-byte multihash header.
Confirmed in the code and in the bytes. A test with 100 messages from go-0 and 100 from js-0 gave 1156 duplicates with the shared ID and 1163 with the JS default. Neither test had IHAVE or IWANT: all peers were in each mesh, so the test does not show the effect. Hypothesis: with different IDs, IDONTWANT, IHAVE and IWANT do not match across the implementations. The gossip test above uses the shared ID.
Fix: `specMessageId` in the JS peer (`src/p2p/message-id.js`), with a test on a known vector.

**3. The GossipSub package of the first plan does not fit js-libp2p 3.**
Evidence: `@chainsafe/libp2p-gossipsub` depends on `@libp2p/interface` ^2.
Fix: `@libp2p/gossipsub` 17.2.1 from the js-libp2p monorepo.

**4. Different GossipSub defaults.**
Evidence: flood publish (Go off, JS on), Dlo (Go 5, JS 4), IDONTWANT threshold (Go 1024, JS 512).
Fix: the JS peer sets the Go values. With the default D=6 and only 6 peers, every peer was in every mesh, and gossip never occurred. Both peers use D=3.

**5. Go publishers log rejects of their own messages.**
Evidence: the JS peers forward a message back to its publisher. The counts match. In the run from go-0: 2 relayed copies and 2 rejects (`self originated message`) at go-0. In the run from js-0: 28 relayed copies and 28 duplicates at js-0.
Confirmed. Effect: none on delivery. The Go peer logs these rejects at debug level, and the dashboard shows them as a separate reason.

**6. Negative latencies at the Go receivers.**
Evidence: `gs_latency_negative_total` was 56 on the cluster, for messages from the JS publisher. `Date.now()` has only milliseconds, so the JS peer adds the high-resolution clock for microseconds. The first version could move that clock back, or up to 2 ms away from the wall clock. The JS timestamps were then sometimes ahead.
Confirmed. Fix: the JS clock never goes back and stays inside the millisecond that `Date.now()` gives. After the fix: 0 negative latencies on the cluster.

**7. A restarted JS peer had no mesh for one minute.**
Evidence (logs): on stop, the JS peer left the topic and sent PRUNE (go-1, go-2, js-1, js-2 logged `prune js-0`). The new pod has the same peer ID, and all 5 peers answered its GRAFT with PRUNE until the 1-minute prune backoff ended.
Confirmed in the logs and in the code of both libraries (leaving a topic sends PRUNE). Hypothesis: the Go peer did not show this because it closed the host before its PRUNE went out.
Fix: both peers stop without leaving the topic. Check with `kubectl -n dst delete pod js-1`: before the fix, the peers refused every GRAFT of the new js-1 (mesh 1 after 12 s). After the fix, no peer logged `prune js-1`, and go-0 and js-2 grafted the new js-1 within 1 s.

**8. Go module upgrade broke the build.**
Evidence: `go mod tidy` moved go-libp2p to v0.51.0. After a downgrade: `transport.go:217:25: undefined: webtransport.Dialer`.
Fix: `go.mod` rebuilt from the pinned direct dependencies only.

**9. JS pods were CPU throttled.**
Evidence: 31 to 33 throttled periods per pod at a CPU limit of 500m, also during a run.
Fix: JS CPU limit 1000m. Throttling went from 2.9 s to 0.35 s or less. Hypothesis for the rest: helper threads of the V8 garbage collector.

**10. The publishers did not keep the requested rate.**
Evidence: go-1 published 195 of 200 messages. Its log had two gaps of 376 and 431 ms. `time.Ticker` drops ticks when the loop is late. The JS peer used the wall clock: a test that moved `Date.now` back by 10 s made a 1 s run take 11 s.
Confirmed. Fix: both peers send message n at start + (n-1)/rate on the monotonic clock, and send late messages at once. Tests cover a stall and a wall-clock jump.

**11. JS receivers were slower in the early runs.**
Evidence: p50 1 to 2 ms more than on the Go receivers on one machine and in the first cluster runs. In the final baseline: Go 1.6 ms, JS 1.7 ms.
Hypothesis: the cost per message in Node.js (event loop, validation, logging), reduced by the higher CPU limit (issue 9).

**12. More duplicates on the JS peers.**
Evidence: in a full mesh, the JS peers suppressed no duplicates with IDONTWANT, and the Go peers about 10 to 15%. With D=3: about 1 to 2 duplicates per message.
Hypothesis: on one machine, IDONTWANT arrives too late to have an effect.

**13. JS detects a dead connection faster than Go.**
Evidence: over 5 isolation runs, the JS peers logged the disconnect 6.8 to 14.2 s after the cut. The Go peers logged it after 31.4 to 40.7 s. Both use a 30 s yamux keepalive.
Hypothesis: the two yamux libraries handle the keepalive timeout differently.


