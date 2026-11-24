# AI use

An AI coding assistant (Claude, in Claude Code) helped during the whole project.

## Where it helped

- First drafts of code: parts of the peers, the Helm chart and values, the scripts and the dashboard JSON.
- Library behaviour and versions: go-libp2p-pubsub, js-libp2p, kindnet, kube-prometheus-stack, VictoriaLogs.
- Investigation of problems in the runs: open connections after the NetworkPolicy, Docker VM stalls, false pending alerts.
- First drafts of the documentation.

## How the output was checked

- Each design decision was reviewed before any code was written, and each change step by step.
- Unit tests for both peers (`make test`). They include tests for bugs found during the work, for example the publish schedule after a stall.
- Each claim about behaviour was tested on the cluster. A TCP stream tested the NetworkPolicy, promtool tests the alert, and the delivery counts of the logs match the Prometheus counters in each run.
- Some first explanations from the assistant were wrong, and measurements corrected them. One example: an early claim that gossip recovery fails between Go and JS peers. The report marks statements that were not measured as "probably" or "not checked".
- The final results come from a fresh clone of the repository, built and run only with the commands in the README.
