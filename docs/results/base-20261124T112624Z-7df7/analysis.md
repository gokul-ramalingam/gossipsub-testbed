# Analysis of base-20261124T112624Z-7df7

Scenario `base`, 10 msg/s per publisher (go-1), 1024 B, 300 s; run 2026-11-24T11:26:58.734933Z -> 2026-11-24T11:32:00.146017Z.

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
| all | 15000 | 1.5 ms | 3.5 ms | 9.2 ms | 1120.0 ms |
| go | 6000 | 0.9 ms | 2.1 ms | 6.9 ms | 1120.0 ms |
| js | 9000 | 1.9 ms | 4.0 ms | 10.2 ms | 826.0 ms |

## Duplicates and direct deliveries

Duplicates: later copies of a message the peer already had. Direct: first copy from the publisher itself.

| peer | first copies | duplicates | direct |
| --- | --- | --- | --- |
| go-0 | 3000 | 3141 | 0.0 % |
| go-1 | 0 | 0 | - |
| go-2 | 3000 | 3028 | 99.0 % |
| js-0 | 3000 | 5983 | 0.0 % |
| js-1 | 3000 | 8791 | 99.5 % |
| js-2 | 3000 | 8774 | 99.7 % |

## Publisher stalls

Gaps between two messages of a publisher longer than 3 send intervals (300 ms). The publishers catch up after a stall (schedule by sequence number), so a stall shows as a gap and then a burst; a stall of the machine also delays the deliveries.

| publisher | last message before the gap | gap |
| --- | --- | --- |
| go-1 | 11:29:20.186115 | 403.3 ms |
| go-1 | 11:29:21.110752 | 345.7 ms |

## Missing sequence numbers

| subscriber | publisher | missed | seq ranges |
| --- | --- | --- | --- |
| go-0 | go-1 | 0 | none |
| go-2 | go-1 | 0 | none |
| js-0 | go-1 | 0 | none |
| js-1 | go-1 | 0 | none |
| js-2 | go-1 | 0 | none |

