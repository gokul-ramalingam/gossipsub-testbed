# AI use

Claude Code was used as a coding assistant on this project. It helped to move faster, while the direction came from research and a written plan, and every change was reviewed before it was kept.

## How the work was done

1. Research came first. The brief, the libp2p implementations, discovery options, Kubernetes network policies and the monitoring tools were studied before any code was written.
2. The research led to a written plan: the phases, each decision with its alternatives, and the evidence each result would need ([plan](plan.md)).
3. Each step of the plan was then built with the assistant's help, reviewed and tested before the next step started. Drafts that did not fit the plan or did not pass review were reworked or dropped.
4. The plan changed only when a measurement proved it wrong, for example when a NetworkPolicy turned out not to cut open connections. Every change is recorded in the [plan](plan.md#what-changed-during-the-work).

## Where the assistant helped

- Drafting routine code: HTTP handlers, chart templates, scripts and the dashboard JSON.
- Looking up library behaviour, defaults and versions in go-libp2p-pubsub, js-libp2p, kindnet and the monitoring charts.
- Suggesting ways to investigate problems, such as the open connections after the policy and the false alerts.
- Drafting documentation from the project notes, which was then reviewed and edited.

## How its output was checked

- Unit tests for both peers (`make test`). Every bug fix comes with a test that fails on the old code and passes on the new.
- Every claim about behaviour was tested on the cluster: a TCP stream for the NetworkPolicy, promtool for the alert rule, and log counts against Prometheus counters in every run.
- Refactors were compared with the old version: the same rendered chart, and identical analysis reports on 20 saved runs.
- Some early explanations from the assistant were wrong, and measurements corrected them. One example was a claim that gossip recovery fails between Go and JS peers. Anything that was not measured is marked as a hypothesis.
- The final results come from a clean commit, built and run with the documented commands only.

---

[README](../README.md) | Previous: [Plan](plan.md)
