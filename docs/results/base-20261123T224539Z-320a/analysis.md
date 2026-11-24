# Analysis of base-20261123T224539Z-320a

Scenario `base`, 10 msg/s per publisher (go-1), 1024 B, 300 s; run 2026-11-23T22:46:13.278521Z -> 2026-11-23T22:51:13.773575Z.

## Completeness

From the logs: published = the publisher's `published` lines, received = distinct `seq` in the subscriber's `received` lines. Prometheus = the last value of the counters in the export (cross-check).

| subscriber | publisher | published | received | missed | completeness | Prometheus received/published |
| --- | --- | --- | --- | --- | --- | --- |
| go-0 | go-1 | 3000 | 3000 | 0 | 100.00 % | 3000/3000 |
| go-2 | go-1 | 3000 | 3000 | 0 | 100.00 % | 3000/3000 |
| js-0 | go-1 | 3000 | 3000 | 0 | 100.00 % | 3000/3000 |
| js-1 | go-1 | 3000 | 3000 | 0 | 100.00 % | 3000/3000 |
| js-2 | go-1 | 3000 | 3000 | 0 | 100.00 % | 3000/3000 |

## Latency

Receive time - the publisher's timestamp, first copy only (nearest-rank percentiles). In an isolation run, the late arrivals are in the rows all, go/js and isolated.

| receivers | deliveries | p50 | p95 | p99 | max |
| --- | --- | --- | --- | --- | --- |
| all | 15000 | 1.7 ms | 3.6 ms | 5.9 ms | 41.9 ms |
| go | 6000 | 1.6 ms | 3.8 ms | 5.4 ms | 24.7 ms |
| js | 9000 | 1.7 ms | 3.5 ms | 6.2 ms | 41.9 ms |

## Duplicates and direct deliveries

Duplicates: later copies of a message the peer already had. Direct: first copy from the publisher itself.

| peer | first copies | duplicates | direct |
| --- | --- | --- | --- |
| go-0 | 3000 | 5995 | 0.0 % |
| go-1 | 0 | 0 | - |
| go-2 | 3000 | 3025 | 99.4 % |
| js-0 | 3000 | 4113 | 0.0 % |
| js-1 | 3000 | 6092 | 99.9 % |
| js-2 | 3000 | 6145 | 99.3 % |

## Publisher stalls

Gaps between two messages of a publisher longer than 3 send intervals (300 ms). The publishers catch up after a stall (schedule by sequence number), so a stall shows as a gap and then a burst; a stall of the machine also delays the deliveries.

None.

## Missing sequence numbers

| subscriber | publisher | missed | seq ranges |
| --- | --- | --- | --- |
| go-0 | go-1 | 0 | none |
| go-2 | go-1 | 0 | none |
| js-0 | go-1 | 0 | none |
| js-1 | go-1 | 0 | none |
| js-2 | go-1 | 0 | none |

