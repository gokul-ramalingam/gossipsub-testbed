# Analysis of iso-20261124T113220Z-6b77

Scenario `iso`, 10 msg/s per publisher (go-1), 1024 B, 420 s; run 2026-11-24T11:32:54.958644Z -> 2026-11-24T11:39:56.873067Z.
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
| all | 18678 | 1.7 ms | 5.7 ms | 657.9 ms | 3273.9 ms |
| go | 7239 | 0.9 ms | 3.8 ms | 409.6 ms | 2964.4 ms |
| js | 11439 | 1.9 ms | 6.7 ms | 736.8 ms | 3273.9 ms |
| not isolated | 12600 | 1.7 ms | 5.0 ms | 596.9 ms | 2732.2 ms |
| isolated | 6078 | 1.5 ms | 8.3 ms | 981.1 ms | 3273.9 ms |

## Duplicates and direct deliveries

Duplicates: later copies of a message the peer already had. Direct: first copy from the publisher itself.

| peer | first copies | duplicates | direct |
| --- | --- | --- | --- |
| go-0 | 4200 | 5775 | 60.8 % |
| go-1 | 0 | 0 | - |
| go-2 | 3039 | 2031 | 98.5 % |
| js-0 | 4200 | 9661 | 66.3 % |
| js-1 | 4200 | 10753 | 57.0 % |
| js-2 | 3039 | 7130 | 40.2 % |

## Publisher stalls

Gaps between two messages of a publisher longer than 3 send intervals (300 ms). The publishers catch up after a stall (schedule by sequence number), so a stall shows as a gap and then a burst; a stall of the machine also delays the deliveries.

| publisher | last message before the gap | gap |
| --- | --- | --- |
| go-1 | 11:38:35.289558 | 1622.1 ms |
| go-1 | 11:38:36.920839 | 940.0 ms |
| go-1 | 11:38:38.533806 | 415.7 ms |
| go-1 | 11:39:06.722701 | 345.3 ms |
| go-1 | 11:39:20.173761 | 301.7 ms |
| go-1 | 11:39:20.477539 | 522.0 ms |
| go-1 | 11:39:41.569181 | 302.6 ms |

## Missing sequence numbers

| subscriber | publisher | missed | seq ranges |
| --- | --- | --- | --- |
| go-0 | go-1 | 0 | none |
| go-2 | go-1 | 1161 | 1220-2380 |
| js-0 | go-1 | 0 | none |
| js-1 | go-1 | 0 | none |
| js-2 | go-1 | 1161 | 1220-2380 |

## Isolation timeline

| event | time (UTC) |
| --- | --- |
| policy applied (T_apply) | 11:34:55.578383 |
| open connections cut (conntrack), start | 11:34:55.816468 |
| open connections cut, done | 11:34:57.291094 |
| policy removed (T_remove) | 11:36:54.726210 |
| isolation length (T_remove - T_apply) | 119.148 s |

### Isolation checks

| time | from | to | result | phase |
| --- | --- | --- | --- | --- |
| 11:34:59.542511 | go-2 | go-0 | fail | during |
| 11:34:59.908542 | go-2 | js-2 | ok | during |
| 11:35:02.356504 | go-0 | go-2 | fail | during |
| 11:36:55.504399 | go-2 | go-0 | ok | after |
| 11:36:56.212340 | go-2 | js-2 | ok | after |
| 11:36:56.639949 | go-0 | go-2 | ok | after |
| 11:39:57.160325 | go-2 | go-0 | ok | after |
| 11:39:57.506404 | go-2 | js-2 | ok | after |
| 11:39:57.838383 | go-0 | go-2 | ok | after |

### Connections between the groups

One row per side of each connection (each side has its own keepalive). Detection lag = D - T_apply (and D - the cut: the policy alone blocks only new connections); recovery lag = C - T_remove; seen outage = C - D.

