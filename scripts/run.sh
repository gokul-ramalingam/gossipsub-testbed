#!/usr/bin/env bash
# Runs one scenario and saves its data in runs/<run_id>/.
#
#   scripts/run.sh base [duration_s]                                Scenario A, default 300 s
#   scripts/run.sh iso  [duration_s] [isolate_at_s] [isolation_s]  Scenario B, default 420 120 120
#
# Environment: PUBLISHERS (default go-1), RATE (msg/s, default 10), SIZE (bytes, default 1024).
# All times come from the clock of the kind node.
set -euo pipefail

NS=dst
CLUSTER=gossipsub-testbed
CLOCK_NODE="${CLUSTER}-control-plane"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

PEERS="go-0 go-1 go-2 js-0 js-1 js-2"
ISOLATED="go-2 js-2"
# ${NAME:-value} uses value when NAME is not set.
PUBLISHERS="${PUBLISHERS:-go-1}"
RATE="${RATE:-10}"
SIZE="${SIZE:-1024}"

WARMUP_S=20         # warm-up run, so that the meshes form
SETTLE_S=10         # wait after the warm-up
INGEST_WAIT_S=15    # wait for the last log lines to reach VictoriaLogs
PROM_PORT=19090     # local port for Prometheus
VL_PORT=19428       # local port for VictoriaLogs

# --- helpers ---------------------------------------------------------------------

# now prints the node time, such as 2026-11-24T10:15:00.123456Z.
now() {
  docker exec "$CLOCK_NODE" date -u +%Y-%m-%dT%H:%M:%S.%6NZ
}

# epoch prints the Unix seconds of a time.
epoch() {
  docker exec "$CLOCK_NODE" date -u -d "$1" +%s
}

# utc prints Unix seconds $1 in the date format $2.
utc() {
  docker exec "$CLOCK_NODE" date -u -d "@$1" "+$2"
}

# record prints one event as a JSON line and adds it to the timeline.
# Usage: record <time> <event> [key=value ...]
record() {
  local ts="$1" event="$2" args=()
  shift 2
  for pair in "$@"; do
    args+=(--arg "${pair%%=*}" "${pair#*=}")   # key = text before "=", value = text after it
  done
  # Numbers stay numbers; ts and event come first.
  jq -cn --arg ts "$ts" --arg event "$event" "${args[@]+"${args[@]}"}" \
    '$ARGS.named | with_entries(.value |= (tonumber? // .)) | {ts: .ts, event: .event} + del(.ts, .event)' |
    tee -a "$OUT/timeline.jsonl"
}

# api calls the HTTP API of a peer from inside its pod. A third argument is sent as a POST body.
# Usage: api <peer> <path> [body]
api() {
  if [[ -n "${3:-}" ]]; then
    kubectl -n "$NS" exec "$1" -- wget -qO- --header 'Content-Type: application/json' --post-data "$3" "localhost:8080$2"
  else
    kubectl -n "$NS" exec "$1" -- wget -qO- "localhost:8080$2"
  fi
}

# metric prints the value of one metric of a peer.
# Usage: metric <peer> <metric name>
metric() {
  api "$1" /metrics | awk -v name="$2" '$1 == name { print $2 }'
}

# wait_for repeats a command every 2 s until it succeeds. After <seconds>, the script stops.
# Usage: wait_for <seconds> <command> [arguments ...]
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

# all_connected succeeds when each peer has 5 connections.
all_connected() {
  local p
  for p in $PEERS; do
    [[ "$(api "$p" /connections | jq -r .data.count)" == 5 ]] || return 1
  done
}

# all_meshed succeeds when each peer has at least 3 mesh peers (Dlo).
all_meshed() {
  local p
  for p in $PEERS; do
    (($(metric "$p" gs_mesh_peers) >= 3)) || return 1
  done
}

# mesh_sizes prints the mesh size of each peer, such as "go-0=3 go-1=4".
mesh_sizes() {
  local p sizes=()
  for p in $PEERS; do
    sizes+=("$p=$(metric "$p" gs_mesh_peers)")
  done
  echo "${sizes[*]}"
}

