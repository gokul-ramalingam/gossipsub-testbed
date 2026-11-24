"""Analyses one run from its raw data (README.md, "Run the scenarios").

    python3 scripts/analyze.py runs/<run_id>

Reads the files that scripts/run.sh writes (settings.json, timeline.jsonl,
logs.jsonl.gz, metrics/*.json), prints a report in Markdown, and writes it to
runs/<run_id>/analysis.md. Standard library only.

The report:
  - completeness per subscriber and publisher, from the logs (exact), with the
    Prometheus counters as a cross-check;
  - latency percentiles (nearest rank) from the receivers' latency_us, overall
    and per receiver implementation;
  - duplicates and direct deliveries per peer;
  - the missing sequence numbers per subscriber and publisher, as ranges;
  - for an isolation run: the timeline measurements (detection lag,
    recovery lag, delivery recovery, seen outage, isolation length), the
    messages received during the isolation, the late arrivals, and the alert's
    firing and resolve times.

All times come from one clock: the peers' times (_time, ts_us) and the
script's times (the kind node) share the Docker VM's kernel clock.
"""
import gzip
import json
import sys
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path

# A message published during an isolation counts as a late arrival at an
# isolated peer if it arrives more than this after it was published.
LATE_S = 1.0

# A gap between two messages of one publisher longer than this many send
# intervals is a publisher stall (the publisher, or the machine, was paused).
STALL_INTERVALS = 3


def parse_time(value):
    """Returns the Unix time in seconds (float) of an RFC 3339 UTC time."""
    return datetime.fromisoformat(value.replace("Z", "+00:00")).timestamp()


def fmt_time(seconds):
    """Formats Unix seconds as HH:MM:SS.ffffff (UTC)."""
    return datetime.fromtimestamp(seconds, timezone.utc).strftime("%H:%M:%S.%f")


