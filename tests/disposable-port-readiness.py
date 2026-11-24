#!/usr/bin/env python3
"""Deterministic offline check of occupied-port timeout and release."""
import importlib.util
from pathlib import Path
import socket
import threading
import time

path = Path(__file__).resolve().parent.parent / "scripts/wait-disposable-ports.py"
spec = importlib.util.spec_from_file_location("port_wait", path)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as held:
    held.bind(("127.0.0.1", 0))
    held.listen(1)
    port = held.getsockname()[1]
    assert module.busy_ports([port]) == [port]
    assert not module.wait_for_ports([port], 0.05, 0.01)
    assert held.getsockname()[1] == port
    release = threading.Timer(0.15, held.close)
    release.start()
    try:
        assert module.wait_for_ports([port], 2, 0.03)
    finally:
        release.join()
assert module.wait_for_ports([port], 0, 0.01)
print("PASS: occupied port fails closed; released port permits startup; no foreign process stopped.")
