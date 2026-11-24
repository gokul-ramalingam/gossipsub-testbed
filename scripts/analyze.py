"""Analyzes one run and writes runs/<run_id>/analysis.md.

    python3 scripts/analyze.py runs/<run_id>

The report gives completeness (from the logs, checked against Prometheus),
latency, duplicates, publisher stalls and missing sequence numbers. For an
isolation run, it also gives the detection and recovery lags, the late
arrivals and the alert times. All times come from one clock, the Docker VM.
Standard library only.
"""
import gzip
import json
import sys
from collections import Counter, defaultdict
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import NamedTuple

# A message to an isolated peer that arrives more than this after publication is late.
LATE_S = 1.0

# A gap of more than this many send intervals is a publisher stall.
STALL_INTERVALS = 3


# --- formatting ------------------------------------------------------------------


def parse_time(value):
    """Returns the Unix seconds of an RFC 3339 UTC time."""
    return datetime.fromisoformat(value.replace("Z", "+00:00")).timestamp()


def fmt_time(seconds):
    """Formats Unix seconds as HH:MM:SS.ffffff (UTC)."""
    return datetime.fromtimestamp(seconds, timezone.utc).strftime("%H:%M:%S.%f")


def ms(seconds):
    """Formats seconds as milliseconds with 1 decimal, or - for None."""
    return "-" if seconds is None else f"{seconds * 1000:.1f} ms"


def secs(seconds):
    """Formats seconds with 3 decimals, or - for None."""
    return "-" if seconds is None else f"{seconds:.3f} s"


def percent(part, whole, decimals):
    """Formats part / whole as a percentage, or - if whole is 0."""
    return f"{100 * part / whole:.{decimals}f} %" if whole else "-"


def table(header, rows):
    """Returns a Markdown table."""
    lines = ["| " + " | ".join(header) + " |", "| " + " | ".join("---" for _ in header) + " |"]
    lines += ["| " + " | ".join(str(cell) for cell in row) + " |" for row in rows]
    return "\n".join(lines)


def section(heading, intro, body):
    """Returns the lines of one report section. intro can be empty."""
    lines = [heading, ""]
    if intro:
        lines += [intro, ""]
    return lines + [body, ""]


# --- statistics ------------------------------------------------------------------