# start_publishers starts a run on each publisher.
# Usage: start_publishers <run id> <duration_s>
start_publishers() {
  local p body
  body="$(jq -cn --arg id "$1" --argjson rate "$RATE" --argjson size "$SIZE" --argjson duration "$2" \
    '{run_id: $id, rate: $rate, size: $size, duration_s: $duration}')"
  for p in $PUBLISHERS; do
    api "$p" /publish/start "$body" >/dev/null
  done
}

# wait_publishers waits until no publisher publishes.
wait_publishers() {
  local p
  for p in $PUBLISHERS; do
    while [[ "$(api "$p" /publish/status | jq -r .data.publishing)" == true ]]; do
      sleep 2
    done
  done
}

# keep_awake stops the host from sleeping until the script ends. On macOS,
# the Docker VM stalls when the display wakes up.
keep_awake() {
  if command -v caffeinate >/dev/null; then
    caffeinate -dims -w $$ &
  elif command -v systemd-inhibit >/dev/null; then
    systemd-inhibit --what=idle:sleep --who=gossipsub-testbed --why="run in progress" \
      sh -c "while kill -0 $$ 2>/dev/null; do sleep 5; done" &
  fi
}

# --- steps -----------------------------------------------------------------------

# read_arguments sets SCENARIO, DURATION_S, ISOLATE_AT_S and ISOLATION_S, and checks them.
read_arguments() {
  SCENARIO="${1:-}"
  ISOLATE_AT_S=""
  ISOLATION_S=""
  case "$SCENARIO" in
    base)
      DURATION_S="${2:-300}"
      ;;
    iso)
      DURATION_S="${2:-420}"
      ISOLATE_AT_S="${3:-120}"
      ISOLATION_S="${4:-120}"
      if ((ISOLATE_AT_S + ISOLATION_S >= DURATION_S)); then
        echo "isolate_at_s + isolation_s must be below duration_s" >&2
        exit 2
      fi
      local p
      for p in $PUBLISHERS; do
        if [[ " $ISOLATED " == *" $p "* ]]; then   # true when $p is in the list
          echo "publisher $p is an isolated peer; choose another publisher" >&2
          exit 2
        fi
      done
      ;;
    *)
      echo "usage: $0 base [duration_s] | iso [duration_s] [isolate_at_s] [isolation_s]" >&2
      exit 2
      ;;
  esac
}

# create_run sets RUN_ID and creates the run folder OUT.
# The run ID is <scenario>-<UTC start>-<4 random hex digits>.
create_run() {
  local start random
  start="$(utc "$(epoch "$(now)")" %Y%m%dT%H%M%SZ)"
  random="$(od -An -N2 -tx1 /dev/urandom | tr -d ' \n')"
  RUN_ID="$SCENARIO-$start-$random"
  OUT="$ROOT/runs/$RUN_ID"
  mkdir -p "$OUT/metrics"
  echo "run $RUN_ID -> runs/$RUN_ID"
}

# wait_until_stable waits for all connections, runs a warm-up, and waits for full meshes.
wait_until_stable() {
  wait_for 180 all_connected
  record "$(now)" connected peers="$PEERS"

  local warmup_id="warmup-${RUN_ID#*-}"   # the run ID without its scenario prefix
  start_publishers "$warmup_id" "$WARMUP_S"
  record "$(now)" warmup_started run_id="$warmup_id" duration_s="$WARMUP_S"
  wait_publishers
  sleep "$SETTLE_S"
  wait_for 120 all_meshed
  record "$(now)" stable mesh="$(mesh_sizes)"
}

# isolate isolates go-2 and js-2 for ISOLATION_S seconds. The time starts when
# the isolation starts, because isolate.sh enable takes several seconds.
isolate() {
  local end=$(($(date +%s) + ISOLATION_S))
  "$ROOT/scripts/isolate.sh" enable "$OUT/timeline.jsonl"
  local rest=$((end - $(date +%s)))
  if ((rest > 0)); then
    sleep "$rest"
  fi
  "$ROOT/scripts/isolate.sh" disable "$OUT/timeline.jsonl"
}

