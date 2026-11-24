#!/usr/bin/env bash
# Shows the pods, and the connections and mesh size of each peer.
# Usage: scripts/status.sh
set -euo pipefail

NS=dst

# peer_status prints the connected peers and the mesh size of one peer.
peer_status() {
  local peer="$1" connections mesh
  connections="$(kubectl -n "$NS" exec "$peer" -- wget -qO- localhost:8080/connections 2>/dev/null |
    jq -r '"\(.data.count): \([.data.peers[].name] | sort | join(" "))"' 2>/dev/null || echo "?")"
  mesh="$(kubectl -n "$NS" exec "$peer" -- wget -qO- localhost:8080/metrics 2>/dev/null |
    awk '$1 == "gs_mesh_peers" { print $2 }')"
  echo "$peer  connected $connections  mesh ${mesh:-?}"
}

for ns in "$NS" monitoring logging; do
  echo "== pods in $ns"
  kubectl -n "$ns" get pods -o wide 2>/dev/null | awk '{print $1, $2, $3, $4, $7}' | column -t || echo "(namespace $ns not found)"
done

echo
echo "== peers (connected peers, mesh size)"
for peer in $(kubectl -n "$NS" get pods -l app.kubernetes.io/name=gossipsub-peer -o jsonpath='{.items[*].metadata.name}' 2>/dev/null); do
  peer_status "$peer"
done

echo
echo "== isolation policy"
kubectl -n "$NS" get networkpolicy isolate 2>/dev/null || echo "none (not isolated)"
