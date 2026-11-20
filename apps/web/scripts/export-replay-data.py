"""Run with the XAUUSD virtualenv's Python and pass its repository path."""

import argparse
import gzip
import json
import sys
from datetime import UTC, datetime
from pathlib import Path


OUTPUT = Path(__file__).resolve().parents[1] / "public" / "replay" / "data"


def store(path, content, verify, *, compressed=False):
    if verify:
        actual = path.read_bytes()
        if compressed:
            actual = gzip.decompress(actual)
        if actual != content:
            raise ValueError(f"{path} differs from the source replay payload")
        return

    path.parent.mkdir(parents=True, exist_ok=True)
    if compressed:
        content = gzip.compress(content, mtime=0)
    pending = path.with_name(f"{path.name}.tmp")
    pending.write_bytes(content)
    pending.replace(path)


def export(source, verify):
    sys.path.insert(0, str(source))
    from src.assistant import replay_api

    cache_path = replay_api.replay_engine.CACHE_DIR.resolve().relative_to(source)
    coverage = replay_api.replay_coverage()
    timeframes = coverage["timeframe_coverage"]
    if set(timeframes) != set(replay_api.replay_engine.SUPPORTED_TIMEFRAMES):
        raise ValueError(f"Missing timeframe data in {source / cache_path}")

    months = {}
    for timeframe, bounds in timeframes.items():
        entries = []
        for key in sorted(bounds["available_months"]):
            year, month = map(int, key.split("-"))
            payload = replay_api.replay_data(
                period_mode="month", timeframe=timeframe, year=year, month=month,
                start_date=None, end_date=None,
            )
            meta, candles = payload["meta"], payload["candles"]
            start_date = datetime.fromtimestamp(candles[0]["time"], UTC).date().isoformat()
            end_date = datetime.fromtimestamp(candles[-1]["time"], UTC).date().isoformat()
            if (len(candles), start_date, end_date) != (
                meta["total_bars"], meta["start_date"], meta["end_date"]
            ):
                raise ValueError(f"Replay metadata differs from candles for {timeframe} {key}")

            file = f"{timeframe}/{key}.json.gz"
            content = json.dumps(candles, separators=(",", ":"), allow_nan=False)
            store(OUTPUT / file, content.encode("utf-8"), verify, compressed=True)
            entries.append({
                "year": year,
                "month": month,
                "file": file,
                "bars": len(candles),
                "startDate": start_date,
                "endDate": end_date,
                "warning": "\n".join(meta["warnings"]) or None,
            })

        bars = sum(entry["bars"] for entry in entries)
        if (len(entries), bars, entries[-1]["endDate"]) != (
            bounds["months"], bounds["total_bars"], bounds["end_date"]
        ):
            raise ValueError(f"Replay coverage differs from candles for {timeframe}")
        months[timeframe] = entries
        print(f"{timeframe}: {len(entries)} months, {bars:,} bars, "
              f"{entries[0]['startDate']} to {entries[-1]['endDate']}")

    manifest = {
        "source": {
            "cachePath": cache_path.as_posix(),
            "startDate": min(bounds["start_date"] for bounds in timeframes.values()),
            "endDate": max(bounds["end_date"] for bounds in timeframes.values()),
        },
        "coverage": coverage,
        "months": months,
    }
    content = json.dumps(manifest, ensure_ascii=False, indent=2, allow_nan=False) + "\n"
    store(OUTPUT / "manifest.json", content.encode("utf-8"), verify)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path, help="XAUUSD repository path")
    parser.add_argument("--verify", action="store_true", help="Check generated assets against the source")
    args = parser.parse_args()
    export(args.source.resolve(), args.verify)
