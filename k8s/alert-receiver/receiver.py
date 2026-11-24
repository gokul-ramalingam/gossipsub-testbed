"""Webhook receiver of Alertmanager.

Writes one JSON log line per alert of each notification, so that VictoriaLogs
keeps the firing and resolved times. Standard library only.
"""
import json
import signal
import sys
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, HTTPServer

PORT = 8080

# Alert labels copied to the log line, with the field name in the line. pod is the subscriber.
LABELS = {"alertname": "alertname", "run_id": "run_id", "pod": "subscriber", "publisher": "publisher"}


def log_line(alert, ts):
    """Returns the log line of one alert."""
    line = {"ts": ts, "level": "INFO", "event": "alert_notification", "status": alert["status"]}
    line.update({field: alert["labels"].get(label, "") for label, field in LABELS.items()})
    line.update({"starts_at": alert["startsAt"], "ends_at": alert["endsAt"]})
    return line


class Handler(BaseHTTPRequestHandler):
    """Answers the probes and logs the notifications."""

    def do_GET(self):
        """Answers the probes."""
        self.send_response(200)
        self.end_headers()

    def do_POST(self):
        """Logs each alert of one Alertmanager notification."""
        body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        ts = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%fZ")
        for alert in body.get("alerts", []):
            print(json.dumps(log_line(alert, ts)), flush=True)
        self.send_response(200)
        self.end_headers()

    def log_message(self, *args):
        """Turns off the access log."""


if __name__ == "__main__":
    # As PID 1 in the container, Python ignores SIGTERM unless it handles it.
    signal.signal(signal.SIGTERM, lambda *_: sys.exit(0))
    HTTPServer(("", PORT), Handler).serve_forever()