def percentile(sorted_values, p):
    """Returns the nearest-rank percentile p (0-100) of an ascending list."""
    if not sorted_values:
        return None
    rank = max(1, -(-len(sorted_values) * p // 100))  # ceil(n x p / 100)
    return sorted_values[int(rank) - 1]


def ranges(numbers):
    """Compresses ascending integers into 'a-b' ranges."""
    out, start, prev = [], None, None
    for n in numbers:
        if start is None:
            start = prev = n
        elif n == prev + 1:
            prev = n
        else:
            out.append(f"{start}-{prev}" if start != prev else f"{start}")
            start = prev = n
    if start is not None:
        out.append(f"{start}-{prev}" if start != prev else f"{start}")
    return out


def table(header, rows):
    """A Markdown table."""
    lines = ["| " + " | ".join(header) + " |", "| " + " | ".join("---" for _ in header) + " |"]
    lines += ["| " + " | ".join(str(c) for c in row) + " |" for row in rows]
    return "\n".join(lines)


def ms(seconds):
    """Formats seconds as milliseconds with 1 decimal, or - for None."""
    return "-" if seconds is None else f"{seconds * 1000:.1f} ms"


def secs(seconds):
    """Formats seconds with 3 decimals, or - for None."""
    return "-" if seconds is None else f"{seconds:.3f} s"


def load(run_dir):
    """Reads the run's settings, timeline and log lines."""
    settings = json.loads((run_dir / "settings.json").read_text())
    timeline = [json.loads(line) for line in (run_dir / "timeline.jsonl").read_text().splitlines() if line]
    with gzip.open(run_dir / "logs.jsonl.gz", "rt") as f:
        logs = [json.loads(line) for line in f if line.strip()]
    return settings, timeline, logs


def first_event(timeline, event):
    """Returns the time (Unix seconds) of the first timeline event of a kind, or None."""
    for e in timeline:
        if e["event"] == event:
            return parse_time(e["ts"])
    return None


def prometheus_last(run_dir, name, key):
    """Returns {key labels: last value} of a metrics/<name>.json range query."""
    path = run_dir / "metrics" / f"{name}.json"
    if not path.exists():
        return {}
    data = json.loads(path.read_text())
    return {tuple(r["metric"].get(k) for k in key): float(r["values"][-1][1]) for r in data["data"]["result"]}


def analyse(run_dir):
    settings, timeline, logs = load(run_dir)
    run_id = settings["run_id"]
    publishers = settings["publishers"]
    isolated = settings["isolated"]
    peers = sorted({line["peer"] for line in logs if line.get("peer")})
    out = [f"# Analysis of {run_id}", ""]
    out.append(f"Scenario `{settings['scenario']}`, {settings['rate_per_publisher']} msg/s per publisher "
               f"({', '.join(publishers)}), {settings['size_bytes']} B, {settings['duration_s']} s; "
               f"run {settings['start']} -> {settings['end']}.")
    if isolated:
        out.append(f"Isolated: {', '.join(isolated)} from {settings['isolate_at_s']} s for {settings['isolation_s']} s.")
    out.append("")

    # --- messages of the run ---------------------------------------------------
    published = {}  # (publisher, seq) -> publish time (s, the publisher's ts_us)
    received = {}  # (peer, publisher, seq) -> line
    duplicates = Counter()
    for line in logs:
        if line.get("run_id") != run_id:
            continue
        event = line["event"]
        if event == "published":
            published[(line["peer"], int(line["seq"]))] = int(line["ts_us"]) / 1e6
        elif event == "received":
            received[(line["peer"], line["publisher"], int(line["seq"]))] = line
        elif event == "duplicate":
            duplicates[line["peer"]] += 1

    subscribers = [p for p in peers if p in {k[0] for k in received} or p in publishers]

    # --- completeness ---------------------------------------------------------
    prom_received = prometheus_last(run_dir, "received", ("pod", "publisher"))
    prom_published = prometheus_last(run_dir, "publish_success", ("pod",))
    rows, missing_by_pair = [], {}
    for sub in subscribers:
        for pub in publishers:
            if sub == pub:
                continue
            sent = sorted(seq for (p, seq) in published if p == pub)
            got = {seq for (s, p, seq) in received if s == sub and p == pub}
            missing = [seq for seq in sent if seq not in got]
            missing_by_pair[(sub, pub)] = missing
            prom = prom_received.get((sub, pub))
            prom_pub = prom_published.get((pub,))
            rows.append([sub, pub, len(sent), len(got), len(missing), f"{100 * len(got) / len(sent):.2f} %" if sent else "-",
                         "-" if prom is None or not prom_pub else f"{int(prom)}/{int(prom_pub)}"])
    out += ["## Completeness", "",
            "From the logs: published = the publisher's `published` lines, received = distinct `seq` in the "
            "subscriber's `received` lines. Prometheus = the last value of the counters in the export (cross-check).", "",
            table(["subscriber", "publisher", "published", "received", "missed", "completeness", "Prometheus received/published"], rows), ""]

    # --- latency ----------------------------------------------------------------
    # Groups of receivers: all, per implementation, and for an isolation run the
    # isolated and the other receivers (the late arrivals are at the isolated ones).
    groups = defaultdict(list)
    for (sub, _pub, _seq), line in received.items():
        latency = int(line["latency_us"]) / 1e6
        groups["all"].append(latency)
        groups[line.get("impl", sub[:2])].append(latency)
        if isolated:
            groups["isolated" if sub in isolated else "not isolated"].append(latency)
    rows = []
    for group in ("all", "go", "js", "not isolated", "isolated"):
        values = sorted(groups.get(group, []))
        if values:
            rows.append([group, len(values)] + [ms(percentile(values, p)) for p in (50, 95, 99)] + [ms(values[-1])])
    out += ["## Latency", "",
            "Receive time - the publisher's timestamp, first copy only (nearest-rank percentiles). In an isolation run, "
            "the late arrivals are in the rows all, go/js and isolated.", "",
            table(["receivers", "deliveries", "p50", "p95", "p99", "max"], rows), ""]

    # --- duplicates and direct deliveries ------------------------------------
    rows = []
    for peer in subscribers:
        firsts = [line for (s, _p, _q), line in received.items() if s == peer]
        direct = sum(1 for line in firsts if line.get("source") == line["publisher"])
        rows.append([peer, len(firsts), duplicates[peer], f"{100 * direct / len(firsts):.1f} %" if firsts else "-"])
    out += ["## Duplicates and direct deliveries", "",
            "Duplicates: later copies of a message the peer already had. Direct: first copy from the publisher itself.", "",
            table(["peer", "first copies", "duplicates", "direct"], rows), ""]

    # --- publisher stalls -------------------------------------------------------
    interval = 1 / settings["rate_per_publisher"]
    rows = []
    for pub in publishers:
        times = sorted(t for (p, _s), t in published.items() if p == pub)
        for before, after in zip(times, times[1:]):
            if after - before > STALL_INTERVALS * interval:
                rows.append([pub, fmt_time(before), ms(after - before)])
    out += ["## Publisher stalls", "",
            f"Gaps between two messages of a publisher longer than {STALL_INTERVALS} send intervals "
            f"({STALL_INTERVALS * interval * 1000:.0f} ms). The publishers catch up after a stall (schedule by sequence "
            "number), so a stall shows as a gap and then a burst; a stall of the machine also delays the deliveries.", "",
            table(["publisher", "last message before the gap", "gap"], rows) if rows else "None.", ""]

    # --- sequence gaps --------------------------------------------------------
    rows = [[sub, pub, len(missing), ", ".join(ranges(missing)) or "none"]
            for (sub, pub), missing in missing_by_pair.items()]
    out += ["## Missing sequence numbers", "", table(["subscriber", "publisher", "missed", "seq ranges"], rows), ""]

    if not isolated:
        return "\n".join(out)

    # --- isolation run ----------------------------------------------------------
    t_apply = first_event(timeline, "isolation_enabled")
    t_cut = first_event(timeline, "connections_cut")
    t_remove = first_event(timeline, "isolation_disabled")
    # The cut runs node by node and takes about 1.5 s; its done_at is the end.
    # Messages can still arrive over not yet cut connections until then.
    cut_event = next((e for e in timeline if e["event"] == "connections_cut"), {})
    t_cut_done = parse_time(cut_event["done_at"]) if "done_at" in cut_event else t_cut
    others = [p for p in peers if p not in isolated]
    out += ["## Isolation timeline", "",
            table(["event", "time (UTC)"], [
                ["policy applied (T_apply)", fmt_time(t_apply)],
                ["open connections cut (conntrack), start", fmt_time(t_cut)],
                ["open connections cut, done", fmt_time(t_cut_done)],
                ["policy removed (T_remove)", fmt_time(t_remove)],
                ["isolation length (T_remove - T_apply)", secs(t_remove - t_apply)],
            ]), ""]

    checks = [e for e in timeline if e["event"] == "isolation_check"]
    out += ["### Isolation checks", "",
            table(["time", "from", "to", "result", "phase"],
                  [[fmt_time(parse_time(e["ts"])), e["peer"], e["to"], e["result"],
                    "during" if t_apply <= parse_time(e["ts"]) < t_remove else "after"] for e in checks]), ""]

    # Connection events between the isolated peers and the others, as seen by each
    # side: the first disconnect after T_apply, then the first connect after that
    # disconnect. The connect can come a few ms before the recorded T_remove: the
    # policy is gone before kubectl returns (runs before Nov 24 recorded T_remove
    # after the command, later runs before it).
    disconnects, connects = {}, {}
    events = sorted((parse_time(line["_time"]), line["event"], line["peer"], line.get("remote"))
                    for line in logs if line.get("event") in ("peer_disconnected", "peer_connected"))
    for t, event, peer, remote in events:
        if not remote or (peer in isolated) == (remote in isolated):
            continue
        key = (peer, remote)
        if event == "peer_disconnected" and t_apply <= t < t_remove:
            disconnects.setdefault(key, t)
        elif event == "peer_connected" and key in disconnects and key not in connects and t > disconnects[key]:
            connects[key] = t
    rows = []
    for peer in peers:
        for remote in peers:
            if (peer in isolated) == (remote in isolated):
                continue
            d, c = disconnects.get((peer, remote)), connects.get((peer, remote))
            rows.append([peer, remote,
                         fmt_time(d) if d else "none", secs(d - t_apply) if d else "-", secs(d - t_cut) if d else "-",
                         fmt_time(c) if c else "none", ms(c - t_remove) if c else "-",
                         secs(c - d) if c and d else "-"])
    lags_d = [disconnects[k] - t_cut for k in disconnects]
    lags_c = [connects[k] - t_remove for k in connects]
    out += ["### Connections between the groups", "",
            "One row per side of each connection (each side has its own keepalive). Detection lag = D - T_apply "
            "(and D - the cut: the policy alone blocks only new connections); recovery lag = C - T_remove; seen outage = C - D.", "",
            table(["peer", "remote", "disconnected (D)", "D - T_apply", "D - cut", "reconnected (C)", "C - T_remove", "C - D"], rows), "",
            f"Detection lag after the cut: min {secs(min(lags_d)) if lags_d else '-'}, max {secs(max(lags_d)) if lags_d else '-'} "
            f"({len(lags_d)} of {len(rows)} sides saw a disconnect). Recovery lag: min {ms(min(lags_c)) if lags_c else '-'}, "
            f"max {ms(max(lags_c)) if lags_c else '-'}.", ""]

    # Delivery at the isolated peers around the isolation.
    rows = []
    for peer in isolated:
        mine = sorted((parse_time(line["_time"]), pub, seq, line) for (s, pub, seq), line in received.items() if s == peer)
        last_before = max((m for m in mine if m[0] < t_cut), default=None)
        during = [m for m in mine if t_cut_done + 1 <= m[0] < t_remove]
        first_after = next((m for m in mine if m[0] >= t_remove), None)
        first_new = next((m for m in mine if m[0] >= t_remove and published.get((m[1], m[2]), 0) >= t_remove), None)
        late = [m for m in mine if m[0] >= t_remove and published.get((m[1], m[2]), t_remove) < t_remove
                and m[0] - published[(m[1], m[2])] > LATE_S]
        sent_during = sum(1 for (p, _s), t in published.items() if t_cut_done <= t < t_remove)
        missed_during = sum(1 for (p, s), t in published.items() if t_cut_done <= t < t_remove and (peer, p, s) not in received)
        rows.append([peer,
                     f"{fmt_time(last_before[0])} ({last_before[1]} {last_before[2]})" if last_before else "-",
                     len(during),
                     f"{fmt_time(first_after[0])} ({first_after[1]} {first_after[2]}), {ms(first_after[0] - t_remove)}" if first_after else "-",
                     f"{ms(first_new[0] - t_remove)}" if first_new else "-",
                     f"{missed_during} of {sent_during}",
                     f"{len(late)}" + (f" ({secs(min(m[0] - published[(m[1], m[2])] for m in late))}-"
                                      f"{secs(max(m[0] - published[(m[1], m[2])] for m in late))})" if late else "")])
    expected = settings["rate_per_publisher"] * len(publishers) * (t_remove - t_cut_done)
    out += ["### Delivery at the isolated peers", "",
            f"Messages published between the end of the cut and T_remove: missed by the isolated peer. Expected about publish rate x "
            f"isolation = {expected:.0f} (all publishers). Late arrival: a message published before T_remove that arrived "
            f"after it, more than {LATE_S:.0f} s after it was published.", "",
            table(["peer", "last receipt before the cut", "receipts during (cut done + 1 s -> T_remove)",
                   "first receipt after T_remove", "first new message - T_remove", "missed of published during", "late arrivals"], rows), ""]

    # Alert firing and resolve times.
    path = run_dir / "metrics" / "alerts.json"
    rows = []
    if path.exists():
        for r in json.loads(path.read_text())["data"]["result"]:
            m = r["metric"]
            if m.get("alertstate") != "firing" or m.get("run_id") != run_id:
                continue
            first, last = float(r["values"][0][0]), float(r["values"][-1][0])
            rows.append([m.get("pod"), m.get("publisher"), fmt_time(first)[:8], secs(first - t_apply),
                         fmt_time(last)[:8], secs(last - t_remove)])
    out += ["### Alert DeliveryCompletenessLow", "",
            "First and last firing sample (the export's 5 s grid).", "",
            table(["subscriber", "publisher", "first firing", "- T_apply", "last firing", "- T_remove"], sorted(rows)) if rows else "No firing samples.", ""]
    return "\n".join(out)


def main():
    if len(sys.argv) != 2:
        sys.exit("usage: python3 scripts/analyze.py runs/<run_id>")
    run_dir = Path(sys.argv[1])
    report = analyse(run_dir)
    (run_dir / "analysis.md").write_text(report + "\n")
    print(report)


if __name__ == "__main__":
    main()
