# GossipSub testbed: one entry point for the whole lifecycle.
#
#   make help                 list the targets
#   make up                   kind cluster, images, monitoring, logging, peers
#   make run-base             Scenario A (5 min) → runs/base-<…>/
#   make run-iso              Scenario B (7 min, isolation from 2 min for 2 min) → runs/iso-<…>/
#   make down                 delete the cluster
#
# Settings are variables, for example: make run-iso DURATION=300 ISOLATE_AT=60 ISOLATION=90
# The logic is in scripts/; this file only calls it. Works with GNU make 3.81
# (macOS) and later (Linux).

SHELL := /bin/bash

# Cluster, namespace of the peers, image tag.
CLUSTER  ?= gossipsub-testbed
NS       ?= dst
VERSION  ?= 0.1.0
GO_IMAGE := gossipsub-testbed/go-peer:$(VERSION)
JS_IMAGE := gossipsub-testbed/js-peer:$(VERSION)

# Pinned chart versions (docs/phase2-closure.md, section 1).
KPS_VERSION ?= 93.1.2
VLS_VERSION ?= 0.13.11
VLC_VERSION ?= 0.3.8

# Workload of a run (scripts/run.sh): duration (s), isolation start and length (s),
# msg/s per publisher, bytes per message.
DURATION   ?=
ISOLATE_AT ?=
ISOLATION  ?=
RATE       ?= 10
SIZE       ?= 1024

# A run (a folder in runs/) and a message of it, for analyze and screenshot.
RUN ?=
SEQ ?= 1500

.DEFAULT_GOAL := help
.PHONY: help tools up cluster images load monitoring logging peers reload status \
        run-base run-iso isolate-on isolate-off isolate-check analyze screenshot \
        dashboard grafana prometheus logs-ui test test-alert lint down

help: ## List the targets
	@awk 'BEGIN {FS = ":.*## "} /^[a-z-]+:.*## / {printf "  %-15s %s\n", $$1, $$2}' $(MAKEFILE_LIST)

tools: ## Check that the needed tools are installed
	@for t in docker kind kubectl helm jq curl gzip python3; do \
	  command -v $$t >/dev/null && echo "ok      $$t" || echo "MISSING $$t"; done
	@for t in go npm node shellcheck; do \
	  command -v $$t >/dev/null && echo "ok      $$t (optional)" || echo "missing $$t (optional: tests, screenshots, lint)"; done

# --- cluster and deployment ------------------------------------------------------

up: cluster images load monitoring logging peers ## Create everything: cluster, images, monitoring, logging, peers

cluster: ## Create the kind cluster (kind/cluster.yaml), if it does not exist
	@kind get clusters 2>/dev/null | grep -qx $(CLUSTER) || kind create cluster --config kind/cluster.yaml

images: ## Build the Go and JS peer images
	docker build -t $(GO_IMAGE) peers/go-peer
	docker build -t $(JS_IMAGE) peers/js-peer

load: ## Load the peer images into the kind nodes
	kind load docker-image $(GO_IMAGE) $(JS_IMAGE) --name $(CLUSTER)

monitoring: ## Install or upgrade kube-prometheus-stack (Prometheus, Grafana) in monitoring
	@helm repo add prometheus-community https://prometheus-community.github.io/helm-charts >/dev/null 2>&1 || true
	helm repo update prometheus-community >/dev/null
	helm upgrade --install kps prometheus-community/kube-prometheus-stack --version $(KPS_VERSION) \
	  -n monitoring --create-namespace -f monitoring/kube-prometheus-stack.values.yaml --wait --timeout 10m

logging: ## Install or upgrade VictoriaLogs and its collector in logging
	@helm repo add vm https://victoriametrics.github.io/helm-charts >/dev/null 2>&1 || true
	helm repo update vm >/dev/null
	helm upgrade --install vls vm/victoria-logs-single --version $(VLS_VERSION) \
	  -n logging --create-namespace -f monitoring/victoria-logs-single.values.yaml --wait
	helm upgrade --install vlc vm/victoria-logs-collector --version $(VLC_VERSION) \
	  -n logging -f monitoring/victoria-logs-collector.values.yaml --wait

peers: ## Install or upgrade the peers' chart (peers, PodMonitor, alert rule, dashboard)
	helm upgrade --install testbed charts/gossipsub-testbed -n $(NS) --create-namespace --wait

reload: images load ## Rebuild the images, load them and restart the peers
	kubectl -n $(NS) rollout restart statefulset/go statefulset/js
	kubectl -n $(NS) rollout status statefulset/go --timeout 3m
	kubectl -n $(NS) rollout status statefulset/js --timeout 3m

status: ## Pods, connections and mesh size of every peer, isolation policy
	@scripts/status.sh

down: ## Delete the kind cluster
	kind delete cluster --name $(CLUSTER)

# --- experiments -------------------------------------------------------------------

run-base: ## Scenario A: baseline run (DURATION, default 300 s) → runs/base-<…>/
	RATE=$(RATE) SIZE=$(SIZE) scripts/run.sh base $(DURATION)

run-iso: ## Scenario B: isolation run (DURATION 420, ISOLATE_AT 120, ISOLATION 120) → runs/iso-<…>/
	RATE=$(RATE) SIZE=$(SIZE) scripts/run.sh iso $(or $(DURATION),420) $(or $(ISOLATE_AT),120) $(or $(ISOLATION),120)

isolate-on: ## Isolate go-2 and js-2 (policy + cut of the open connections) and check
	scripts/isolate.sh enable

isolate-off: ## End the isolation and check
	scripts/isolate.sh disable

isolate-check: ## Run the isolation checks only
	scripts/isolate.sh check

# analyze: ## Analyse a run again: make analyze RUN=<run_id>
# 	@test -n "$(RUN)" || { echo "usage: make analyze RUN=<run_id>"; exit 2; }
# 	python3 scripts/analyze.py runs/$(RUN)

screenshot: ## Dashboard screenshot of a run: make screenshot RUN=<run_id> [SEQ=1500]
	@test -n "$(RUN)" || { echo "usage: make screenshot RUN=<run_id> [SEQ=1500]"; exit 2; }
	scripts/screenshot.sh $(RUN) $(SEQ)

dashboard: ## Regenerate the dashboard JSON from its generator and load it
	python3 charts/gossipsub-testbed/dashboards/generate.py
	helm upgrade testbed charts/gossipsub-testbed -n $(NS) --wait

# --- user interfaces (port-forwards; stop with Ctrl-C) ----------------------------

grafana: ## Grafana on http://localhost:3000 (admin / admin)
	kubectl -n monitoring port-forward svc/kps-grafana 3000:80

prometheus: ## Prometheus on http://localhost:9090
	kubectl -n monitoring port-forward svc/kps-kube-prometheus-stack-prometheus 9090:9090

logs-ui: ## VictoriaLogs UI on http://localhost:9428/select/vmui/
	kubectl -n logging port-forward svc/vls-victoria-logs-single-server 9428:9428

# --- checks -------------------------------------------------------------------------

test: ## Unit tests of the Go and JS peers
	cd peers/go-peer && go test -race ./...
	cd peers/js-peer && npm test

test-alert: ## promtool test of the alert rule installed in the cluster
	scripts/test-alert.sh

lint: ## shellcheck of the scripts, helm lint of the chart
	shellcheck scripts/*.sh
	helm lint charts/gossipsub-testbed
