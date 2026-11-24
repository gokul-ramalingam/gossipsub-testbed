#!/usr/bin/env bash
# Runs one experiment (README.md, "Run the scenarios") and keeps its raw data
# in runs/<run_id>/.
#
#   scripts/run.sh base [duration_s]                              Scenario A, default 300 s
#   scripts/run.sh iso  [duration_s] [isolate_at_s] [isolation_s]  Scenario B, default 420 120 120
#
# Settings from the environment: PUBLISHERS (default go-1), RATE (msg/s per
# publisher, default 10), SIZE (bytes per message, default 1024).
#
# Steps: wait until every peer has 5 connections; a 20 s warm-up run (the first
# messages after a peer joins can be lost, Phase 1); wait until every mesh has
# at least 3 peers (Dlo); the run from go-1 and js-1; for iso, scripts/isolate.sh
# enable at isolate_at_s and disable isolation_s later; then the export.
#
# runs/<run_id>/
#   settings.json      the run's settings and versions
#   timeline.jsonl     the script's events, with the time of the kind node
#   logs.jsonl.gz      the run's lines from VictoriaLogs (run_id, connection,
#                      mesh and isolation_check events of the run's time range)
#   metrics/*.json     Prometheus range queries over the run (step 5 s)
#   analysis.md        scripts/analyze.py of the run
#
# The run ID is <scenario>-<UTC start, kind node>-<4 random hex digits>: unique,
# readable, sorted by time.
#
# Works on macOS (bash 3.2) and Linux: every time conversion uses the GNU date
# of the kind node (the clock of the experiment), not the host's date. Needs
# kubectl, kind, docker, jq, curl, gzip, python3.
#
# The host is kept awake during the run: on macOS the Docker VM stalls for a few
# seconds when the display wakes up after an idle sleep (README.md, "Known
# issues"). caffeinate on macOS, systemd-inhibit on Linux if present.
set -euo pipefail

# Namespace of the peers, name of the kind cluster, and the node whose clock is used.
NS=dst
CLUSTER=gossipsub-testbed
CLOCK_NODE="${CLUSTER}-control-plane"
# The repository root (the scripts' parent folder).
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# The peers, the publishers, and the isolated peers (k8s/isolate.yaml).
PEERS="go-0 go-1 go-2 js-0 js-1 js-2"
PUBLISHERS="${PUBLISHERS:-go-1}"
ISOLATED="go-2 js-2"
# Workload per publisher.
RATE="${RATE:-10}"
SIZE="${SIZE:-1024}"
# Warm-up run length, and the time the network gets after it.
WARMUP_S=20
SETTLE_S=10
# Seconds to wait after the run for the last log lines (VictoriaLogs: 5–10 s).
INGEST_WAIT_S=15
# Local ports of the port-forwards for the export.
PROM_PORT=19090
VL_PORT=19428

SCENARIO="${1:-}"
case "$SCENARIO" in
  base)
    DURATION_S="${2:-300}"
    ISOLATE_AT_S=""
    ISOLATION_S=""
    ;;
  iso)
    DURATION_S="${2:-420}"
    ISOLATE_AT_S="${3:-120}"
    ISOLATION_S="${4:-120}"
    if ((ISOLATE_AT_S + ISOLATION_S >= DURATION_S)); then
      echo "isolate_at_s + isolation_s must be below duration_s" >&2
      exit 2
    fi
    ;;
  *)
    echo "usage: $0 base [duration_s] | iso [duration_s] [isolate_at_s] [isolation_s]" >&2
    exit 2
    ;;
esac

# now prints the UTC time of the kind node, with microseconds.
now() {
  docker exec "$CLOCK_NODE" date -u +%Y-%m-%dT%H:%M:%S.%6NZ
}

# epoch prints the Unix seconds of a UTC time (2026-11-24T10:15:00[.123456]Z).
epoch() {
  docker exec "$CLOCK_NODE" date -u -d "$1" +%s
}

