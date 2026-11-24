#!/usr/bin/env python3
"""Wait briefly for disposable Supabase TCP ports; never stop other processes."""
import argparse
import errno
import socket
import sys
import time

def busy_ports(ports):
    occupied = []
    for port in ports:
        # Docker binds host ports on wildcard IPv4. Check without listening.
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
            try:
                probe.bind(("0.0.0.0", port))
            except OSError as exc:
                if exc.errno != errno.EADDRINUSE:
                    raise
                occupied.append(port)
    return occupied

def wait_for_ports(ports, timeout, interval):
    deadline = time.monotonic() + timeout
    while True:
        busy = busy_ports(ports)
        if not busy:
            return True
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            print("DISPOSABLE_PORTS_BUSY:", ",".join(map(str, busy)), file=sys.stderr)
            return False
        print("Waiting for occupied disposable ports:", ",".join(map(str, busy)), flush=True)
        time.sleep(min(interval, remaining))

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--timeout", type=float, default=60)
    parser.add_argument("--interval", type=float, default=3)
    parser.add_argument("ports", type=int, nargs="+")
    args = parser.parse_args()
    if not (0 <= args.timeout <= 120 and 0 < args.interval <= 10 and all(1024 <= p <= 65535 for p in args.ports)):
        parser.error("invalid bounded wait or unprivileged port")
    if not wait_for_ports(args.ports, args.timeout, args.interval):
        sys.exit(1)
    print("DISPOSABLE_PORTS_READY: preflight only; no process stopped")