def percentile(sorted_values, p):
    """Returns the nearest-rank percentile p (0-100) of an ascending list."""
    if not sorted_values:
        return None
    rank = max(1, -(-len(sorted_values) * p // 100))  # ceil(n * p / 100)
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


# --- run data --------------------------------------------------------------------


class Receipt(NamedTuple):
    """One first copy of a message at a subscriber."""

    time: float
    publisher: str
    seq: int


@dataclass
class Run:
    """The parsed data of one run."""

    run_dir: Path
    settings: dict
    timeline: list
    logs: list
    published: dict  # (publisher, seq) -> publication time, s
    received: dict  # (subscriber, publisher, seq) -> received log line
    duplicates: Counter  # peer -> duplicate copies

    @property
    def run_id(self):
        return self.settings["run_id"]

    @property
    def publishers(self):
        return self.settings["publishers"]

    @property
    def isolated(self):
        return self.settings["isolated"]

    @property
    def peers(self):
        """All peers that wrote a log line, sorted."""
        return sorted({line["peer"] for line in self.logs if line.get("peer")})

    @property
    def subscribers(self):
        """The peers that received a message, and the publishers."""
        receivers = {sub for (sub, _pub, _seq) in self.received}
        return [p for p in self.peers if p in receivers or p in self.publishers]

    def pairs(self):
        """Yields each (subscriber, publisher) pair, without self-pairs."""
        for sub in self.subscribers:
            for pub in self.publishers:
                if sub != pub:
                    yield sub, pub

    def sent_seqs(self, publisher):
        """Returns the sorted sequence numbers that a publisher published."""
        return sorted(seq for (pub, seq) in self.published if pub == publisher)

    def got_seqs(self, subscriber, publisher):
        """Returns the sequence numbers of a publisher that a subscriber received."""
        return {seq for (sub, pub, seq) in self.received if sub == subscriber and pub == publisher}

    def missing_seqs(self, subscriber, publisher):
        """Returns the sequence numbers of a publisher that a subscriber missed."""
        got = self.got_seqs(subscriber, publisher)
        return [seq for seq in self.sent_seqs(publisher) if seq not in got]

    def receipts(self, subscriber):
        """Returns the receipts of a subscriber, sorted by time."""
        return sorted(Receipt(parse_time(line["_time"]), pub, seq)
                      for (sub, pub, seq), line in self.received.items() if sub == subscriber)

    def prometheus_last(self, name, key):
        """Returns {key labels: last value} of the metrics/<name>.json range query."""
        path = self.run_dir / "metrics" / f"{name}.json"
        if not path.exists():
            return {}
        data = json.loads(path.read_text())
        return {tuple(r["metric"].get(k) for k in key): float(r["values"][-1][1]) for r in data["data"]["result"]}


def load_run(run_dir):
    """Reads the files of a run and indexes the messages of the run."""
    settings = json.loads((run_dir / "settings.json").read_text())
    timeline = [json.loads(line) for line in (run_dir / "timeline.jsonl").read_text().splitlines() if line]
    with gzip.open(run_dir / "logs.jsonl.gz", "rt") as f:
        logs = [json.loads(line) for line in f if line.strip()]

    published, received, duplicates = {}, {}, Counter()
    for line in logs:
        if line.get("run_id") != settings["run_id"]:
            continue
        event = line["event"]
        if event == "published":
            published[(line["peer"], int(line["seq"]))] = int(line["ts_us"]) / 1e6
        elif event == "received":
            received[(line["peer"], line["publisher"], int(line["seq"]))] = line
        elif event == "duplicate":
            duplicates[line["peer"]] += 1

    return Run(run_dir, settings, timeline, logs, published, received, duplicates)


@dataclass
class IsolationTimes:
    """Times of the isolation steps, Unix seconds."""

    apply: float  # T_apply: policy applied
    cut: float  # open connections cut, start
    cut_done: float  # open connections cut, end
    remove: float  # T_remove: policy removed


def first_event(timeline, event):
    """Returns the first timeline event of a kind, or an empty dict."""
    return next((e for e in timeline if e["event"] == event), {})


def isolation_times(timeline):
    """Reads the isolation steps from the timeline."""
    cut = first_event(timeline, "connections_cut")
    t_cut = parse_time(cut["ts"]) if cut else None
    return IsolationTimes(
        apply=parse_time(first_event(timeline, "isolation_enabled")["ts"]),
        cut=t_cut,
        cut_done=parse_time(cut["done_at"]) if "done_at" in cut else t_cut,
        remove=parse_time(first_event(timeline, "isolation_disabled")["ts"]),
    )


# --- sections of every run -------------------------------------------------------


def summary(run):
    """Run settings."""
    s = run.settings
    lines = [f"# Analysis of {run.run_id}", "",
             f"Scenario `{s['scenario']}`, {s['rate_per_publisher']} msg/s per publisher "
             f"({', '.join(run.publishers)}), {s['size_bytes']} B, {s['duration_s']} s; "
             f"run {s['start']} -> {s['end']}."]
    if run.isolated:
        lines.append(f"Isolated: {', '.join(run.isolated)} from {s['isolate_at_s']} s for {s['isolation_s']} s.")
    return lines + [""]


def completeness(run):
    """Received of published, per subscriber and publisher, with the Prometheus cross-check."""
    prom_received = run.prometheus_last("received", ("pod", "publisher"))
    prom_published = run.prometheus_last("publish_success", ("pod",))
    rows = []
    for sub, pub in run.pairs():
        sent = run.sent_seqs(pub)
        got = run.got_seqs(sub, pub)
        prom = prom_received.get((sub, pub))
        prom_pub = prom_published.get((pub,))
        rows.append([sub, pub, len(sent), len(got), len(run.missing_seqs(sub, pub)), percent(len(got), len(sent), 2),
                     "-" if prom is None or not prom_pub else f"{int(prom)}/{int(prom_pub)}"])
    return section("## Completeness",
                   "From the logs: published = the publisher's `published` lines, received = distinct `seq` in the "
                   "subscriber's `received` lines. Prometheus = the last value of the counters in the export (cross-check).",
                   table(["subscriber", "publisher", "published", "received", "missed", "completeness",
                          "Prometheus received/published"], rows))


def latency(run):
    """Latency percentiles per receiver group: all, per implementation, and isolated or not."""
    groups = defaultdict(list)
    for (sub, _pub, _seq), line in run.received.items():
        value = int(line["latency_us"]) / 1e6
        groups["all"].append(value)
        groups[line.get("impl", sub[:2])].append(value)
        if run.isolated:
            groups["isolated" if sub in run.isolated else "not isolated"].append(value)

    rows = []
    for group in ("all", "go", "js", "not isolated", "isolated"):
        values = sorted(groups.get(group, []))
        if values:
            rows.append([group, len(values)] + [ms(percentile(values, p)) for p in (50, 95, 99)] + [ms(values[-1])])
    return section("## Latency",
                   "Receive time - the publisher's timestamp, first copy only (nearest-rank percentiles). In an isolation "
                   "run, the late arrivals are in the rows all, go/js and isolated.",
                   table(["receivers", "deliveries", "p50", "p95", "p99", "max"], rows))


def duplicates(run):
    """First copies, duplicates and the share of first copies from the publisher itself."""
    rows = []
    for peer in run.subscribers:
        firsts = [line for (sub, _pub, _seq), line in run.received.items() if sub == peer]
        direct = sum(1 for line in firsts if line.get("source") == line["publisher"])
        rows.append([peer, len(firsts), run.duplicates[peer], percent(direct, len(firsts), 1)])
    return section("## Duplicates and direct deliveries",
                   "Duplicates: later copies of a message the peer already had. Direct: first copy from the publisher itself.",
                   table(["peer", "first copies", "duplicates", "direct"], rows))


def publisher_stalls(run):
    """Gaps between two messages of a publisher longer than STALL_INTERVALS send intervals."""
    interval = 1 / run.settings["rate_per_publisher"]
    rows = []
    for pub in run.publishers:
        times = sorted(t for (p, _seq), t in run.published.items() if p == pub)
        for before, after in zip(times, times[1:]):
            if after - before > STALL_INTERVALS * interval:
                rows.append([pub, fmt_time(before), ms(after - before)])
    return section("## Publisher stalls",
                   f"Gaps between two messages of a publisher longer than {STALL_INTERVALS} send intervals "
                   f"({STALL_INTERVALS * interval * 1000:.0f} ms). The publishers catch up after a stall (schedule by sequence "
                   "number), so a stall shows as a gap and then a burst; a stall of the machine also delays the deliveries.",
                   table(["publisher", "last message before the gap", "gap"], rows) if rows else "None.")


def missing_numbers(run):
    """The missed sequence numbers per subscriber and publisher, as ranges."""
    rows = []
    for sub, pub in run.pairs():
        missing = run.missing_seqs(sub, pub)
        rows.append([sub, pub, len(missing), ", ".join(ranges(missing)) or "none"])
    return section("## Missing sequence numbers", "", table(["subscriber", "publisher", "missed", "seq ranges"], rows))


# --- sections of an isolation run ------------------------------------------------


def isolation_timeline(times):
    """The isolation steps."""
    return section("## Isolation timeline", "", table(["event", "time (UTC)"], [
        ["policy applied (T_apply)", fmt_time(times.apply)],
        ["open connections cut (conntrack), start", fmt_time(times.cut)],
        ["open connections cut, done", fmt_time(times.cut_done)],
        ["policy removed (T_remove)", fmt_time(times.remove)],
        ["isolation length (T_remove - T_apply)", secs(times.remove - times.apply)],
    ]))


def isolation_checks(run, times):
    """The TCP checks of isolate.sh, during or after the isolation."""
    rows = []
    for e in run.timeline:
        if e["event"] != "isolation_check":
            continue
        t = parse_time(e["ts"])
        rows.append([fmt_time(t), e["peer"], e["to"], e["result"], "during" if times.apply <= t < times.remove else "after"])
    return section("### Isolation checks", "", table(["time", "from", "to", "result", "phase"], rows))


def connection_changes(run, times):
    """For each pair of an isolated and another peer, as seen by each side: the
    first disconnect after T_apply, then the first connect after it. The
    connect can come a few ms before T_remove, because the policy is gone
    before kubectl returns."""
    def across(peer, remote):
        return (peer in run.isolated) != (remote in run.isolated)

    disconnects, connects = {}, {}
    events = sorted((parse_time(line["_time"]), line["event"], line["peer"], line.get("remote"))
                    for line in run.logs if line.get("event") in ("peer_disconnected", "peer_connected"))
    for t, event, peer, remote in events:
        if not remote or not across(peer, remote):
            continue
        key = (peer, remote)
        if event == "peer_disconnected" and times.apply <= t < times.remove:
            disconnects.setdefault(key, t)
        elif event == "peer_connected" and key in disconnects and key not in connects and t > disconnects[key]:
            connects[key] = t

    rows = []
    for peer in run.peers:
        for remote in run.peers:
            if not across(peer, remote):
                continue
            d, c = disconnects.get((peer, remote)), connects.get((peer, remote))
            rows.append([peer, remote,
                         fmt_time(d) if d else "none", secs(d - times.apply) if d else "-", secs(d - times.cut) if d else "-",
                         fmt_time(c) if c else "none", ms(c - times.remove) if c else "-",
                         secs(c - d) if c and d else "-"])

    detection = [t - times.cut for t in disconnects.values()]
    recovery = [t - times.remove for t in connects.values()]
    return section("### Connections between the groups",
                   "One row per side of each connection (each side has its own keepalive). Detection lag = D - T_apply "
                   "(and D - the cut: the policy alone blocks only new connections); recovery lag = C - T_remove; "
                   "seen outage = C - D.",
                   table(["peer", "remote", "disconnected (D)", "D - T_apply", "D - cut", "reconnected (C)",
                          "C - T_remove", "C - D"], rows)) + [
        f"Detection lag after the cut: min {secs(min(detection)) if detection else '-'}, "
        f"max {secs(max(detection)) if detection else '-'} ({len(detection)} of {len(rows)} sides saw a disconnect). "
        f"Recovery lag: min {ms(min(recovery)) if recovery else '-'}, max {ms(max(recovery)) if recovery else '-'}.", ""]


def isolated_delivery(run, times):
    """Receipts of the isolated peers before, during and after the isolation, and the late arrivals."""
    def published_at(r):
        return run.published.get((r.publisher, r.seq))

    def label(r):
        return f"{fmt_time(r.time)} ({r.publisher} {r.seq})"

    sent_during = [(pub, seq) for (pub, seq), t in run.published.items() if times.cut_done <= t < times.remove]
    rows = []
    for peer in run.isolated:
        receipts = run.receipts(peer)
        after = [r for r in receipts if r.time >= times.remove]
        last_before = max((r for r in receipts if r.time < times.cut), default=None)
        during = [r for r in receipts if times.cut_done + 1 <= r.time < times.remove]
        first_after = after[0] if after else None
        first_new = next((r for r in after if (published_at(r) or 0) >= times.remove), None)
        late = [r for r in after if (published_at(r) or times.remove) < times.remove and r.time - published_at(r) > LATE_S]
        delays = [r.time - published_at(r) for r in late]
        missed = sum(1 for (pub, seq) in sent_during if (peer, pub, seq) not in run.received)
        rows.append([peer,
                     label(last_before) if last_before else "-",
                     len(during),
                     f"{label(first_after)}, {ms(first_after.time - times.remove)}" if first_after else "-",
                     ms(first_new.time - times.remove) if first_new else "-",
                     f"{missed} of {len(sent_during)}",
                     f"{len(late)}" + (f" ({secs(min(delays))}-{secs(max(delays))})" if late else "")])

    expected = run.settings["rate_per_publisher"] * len(run.publishers) * (times.remove - times.cut_done)
    return section("### Delivery at the isolated peers",
                   f"Messages published between the end of the cut and T_remove: missed by the isolated peer. Expected "
                   f"about publish rate x isolation = {expected:.0f} (all publishers). Late arrival: a message published "
                   f"before T_remove that arrived after it, more than {LATE_S:.0f} s after it was published.",
                   table(["peer", "last receipt before the cut", "receipts during (cut done + 1 s -> T_remove)",
                          "first receipt after T_remove", "first new message - T_remove", "missed of published during",
                          "late arrivals"], rows))


def alert_samples(run, times):
    """First and last firing sample of the alert per subscriber and publisher."""
    path = run.run_dir / "metrics" / "alerts.json"
    rows = []
    if path.exists():
        for series in json.loads(path.read_text())["data"]["result"]:
            labels = series["metric"]
            if labels.get("alertstate") != "firing" or labels.get("run_id") != run.run_id:
                continue
            first, last = float(series["values"][0][0]), float(series["values"][-1][0])
            rows.append([labels.get("pod"), labels.get("publisher"), fmt_time(first)[:8], secs(first - times.apply),
                         fmt_time(last)[:8], secs(last - times.remove)])
    return section("### Alert DeliveryCompletenessLow", "First and last firing sample (the export's 5 s grid).",
                   table(["subscriber", "publisher", "first firing", "- T_apply", "last firing", "- T_remove"], sorted(rows))
                   if rows else "No firing samples.")


def alert_notifications(run, times):
    """Notifications that the in-cluster receiver got from Alertmanager."""
    rows = []
    for line in run.logs:
        if line.get("event") != "alert_notification":
            continue
        t = parse_time(line["_time"])
        ref, ref_name = (times.apply, "T_apply") if line["status"] == "firing" else (times.remove, "T_remove")
        rows.append([line.get("subscriber"), line.get("publisher"), line["status"], fmt_time(t)[:8],
                     f"{secs(t - ref)} after {ref_name}"])
    return section("### Alert notifications", "Notifications that the alert receiver logged (Alertmanager webhook).",
                   table(["subscriber", "publisher", "status", "time", "delay"], rows) if rows else "No notifications.")


# --- report ----------------------------------------------------------------------


def analyze(run_dir):
    """Returns the Markdown report of a run."""
    run = load_run(run_dir)
    lines = summary(run) + completeness(run) + latency(run) + duplicates(run) + publisher_stalls(run) + missing_numbers(run)
    if run.isolated:
        times = isolation_times(run.timeline)
        lines += (isolation_timeline(times) + isolation_checks(run, times) + connection_changes(run, times)
                  + isolated_delivery(run, times) + alert_samples(run, times) + alert_notifications(run, times))
    return "\n".join(lines)


def main():
    if len(sys.argv) != 2:
        sys.exit("usage: python3 scripts/analyze.py runs/<run_id>")
    run_dir = Path(sys.argv[1])
    report = analyze(run_dir)
    (run_dir / "analysis.md").write_text(report + "\n")
    print(report)


if __name__ == "__main__":
    main()
