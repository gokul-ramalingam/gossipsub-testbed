# Analysis of iso-20261123T225134Z-cb27

Scenario `iso`, 10 msg/s per publisher (go-1), 1024 B, 420 s; run 2026-11-23T22:52:08.180138Z -> 2026-11-23T22:59:09.224331Z.
Isolated: go-2, js-2 from 120 s for 120 s.

## Completeness

From the logs: published = the publisher's `published` lines, received = distinct `seq` in the subscriber's `received` lines. Prometheus = the last value of the counters in the export (cross-check).

| subscriber | publisher | published | received | missed | completeness | Prometheus received/published |
| --- | --- | --- | --- | --- | --- | --- |
| go-0 | go-1 | 4200 | 4200 | 0 | 100.00 % | 4200/4200 |
| go-2 | go-1 | 4200 | 3039 | 1161 | 72.36 % | 3039/4200 |
| js-0 | go-1 | 4200 | 4200 | 0 | 100.00 % | 4200/4200 |
| js-1 | go-1 | 4200 | 4200 | 0 | 100.00 % | 4200/4200 |
| js-2 | go-1 | 4200 | 3039 | 1161 | 72.36 % | 3039/4200 |

## Latency

Receive time - the publisher's timestamp, first copy only (nearest-rank percentiles). In an isolation run, the late arrivals are in the rows all, go/js and isolated.

| receivers | deliveries | p50 | p95 | p99 | max |
| --- | --- | --- | --- | --- | --- |
| all | 18678 | 1.7 ms | 3.8 ms | 8.3 ms | 2992.5 ms |
| go | 7239 | 1.5 ms | 3.8 ms | 7.4 ms | 2967.9 ms |
| js | 11439 | 1.8 ms | 3.9 ms | 9.2 ms | 2992.5 ms |
| not isolated | 12600 | 1.7 ms | 3.9 ms | 7.2 ms | 520.6 ms |
| isolated | 6078 | 1.6 ms | 3.7 ms | 69.6 ms | 2992.5 ms |

## Duplicates and direct deliveries

Duplicates: later copies of a message the peer already had. Direct: first copy from the publisher itself.

| peer | first copies | duplicates | direct |
| --- | --- | --- | --- |
| go-0 | 4200 | 5861 | 61.4 % |
| go-1 | 0 | 0 | - |
| go-2 | 3039 | 4792 | 40.4 % |
| js-0 | 4200 | 8031 | 25.7 % |
| js-1 | 4200 | 7704 | 84.0 % |
| js-2 | 3039 | 4303 | 98.3 % |

## Publisher stalls

Gaps between two messages of a publisher longer than 3 send intervals (300 ms). The publishers catch up after a stall (schedule by sequence number), so a stall shows as a gap and then a burst; a stall of the machine also delays the deliveries.

None.

## Missing sequence numbers

| subscriber | publisher | missed | seq ranges |
| --- | --- | --- | --- |
| go-0 | go-1 | 0 | none |
| go-2 | go-1 | 1161 | 1218-2378 |
| js-0 | go-1 | 0 | none |
| js-1 | go-1 | 0 | none |
| js-2 | go-1 | 1161 | 1218-2378 |

## Isolation timeline

| event | time (UTC) |
| --- | --- |
| policy applied (T_apply) | 22:54:08.682606 |
| open connections cut (conntrack), start | 22:54:09.024453 |
| open connections cut, done | 22:54:10.234862 |
| policy removed (T_remove) | 22:56:08.213642 |
| isolation length (T_remove - T_apply) | 119.531 s |

### Isolation checks

| time | from | to | result | phase |
| --- | --- | --- | --- | --- |
| 22:54:12.462428 | go-2 | go-0 | fail | during |
| 22:54:12.741531 | go-2 | js-2 | ok | during |
| 22:54:15.014195 | go-0 | go-2 | fail | during |
| 22:56:08.652940 | go-2 | go-0 | ok | after |
| 22:56:08.942420 | go-2 | js-2 | ok | after |
| 22:56:09.210921 | go-0 | go-2 | ok | after |
| 22:59:09.428003 | go-2 | go-0 | ok | after |
| 22:59:09.679755 | go-2 | js-2 | ok | after |
| 22:59:09.923244 | go-0 | go-2 | ok | after |

### Connections between the groups

