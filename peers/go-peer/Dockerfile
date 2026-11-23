# Go peer of the gossipsub testbed.
#
# Two stages: the build stage compiles a static binary; the runtime stage is
# Alpine, the same Alpine release as the JS image, so that both peers have a
# shell and the same tools for debugging (kubectl exec … sh). The peer runs as
# a non-root user. Each base image is pinned by tag and digest, so that a
# rebuild uses the same image.

# --- build ---
FROM golang:1.26.11-bookworm@sha256:dc40a13b61304647ed7e5d581d246b86413dfc29d63c6d018310feb93cd98fc0 AS build

WORKDIR /src

# The modules first, so that a change of the code does not download them again.
COPY go.mod go.sum ./
RUN go mod download

COPY . .

# CGO off: Go uses its own code instead of the C library, also for DNS. The
# build image has glibc (Debian); Alpine has musl. A binary built with cgo
# would need glibc and not start on Alpine. -trimpath and -s -w: no local paths
# and no debug symbols in the binary; the module versions stay in the build
# info (the started event logs them).
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/go-peer .

# --- runtime ---
FROM alpine:3.24.4@sha256:f59abe656b692d901e184be3445e084786602108599d2a51d229c0f5a48c71bf

COPY --from=build /out/go-peer /usr/local/bin/go-peer

# nobody: the unprivileged user that Alpine already has (uid 65534). The peer
# needs no rights: its ports are above 1024 and it writes no files. A shell
# with kubectl exec still works; tools that need root (tcpdump) go through
# kubectl debug with a tool image.
USER nobody

# libp2p (P2P_PORT) and the HTTP API (HTTP_PORT), the defaults of the peer.
EXPOSE 4001 8080

ENTRYPOINT ["/usr/local/bin/go-peer"]
