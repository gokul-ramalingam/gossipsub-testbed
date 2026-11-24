# Setup and test

Step-by-step instructions to build the testbed, run both scenarios and check each requirement. All commands run from the repository root. Total time: about 30 minutes.

## 1. Setup (about 10 minutes)

Install Docker (8 CPUs, 8 GB memory), kind, kubectl, Helm, jq, curl, gzip and Python 3. Go and Node.js are necessary only for the unit tests.

```
make tools     # all tools must show "ok"
make up        # cluster, images, monitoring, logging, peers
make status    # network check
```

Expected result of `make status`:

```
go-0  connected 5: go-1 go-2 js-0 js-1 js-2  mesh 3
go-1  connected 5: go-0 go-2 js-0 js-1 js-2  mesh 3
go-2  connected 5: go-0 go-1 js-0 js-1 js-2  mesh 3
js-0  connected 5: go-0 go-1 go-2 js-1 js-2  mesh 3
js-1  connected 5: go-0 go-1 go-2 js-0 js-2  mesh 4
js-2  connected 5: go-0 go-1 go-2 js-0 js-1  mesh 4
```

Each peer must have 5 connected peers. The mesh size is 3 or 4. All pods in `dst`, `monitoring` and `logging` must be `Running`.

Open the user interfaces in separate terminals. Each command runs until Ctrl-C.

```
make grafana      # http://localhost:3000/d/gossipsub-testbed  (admin / admin)
make prometheus   # http://localhost:9090
make logs-ui      # http://localhost:9428/select/vmui/
```

## 2. Test the network (Requirement 1)

| Check | How | Expected |
| --- | --- | --- |
| 3 Go + 3 JS peers on one topic | `make status` | 6 peers, 5 connections each |
| Discovery without pod IPs | `kubectl -n dst exec go-0 -- nslookup -type=SRV _p2p._tcp.peers.dst.svc.cluster.local` | 6 SRV answers |
| Resources and health checks | `kubectl -n dst get statefulset go -o yaml \| grep -A4 -E 'resources:\|Probe:'` | requests, limits, liveness and readiness probes |
| Message fields | `kubectl -n dst logs go-1 \| grep -m1 '"published"'` and `kubectl -n dst logs go-0 \| grep -m1 '"received"'` | `published`: run_id, seq, ts_us (publication time). `received`: run_id, publisher, seq, latency_us (after a run) |

## 3. Run the baseline (Scenario A, about 6 minutes)

```
make run-base
```

go-1 publishes 10 msg/s with 1 KiB for 300 s. The command prints its steps and ends with `done: runs/base-<run_id>`.

Check the result:

```
cat runs/base-*/analysis.md
```

Expected: completeness 100.00% for each of the 5 subscribers, and latency p99 of a few ms.

```
| go-0 | go-1 | 3000 | 3000 | 0 | 100.00 % | 3000/3000 |
| go-2 | go-1 | 3000 | 3000 | 0 | 100.00 % | 3000/3000 |
| js-0 | go-1 | 3000 | 3000 | 0 | 100.00 % | 3000/3000 |
...
```

The last column compares the logs with the Prometheus counters. The two must be equal.

## 4. Check the dashboard (Requirement 2)

In Grafana, select the run in `run_id` and set the time range to the run.

| Question | Dashboard row | Expected in the baseline |
| --- | --- | --- |
| Is the workload running? | 2. Workload | 10 msg/s, no errors |
| Are messages reaching subscribers? | 3. Delivery | 100% for each subscriber |
| Is propagation slowing down? | 4. Latency | p50 about 2 ms, steady |
| Is connectivity changing? | 5. Connectivity | 5 connected peers, mesh 3-4, no change |
| Is a process struggling? | 6. Process health | low CPU, flat memory, no throttling, 0 restarts |
| Is telemetry missing? | 7. Telemetry | `up` = 1, log lines from each peer |

Receipt timeline of one message: row 10 of the dashboard (set `seq`), or this query in the VictoriaLogs UI:

```
run_id:"<run_id>" event:received seq:42 | sort by (_time) | fields _time, peer, latency_us, source
```

Expected: 5 lines, one for each subscriber, with the time of receipt.

## 5. Run the isolation (Scenario B, about 8 minutes)

```
make run-iso
```

go-2 and js-2 are isolated from 120 s to 240 s of a 420 s run. The terminal shows each step with its time:

