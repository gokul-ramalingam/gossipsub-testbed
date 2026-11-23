#!/usr/bin/env bash
# Isolates go-2 and js-2 from the other four peers, and ends the isolation
# (Scenario B, docs/phase3-plan.md).
#
#   scripts/isolate.sh enable  [timeline file]   policy on, open connections cut, checks
#   scripts/isolate.sh disable [timeline file]   policy off, checks
#   scripts/isolate.sh check   [timeline file]   checks only
#
# enable applies k8s/isolate.yaml, then deletes the conntrack entries of go-2
# and js-2 on every kind node: a NetworkPolicy blocks only new connections, and
# without the deletion the open libp2p connections would keep carrying messages
# (docs/phase3-plan.md, section 6). disable deletes the policy only.
#
# Each step is one JSON line with the time of the kind node (the clock of the
# peers) taken just before the step's command, and done_at when it returned;
# printed and, if a timeline file is given, appended to it. Each check
# (nc to port 4001) is also written to the stdout of the peer it ran in, as an
# isolation_check log line, so that it is in VictoriaLogs with the peer's logs.
#
# Works with the bash 3.2 of macOS.
set -euo pipefail

# Namespace of the peers, name of the kind cluster, and the node whose clock is used.
NS=dst
CLUSTER=gossipsub-testbed
CLOCK_NODE="${CLUSTER}-control-plane"
# The policy, next to this script's folder.
POLICY="$(cd "$(dirname "$0")/.." && pwd)/k8s/isolate.yaml"
# The isolated peers, and the libp2p port of all peers.
ISOLATED="go-2 js-2"
P2P_PORT=4001
# Seconds that one nc check waits for the connection.
CHECK_TIMEOUT=2

ACTION="${1:-}"
TIMELINE="${2:-}"

# now prints the UTC time of the kind node, with microseconds.
now() {
  docker exec "$CLOCK_NODE" date -u +%Y-%m-%dT%H:%M:%S.%6NZ
}

# record prints one JSON line (the fields given, after ts) and appends it to
# the timeline file, if any. $1 is the time; the other arguments are key=value
# pairs (values are strings, or numbers if they look like one).
record() {
  local ts="$1" line key value
  shift
  line="{\"ts\":\"$ts\""
  for pair in "$@"; do
    key="${pair%%=*}"
    value="${pair#*=}"
    if [[ "$value" =~ ^[0-9]+$ ]]; then
      line="$line,\"$key\":$value"
    else
      line="$line,\"$key\":\"$value\""
    fi
  done
  line="$line}"
  echo "$line"
  if [[ -n "$TIMELINE" ]]; then
    echo "$line" >>"$TIMELINE"
  fi
}

# pod_ip prints the IP of a peer.
pod_ip() {
  kubectl -n "$NS" get pod "$1" -o jsonpath='{.status.podIP}'
}

# check opens a TCP connection from peer $1 to peer $2 on the libp2p port, and
# records ok or fail, in the timeline and in the logs of peer $1.
check() {
  local from="$1" to="$2" ip result ts line
  ip="$(pod_ip "$to")"
  if kubectl -n "$NS" exec "$from" -- nc -z -w "$CHECK_TIMEOUT" "$ip" "$P2P_PORT" >/dev/null 2>&1; then
    result=ok
  else
    result=fail
  fi
  ts="$(now)"
  record "$ts" event=isolation_check peer="$from" to="$to" result="$result"
  line="{\"ts\":\"$ts\",\"level\":\"INFO\",\"event\":\"isolation_check\",\"peer\":\"$from\",\"to\":\"$to\",\"result\":\"$result\"}"
  kubectl -n "$NS" exec "$from" -- sh -c "echo '$line' > /proc/1/fd/1"
}

# checks runs the three checks of the plan: go-2 to go-0 (blocked during the
# isolation), go-2 to js-2 (always open), go-0 to go-2 (the other direction).
checks() {
  check go-2 go-0
  check go-2 js-2
  check go-0 go-2
}

# cut_connections deletes the conntrack entries of the isolated peers' IPs, as
# source and as destination, on every node, and records how many were deleted.
cut_connections() {
  local ips="" ip node deleted=0 out n t0
  t0="$(now)"
  for peer in $ISOLATED; do
    ips="$ips $(pod_ip "$peer")"
  done
  for node in $(kind get nodes --name "$CLUSTER"); do
    for ip in $ips; do
      for flag in --orig-src --orig-dst; do
        # conntrack prints the deleted entries, then "N flow entries have been
        # deleted" on stderr; it exits with 1 when there were none.
        out="$(docker exec "$node" conntrack -D "$flag" "$ip" 2>&1 >/dev/null || true)"
        n="$(echo "$out" | sed -n 's/.*: \([0-9][0-9]*\) flow entries have been deleted.*/\1/p')"
        deleted=$((deleted + ${n:-0}))
      done
    done
  done
  record "$t0" event=connections_cut ips="${ips# }" conntrack_entries_deleted="$deleted" done_at="$(now)"
}

case "$ACTION" in
  enable)
    # The event's time is the time of the command (before it); done_at is when
    # kubectl returned. The policy can take effect before kubectl returns.
    t0="$(now)"
    kubectl apply -f "$POLICY" >/dev/null
    record "$t0" event=isolation_enabled policy=isolate peers="$ISOLATED" done_at="$(now)"
    cut_connections
    checks
    ;;
  disable)
    t0="$(now)"
    kubectl -n "$NS" delete networkpolicy isolate --ignore-not-found >/dev/null
    record "$t0" event=isolation_disabled policy=isolate peers="$ISOLATED" done_at="$(now)"
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
