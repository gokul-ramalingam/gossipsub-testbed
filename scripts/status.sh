#!/usr/bin/env bash
# Shows the state of the testbed: the pods of the three namespaces, and for
# every peer its connected peers and its mesh size.
#
#   scripts/status.sh
#
# Works on macOS (bash 3.2) and Linux. Needs kubectl, jq.
set -euo pipefail

# Namespace of the peers, and the namespaces of the telemetry.
NS=dst
TELEMETRY_NS="monitoring logging"

for ns in "$NS" $TELEMETRY_NS; do
  echo "== pods in $ns"
  kubectl -n "$ns" get pods -o wide 2>/dev/null | awk '{print $1, $2, $3, $4, $7}' | column -t || echo "(namespace $ns not found)"
done

echo
echo "== peers (connected peers, mesh size)"
for peer in $(kubectl -n "$NS" get pods -o jsonpath='{.items[*].metadata.name}' 2>/dev/null); do
  connections="$(kubectl -n "$NS" exec "$peer" -- wget -qO- localhost:8080/connections 2>/dev/null |
    jq -r '"\(.data.count): \([.data.peers[].name] | sort | join(" "))"' 2>/dev/null || echo "?")"
  mesh="$(kubectl -n "$NS" exec "$peer" -- wget -qO- localhost:8080/metrics 2>/dev/null | awk '$1 == "gs_mesh_peers" { print $2 }')"
  echo "$peer  connected ${connections}  mesh ${mesh:-?}"
done

echo
echo "== isolation policy"
kubectl -n "$NS" get networkpolicy isolate 2>/dev/null || echo "none (not isolated)"