```
{"event":"isolation_enabled", ...}
{"event":"connections_cut", ...}
{"event":"isolation_check","peer":"go-2","to":"go-0","result":"fail"}
{"event":"isolation_check","peer":"go-2","to":"js-2","result":"ok"}
{"event":"isolation_check","peer":"go-0","to":"go-2","result":"fail"}
...
{"event":"isolation_disabled", ...}
{"event":"isolation_check","peer":"go-2","to":"go-0","result":"ok"}
```

While the isolation is active (from 2:00 to 4:00 of the run), check:

| Check | Where | Expected |
| --- | --- | --- |
| Isolation is real | the `isolation_check` lines above | go-2 to go-0 fails, go-2 to js-2 works |
| Policy | `kubectl -n dst get networkpolicy` | `isolate` |
| Connectivity | `make status`, or dashboard row 5 | go-2 and js-2: 1 connected peer; the others: 3 |
| Delivery | dashboard row 3 | go-2 and js-2 drop to 0%; the others stay at 100% |
| Alert | http://localhost:9090/alerts, or the alert tile on the dashboard | `DeliveryCompletenessLow` firing for go-2 and js-2, about 45 s after the start of the isolation |
| Telemetry continues | dashboard row 7; VictoriaLogs query `peer:"go-2"` | `up` = 1; log lines from go-2 and js-2 continue |

After the run:

```
cat runs/iso-*/analysis.md
```

Expected:

- go-2 and js-2: 0 messages during the isolation, about 72% completeness for the run, about 20 late arrivals each.
- The other peers: 100% completeness.
- Detection lag: JS peers about 10 s, Go peers about 40 s.
- Recovery lag: about 1 s for all connections.
- Alert: firing during the isolation, resolved within about 25 s after the end.

The isolation band on the dashboard (red) marks the isolation window.

## 6. Test the alert rule

```
make test-alert
```

Expected: `SUCCESS`. The test simulates a 2-minute isolation of go-2. The alert is pending after 20 s, firing after 50 s and resolved 40 s after the recovery.

## 7. Unit tests (optional)

```
make test
```

Expected: all Go packages `ok`, and 40 of 40 JS tests pass.

## Requirement checklist

| Requirement | Where |
| --- | --- |
| Six peers, one topic, 3 Go + 3 JS | `charts/gossipsub-testbed`, `make status` |
| One publisher, configurable rate and payload | `scripts/run.sh` (`RATE`, `SIZE`, `PUBLISHERS`) |
| Message fields: run ID, publisher, sequence number, timestamp | `peers/*/` message format; `published` and `received` log events |
| Discovery without pod IPs | headless Service and DNS SRV (`charts/gossipsub-testbed/templates/service.yaml`) |
| Container builds, chart, requests, limits, health checks | `peers/*/Dockerfile`, `charts/gossipsub-testbed/values.yaml`, `templates/statefulset.yaml` |
| Integration notes: versions, issues, diagnosis, next steps | [integration.md](integration.md) |
| Provisioned dashboard, Prometheus, VictoriaLogs | `charts/gossipsub-testbed/dashboards/gossipsub.json`, `monitoring/*.values.yaml` |
| Latency distribution with assumptions | dashboard row 4; [report.md](report.md), "Latency assumptions" |
| Receipt timeline query | dashboard row 10; query in step 4 |
| Baseline and isolation with NetworkPolicy | `make run-base`, `make run-iso`, `k8s/isolate.yaml`, `scripts/isolate.sh` |
| Isolation start and end recorded | `runs/<run_id>/timeline.jsonl` |
| Isolation verified beyond the policy | `isolation_check` results, 0 messages received while cut off |
| Recovery and late arrivals | `analysis.md` of the isolation run; [report.md](report.md) |
| Alert rule that fires and resolves | `templates/prometheusrule.yaml`, `make test-alert`, [report.md](report.md), "Alert" |
| Commands to deploy, run, collect, clean up | `Makefile` (`make help`) |
| Report and AI-use statement | [report.md](report.md), [ai-use.md](ai-use.md) |

## Clean-up

```
make down
```

This deletes the cluster. The results in `runs/` stay on disk.

## Troubleshooting

| Problem | Action |
| --- | --- |
| A peer shows fewer than 5 connections after `make up` | Wait 30 s and run `make status` again. The peers redial every 5 s |
| Pods stay `Pending` | Increase the Docker memory to 8 GB |
| `make run-*` stops with "timed out" | Run `make status`. If a peer is not connected, run `make reload` |
| Latency jumps of several seconds on macOS | Do not let the display sleep during a run |