# utc prints Unix seconds $1 in the format $2, in UTC.
utc() {
  docker exec "$CLOCK_NODE" date -u -d "@$1" "+$2"
}

# keep_awake keeps the host from sleeping (and the display from turning off)
# until this script ends.
keep_awake() {
  if command -v caffeinate >/dev/null; then
    caffeinate -dims -w $$ &
  elif command -v systemd-inhibit >/dev/null; then
    systemd-inhibit --what=idle:sleep --who=gossipsub-testbed --why="run in progress" \
      sh -c "while kill -0 $$ 2>/dev/null; do sleep 5; done" &
  fi
}

# record prints one script event as a JSON line and appends it to the timeline.
# $1 = time, $2 = event, then key=value pairs (numbers stay numbers).
record() {
  local ts="$1" event="$2" args=()
  shift 2
  for pair in "$@"; do
    args+=(--arg "${pair%%=*}" "${pair#*=}")
  done
  jq -cn --arg ts "$ts" --arg event "$event" "${args[@]+"${args[@]}"}" \
    '$ARGS.named | with_entries(.value |= (tonumber? // .)) | {ts: .ts, event: .event} + del(.ts, .event)' |
    tee -a "$OUT/timeline.jsonl"
}

# api calls the HTTP API of a peer from inside its pod (no port-forward needed).
# $1 = peer, $2 = path, $3 = POST body (optional).
api() {
  if [[ -n "${3:-}" ]]; then
    kubectl -n "$NS" exec "$1" -- wget -qO- --header 'Content-Type: application/json' --post-data "$3" "localhost:8080$2"
  else
    kubectl -n "$NS" exec "$1" -- wget -qO- "localhost:8080$2"
  fi
}

# metric prints the value of a gauge of a peer, from its /metrics.
metric() {
  api "$1" /metrics | awk -v m="$2" '$1 == m { print $2 }'
}

# wait_for waits up to $1 seconds until the command in the other arguments
# succeeds; it fails the script if it never does.
wait_for() {
  local limit="$1" waited=0
  shift
  until "$@"; do
    if ((waited >= limit)); then
      echo "timed out after ${limit}s: $*" >&2
      exit 1
    fi
    sleep 2
    waited=$((waited + 2))
  done
}

# all_connected succeeds when every peer has 5 connections.
all_connected() {
  local p
  for p in $PEERS; do
    [[ "$(api "$p" /connections | jq -r .data.count)" == 5 ]] || return 1
  done
}

# all_meshed succeeds when every peer has at least 3 mesh peers (Dlo).
all_meshed() {
  local p
  for p in $PEERS; do
    (($(metric "$p" gs_mesh_peers) >= 3)) || return 1
  done
}

# start_publishers starts a run with ID $1 and length $2 on every publisher.
start_publishers() {
  local p body
  body="$(jq -cn --arg id "$1" --argjson rate "$RATE" --argjson size "$SIZE" --argjson d "$2" \
    '{run_id: $id, rate: $rate, size: $size, duration_s: $d}')"
  for p in $PUBLISHERS; do
    api "$p" /publish/start "$body" >/dev/null
  done
}

# wait_publishers waits until no publisher is publishing.
wait_publishers() {
  local p
  for p in $PUBLISHERS; do
    while [[ "$(api "$p" /publish/status | jq -r .data.publishing)" == true ]]; do
      sleep 2
    done
  done
}

# mesh_sizes prints the mesh size of every peer, as peer=size pairs.
mesh_sizes() {
  local p out=""
  for p in $PEERS; do
    out="$out $p=$(metric "$p" gs_mesh_peers)"
  done
  echo "${out# }"
}

# --- run ID and folder ---------------------------------------------------------

keep_awake

START_TS="$(now)"
RUN_ID="${SCENARIO}-$(utc "$(epoch "$START_TS")" %Y%m%dT%H%M%SZ)-$(od -An -N2 -tx1 /dev/urandom | tr -d ' \n')"
OUT="$ROOT/runs/$RUN_ID"
mkdir -p "$OUT/metrics"
echo "run $RUN_ID → runs/$RUN_ID"

