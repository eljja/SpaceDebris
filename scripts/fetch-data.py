"""
SpaceDebris Data Fetcher
========================
CelesTrak에서 GP 궤도 데이터 + SATCAT 메타데이터를 수집합니다.
분기별 1회 수동 실행하여 data/ 폴더에 JSON으로 저장합니다.

사용법:
  python scripts/fetch-data.py

필요 패키지:
  pip install requests
"""

import json
import csv
import io
import os
import time
from datetime import datetime, timezone

import requests

# CelesTrak API endpoints
BASE_GP = "https://celestrak.org/NORAD/elements/gp.php"
BASE_SATCAT = "https://celestrak.org/pub/satcat.csv"

# Output directory
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(os.path.dirname(SCRIPT_DIR), "data")

# GP data groups to fetch
GP_GROUPS = [
    ("active", "gp-active.json"),
    ("cosmos-1408-debris", "gp-debris-cosmos1408.json"),
    ("fengyun-1c-debris", "gp-debris-fengyun1c.json"),
    ("cosmos-2251-debris", "gp-debris-cosmos2251.json"),
    ("iridium-33-debris", "gp-debris-iridium33.json"),
    ("1982-092", "gp-debris-cosmos1275.json"),
]

DELAY_BETWEEN_REQUESTS = 5  # seconds - respect CelesTrak fair-use policy


def ensure_data_dir():
    """Create data directory if it doesn't exist."""
    os.makedirs(DATA_DIR, exist_ok=True)
    print(f"[OK] Data directory: {DATA_DIR}")


def fetch_gp_group(group_name, output_file):
    """Fetch GP data for a specific group from CelesTrak."""
    url = f"{BASE_GP}?GROUP={group_name}&FORMAT=json"
    print(f"[FETCH] {group_name} from {url}")

    try:
        resp = requests.get(url, timeout=120)
        resp.raise_for_status()
        data = resp.json()
        
        output_path = os.path.join(DATA_DIR, output_file)
        with open(output_path, "w", encoding="utf-8") as f:
            json.dump(data, f, separators=(",", ":"))

        print(f"  -> {len(data)} objects -> {output_file} ({os.path.getsize(output_path) / 1024:.1f} KB)")
        return len(data)

    except Exception as e:
        print(f"  [ERROR] Failed to fetch {group_name}: {e}")
        return 0


def fetch_satcat():
    """Fetch SATCAT catalog from CelesTrak and convert to JSON."""
    print(f"[FETCH] SATCAT from {BASE_SATCAT}")

    try:
        resp = requests.get(BASE_SATCAT, timeout=180)
        resp.raise_for_status()

        reader = csv.DictReader(io.StringIO(resp.text))
        satcat = {}

        for row in reader:
            norad_id = row.get("NORAD_CAT_ID", "").strip()
            if not norad_id:
                continue
            
            satcat[norad_id] = {
                "name": row.get("OBJECT_NAME", "").strip(),
                "id": row.get("OBJECT_ID", "").strip(),
                "type": row.get("OBJECT_TYPE", "").strip(),
                "ops": row.get("OPS_STATUS_CODE", "").strip(),
                "owner": row.get("OWNER", "").strip(),
                "launchDate": row.get("LAUNCH_DATE", "").strip(),
                "launchSite": row.get("LAUNCH_SITE", "").strip(),
                "decayDate": row.get("DECAY_DATE", "").strip(),
                "period": row.get("PERIOD", "").strip(),
                "incl": row.get("INCLINATION", "").strip(),
                "apo": row.get("APOGEE", "").strip(),
                "peri": row.get("PERIGEE", "").strip(),
                "rcs": row.get("RCS_SIZE", "").strip(),
            }

        output_path = os.path.join(DATA_DIR, "satcat.json")
        with open(output_path, "w", encoding="utf-8") as f:
            json.dump(satcat, f, separators=(",", ":"))

        print(f"  -> {len(satcat)} objects -> satcat.json ({os.path.getsize(output_path) / 1024:.1f} KB)")
        return satcat

    except Exception as e:
        print(f"  [ERROR] Failed to fetch SATCAT: {e}")
        return {}


def merge_debris_files():
    """Merge individual debris group files into one gp-debris.json."""
    debris_files = [f for f in os.listdir(DATA_DIR) if f.startswith("gp-debris-")]
    all_debris = []
    seen_ids = set()

    for fname in debris_files:
        filepath = os.path.join(DATA_DIR, fname)
        with open(filepath, "r", encoding="utf-8") as f:
            data = json.load(f)
            for obj in data:
                nid = obj.get("NORAD_CAT_ID")
                if nid not in seen_ids:
                    seen_ids.add(nid)
                    all_debris.append(obj)

    output_path = os.path.join(DATA_DIR, "gp-debris.json")
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(all_debris, f, separators=(",", ":"))

    print(f"[MERGE] {len(all_debris)} unique debris -> gp-debris.json ({os.path.getsize(output_path) / 1024:.1f} KB)")
    return len(all_debris)


def generate_metadata(counts, satcat):
    """Generate metadata.json with update timestamps and statistics."""
    # Count by type from satcat
    type_counts = {"PAY": 0, "R/B": 0, "DEB": 0, "UNK": 0}
    for obj in satcat.values():
        t = obj.get("type", "UNK")
        if t in type_counts:
            type_counts[t] += 1

    now = datetime.now(timezone.utc).isoformat()

    metadata = {
        "lastUpdated": now,
        "nextScheduledUpdate": "2026-11-01",
        "updateFrequency": "quarterly",
        "sources": {
            "celestrak_gp": "https://celestrak.org/NORAD/elements/gp.php",
            "celestrak_satcat": "https://celestrak.org/pub/satcat.csv",
        },
        "objectCounts": {
            "activeSatellites": counts.get("active", 0),
            "debris": counts.get("debris_merged", 0),
            "satcatTotal": len(satcat),
            "satcatPayloads": type_counts["PAY"],
            "satcatRocketBodies": type_counts["R/B"],
            "satcatDebris": type_counts["DEB"],
        },
    }

    output_path = os.path.join(DATA_DIR, "metadata.json")
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(metadata, f, indent=2)

    print(f"[META] metadata.json written")
    print(f"  Last updated: {now}")
    print(f"  Active satellites: {counts.get('active', 0)}")
    print(f"  Debris (merged): {counts.get('debris_merged', 0)}")
    print(f"  SATCAT total: {len(satcat)}")


def main():
    print("=" * 60)
    print("SpaceDebris Data Fetcher")
    print("=" * 60)
    print()

    ensure_data_dir()
    counts = {}

    # Fetch GP groups
    for group_name, output_file in GP_GROUPS:
        count = fetch_gp_group(group_name, output_file)
        counts[group_name] = count
        time.sleep(DELAY_BETWEEN_REQUESTS)

    # Merge debris files
    counts["debris_merged"] = merge_debris_files()

    # Fetch SATCAT
    time.sleep(DELAY_BETWEEN_REQUESTS)
    satcat = fetch_satcat()

    # Generate metadata
    generate_metadata(counts, satcat)

    print()
    print("=" * 60)
    print("Data fetch complete!")
    print("=" * 60)


if __name__ == "__main__":
    main()
