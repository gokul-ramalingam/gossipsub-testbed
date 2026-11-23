# gossipsub-testbed

Six GossipSub peers on a local Kubernetes cluster (kind). Three peers use go-libp2p and three use js-libp2p, and all of them are on one topic. The testbed measures delivery and latency between the two implementations, and shows what happens when two peers lose the network and then get it back.

Metrics go to Prometheus and logs go to VictoriaLogs. One Grafana dashboard shows a full run, and an alert fires when a peer stops getting messages.

Results of the baseline and the isolation runs: [docs/report.md](docs/report.md).

```
kind cluster: 1 control plane, 3 workers

  dst          go-0 go-1 go-2  js-0 js-1 js-2   (2 peers per worker, one topic)
                  |                    |
                  | /metrics           | logs (stdout)
                  v                    v
  monitoring   Prometheus, Grafana    logging   VictoriaLogs + collector
               alert rule
```

## What is in the repo

- `peers/go-peer` - the Go peer (go-libp2p v0.49.0, go-libp2p-pubsub v0.15.0, Gin)
- `peers/js-peer` - the JS peer (js-libp2p 3.5.1, @libp2p/gossipsub 17.2.1, Express)
- `kind/cluster.yaml` - the kind cluster
- `charts/gossipsub-testbed` - Helm chart for the peers, with the PodMonitor, the alert rule and the dashboard
- `monitoring/` - Helm values for kube-prometheus-stack and VictoriaLogs, and a unit test for the alert
- `k8s/isolate.yaml` - the NetworkPolicy that isolates go-2 and js-2
- `scripts/` - `run.sh` runs an experiment, `isolate.sh` does the isolation, `analyze.py` analyses a run, plus `status.sh` and `test-alert.sh`
- `Makefile` - every command goes through it (`make help`)
- `docs/` - report, AI-use statement, screenshots, analysis of the evidence runs

## Prerequisites

Tested on macOS (Apple silicon) with:

- Docker Desktop with 8 CPUs and 8 GB memory (the whole stack uses about 5 GB)
- kind v0.33.0, kubectl v1.36, Helm v4.3.2
- jq, curl, gzip, Python 3
- Go 1.26 and Node 26 only for `make test`, shellcheck only for `make lint`

The scripts also work on Linux. They use the GNU `date` inside the kind node, not the date of the host. The cluster needs internet access to download the charts and the Grafana plugin for VictoriaLogs.

`make tools` tells you if something is missing.

## Quick start

```
make up        # cluster, images, monitoring, logging, peers (about 10 min the first time)
make status    # each peer must have 5 connected peers and a mesh of 3 or 4
make grafana   # dashboard: http://localhost:3000/d/gossipsub-testbed (admin / admin)
```

`make up` runs `cluster`, `images`, `load`, `monitoring`, `logging` and `peers`. You can also run them one by one. Monitoring is kube-prometheus-stack 93.1.2 in the namespace `monitoring`. Logging is VictoriaLogs 0.13.11 and its collector 0.3.8 in `logging`. The peers go into `dst`.

If you change the peer code, `make reload` builds and loads the images again and restarts the peers.

## The peers

The pod name is the peer name (go-0 to js-2). The peer key is made from the name, so a restarted pod keeps its peer ID. Peers find each other through the DNS SRV record of the headless Service and try again every 5 s. The mesh is D=3, Dlo=3, Dhi=4.

Both peers have the same HTTP API, metrics and log events. They also use the same GossipSub message ID (the peer ID of the sender and the libp2p sequence number), so a message has the same ID on both sides. js-libp2p uses a different ID by default.

HTTP API on port 8080:

```
GET  /healthz          health (used by the probes)
GET  /connections      connected peers: name, peer ID, addresses
POST /publish/start    {"run_id": "r1", "rate": 10, "size": 1024, "duration_s": 300}   (0 = until stop)
POST /publish/stop
GET  /publish/status   state and counts of the current or last run
GET  /metrics
```

A message has the run ID, the publisher, a sequence number starting at 1, and the publish time in microseconds. Message n is sent at start + (n-1)/rate. If the publisher is late, it sends the late messages at once and does not skip them.

Metrics (Prometheus adds `pod` and `impl`):

| Metric | Labels |
| --- | --- |
| `gs_publish_attempts_total`, `gs_publish_success_total`, `gs_publish_errors_total` | run_id, reason |
| `gs_messages_received_total` (first copies) | run_id, publisher |
| `gs_messages_duplicate_total` | run_id |
| `gs_messages_rejected_total` | reason |
| `gs_delivery_latency_seconds` (histogram, 0.5 ms to 5 s) | run_id, publisher, source |
| `gs_rpc_control_total` (IHAVE, IWANT) | type |
| `gs_connected_peers`, `gs_topic_peers`, `gs_mesh_peers` | |

Logs are one JSON line per event with `ts`, `event`, `peer`, `impl` and `peer_id`. The main events:

- `published` (run_id, seq, ts_us) and `received` (run_id, publisher, seq, latency_us, source)
- `duplicate`, `rejected`
- `peer_connected` and `peer_disconnected` (remote), `graft` and `prune` (remote)
- `isolation_check` (to, result), written by `scripts/isolate.sh`

`source` is the peer that sent the first copy. If it is the publisher, the message came directly.

## Dashboard, logs and alert

The dashboard "GossipSub testbed" comes with the chart. Pick the run in `run_id` and set the time range to the run. The rows go in the order of a run: summary, workload, delivery, latency, connectivity, process health, telemetry, isolation evidence, recovery and the receipt timeline of one message. A red band marks the isolation. The last three rows come from VictoriaLogs and the rest from Prometheus.

For the logs, run `make logs-ui` and open http://localhost:9428/select/vmui/. Example queries:

```
run_id:"<run_id>" event:received publisher:"go-1" seq:42 | sort by (_time) | fields _time, peer, latency_us, source
run_id:"<run_id>" event:received | stats by (peer) count() as received
peer:"go-2" event:peer_* | fields _time, event, remote
event:isolation_check | fields _time, peer, to, result
```

The first one shows who received message 42 and when.

The alert `DeliveryCompletenessLow` fires for a subscriber and a publisher when, for 30 s, the subscriber got less than 95% of the publisher's messages of the last 30 s and at least 60 of them are missing. The second condition is there because the peers are scraped at different times. At the start and end of a run the ratio is wrong for a few seconds, and without the count the alert went to pending in runs without any loss. 60 is 6 s of publishing at 10 msg/s, so change `monitoring.alert.minMissing` if you change the rate. The rule is evaluated every 10 s. Alertmanager is off, so the alert state shows in Prometheus and on the dashboard. `make test-alert` runs a promtool test of the rule with a simulated isolation.

## Running the scenarios

```
make run-base   # baseline, 300 s
make run-iso    # 420 s, go-2 and js-2 isolated from 120 s for 120 s
```

go-1 and js-1 publish 10 msg/s each with 1024-byte messages. The settings are variables, for example:

```
make run-iso DURATION=300 ISOLATE_AT=60 ISOLATION=90 RATE=20 SIZE=512
```

`scripts/run.sh` first waits until every peer has 5 connections. Then it sends a 20 s warm-up and waits until every mesh has at least 3 peers, because the first messages after a peer joins can get lost. Then it starts the run, and for `run-iso` it isolates go-2 and js-2 and removes the isolation later. At the end it exports everything to `runs/<run_id>/` and writes the analysis. It also keeps the host awake during the run (see the macOS issue below).

The run ID looks like `iso-20261124T101500Z-3f9a`: the scenario, the UTC start time and 4 random hex digits.

What ends up in `runs/<run_id>/`:

- `settings.json` - workload, times, versions, image digests
- `timeline.jsonl` - what the script did and when, with the time from the kind node
- `logs.jsonl.gz` - the log lines of the run from VictoriaLogs
- `metrics/*.json` - 15 Prometheus range queries, 5 s step
- `analysis.md` - completeness, latency percentiles, duplicates, publisher stalls, missing sequence numbers. For an isolation run also detection lag, recovery lag, late arrivals and the alert times

`make analyze RUN=<run_id>` writes the analysis again. All times come from one clock, because the kind nodes and the peers share the kernel clock of the Docker VM.

## How the isolation works

`make isolate-on` applies `k8s/isolate.yaml`. go-2 and js-2 can still reach each other, Prometheus can still scrape them and they can still use DNS. All other traffic to and from them is dropped.

The policy alone is not enough. kindnet only checks new connections against a NetworkPolicy, and packets of a connection that is already open pass without a check. Every isolated peer already has an open connection to every other peer, so the policy alone changes nothing (a test TCP stream kept running after a deny policy was applied). So after the policy, `scripts/isolate.sh` deletes the conntrack entries of go-2 and js-2 on every kind node. The next packet of an open connection then counts as new and the policy drops it. The connections stop without an error on either side, like a pulled cable.

After that it checks with `nc` to port 4001: go-2 to go-0 must fail, go-2 to js-2 must work, and go-0 to go-2 must fail. `make isolate-off` deletes the policy and checks again. `make isolate-check` only checks.

## Clean-up

```
make down
```

This deletes the cluster with all its data. The images stay in Docker (`docker rmi gossipsub-testbed/go-peer:0.1.0 gossipsub-testbed/js-peer:0.1.0`), and so does `runs/`.

## Known issues

- On macOS the Docker VM stops for a few seconds when the display wakes up from sleep. Both publishers stop, latency goes up to 6 s and messages can get lost. Nothing inside the VM shows it; the stalls match "Display is turned on" in the macOS power log (`pmset -g log`). `run.sh` keeps the Mac awake, but do not let it sleep during a run.
- A cut connection is only noticed through the yamux keepalive (30 s). In the test runs the JS peers noticed it after 5 to 14 s and the Go peers after 34 to 39 s.
- The isolation band on the dashboard is only accurate to about 30 s, because kube-state-metrics is scraped every 30 s. `timeline.jsonl` has the exact times.
