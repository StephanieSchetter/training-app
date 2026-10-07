"""Daily Garmin pull (spec section 9). Runs on GitHub's scheduler.

Reads Garmin with the saved sign-in token and writes daily metrics and activities to the database.
IMPORTANT: this repository's run logs are public, so this script only ever prints counts and
error types. It must never print health numbers, names or tokens.

Environment:
  SUPABASE_URL, SUPABASE_SERVICE_KEY   database address and its private key
  GARMIN_TOKENS                        first-time sign-in token (afterwards the refreshed one is kept in the database)
  DAYS                                 how many days back to pull (default 3; 365 for the first history load)
"""
import json
import os
import sys
import time
from datetime import date, datetime, timedelta, timezone

import requests
from garminconnect import Garmin

URL = os.environ["SUPABASE_URL"].rstrip("/") + "/rest/v1/records"
KEY = os.environ["SUPABASE_SERVICE_KEY"]
HEAD = {"apikey": KEY, "Authorization": f"Bearer {KEY}", "Content-Type": "application/json"}
DAYS = int(os.environ.get("DAYS") or 3)
ADELAIDE = timezone(timedelta(hours=10, minutes=30))  # only used to decide which calendar day "today" is


def db_get(params):
    r = requests.get(URL, headers=HEAD, params=params, timeout=30)
    r.raise_for_status()
    return r.json()


def db_put(user_id, rows):
    stamp = datetime.now(timezone.utc).isoformat()
    body = [{"user_id": user_id, "kind": k, "id": str(i), "data": d, "deleted": False, "updated_at": stamp} for k, i, d in rows]
    for n in range(0, len(body), 200):
        r = requests.post(URL, headers={**HEAD, "Prefer": "resolution=merge-duplicates"}, params={"on_conflict": "user_id,kind,id"}, data=json.dumps(body[n:n + 200]), timeout=60)
        r.raise_for_status()


def pick_readiness(items):
    """The morning score is the one the app uses; fall back to the latest of the day."""
    if not items:
        return None
    morning = [x for x in items if x.get("inputContext") == "AFTER_WAKEUP_RESET"]
    return (morning or items)[0]


def day_record(g, d):
    sleep = g.get_sleep_data(d) or {}
    dto = sleep.get("dailySleepDTO") or {}
    ready = pick_readiness(g.get_training_readiness(d) or [])
    secs = dto.get("sleepTimeSeconds")
    rec = {
        "date": d,
        "restingHr": sleep.get("restingHeartRate"),
        "hrv": sleep.get("avgOvernightHrv"),
        "sleepHours": round(secs / 3600, 2) if secs else None,
        "sleepScore": ((dto.get("sleepScores") or {}).get("overall") or {}).get("value"),
        "readiness": ready.get("score") if ready else None,
        "trainingLoad": ready.get("acuteLoad") if ready else None,
    }
    return rec if any(v is not None for k, v in rec.items() if k != "date") else None


def activity_record(g, a):
    key = (a.get("activityType") or {}).get("typeKey", "")
    kind = "run" if "running" in key else "strength" if key == "strength_training" else None
    if not kind:
        return None
    laps = []
    if kind == "run":
        for lap in (g.get_activity_splits(a["activityId"]) or {}).get("lapDTOs") or []:
            laps.append({"sec": round(lap.get("duration") or 0, 1), "km": round((lap.get("distance") or 0) / 1000, 3), "avgHr": lap.get("averageHR")})
    start = a.get("startTimeLocal") or ""
    return {
        "id": a["activityId"], "type": kind, "typeKey": key, "startLocal": start, "date": start[:10],
        "durationSec": round(a.get("duration") or 0), "avgHr": a.get("averageHR"), "maxHr": a.get("maxHR"),
        "trainingLoad": round(a["activityTrainingLoad"], 1) if a.get("activityTrainingLoad") is not None else None,
        "distanceKm": round((a.get("distance") or 0) / 1000, 3), "laps": laps,
    }


def main():
    owner = db_get({"select": "user_id", "kind": "eq.meta", "id": "eq.program", "limit": "1"})
    if not owner:
        print("No program found in the database, so there is nobody to sync for.")
        return 1
    user_id = owner[0]["user_id"]
    previous = db_get({"select": "data", "kind": "eq.meta", "id": "eq.garmin_status", "user_id": f"eq.{user_id}"})
    status = (previous[0]["data"] or {}) if previous else {}
    now = datetime.now(timezone.utc).isoformat()

    try:
        saved = db_get({"select": "data", "kind": "eq.secret", "id": "eq.garmin_tokens", "user_id": f"eq.{user_id}"})
        # Prefer the refreshed token kept in the database; fall back to the one stored in GitHub.
        tokens = (saved[0]["data"] or {}).get("json") if saved else None
        tokens = tokens or os.environ.get("GARMIN_TOKENS", "").strip()
        if not tokens:
            raise RuntimeError("no Garmin sign-in token available")
        g = Garmin()
        g.login(tokens)

        today = datetime.now(ADELAIDE).date()
        days = [(today - timedelta(days=n)).isoformat() for n in range(DAYS)]
        pause = 0.4 if DAYS > 10 else 0
        rows, failed_days = [], 0
        for d in days:
            try:
                rec = day_record(g, d)
                if rec:
                    rows.append(("garmin_day", d, rec))
            except Exception as err:  # one bad day must not sink a year of history
                failed_days += 1
                print(f"day skipped: {type(err).__name__}")
            time.sleep(pause)
            if len(rows) >= 100:
                db_put(user_id, rows)
                rows = []
        db_put(user_id, rows)

        acts = g.get_activities_by_date(days[-1], days[0]) or []
        act_rows = []
        for a in acts:
            try:
                rec = activity_record(g, a)
                if rec:
                    act_rows.append(("garmin_activity", rec["id"], rec))
            except Exception as err:
                print(f"activity skipped: {type(err).__name__}")
            time.sleep(pause)
        db_put(user_id, act_rows)

        # Keep the refreshed token so the next run doesn't need a new sign-in.
        db_put(user_id, [("secret", "garmin_tokens", {"json": g.client.dumps(), "savedAt": now})])
        db_put(user_id, [("meta", "garmin_status", {"ok": True, "lastSync": now, "lastAttempt": now, "error": None})])
        print(f"Garmin sync finished: {len(days) - failed_days} of {len(days)} days read, {len(act_rows)} activities saved.")
        return 0
    except Exception as err:
        # The app shows a "Garmin data is old" banner from this; it never crashes because of it.
        db_put(user_id, [("meta", "garmin_status", {**status, "ok": False, "lastAttempt": now, "error": type(err).__name__})])
        print(f"Garmin sync FAILED: {type(err).__name__}")
        return 1


if __name__ == "__main__":
    sys.exit(main())