# run_workload publishes for DURATION_S seconds, with the isolation for iso.
# It sets RUN_START and RUN_END.
run_workload() {
  start_publishers "$RUN_ID" "$DURATION_S"
  RUN_START="$(now)"
  record "$RUN_START" run_started run_id="$RUN_ID" scenario="$SCENARIO" rate="$RATE" size="$SIZE" \
    duration_s="$DURATION_S" publishers="$PUBLISHERS"

  if [[ "$SCENARIO" == iso ]]; then
    sleep "$ISOLATE_AT_S"
    isolate
  fi

  wait_publishers
  RUN_END="$(now)"
  record "$RUN_END" run_stopped run_id="$RUN_ID"
  if [[ "$SCENARIO" == iso ]]; then
    "$ROOT/scripts/isolate.sh" check "$OUT/timeline.jsonl"
  fi
  record "$(now)" mesh_after mesh="$(mesh_sizes)"
}

# write_settings writes settings.json: the run settings and the versions.
write_settings() {
  local kindnet node go_image js_image chart commit
  kindnet="$(kubectl -n kube-system get ds kindnet -o jsonpath='{.spec.template.spec.containers[0].image}')"
  node="$(kubectl get node "$CLOCK_NODE" -o jsonpath='{.status.nodeInfo.kubeletVersion}')"
  go_image="$(kubectl -n "$NS" get pod go-1 -o jsonpath='{.status.containerStatuses[0].imageID}')"
  js_image="$(kubectl -n "$NS" get pod js-1 -o jsonpath='{.status.containerStatuses[0].imageID}')"
  chart="$(helm -n "$NS" list -o json | jq -r '.[] | select(.name=="testbed") | "\(.chart) revision \(.revision)"')"
  commit="$(git -C "$ROOT" rev-parse --short HEAD)$(git -C "$ROOT" diff --quiet HEAD || echo '-dirty')"

  jq -n \
    --arg run_id "$RUN_ID" --arg scenario "$SCENARIO" \
    --argjson rate "$RATE" --argjson size "$SIZE" --argjson duration_s "$DURATION_S" \
    --arg isolate_at_s "$ISOLATE_AT_S" --arg isolation_s "$ISOLATION_S" \
    --arg publishers "$PUBLISHERS" --arg isolated "$ISOLATED" \
    --arg start "$RUN_START" --arg end "$RUN_END" \
    --arg kindnet "$kindnet" --arg node "$node" --arg go_image "$go_image" --arg js_image "$js_image" \
    --arg chart "$chart" --arg commit "$commit" \
    '{run_id: $run_id, scenario: $scenario, rate_per_publisher: $rate, size_bytes: $size, duration_s: $duration_s,
      isolate_at_s: ($isolate_at_s | tonumber? // null), isolation_s: ($isolation_s | tonumber? // null),
      publishers: ($publishers | split(" ")), isolated: (if $scenario == "iso" then ($isolated | split(" ")) else [] end),
      start: $start, end: $end,
      versions: {kindnet: $kindnet, kubernetes: $node, chart: $chart, commit: $commit,
                 go_peer_image: $go_image, js_peer_image: $js_image},
      transport: {yamux_keepalive_s: 30, redial_interval_s: 5, gossipsub: {D: 3, Dlo: 3, Dhi: 4, prune_backoff_s: 60}}}' \
    >"$OUT/settings.json"
}

