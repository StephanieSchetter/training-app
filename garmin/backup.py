"""Weekly backup (spec section 13): copies every record out of the database into one dated file.

The file is then committed to a separate private repository by the workflow. This repository's
run logs are public, so this script prints counts only, never the data. The Garmin sign-in token
is left out of the backup.
"""
import json
import os
import sys
from collections import Counter
from datetime import datetime, timezone

import requests

URL = os.environ["SUPABASE_URL"].rstrip("/") + "/rest/v1/records"
KEY = os.environ["SUPABASE_SERVICE_KEY"]
HEAD = {"apikey": KEY, "Authorization": f"Bearer {KEY}"}


def main():
    rows, start = [], 0
    while True:
        r = requests.get(URL, headers={**HEAD, "Range-Unit": "items", "Range": f"{start}-{start + 999}"},
                         params={"select": "kind,id,data,deleted,updated_at", "kind": "neq.secret", "order": "kind,id"}, timeout=60)
        r.raise_for_status()
        page = r.json()
        rows.extend(page)
        if len(page) < 1000:
            break
        start += 1000
    stamp = datetime.now(timezone.utc)
    out = sys.argv[1] if len(sys.argv) > 1 else "."
    name = f"backup-{stamp.date().isoformat()}.json"
    with open(os.path.join(out, name), "w", encoding="utf-8") as f:
        json.dump({"takenAt": stamp.isoformat(), "records": rows}, f, ensure_ascii=False, separators=(",", ":"))
    kinds = Counter(row["kind"] for row in rows)
    print(f"Backup {name}: {len(rows)} records across {len(kinds)} kinds.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
