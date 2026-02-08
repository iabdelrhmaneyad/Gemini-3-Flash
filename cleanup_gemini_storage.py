#!/usr/bin/env python3
"""Cleanup Gemini Files API storage.

Why:
- Files uploaded with `client.files.upload(...)` persist in your Gemini project until deleted.
- Over time this can hit per-project storage limits.

Safety:
- Default is DRY-RUN (no deletions).
- To actually delete, pass --yes.

Usage examples:
  # Dry run: list what would be deleted (files older than 7 days)
  GEMINI_API_KEY="..." python3 cleanup_gemini_storage.py --older-than-days 7

  # Delete (files older than 7 days)
  GEMINI_API_KEY="..." python3 cleanup_gemini_storage.py --older-than-days 7 --yes

  # Delete everything (dangerous)
  GEMINI_API_KEY="..." python3 cleanup_gemini_storage.py --delete-all --yes

Notes:
- Works with the google-genai Python SDK (import google.genai).
- If list() is not available in your installed SDK version, the script will error and tell you.
"""

from __future__ import annotations

import argparse
import datetime as dt
import os
import random
import sys
import time
from typing import Iterable, Optional

from google import genai


def _parse_iso_datetime(value: str) -> Optional[dt.datetime]:
    if not value:
        return None
    s = value.strip()
    # SDK typically returns RFC3339 / ISO strings, often with 'Z'
    if s.endswith("Z"):
        s = s[:-1] + "+00:00"
    try:
        out = dt.datetime.fromisoformat(s)
        if out.tzinfo is None:
            out = out.replace(tzinfo=dt.timezone.utc)
        return out
    except Exception:
        return None


def _is_quota_exhausted_error(exc: Exception) -> bool:
    status = getattr(exc, "status_code", None)
    if status == 429:
        return True
    msg = str(exc)
    return ("RESOURCE_EXHAUSTED" in msg) or (" 429" in msg) or ("quota" in msg.lower())


def _call_with_backoff(fn, *, what: str, max_attempts: int = 5):
    base = 2.0
    cap = 30.0
    for attempt in range(1, max_attempts + 1):
        try:
            return fn()
        except Exception as e:
            if attempt >= max_attempts:
                raise
            sleep_s = min(cap, base * (2 ** (attempt - 1)))
            # extra backoff for 429
            if _is_quota_exhausted_error(e):
                sleep_s = max(sleep_s, 10.0)
            sleep_s = sleep_s * (0.7 + random.random() * 0.6)
            print(f"[RETRY] {what} attempt {attempt}/{max_attempts} failed: {e} (sleep {sleep_s:.1f}s)")
            time.sleep(sleep_s)


def _iter_files(client) -> Iterable[object]:
    """Iterate all files in Gemini storage.

    The google-genai SDK exposes `client.files.list()` in recent versions.
    """
    if not hasattr(client, "files") or not hasattr(client.files, "list"):
        raise RuntimeError(
            "Your installed google-genai SDK does not support client.files.list(). "
            "Upgrade the SDK or delete files via the console."
        )

    # Some SDKs return an iterator/pager; others return a list.
    res = _call_with_backoff(lambda: client.files.list(), what="files.list")
    if res is None:
        return []
    if isinstance(res, list):
        return res
    return res


def main() -> int:
    parser = argparse.ArgumentParser(description="Cleanup Gemini Files API storage")
    parser.add_argument(
        "--api-key",
        default=os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY"),
        help="Gemini API key (or set GEMINI_API_KEY env var)",
    )
    parser.add_argument("--older-than-days", type=float, default=7.0, help="Delete files older than N days")
    parser.add_argument("--delete-all", action="store_true", help="Delete all files (ignores age filter)")
    parser.add_argument("--limit", type=int, default=0, help="Max files to delete (0 = no limit)")
    parser.add_argument("--yes", action="store_true", help="Actually delete (otherwise dry-run)")
    parser.add_argument("--verbose", action="store_true")
    args = parser.parse_args()

    if not args.api_key:
        print("ERROR: Missing API key. Set GEMINI_API_KEY or pass --api-key.")
        return 2

    client = genai.Client(api_key=args.api_key)

    now = dt.datetime.now(dt.timezone.utc)
    cutoff = now - dt.timedelta(days=float(args.older_than_days))

    dry_run = not args.yes
    if dry_run:
        print("[DRY-RUN] No deletions will be performed (pass --yes to delete).")

    if args.delete_all:
        print("[MODE] delete-all enabled")
    else:
        print(f"[MODE] deleting files older than {args.older_than_days:g} days (cutoff={cutoff.isoformat()})")

    total = 0
    selected = 0
    deleted = 0
    failed = 0

    for f in _iter_files(client):
        total += 1

        # Try common fields exposed by SDK.
        name = getattr(f, "name", None)
        uri = getattr(f, "uri", None)
        mime_type = getattr(f, "mime_type", None)

        created_at_raw = (
            getattr(f, "create_time", None)
            or getattr(f, "created_at", None)
            or getattr(f, "createTime", None)
        )
        created_at = _parse_iso_datetime(str(created_at_raw)) if created_at_raw else None

        should_delete = args.delete_all
        if not should_delete:
            # If we cannot parse time, keep it (safer).
            if created_at is None:
                should_delete = False
            else:
                should_delete = created_at < cutoff

        if not should_delete:
            continue

        selected += 1
        if args.verbose:
            ts = created_at.isoformat() if created_at else "unknown"
            print(f"[SELECT] name={name} created={ts} mime={mime_type} uri={uri}")

        if args.limit and deleted + failed >= args.limit:
            break

        if dry_run:
            continue

        if not name:
            failed += 1
            print("[SKIP] Missing file name; cannot delete")
            continue

        try:
            _call_with_backoff(lambda: client.files.delete(name=name), what=f"files.delete({name})")
            deleted += 1
        except Exception as e:
            failed += 1
            print(f"[ERROR] Failed deleting {name}: {e}")

    print("\n=== SUMMARY ===")
    print(f"Total files seen: {total}")
    print(f"Selected for deletion: {selected}")
    print(f"Deleted: {deleted}")
    print(f"Failed: {failed}")
    if dry_run:
        print("Dry-run: YES")
    else:
        print("Dry-run: NO")

    return 0 if (not args.yes or failed == 0) else 1


if __name__ == "__main__":
    raise SystemExit(main())