| peer | remote | disconnected (D) | D - T_apply | D - cut | reconnected (C) | C - T_remove | C - D |
| --- | --- | --- | --- | --- | --- | --- | --- |
| go-0 | go-2 | 11:35:36.671292 | 41.093 s | 40.855 s | 11:36:55.809759 | 1083.5 ms | 79.138 s |
| go-0 | js-2 | 11:35:36.270770 | 40.692 s | 40.454 s | 11:36:57.360083 | 2633.9 ms | 81.089 s |
| go-1 | go-2 | 11:35:34.074604 | 38.496 s | 38.258 s | 11:36:55.825331 | 1099.1 ms | 81.751 s |
| go-1 | js-2 | 11:35:36.269169 | 40.691 s | 40.453 s | 11:36:55.902590 | 1176.4 ms | 79.633 s |
| go-2 | go-0 | 11:35:34.072069 | 38.494 s | 38.256 s | 11:36:55.809345 | 1083.1 ms | 81.737 s |
| go-2 | go-1 | 11:35:36.670348 | 41.092 s | 40.854 s | 11:36:55.811826 | 1085.6 ms | 79.141 s |
| go-2 | js-0 | 11:35:35.878618 | 40.300 s | 40.062 s | 11:36:54.896697 | 170.5 ms | 79.018 s |
| go-2 | js-1 | 11:35:36.673078 | 41.095 s | 40.857 s | 11:36:54.929006 | 202.8 ms | 78.256 s |
| js-0 | go-2 | 11:35:08.739483 | 13.161 s | 12.923 s | 11:36:54.898585 | 172.4 ms | 106.159 s |
| js-0 | js-2 | 11:35:08.740854 | 13.162 s | 12.924 s | 11:36:54.904024 | 177.8 ms | 106.163 s |
| js-1 | go-2 | 11:35:02.636047 | 7.058 s | 6.820 s | 11:36:54.932735 | 206.5 ms | 112.297 s |
| js-1 | js-2 | 11:35:02.638968 | 7.061 s | 6.822 s | 11:36:54.965192 | 239.0 ms | 112.326 s |
| js-2 | go-0 | 11:35:05.536463 | 9.958 s | 9.720 s | 11:36:57.361420 | 2635.2 ms | 111.825 s |
| js-2 | go-1 | 11:35:05.527999 | 9.950 s | 9.712 s | 11:36:55.907908 | 1181.7 ms | 110.380 s |
| js-2 | js-0 | 11:35:05.538120 | 9.960 s | 9.722 s | 11:36:54.910999 | 184.8 ms | 109.373 s |
| js-2 | js-1 | 11:35:05.534211 | 9.956 s | 9.718 s | 11:36:54.969805 | 243.6 ms | 109.436 s |

Detection lag after the cut: min 6.820 s, max 40.857 s (16 of 16 sides saw a disconnect). Recovery lag: min 170.5 ms, max 2635.2 ms.

### Delivery at the isolated peers

Messages published between the end of the cut and T_remove: missed by the isolated peer. Expected about publish rate x isolation = 1174 (all publishers). Late arrival: a message published before T_remove that arrived after it, more than 1 s after it was published.

| peer | last receipt before the cut | receipts during (cut done + 1 s -> T_remove) | first receipt after T_remove | first new message - T_remove | missed of published during | late arrivals |
| --- | --- | --- | --- | --- | --- | --- |
| go-2 | 11:34:55.768335 (go-1 1210) | 0 | 11:36:55.581679 (go-1 2408), 855.5 ms | 855.5 ms | 1155 of 1174 | 19 (1.165 s-2.964 s) |
| js-2 | 11:34:55.769134 (go-1 1210) | 0 | 11:36:55.581124 (go-1 2408), 854.9 ms | 854.9 ms | 1155 of 1174 | 19 (1.202 s-2.982 s) |

### Alert DeliveryCompletenessLow

First and last firing sample (the export's 5 s grid).

| subscriber | publisher | first firing | - T_apply | last firing | - T_remove |
| --- | --- | --- | --- | --- | --- |
| go-2 | go-1 | 11:35:44 | 48.422 s | 11:37:19 | 24.274 s |
| js-2 | go-1 | 11:35:44 | 48.422 s | 11:37:19 | 24.274 s |

### Alert notifications

Notifications that the alert receiver logged (Alertmanager webhook).

| subscriber | publisher | status | time | delay |
| --- | --- | --- | --- | --- |
| go-2 | go-1 | firing | 11:35:53 | 57.665 s after T_apply |
| js-2 | go-1 | firing | 11:35:53 | 57.856 s after T_apply |
| js-2 | go-1 | resolved | 11:37:33 | 38.507 s after T_remove |
| go-2 | go-1 | resolved | 11:37:33 | 38.509 s after T_remove |

