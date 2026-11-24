# Setup

Get your machine ready to run the testbed. This takes about 10 minutes and only needs to be done once. At the end, `make tools` confirms that everything is in place.

## What you need

| Tool | Tested version | Used for |
| --- | --- | --- |
| [Docker](https://docs.docker.com/get-started/get-docker/) | 29.9 | Running the kind nodes and building the peer images |
| [kind](https://kind.sigs.k8s.io/docs/user/quick-start/#installation) | v0.33.0 | Creating the local Kubernetes cluster |
| [kubectl](https://kubernetes.io/docs/tasks/tools/) | v1.36 | Talking to the cluster. Any version within one minor release of Kubernetes v1.36 works |
| [Helm](https://helm.sh/docs/intro/install/) | v4.3.2 | Installing the charts |
| [jq](https://jqlang.org/download/), curl, gzip, GNU make | jq 1.7.1, make 3.81 | The scripts and the Makefile |
| [Python 3](https://www.python.org/downloads/) | 3.14 (3.9 or later) | Analyzing each run |
| [Go](https://go.dev/dl/) and [Node.js](https://nodejs.org/en/download) | Go 1.26, Node.js 26 | Optional, for `make test` |
| [shellcheck](https://github.com/koalaman/shellcheck#installing) | Any recent version | Optional, for `make lint` |

Give Docker at least **4 CPUs (8 recommended) and 8 GB of memory**. The cluster has four nodes and runs Prometheus, Grafana, Alertmanager, VictoriaLogs and six peers. Memory is the real limit, as the nodes use about 4.6 GB. The published runs used 8 CPUs. A full test also passes with 4 CPUs, with the same delivery and isolation results, but the latency tail is higher. The baseline, run right after `make up`, had a p99 of 76 ms instead of 9.2 ms.

You also need internet access: `make up` pulls the node, monitoring and logging images, and Grafana downloads one plugin.

## Install on macOS

1. Install [Docker Desktop](https://docs.docker.com/desktop/setup/install/mac-install/). Under **Settings > Resources**, set at least 4 CPUs (8 recommended) and 8 GB of memory.
2. Install the tools with [Homebrew](https://brew.sh):

   ```
   brew install kind kubectl helm jq
   brew install go node shellcheck   # optional, for tests and lint
   ```

   curl, gzip, make and Python 3 already come with macOS.

## Install on Linux (Ubuntu)

The scripts support both Linux and macOS and have been successfully tested on Ubuntu 24.04 and macOS.

1. Install [Docker Engine](https://docs.docker.com/engine/install/ubuntu/) and add your user to the `docker` group:

   ```
   curl -fsSL https://get.docker.com | sh
   sudo usermod -aG docker "$USER"   # then log out and back in
   ```

2. Install the tools:

   ```
   sudo apt-get update && sudo apt-get install -y jq curl gzip make python3

   # kind
   curl -Lo kind https://kind.sigs.k8s.io/dl/v0.33.0/kind-linux-amd64
   sudo install kind /usr/local/bin/kind

   # kubectl
   curl -LO "https://dl.k8s.io/release/v1.36.4/bin/linux/amd64/kubectl"
   sudo install kubectl /usr/local/bin/kubectl

   # Helm
   curl -fsSL https://raw.githubusercontent.com/helm/helm/main/scripts/get-helm-4 | bash
   ```

   On an ARM machine, replace `amd64` with `arm64`.

3. Raise the inotify limits, as the kind [known issues](https://kind.sigs.k8s.io/docs/user/known-issues/#pod-errors-due-to-too-many-open-files) page recommends for multi-node clusters:

   ```
   sudo sysctl fs.inotify.max_user_watches=524288 fs.inotify.max_user_instances=512
   ```

## Check your setup

```
make tools
```

Every required tool should show `ok`. A `missing` line is fine only for the optional tools:

```
ok      docker
ok      kind
ok      kubectl
ok      helm
ok      jq
ok      curl
ok      gzip
ok      python3
ok      go (optional)
ok      npm (optional)
ok      node (optional)
ok      shellcheck (optional)
```

---

[README](../README.md) | Next: [Deployment](deployment.md)
