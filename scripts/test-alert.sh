#!/usr/bin/env bash
# Tests the alert rule of the cluster with monitoring/tests/delivery-completeness.test.yaml.
# promtool runs in a temporary pod with the Prometheus image of the cluster.
# Usage: scripts/test-alert.sh. The exit code is the promtool exit code.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TEST="$ROOT/monitoring/tests/delivery-completeness.test.yaml"
MON_NS=monitoring

NAME=promtool-test   # name of the temporary pod and ConfigMap
TMP="$(mktemp -d)"

# cleanup deletes the ConfigMap and the temporary folder when the script ends.
cleanup() {
  kubectl -n "$MON_NS" delete configmap "$NAME" --ignore-not-found >/dev/null
  rm -rf "$TMP"
}
trap cleanup EXIT

# Put the installed rule and the test in a ConfigMap.
kubectl -n dst get prometheusrule gossipsub -o json | jq .spec >"$TMP/rules.json"
cp "$TEST" "$TMP/test.yaml"
kubectl -n "$MON_NS" create configmap "$NAME" --from-file="$TMP/rules.json" --from-file="$TMP/test.yaml" \
  --dry-run=client -o yaml | kubectl apply -f - >/dev/null

# Run promtool on the node of Prometheus, which already has the image.
PROM_POD="$(kubectl -n "$MON_NS" get pods -l app.kubernetes.io/name=prometheus -o jsonpath='{.items[0].metadata.name}')"
IMAGE="$(kubectl -n "$MON_NS" get pod "$PROM_POD" -o jsonpath='{.spec.containers[?(@.name=="prometheus")].image}')"
NODE="$(kubectl -n "$MON_NS" get pod "$PROM_POD" -o jsonpath='{.spec.nodeName}')"

kubectl -n "$MON_NS" run "$NAME" --rm -i --restart=Never --quiet --image="$IMAGE" --overrides="$(jq -cn \
  --arg node "$NODE" --arg image "$IMAGE" --arg name "$NAME" \
  '{spec: {nodeName: $node, containers: [{name: $name, image: $image, imagePullPolicy: "IfNotPresent",
     workingDir: "/t", command: ["/bin/promtool", "test", "rules", "test.yaml"],
     volumeMounts: [{name: "t", mountPath: "/t"}]}],
   volumes: [{name: "t", configMap: {name: $name}}]}}')"