# export_data saves the logs and the metrics of the run, from 10 s before the
# start to 15 s after the end.
export_data() {
  sleep "$INGEST_WAIT_S"
  kubectl -n monitoring port-forward svc/kps-kube-prometheus-stack-prometheus "$PROM_PORT:9090" >/dev/null 2>&1 &
  PF_PROM=$!   # $! is the process ID of the last background command
  kubectl -n logging port-forward svc/vls-victoria-logs-single-server "$VL_PORT:9428" >/dev/null 2>&1 &
  PF_VL=$!
  # Stop both port-forwards when the script ends.
  trap 'kill $PF_PROM $PF_VL 2>/dev/null || true' EXIT
  wait_for 30 curl -sf "localhost:$PROM_PORT/-/ready" -o /dev/null
  wait_for 30 curl -sf "localhost:$VL_PORT/health" -o /dev/null

  local from to
  from="$(utc $(($(epoch "$RUN_START") - 10)) %Y-%m-%dT%H:%M:%SZ)"
  to="$(utc $(($(epoch "$RUN_END") + 15)) %Y-%m-%dT%H:%M:%SZ)"
  export_logs "$from" "$to"
  export_metrics "$(epoch "$from")" "$(epoch "$to")"

  record "$(now)" exported logs_lines="$(gunzip -c "$OUT/logs.jsonl.gz" | wc -l | tr -d ' ')" \
    metrics_files="$(find "$OUT/metrics" -name '*.json' | wc -l | tr -d ' ')"
}

# export_logs saves logs.jsonl.gz: the lines of the run, the connection, mesh
# and check events (they have no run ID), and the alert notifications of the run.
# Usage: export_logs <from> <to>
export_logs() {
  local peers="(run_id:\"$RUN_ID\" or event:peer_* or event:graft or event:prune or event:isolation_check) kubernetes.pod_namespace:$NS"
  local alerts="event:alert_notification run_id:\"$RUN_ID\""
  curl -sf "localhost:$VL_PORT/select/logsql/query" \
    --data-urlencode "query=_time:[$1, $2] (($peers) or ($alerts)) | sort by (_time)" |
    gzip >"$OUT/logs.jsonl.gz"
}

# export_metrics saves one Prometheus range query per file in metrics/, every 5 s.
# Usage: export_metrics <from, Unix seconds> <to, Unix seconds>
export_metrics() {
  local run="run_id=\"$RUN_ID\""
  local peer="namespace=\"$NS\", container=\"peer\""
  local name query
  # Each line below is <file name>|<query>.
  while IFS='|' read -r name query; do
    curl -sf "localhost:$PROM_PORT/api/v1/query_range" --data-urlencode "query=$query" \
      --data-urlencode "start=$1" --data-urlencode "end=$2" --data-urlencode step=5 \
      >"$OUT/metrics/$name.json"
  done <<EOF
publish_success|gs_publish_success_total{$run}
publish_errors|gs_publish_errors_total{$run}
received|gs_messages_received_total{$run}
duplicates|gs_messages_duplicate_total{$run}
latency_buckets|sum by (pod, impl, le) (gs_delivery_latency_seconds_bucket{$run})
connected_peers|max by (pod) (gs_connected_peers{namespace="$NS"})
topic_peers|max by (pod) (gs_topic_peers{namespace="$NS"})
mesh_peers|max by (pod) (gs_mesh_peers{namespace="$NS"})
up|max by (pod) (up{job="$NS/peers"})
cpu|sum by (pod) (rate(container_cpu_usage_seconds_total{$peer}[1m]))
memory|sum by (pod) (container_memory_working_set_bytes{$peer})
throttling|sum by (pod) (rate(container_cpu_cfs_throttled_periods_total{$peer}[1m])) / sum by (pod) (rate(container_cpu_cfs_periods_total{$peer}[1m]))
restarts|max by (pod) (kube_pod_container_status_restarts_total{namespace="$NS"})
networkpolicy|kube_networkpolicy_created{namespace="$NS"}
alerts|ALERTS{alertname="DeliveryCompletenessLow"}
EOF
}

# --- main ------------------------------------------------------------------------

main() {
  read_arguments "$@"
  keep_awake
  create_run
  wait_until_stable
  run_workload
  write_settings
  export_data
  python3 "$ROOT/scripts/analyze.py" "$OUT" >/dev/null
  echo "done: runs/$RUN_ID (analysis: runs/$RUN_ID/analysis.md)"
}

main "$@"
