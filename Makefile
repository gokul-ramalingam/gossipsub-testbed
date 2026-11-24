# GossipSub testbed. Run make help for the targets.
# Settings are variables, such as: make run-iso DURATION=300 ISOLATE_AT=60 ISOLATION=90
# The logic is in scripts/. Works with GNU make 3.81 (macOS) and later.

SHELL := /bin/bash

# Cluster, peer namespace and image tag. Fixed: the scripts, the kind config
# and the chart (appVersion) use the same values.
override CLUSTER := gossipsub-testbed
override NS      := dst
override VERSION := 0.1.0
GO_IMAGE := gossipsub-testbed/go-peer:$(VERSION)
JS_IMAGE := gossipsub-testbed/js-peer:$(VERSION)

# Pinned chart versions.
KPS_VERSION ?= 93.1.2
VLS_VERSION ?= 0.13.11
VLC_VERSION ?= 0.3.8

# Run settings: duration, isolation start and length (seconds), msg/s per publisher, bytes per message.
DURATION   ?=
ISOLATE_AT ?=
ISOLATION  ?=
RATE       ?= 10
SIZE       ?= 1024

# Run ID for analyze.
RUN ?=

.DEFAULT_GOAL := help
.PHONY: help tools up cluster images load monitoring logging peers reload status \
        run-base run-iso isolate-on isolate-off isolate-check analyze \
        grafana prometheus alertmanager logs-ui test test-alert lint down

help: ## List the targets
	@awk 'BEGIN {FS = ":.*## "} /^[a-z-]+:.*## / {printf "  %-15s %s\n", $$1, $$2}' $(MAKEFILE_LIST)

tools: ## Check the needed tools
	@for t in docker kind kubectl helm jq curl gzip python3; do \
	  command -v $$t >/dev/null && echo "ok      $$t" || echo "MISSING $$t"; done
	@for t in go npm node shellcheck; do \
	  command -v $$t >/dev/null && echo "ok      $$t (optional)" || echo "missing $$t (optional: tests, lint)"; done

# --- cluster and deployment ------------------------------------------------------

up: cluster images load monitoring logging peers ## Create the cluster and install everything

cluster: ## Create the kind cluster if it does not exist
	@kind get clusters 2>/dev/null | grep -qx $(CLUSTER) || kind create cluster --config kind/cluster.yaml

images: ## Build the Go and JS peer images
	docker build -t $(GO_IMAGE) peers/go-peer
	docker build -t $(JS_IMAGE) peers/js-peer

load: ## Load the peer images into the kind nodes
	kind load docker-image $(GO_IMAGE) $(JS_IMAGE) --name $(CLUSTER)

monitoring: ## Install Prometheus, Alertmanager, Grafana and the alert receiver
	@helm repo add prometheus-community https://prometheus-community.github.io/helm-charts >/dev/null 2>&1 || true
	helm repo update prometheus-community >/dev/null
	helm upgrade --install kps prometheus-community/kube-prometheus-stack --version $(KPS_VERSION) \
	  -n monitoring --create-namespace -f monitoring/kube-prometheus-stack.values.yaml --wait --timeout 10m
	kubectl apply -k k8s/alert-receiver
	kubectl -n monitoring rollout status deployment/alert-receiver --timeout 3m

logging: ## Install VictoriaLogs and its collector
	@helm repo add vm https://victoriametrics.github.io/helm-charts >/dev/null 2>&1 || true
	helm repo update vm >/dev/null
	helm upgrade --install vls vm/victoria-logs-single --version $(VLS_VERSION) \
	  -n logging --create-namespace -f monitoring/victoria-logs-single.values.yaml --wait
	helm upgrade --install vlc vm/victoria-logs-collector --version $(VLC_VERSION) \
	  -n logging -f monitoring/victoria-logs-collector.values.yaml --wait

peers: ## Install the testbed chart: peers, PodMonitor, alert rule, dashboard
	helm upgrade --install testbed charts/gossipsub-testbed -n $(NS) --create-namespace --wait

reload: images load ## Rebuild the images, load them and restart the peers
	kubectl -n $(NS) rollout restart statefulset/go statefulset/js
	kubectl -n $(NS) rollout status statefulset/go --timeout 3m
	kubectl -n $(NS) rollout status statefulset/js --timeout 3m

status: ## Show the connections and mesh size of each peer
	@scripts/status.sh

down: ## Delete the kind cluster
	kind delete cluster --name $(CLUSTER)

# --- experiments -------------------------------------------------------------------

run-base: ## Scenario A: baseline run, 300 s by default
	RATE=$(RATE) SIZE=$(SIZE) scripts/run.sh base $(DURATION)

run-iso: ## Scenario B: isolation run, 420 s, isolated from 120 s for 120 s
	RATE=$(RATE) SIZE=$(SIZE) scripts/run.sh iso $(or $(DURATION),420) $(or $(ISOLATE_AT),120) $(or $(ISOLATION),120)

isolate-on: ## Isolate go-2 and js-2, and check
	scripts/isolate.sh enable

isolate-off: ## End the isolation and check
	scripts/isolate.sh disable

isolate-check: ## Check the isolation only
	scripts/isolate.sh check

analyze: ## Analyze a run again: make analyze RUN=<run_id>
	@test -n "$(RUN)" || { echo "usage: make analyze RUN=<run_id>"; exit 2; }
	python3 scripts/analyze.py runs/$(RUN)

# --- user interfaces (port-forward until Ctrl-C) -----------------------------------

grafana: ## Grafana on http://localhost:3000 (admin / admin)
	kubectl -n monitoring port-forward svc/kps-grafana 3000:80

prometheus: ## Prometheus on http://localhost:9090
	kubectl -n monitoring port-forward svc/kps-kube-prometheus-stack-prometheus 9090:9090

alertmanager: ## Alertmanager on http://localhost:9093
	kubectl -n monitoring port-forward svc/kps-kube-prometheus-stack-alertmanager 9093:9093

logs-ui: ## VictoriaLogs UI on http://localhost:9428/select/vmui/
	kubectl -n logging port-forward svc/vls-victoria-logs-single-server 9428:9428

# --- checks -------------------------------------------------------------------------

test: ## Run the unit tests of the Go and JS peers
	cd peers/go-peer && go test -race ./...
	cd peers/js-peer && npm ci --no-audit --no-fund && npm test

test-alert: ## Test the alert rule of the cluster with promtool
	scripts/test-alert.sh

lint: ## Lint the scripts and the chart
	shellcheck scripts/*.sh
	helm lint charts/gossipsub-testbed
