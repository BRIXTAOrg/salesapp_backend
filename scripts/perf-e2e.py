#!/usr/bin/env python3
from __future__ import annotations

import getpass
import http.client
import json
import os
import socket
import statistics
import subprocess
import time
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
LOG_PATH = Path("/tmp/brixta-perf-e2e-backend.log")
RESULT_PATH = Path("/tmp/brixta-perf-e2e-result.json")


def percentile(values: list[float], p: float) -> float:
    if not values:
        return 0.0
    ordered = sorted(values)
    idx = max(0, min(len(ordered) - 1, int(len(ordered) * p) - 1))
    return ordered[idx]


def stats(values: list[float]) -> dict[str, float]:
    if not values:
        return {"min": 0.0, "avg": 0.0, "p50": 0.0, "p95": 0.0, "p99": 0.0, "max": 0.0}
    ordered = sorted(values)
    return {
        "min": round(min(ordered), 2),
        "avg": round(statistics.mean(ordered), 2),
        "p50": round(statistics.median(ordered), 2),
        "p95": round(percentile(ordered, 0.95), 2),
        "p99": round(percentile(ordered, 0.99), 2),
        "max": round(max(ordered), 2),
    }


def free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return int(s.getsockname()[1])


class Client:
    def __init__(self, port: int):
        self.port = port
        self.conn = http.client.HTTPConnection("127.0.0.1", port, timeout=15)

    def close(self):
        try:
            self.conn.close()
        except Exception:
            pass

    def request(self, method: str, path: str, *, token: str | None = None, body=None):
        headers = {
            "Accept": "application/json",
            "Connection": "keep-alive",
            "User-Agent": "BRIXTA-E2E-PERF/1",
        }
        encoded = None
        if token:
            headers["Authorization"] = f"Bearer {token}"
        if body is not None:
            encoded = json.dumps(body, separators=(",", ":")).encode("utf-8")
            headers["Content-Type"] = "application/json"
            headers["Content-Length"] = str(len(encoded))

        start = time.perf_counter()
        try:
            self.conn.request(method, path, body=encoded, headers=headers)
            response = self.conn.getresponse()
            raw = response.read()
        except (http.client.HTTPException, OSError):
            self.close()
            self.conn = http.client.HTTPConnection("127.0.0.1", self.port, timeout=15)
            start = time.perf_counter()
            self.conn.request(method, path, body=encoded, headers=headers)
            response = self.conn.getresponse()
            raw = response.read()

        elapsed = (time.perf_counter() - start) * 1000
        try:
            payload = json.loads(raw.decode("utf-8")) if raw else None
        except Exception:
            payload = {"_raw": raw.decode("utf-8", errors="replace")[:1000]}

        return {
            "status": response.status,
            "ms": elapsed,
            "bytes": len(raw),
            "headers": dict(response.getheaders()),
            "json": payload,
        }


def ensure_ok(result, label: str):
    if 200 <= int(result["status"]) < 300:
        return
    print(f"\n❌ {label}: HTTP {result['status']}")
    print(json.dumps(result.get("json"), indent=2)[:4000])
    raise SystemExit(1)


def bench(client: Client, label: str, method: str, path: str, *, token=None, body=None, warmup=3, samples=15):
    for _ in range(warmup):
        r = client.request(method, path, token=token, body=body)
        ensure_ok(r, f"{label} warmup")

    times = []
    sizes = []
    last = None
    for _ in range(samples):
        last = client.request(method, path, token=token, body=body)
        ensure_ok(last, label)
        times.append(last["ms"])
        sizes.append(last["bytes"])

    out = stats(times)
    out["samples"] = samples
    out["avgBytes"] = round(statistics.mean(sizes), 1) if sizes else 0
    print(
        f"{label:<30} "
        f"p50={out['p50']:>8.2f} ms  "
        f"p95={out['p95']:>8.2f} ms  "
        f"p99={out['p99']:>8.2f} ms  "
        f"avgBytes={out['avgBytes']:.0f}"
    )
    return out, last


