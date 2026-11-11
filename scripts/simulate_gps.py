"""GPS SIMULATOR (test tool). Sends SYNTHETIC positions through the real /me/location endpoint as a technician,
so you can watch the Live Operations map without walking around. It proves the server pipeline
(shift -> policy check -> ping stored -> map update); it does NOT prove a phone's GPS chip works.
Use the "Test my GPS" panel in the technician app on the actual device for that.

  python scripts/simulate_gps.py --email tech2@demo.techso.local --password <demo password>
Standard library only.
"""
import argparse
import json
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone


def call(base, method, path, token=None, body=None):
    req = urllib.request.Request(base + path, method=method, data=json.dumps(body).encode() if body is not None else None)
    req.add_header("Content-Type", "application/json")
    if token:
        req.add_header("Authorization", f"Bearer {token}")
    try:
        with urllib.request.urlopen(req, timeout=10) as r:
            return r.status, json.loads(r.read() or b"{}")
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read())
        except Exception:
            return e.code, {}


def fleet(a):
    """Several demo technicians at once, each driving towards the device of one of their active jobs (or idling nearby)."""
    techs = []
    for i, email in enumerate(a.fleet.split(",")):
        email = email.strip()
        st, r = call(a.base, "POST", "/auth/login", body={"email": email, "password": a.password})
        if st != 200:
            print(f"{email}: login failed ({st})")
            continue
        token = r["access_token"]
        call(a.base, "POST", "/me/shift/start", token)  # 409 when already on shift: fine
        st, t = call(a.base, "GET", "/me/tracking", token)
        if not t.get("active"):
            print(f"{email}: tracking not active ({t.get('reason')})")
            continue
        _, jobs = call(a.base, "GET", "/me/jobs?scope=active", token)
        dev = next((j["device"] for j in jobs if j.get("device") and j["device"].get("lat") is not None), None) if isinstance(jobs, list) else None
        to = (dev["lat"], dev["lon"]) if dev else (a.to_lat + 0.01 * i, a.to_lon - 0.012 * i)
        start = (to[0] + 0.012 + 0.004 * i, to[1] - 0.015 + 0.006 * i)   # roughly 1.5-2.5 km away
        techs.append({"name": r["user"]["full_name"], "token": token, "from": start, "to": to,
                      "interval": max(t["policy"]["min_interval_s"], 1) + 1, "target": dev["code"] if dev else "standby point"})
        print(f"{r['user']['full_name']}: heading to {techs[-1]['target']}")
    if not techs:
        sys.exit("no technician could be simulated")
    interval = max(t["interval"] for t in techs)
    for i in range(a.steps + 1):
        f = i / a.steps
        for t in techs:
            lat = t["from"][0] + (t["to"][0] - t["from"][0]) * f
            lon = t["from"][1] + (t["to"][1] - t["from"][1]) * f
            st, r = call(a.base, "POST", "/me/location", t["token"],
                         {"lat": lat, "lon": lon, "accuracy_m": 15, "recorded_at": datetime.now(timezone.utc).isoformat()})
            print(f"[{i:02d}/{a.steps}] {t['name']:<16} {lat:.5f},{lon:.5f} -> HTTP {st} {r}")
        if i < a.steps:
            time.sleep(interval)
    print("done. (This was simulated movement.)")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="http://127.0.0.1:8000/api/v1")
    ap.add_argument("--email")
    ap.add_argument("--fleet", help="comma-separated technician emails to simulate together, "
                                    "e.g. tech1@demo.techso.local,tech2@demo.techso.local,tech3@demo.techso.local")
    ap.add_argument("--password", required=True)
    ap.add_argument("--from-lat", type=float, default=-6.2000)
    ap.add_argument("--from-lon", type=float, default=106.8230)
    ap.add_argument("--to-lat", type=float, default=-6.2088)
    ap.add_argument("--to-lon", type=float, default=106.8456)
    ap.add_argument("--steps", type=int, default=12)
    ap.add_argument("--no-shift", action="store_true", help="do not start a shift (needs an active assignment instead)")
    a = ap.parse_args()
    if a.fleet:
        return fleet(a)
    if not a.email:
        ap.error("--email or --fleet is required")

    st, r = call(a.base, "POST", "/auth/login", body={"email": a.email, "password": a.password})
    if st != 200:
        sys.exit(f"login failed ({st}): {r.get('detail')}")
    token = r["access_token"]
    print(f"signed in as {r['user']['full_name']} ({r['user']['role']})")
    if r["user"]["role"] != "technician":
        sys.exit("only technicians report location")

    if not a.no_shift:
        st, r = call(a.base, "POST", "/me/shift/start", token)
        print("shift:", "started" if st == 200 else f"not started ({st}: {r.get('detail')})")

    st, t = call(a.base, "GET", "/me/tracking", token)
    if not t.get("active"):
        sys.exit(f"tracking not active: {t.get('reason')}")
    interval = max(t["policy"]["min_interval_s"], 1) + 1
    print(f"tracking active ({t['reason']}); one ping every {interval}s; {a.steps} steps")

    for i in range(a.steps + 1):
        f = i / a.steps
        lat = a.from_lat + (a.to_lat - a.from_lat) * f
        lon = a.from_lon + (a.to_lon - a.from_lon) * f
        st, r = call(a.base, "POST", "/me/location", token,
                     {"lat": lat, "lon": lon, "accuracy_m": 15, "recorded_at": datetime.now(timezone.utc).isoformat()})
        print(f"[{i:02d}/{a.steps}] {lat:.5f},{lon:.5f} -> HTTP {st} {r}")
        if i < a.steps:
            time.sleep(interval)
    print("done. (This was simulated movement.)")


if __name__ == "__main__":
    main()
