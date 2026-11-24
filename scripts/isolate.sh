#!/usr/bin/env bash
# Isolates go-2 and js-2 from the other peers (Scenario B), or ends the isolation.
#
#   scripts/isolate.sh enable  [timeline file]   apply the policy, cut the open connections, check
#   scripts/isolate.sh disable [timeline file]   delete the policy, check
#   scripts/isolate.sh check   [timeline file]   check only
#
# Each step prints one JSON line with the node time, and adds it to the timeline file.
set -euo pipefail

NS=dst
CLUSTER=gossipsub-testbed
CLOCK_NODE="${CLUSTER}-control-plane"
POLICY="$(cd "$(dirname "$0")/.." && pwd)/k8s/isolate.yaml"
ISOLATED="go-2 js-2"
P2P_PORT=4001
CHECK_TIMEOUT=2   # seconds

ACTION="${1:-}"
TIMELINE="${2:-}"

# now prints the node time, such as 2026-11-24T10:15:00.123456Z.
now() {
  docker exec "$CLOCK_NODE" date -u +%Y-%m-%dT%H:%M:%S.%6NZ
}

# record prints one event as a JSON line and adds it to the timeline file.
# Usage: record <time> key=value [key=value ...]
record() {
  local ts="$1" args=() line
  shift
  for pair in "$@"; do
    args+=(--arg "${pair%%=*}" "${pair#*=}")   # key = text before "=", value = text after it
  done
  # Numbers stay numbers; ts comes first.
  line="$(jq -cn --arg ts "$ts" "${args[@]}" '$ARGS.named | with_entries(.value |= (tonumber? // .))')"
  echo "$line"
  if [[ -n "$TIMELINE" ]]; then
    echo "$line" >>"$TIMELINE"
  fi
}

# pod_ip prints the IP address of a peer.
pod_ip() {
  kubectl -n "$NS" get pod "$1" -o jsonpath='{.status.podIP}'
}

# check tries a TCP connection from one peer to another, and records ok or fail.
# The result also goes to the log of the first peer, so that it is in VictoriaLogs.
# Usage: check <from peer> <to peer>
check() {
  local from="$1" to="$2" result ts line
  if kubectl -n "$NS" exec "$from" -- nc -z -w "$CHECK_TIMEOUT" "$(pod_ip "$to")" "$P2P_PORT" >/dev/null 2>&1; then
    result=ok
  else
    result=fail
  fi
  ts="$(now)"
  record "$ts" event=isolation_check peer="$from" to="$to" result="$result"
  line="$(jq -cn --arg ts "$ts" --arg from "$from" --arg to "$to" --arg result "$result" \
    '{ts: $ts, level: "INFO", event: "isolation_check", peer: $from, to: $to, result: $result}')"
  # /proc/1/fd/1 is the output of the peer process, which the log collector reads.
  kubectl -n "$NS" exec "$from" -- sh -c "echo '$line' > /proc/1/fd/1"
}

# checks runs three checks: go-2 to go-0 (blocked when isolated), go-2 to js-2
# (always open), and go-0 to go-2.
checks() {
  check go-2 go-0
  check go-2 js-2
  check go-0 go-2
}

# cut_connections deletes the conntrack entries of the isolated peers on every
# node. A NetworkPolicy blocks only new connections, so without this the open
# connections keep working.
cut_connections() {
  local start ips=() peer node ip direction out count deleted=0
  start="$(now)"
  for peer in $ISOLATED; do
    ips+=("$(pod_ip "$peer")")
  done
  for node in $(kind get nodes --name "$CLUSTER"); do
    for ip in "${ips[@]}"; do
      for direction in --orig-src --orig-dst; do
        # conntrack writes "N flow entries have been deleted" to stderr, and
        # exits with 1 when there are none.
        out="$(docker exec "$node" conntrack -D "$direction" "$ip" 2>&1 >/dev/null || true)"
        count="$(echo "$out" | sed -n 's/.*: \([0-9][0-9]*\) flow entries have been deleted.*/\1/p')"
        deleted=$((deleted + ${count:-0}))
      done
    done
  done
  record "$start" event=connections_cut ips="${ips[*]}" conntrack_entries_deleted="$deleted" done_at="$(now)"
}

# ts is the time before each command, done_at the time after it.
case "$ACTION" in
  enable)
    start="$(now)"
    kubectl apply -f "$POLICY" >/dev/null
    record "$start" event=isolation_enabled policy=isolate peers="$ISOLATED" done_at="$(now)"
    cut_connections
    checks
    ;;
  disable)
    start="$(now)"
    kubectl -n "$NS" delete networkpolicy isolate --ignore-not-found >/dev/null
    record "$start" event=isolation_disabled policy=isolate peers="$ISOLATED" done_at="$(now)"
    checks
    ;;
  check)
    checks
    ;;
  *)
    echo "usage: $0 enable|disable|check [timeline file]" >&2
    exit 2
    ;;
esac