One row per side of each connection (each side has its own keepalive). Detection lag = D - T_apply (and D - the cut: the policy alone blocks only new connections); recovery lag = C - T_remove; seen outage = C - D.

| peer | remote | disconnected (D) | D - T_apply | D - cut | reconnected (C) | C - T_remove | C - D |
| --- | --- | --- | --- | --- | --- | --- | --- |
| go-0 | go-2 | 22:54:48.860524 | 40.178 s | 39.836 s | 22:56:08.853807 | 640.2 ms | 79.993 s |
| go-0 | js-2 | 22:54:48.865822 | 40.183 s | 39.841 s | 22:56:08.881521 | 667.9 ms | 80.016 s |
| go-1 | go-2 | 22:54:48.857982 | 40.175 s | 39.834 s | 22:56:08.855903 | 642.3 ms | 79.998 s |
| go-1 | js-2 | 22:54:48.858711 | 40.176 s | 39.834 s | 22:56:08.885279 | 671.6 ms | 80.027 s |
| go-2 | go-0 | 22:54:48.861181 | 40.179 s | 39.837 s | 22:56:08.859893 | 646.3 ms | 79.999 s |
| go-2 | go-1 | 22:54:48.859163 | 40.177 s | 39.835 s | 22:56:08.861036 | 647.4 ms | 80.002 s |
| go-2 | js-0 | 22:54:48.862194 | 40.180 s | 39.838 s | 22:56:08.875936 | 662.3 ms | 80.014 s |
| go-2 | js-1 | 22:54:48.867737 | 40.185 s | 39.843 s | 22:56:08.879594 | 666.0 ms | 80.012 s |
| js-0 | go-2 | 22:54:19.710098 | 11.027 s | 10.686 s | 22:56:08.884386 | 670.7 ms | 109.174 s |
| js-0 | js-2 | 22:54:19.712275 | 11.030 s | 10.688 s | 22:56:08.933125 | 719.5 ms | 109.221 s |
| js-1 | go-2 | 22:54:19.740327 | 11.058 s | 10.716 s | 22:56:08.888443 | 674.8 ms | 109.148 s |
| js-1 | js-2 | 22:54:19.741489 | 11.059 s | 10.717 s | 22:56:09.192865 | 979.2 ms | 109.451 s |
| js-2 | go-0 | 22:54:19.487359 | 10.805 s | 10.463 s | 22:56:08.888833 | 675.2 ms | 109.401 s |
| js-2 | go-1 | 22:54:19.486182 | 10.804 s | 10.462 s | 22:56:08.892825 | 679.2 ms | 109.407 s |
| js-2 | js-0 | 22:54:19.488291 | 10.806 s | 10.464 s | 22:56:08.937802 | 724.2 ms | 109.450 s |
| js-2 | js-1 | 22:54:19.482927 | 10.800 s | 10.458 s | 22:56:09.198649 | 985.0 ms | 109.716 s |

Detection lag after the cut: min 10.458 s, max 39.843 s (16 of 16 sides saw a disconnect). Recovery lag: min 640.2 ms, max 985.0 ms.

### Delivery at the isolated peers

Messages published between the end of the cut and T_remove: missed by the isolated peer. Expected about publish rate x isolation = 1180 (all publishers). Late arrival: a message published before T_remove that arrived after it, more than 1 s after it was published.

| peer | last receipt before the cut | receipts during (cut done + 1 s -> T_remove) | first receipt after T_remove | first new message - T_remove | missed of published during | late arrivals |
| --- | --- | --- | --- | --- | --- | --- |
| go-2 | 22:54:09.023753 (go-1 1210) | 0 | 22:56:08.891845 (go-1 2383), 678.2 ms | 678.8 ms | 1156 of 1179 | 20 (1.069 s-2.968 s) |
| js-2 | 22:54:08.925561 (go-1 1209) | 0 | 22:56:08.911273 (go-1 2383), 697.6 ms | 702.7 ms | 1156 of 1179 | 20 (1.093 s-2.993 s) |

### Alert DeliveryCompletenessLow

First and last firing sample (the export's 5 s grid).

| subscriber | publisher | first firing | - T_apply | last firing | - T_remove |
| --- | --- | --- | --- | --- | --- |
| go-2 | go-1 | 22:54:58 | 49.317 s | 22:56:33 | 24.786 s |
| js-2 | go-1 | 22:54:58 | 49.317 s | 22:56:33 | 24.786 s |

