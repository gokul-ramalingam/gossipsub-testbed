#!/usr/bin/env bash
# Runs the promtool unit test of the alert DeliveryCompletenessLow
# (monitoring/tests/delivery-completeness.test.yaml) against the rule that is
# installed in the cluster.
#
#   scripts/test-alert.sh
#
# promtool comes from the cluster's own Prometheus image, in a short-lived pod
# on the node that already has the image (no download). The rule (the spec of
# the PrometheusRule) and the test go in a ConfigMap; the pod and the ConfigMap
# are deleted after the test. The exit code is promtool's.
#
# Works on macOS (bash 3.2) and Linux. Needs kubectl, jq.
set -euo pipefail

# The repository root, the test, the namespace of Prometheus, and the names used.
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TEST="$ROOT/monitoring/tests/delivery-completeness.test.yaml"
MON_NS=monitoring
NAME=promtool-test

TMP="$(mktemp -d)"
cleanup() {
  kubectl -n "$MON_NS" delete configmap "$NAME" --ignore-not-found >/dev/null
  rm -rf "$TMP"
}
trap cleanup EXIT

kubectl -n dst get prometheusrule gossipsub -o json | jq .spec >"$TMP/rules.json"
cp "$TEST" "$TMP/test.yaml"
kubectl -n "$MON_NS" create configmap "$NAME" --from-file="$TMP/rules.json" --from-file="$TMP/test.yaml" \
  --dry-run=client -o yaml | kubectl apply -f - >/dev/null

PROM_POD="$(kubectl -n "$MON_NS" get pods -l app.kubernetes.io/name=prometheus -o jsonpath='{.items[0].metadata.name}')"
IMAGE="$(kubectl -n "$MON_NS" get pod "$PROM_POD" -o jsonpath='{.spec.containers[?(@.name=="prometheus")].image}')"
NODE="$(kubectl -n "$MON_NS" get pod "$PROM_POD" -o jsonpath='{.spec.nodeName}')"

kubectl -n "$MON_NS" run "$NAME" --rm -i --restart=Never --quiet --image="$IMAGE" --overrides="$(jq -cn \
  --arg node "$NODE" --arg image "$IMAGE" --arg name "$NAME" \
  '{spec: {nodeName: $node, containers: [{name: $name, image: $image, imagePullPolicy: "IfNotPresent",
     workingDir: "/t", command: ["/bin/promtool", "test", "rules", "test.yaml"],
     volumeMounts: [{name: "t", mountPath: "/t"}]}],
   volumes: [{name: "t", configMap: {name: $name}}]}}')"
