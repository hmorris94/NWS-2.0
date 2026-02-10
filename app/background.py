"""Background data-fetching tasks for the NWS weather dashboard."""

from __future__ import annotations

import json
import os
import tempfile
import threading
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent  # app/background.py → app/ → project/

from .config import (
    ENABLE_HRRR,
    HRRR_CACHE_DIR,
    HRRR_INTERVAL_SECONDS,
    LOCATIONS,
    NWS_INTERVAL_SECONDS,
)
from .nws_fetcher import fetch_all_locations

# Data directory and file paths
DATA_DIR = PROJECT_ROOT / "server_side" / "data"
LOCATIONS_FILE = DATA_DIR / "locations.json"


def write_json_atomic(data: dict, path: Path) -> None:
    """Write JSON atomically using temp file + rename."""
    path.parent.mkdir(parents=True, exist_ok=True)

    # Write to temp file first
    fd, tmp_path = tempfile.mkstemp(
        suffix=".json.tmp", prefix="locations_", dir=path.parent
    )
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2)
        # Atomic rename
        os.replace(tmp_path, path)
    except Exception:
        # Clean up temp file on error
        try:
            os.unlink(tmp_path)
        except OSError:
            pass
        raise


def nws_fetch_loop(stop_event: threading.Event) -> None:
    """Background thread to fetch NWS data periodically."""
    while not stop_event.is_set():
        try:
            print(f"[NWS] Fetching data for {len(LOCATIONS)} locations...")
            data = fetch_all_locations(LOCATIONS)
            write_json_atomic(data, LOCATIONS_FILE)
            print(f"[NWS] Updated locations.json at {data['fetchedAt']}")
        except Exception as e:
            print(f"[NWS] Error: {e}")

        # Wait for next interval or until stopped
        stop_event.wait(NWS_INTERVAL_SECONDS)


def hrrr_fetch_loop(stop_event: threading.Event) -> None:
    """Background thread to fetch HRRR/NBM data periodically."""
    if not ENABLE_HRRR:
        print("[HRRR] Disabled via ENABLE_HRRR=False")
        return

    try:
        from .hrrr_nbm_dl import sync_hrrr_nbm_subsets
    except ImportError as e:
        print(f"[HRRR] Could not import hrrr_nbm_dl: {e}")
        return

    while not stop_event.is_set():
        try:
            print(f"[HRRR] Syncing HRRR/NBM subsets...")
            result = sync_hrrr_nbm_subsets(
                locations=LOCATIONS,
                cache_dir=HRRR_CACHE_DIR,
            )
            print(
                f"[HRRR] Synced: HRRR cycle {result['hrrr_cycle']}, "
                f"NBM cycle {result['nbm_cycle']}"
            )
        except Exception as e:
            print(f"[HRRR] Error: {e}")

        # Wait for next interval or until stopped
        stop_event.wait(HRRR_INTERVAL_SECONDS)


def start_background_tasks():
    """Start NWS (and optionally HRRR) fetch threads. Returns (stop_event, threads)."""
    stop_event = threading.Event()

    nws_thread = threading.Thread(target=nws_fetch_loop, args=(stop_event,), daemon=True)
    hrrr_thread = threading.Thread(target=hrrr_fetch_loop, args=(stop_event,), daemon=True)

    nws_thread.start()
    hrrr_thread.start()

    return stop_event, [nws_thread, hrrr_thread]