# --- stable network ------------------------------------------------------------

wait_for 180 all_connected
record "$(now)" connected peers="$PEERS"

WARMUP_ID="warmup-${RUN_ID#*-}"
start_publishers "$WARMUP_ID" "$WARMUP_S"
record "$(now)" warmup_started run_id="$WARMUP_ID" duration_s="$WARMUP_S"
wait_publishers
sleep "$SETTLE_S"
wait_for 120 all_meshed
record "$(now)" stable mesh="$(mesh_sizes)"

# --- the run -------------------------------------------------------------------

start_publishers "$RUN_ID" "$DURATION_S"
RUN_START="$(now)"
record "$RUN_START" run_started run_id="$RUN_ID" scenario="$SCENARIO" rate="$RATE" size="$SIZE" duration_s="$DURATION_S" publishers="$PUBLISHERS"

if [[ "$SCENARIO" == iso ]]; then
  sleep "$ISOLATE_AT_S"
  # The isolation lasts isolation_s from the moment enable starts: enable itself
  # (policy, conntrack, checks) takes several seconds, so sleep only the rest.
  ISOLATION_END=$(($(date +%s) + ISOLATION_S))
  "$ROOT/scripts/isolate.sh" enable "$OUT/timeline.jsonl"
  REST=$((ISOLATION_END - $(date +%s)))
  if ((REST > 0)); then
    sleep "$REST"
  fi
  "$ROOT/scripts/isolate.sh" disable "$OUT/timeline.jsonl"
fi

wait_publishers
RUN_END="$(now)"
record "$RUN_END" run_stopped run_id="$RUN_ID"
if [[ "$SCENARIO" == iso ]]; then
  "$ROOT/scripts/isolate.sh" check "$OUT/timeline.jsonl"
fi
record "$(now)" mesh_after mesh="$(mesh_sizes)"

# --- settings ------------------------------------------------------------------

jq -n \
  --arg run_id "$RUN_ID" --arg scenario "$SCENARIO" \
  --argjson rate "$RATE" --argjson size "$SIZE" --argjson duration_s "$DURATION_S" \
  --arg isolate_at_s "$ISOLATE_AT_S" --arg isolation_s "$ISOLATION_S" \
  --arg publishers "$PUBLISHERS" --arg isolated "$ISOLATED" \
  --arg start "$RUN_START" --arg end "$RUN_END" \
  --arg kindnet "$(kubectl -n kube-system get ds kindnet -o jsonpath='{.spec.template.spec.containers[0].image}')" \
  --arg node "$(kubectl get node "$CLOCK_NODE" -o jsonpath='{.status.nodeInfo.kubeletVersion}')" \
  --arg go_image "$(kubectl -n "$NS" get pod go-1 -o jsonpath='{.status.containerStatuses[0].imageID}')" \
  --arg js_image "$(kubectl -n "$NS" get pod js-1 -o jsonpath='{.status.containerStatuses[0].imageID}')" \
  --arg chart "$(helm -n "$NS" list -o json | jq -r '.[] | select(.name=="testbed") | "\(.chart) revision \(.revision)"')" \
  --arg commit "$(git -C "$ROOT" rev-parse --short HEAD)$(git -C "$ROOT" diff --quiet HEAD || echo '-dirty')" \
  '{run_id: $run_id, scenario: $scenario, rate_per_publisher: $rate, size_bytes: $size, duration_s: $duration_s,
    isolate_at_s: ($isolate_at_s | tonumber? // null), isolation_s: ($isolation_s | tonumber? // null),
    publishers: ($publishers | split(" ")), isolated: (if $scenario == "iso" then ($isolated | split(" ")) else [] end),
    start: $start, end: $end,
    versions: {kindnet: $kindnet, kubernetes: $node, chart: $chart, commit: $commit,
               go_peer_image: $go_image, js_peer_image: $js_image},
    transport: {yamux_keepalive_s: 30, redial_interval_s: 5, gossipsub: {D: 3, Dlo: 3, Dhi: 4, prune_backoff_s: 60}}}' \
  >"$OUT/settings.json"

