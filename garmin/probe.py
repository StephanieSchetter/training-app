"""One-off check (14 Oct 2026): where Garmin keeps calories eaten from MyFitnessPal.
Public logs: prints only field names, whether they hold a value, and response status. Never values."""
from datetime import datetime, timedelta

from garminconnect import Garmin

import sync


def shape(obj, depth=0):
    if isinstance(obj, dict):
        return {k: (shape(v, depth + 1) if depth < 1 else type(v).__name__) for k, v in list(obj.items())[:40]}
    if isinstance(obj, list):
        return f"list[{len(obj)}]" + (f" of {shape(obj[0], depth + 1)}" if obj and depth < 1 else "")
    return "value" if obj not in (None, "", 0) else "empty"


owner = sync.db_get({"select": "user_id", "kind": "eq.meta", "id": "eq.program", "limit": "1"})[0]["user_id"]
saved = sync.db_get({"select": "data", "kind": "eq.secret", "id": "eq.garmin_tokens", "user_id": f"eq.{owner}"})
g = Garmin()
g.login((saved[0]["data"] or {}).get("json"))
print("library methods:", [m for m in dir(g) if any(w in m.lower() for w in ("nutri", "food", "meal", "calor"))])
d = (datetime.now(sync.ADELAIDE).date() - timedelta(days=1)).isoformat()
s = g.get_user_summary(d) or {}
print("summary fields about food:", {k: shape(v) for k, v in s.items() if any(w in k.lower() for w in ("consum", "remain", "goal", "intake", "food"))})
for path in [f"/nutrition-service/food/logs/{d}", f"/nutrition-service/meals/{d}", f"/nutrition-service/settings/{d}",
             f"/usersummary-service/usersummary/daily/{d}?calendarDate={d}"]:
    try:
        r = g.client.connectapi(path)
        print(path.split("/")[1:3], "ok:", shape(r))
    except Exception as err:
        print(path.split("/")[1:3], "error:", type(err).__name__, str(err)[:60].replace(d, "<date>"))