def main():
    port = int(os.environ.get("BRIXTA_PERF_PORT") or free_port())

    env = os.environ.copy()
    env["PORT"] = str(port)
    env["NODE_ENV"] = "production"

    LOG_PATH.write_text("")
    log = LOG_PATH.open("a", buffering=1)

    print("============================================================")
    print("BRIXTA AUTHENTICATED E2E PERFORMANCE BASELINE")
    print("============================================================")
    print(f"Backend: {ROOT}")
    print(f"Port:    {port}")
    print()

    server = subprocess.Popen(
        ["npm", "start"],
        cwd=ROOT,
        env=env,
        stdout=log,
        stderr=subprocess.STDOUT,
        text=True,
    )

    client = Client(port)

    try:
        ready = False
        for _ in range(100):
            if server.poll() is not None:
                break
            try:
                r = client.request("GET", "/")
                if r["status"] == 200:
                    ready = True
                    break
            except Exception:
                pass
            time.sleep(0.1)

        if not ready:
            log.flush()
            print("❌ Production backend failed to become ready.")
            print(LOG_PATH.read_text()[-6000:])
            raise SystemExit(1)

        root_stats, _ = bench(client, "raw Express /", "GET", "/", warmup=5, samples=50)

        token = os.environ.get("BRIXTA_PERF_TOKEN", "").strip() or None
        company = os.environ.get("BRIXTA_PERF_COMPANY_CODE", "").strip()
        login_id = os.environ.get("BRIXTA_PERF_LOGIN_ID", "").strip()
        password = os.environ.get("BRIXTA_PERF_PASSWORD", "")

        login_stats = None
        login_response = None

        if token is None:
            if not company:
                company = input("Company code: ").strip()
            if not login_id:
                login_id = input("Salesman login ID / phone: ").strip()
            if not password:
                password = getpass.getpass("Password: ")

            if not company or not login_id or not password:
                print("❌ Credentials are required to benchmark authenticated paths.")
                raise SystemExit(1)

            login_body = {
                "companyCode": company,
                "salesmanLoginId": login_id,
                "password": password,
            }

            login_stats, login_response = bench(
                client,
                "login + DB write",
                "POST",
                "/api/salesApp/auth/login",
                body=login_body,
                warmup=1,
                samples=5,
            )
            token = str(login_response["json"].get("token") or "").strip()
            if not token:
                print("❌ Login succeeded but no token was returned.")
                raise SystemExit(1)
        else:
            print("Using BRIXTA_PERF_TOKEN; login benchmark skipped.")

        bootstrap_stats, bootstrap_response = bench(
            client,
            "bootstrap + DB write",
            "GET",
            "/api/salesApp/bootstrap",
            token=token,
            warmup=2,
            samples=12,
        )

        sync_stats, _ = bench(
            client,
            "sync state",
            "GET",
            "/api/salesApp/sync/state",
            token=token,
            warmup=2,
            samples=20,
        )

        my_work_stats, _ = bench(
            client,
            "my work",
            "GET",
            "/api/salesApp/my-work",
            token=token,
            warmup=2,
            samples=15,
        )

        bootstrap_json = bootstrap_response.get("json") or {}
        responsibilities = bootstrap_json.get("responsibilities") or []
        keys = [
            str(item.get("key") or "").strip()
            for item in responsibilities
            if isinstance(item, dict) and str(item.get("key") or "").strip()
        ]

        runtime_key = os.environ.get("BRIXTA_PERF_RESPONSIBILITY_KEY", "").strip()
        manifest_stats = None
        runtime_stats = None

        candidate_keys = ([runtime_key] if runtime_key else []) + [k for k in keys if k != runtime_key]
        selected_key = None

        for key in candidate_keys:
            probe = client.request(
                "GET",
                f"/api/salesApp/responsibilities/{key}/runtime",
                token=token,
            )
            if 200 <= probe["status"] < 300:
                selected_key = key
                break

        if selected_key:
            print(f"\nResponsibility selected for Kernel runtime: {selected_key}")

            manifest_probe = client.request(
                "GET",
                f"/api/salesApp/responsibilities/{selected_key}/manifest",
                token=token,
            )
            if 200 <= manifest_probe["status"] < 300:
                manifest_stats, _ = bench(
                    client,
                    "published manifest",
                    "GET",
                    f"/api/salesApp/responsibilities/{selected_key}/manifest",
                    token=token,
                    warmup=2,
                    samples=15,
                )
            else:
                print(f"published manifest             skipped (HTTP {manifest_probe['status']})")

            runtime_stats, _ = bench(
                client,
                "Kernel runtime",
                "GET",
                f"/api/salesApp/responsibilities/{selected_key}/runtime",
                token=token,
                warmup=2,
                samples=20,
            )
        else:
            print("\n⚠️ No assigned Responsibility returned a successful Kernel runtime.")
            print("   Bootstrap/auth/DB paths are still benchmarked.")

        action_result = None
        action_spec = os.environ.get("BRIXTA_PERF_ACTION", "").strip()
        allow_mutation = os.environ.get("BRIXTA_PERF_ALLOW_MUTATION", "") == "1"

        if action_spec:
            if not allow_mutation:
                print()
                print("⚠️ BRIXTA_PERF_ACTION was provided, but mutation was NOT executed.")
                print("   Set BRIXTA_PERF_ALLOW_MUTATION=1 explicitly to benchmark a real action.")
            else:
                if ":" not in action_spec:
                    raise SystemExit("BRIXTA_PERF_ACTION must be responsibilityKey:actionId")

                responsibility_key, action_id = action_spec.split(":", 1)
                try:
                    payload = json.loads(os.environ.get("BRIXTA_PERF_ACTION_PAYLOAD_JSON", "{}"))
                except json.JSONDecodeError as exc:
                    raise SystemExit(f"Invalid BRIXTA_PERF_ACTION_PAYLOAD_JSON: {exc}")

                body = {
                    "payload": payload,
                    "clientMutationId": f"perf-{int(time.time() * 1000)}",
                    "clientCreatedAt": datetime.now(timezone.utc).isoformat(),
                }
                record_id = os.environ.get("BRIXTA_PERF_RECORD_ID", "").strip()
                if record_id:
                    body["recordId"] = record_id

                print()
                print("⚠️ Executing ONE explicitly-authorized real Kernel mutation.")
                action_result = client.request(
                    "POST",
                    f"/api/salesApp/responsibilities/{responsibility_key}/actions/{action_id}",
                    token=token,
                    body=body,
                )
                print(
                    f"Kernel action                    "
                    f"HTTP={action_result['status']}  "
                    f"duration={action_result['ms']:.2f} ms"
                )
                if not (200 <= action_result["status"] < 300):
                    print(json.dumps(action_result.get("json"), indent=2)[:4000])

        result = {
            "generatedAt": datetime.now(timezone.utc).isoformat(),
            "port": port,
            "responsibilityKey": selected_key,
            "root": root_stats,
            "login": login_stats,
            "bootstrap": bootstrap_stats,
            "sync": sync_stats,
            "myWork": my_work_stats,
            "manifest": manifest_stats,
            "runtime": runtime_stats,
            "action": None if action_result is None else {
                "status": action_result["status"],
                "ms": round(action_result["ms"], 2),
                "bytes": action_result["bytes"],
            },
            "notes": [
                "Login includes an employeeRuntimeState database upsert.",
                "Bootstrap includes workspace resolution and employeeRuntimeState database upsert.",
                "Kernel action is never executed automatically; it requires explicit BRIXTA_PERF_ALLOW_MUTATION=1.",
            ],
        }

        RESULT_PATH.write_text(json.dumps(result, indent=2) + "\n")

        print()
        print("============================================================")
        print("✅ AUTHENTICATED E2E BASELINE COMPLETE")
        print("============================================================")
        print(f"Result JSON: {RESULT_PATH}")
        print(f"Server log:  {LOG_PATH}")

    finally:
        client.close()
        if server.poll() is None:
            server.terminate()
            try:
                server.wait(timeout=5)
            except subprocess.TimeoutExpired:
                server.kill()
        log.close()


if __name__ == "__main__":
    main()