# --- export --------------------------------------------------------------------

sleep "$INGEST_WAIT_S"
kubectl -n monitoring port-forward svc/kps-kube-prometheus-stack-prometheus "$PROM_PORT:9090" >/dev/null 2>&1 &
PF_PROM=$!
kubectl -n logging port-forward svc/vls-victoria-logs-single-server "$VL_PORT:9428" >/dev/null 2>&1 &
PF_VL=$!
trap 'kill $PF_PROM $PF_VL 2>/dev/null || true' EXIT
wait_for 30 curl -sf "localhost:$PROM_PORT/-/ready" -o /dev/null
wait_for 30 curl -sf "localhost:$VL_PORT/health" -o /dev/null

# Logs: the run's lines, and the connection, mesh and check events of the run's
# time range (they have no run ID), from 10 s before the start to 15 s after the end.
FROM="$(utc $(($(epoch "$RUN_START") - 10)) %Y-%m-%dT%H:%M:%SZ)"
TO="$(utc $(($(epoch "$RUN_END") + 15)) %Y-%m-%dT%H:%M:%SZ)"
curl -sf "localhost:$VL_PORT/select/logsql/query" \
  --data-urlencode "query=_time:[$FROM, $TO] (run_id:\"$RUN_ID\" or event:peer_* or event:graft or event:prune or event:isolation_check) kubernetes.pod_namespace:$NS | sort by (_time)" |
  gzip >"$OUT/logs.jsonl.gz"

# Metrics: range queries over the same time range, every 5 s (the scrape interval).
R="run_id=\"$RUN_ID\""
C="namespace=\"$NS\", container=\"peer\""
while IFS='|' read -r name query; do
  [[ -z "$name" ]] && continue
  curl -sf "localhost:$PROM_PORT/api/v1/query_range" --data-urlencode "query=$query" \
    --data-urlencode "start=$(epoch "$FROM")" --data-urlencode "end=$(epoch "$TO")" --data-urlencode step=5 \
    >"$OUT/metrics/$name.json"
done <<EOF
publish_success|gs_publish_success_total{$R}
publish_errors|gs_publish_errors_total{$R}
received|gs_messages_received_total{$R}
duplicates|gs_messages_duplicate_total{$R}
latency_buckets|sum by (pod, impl, le) (gs_delivery_latency_seconds_bucket{$R})
connected_peers|max by (pod) (gs_connected_peers{namespace="$NS"})
topic_peers|max by (pod) (gs_topic_peers{namespace="$NS"})
mesh_peers|max by (pod) (gs_mesh_peers{namespace="$NS"})
up|max by (pod) (up{job="$NS/peers"})
cpu|sum by (pod) (rate(container_cpu_usage_seconds_total{$C}[1m]))
memory|sum by (pod) (container_memory_working_set_bytes{$C})
throttling|sum by (pod) (rate(container_cpu_cfs_throttled_periods_total{$C}[1m])) / sum by (pod) (rate(container_cpu_cfs_periods_total{$C}[1m]))
restarts|max by (pod) (kube_pod_container_status_restarts_total{namespace="$NS"})
networkpolicy|kube_networkpolicy_created{namespace="$NS"}
alerts|ALERTS{alertname="DeliveryCompletenessLow"}
EOF

record "$(now)" exported logs_lines="$(gunzip -c "$OUT/logs.jsonl.gz" | wc -l | tr -d ' ')" metrics_files="$(find "$OUT/metrics" -name '*.json' | wc -l | tr -d ' ')"

# --- analysis ------------------------------------------------------------------

python3 "$ROOT/scripts/analyze.py" "$OUT" >/dev/null
echo "done: runs/$RUN_ID (analysis: runs/$RUN_ID/analysis.md)"
