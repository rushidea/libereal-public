#!/usr/bin/env python3
"""Daily IndexNow + Baidu URL push. Installed on the origin host as a crontab job.

Default app root: /www/wwwroot/libereal
Override with LIBEREAL_APP_ROOT or --app-root.
"""
from __future__ import annotations

import argparse
import json
import os
import sqlite3
import sys
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

ORIGIN = "https://libereal.cn"
INDEXNOW_ENDPOINT = "https://api.indexnow.org/indexnow"
BAIDU_ENDPOINT = "http://data.zz.baidu.com/urls"
BING_PING = "https://www.bing.com/ping"
LOOKBACK_HOURS = 26
URL_LIMIT = 10_000
BAIDU_BATCH = 2000


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--app-root",
        default=os.environ.get("LIBEREAL_APP_ROOT", "/www/wwwroot/libereal"),
    )
    return parser.parse_args()


def load_env(path: Path) -> dict[str, str]:
    env: dict[str, str] = {}
    if not path.is_file():
        return env
    for raw in path.read_text().splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        env[key] = value.strip().strip('"').strip("'")
    return env


def env_get(env: dict[str, str], key: str) -> str:
    return env.get(key, "").strip()


def hostname_only(raw: str) -> str:
    parsed = urllib.parse.urlparse(raw if "://" in raw else "https://" + raw)
    return parsed.hostname or raw.rstrip("/")


def write_key_file(path: Path, key: str) -> None:
    path.write_text(key + "\n")
    path.chmod(0o644)


def product_url(catalog_number: str, brand: str) -> str:
    return (
        f"{ORIGIN}/products/{urllib.parse.quote(catalog_number, safe='')}"
        f"?brand={urllib.parse.quote(brand, safe='')}"
    )


def list_recent_urls(db_path: str) -> list[str]:
    since = (datetime.now(timezone.utc) - timedelta(hours=LOOKBACK_HOURS)).strftime(
        "%Y-%m-%dT%H:%M:%S.000Z"
    )
    con = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
    try:
        rows = con.execute(
            """
            SELECT catalogNumber, brand
            FROM Product
            WHERE hazardous = 0
              AND catalogNumber != ''
              AND brand != ''
              AND name != ''
              AND updatedAt >= ?
            ORDER BY updatedAt DESC
            LIMIT ?
            """,
            (since, URL_LIMIT),
        ).fetchall()
    finally:
        con.close()
    seen: set[str] = set()
    urls: list[str] = []
    for catalog_number, brand in rows:
        if not catalog_number or not brand:
            continue
        loc = product_url(str(catalog_number), str(brand))
        if loc in seen:
            continue
        seen.add(loc)
        urls.append(loc)
    return urls


def http_json(url: str, data: dict, timeout: int = 15) -> tuple[int, str]:
    body = json.dumps(data).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=body,
        method="POST",
        headers={"Content-Type": "application/json; charset=utf-8"},
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return resp.status, resp.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as exc:
        return exc.code, exc.read().decode("utf-8", "replace")[:200]


def http_text(url: str, payload: str, timeout: int = 30) -> tuple[int, str]:
    req = urllib.request.Request(
        url,
        data=payload.encode("utf-8"),
        method="POST",
        headers={"Content-Type": "text/plain"},
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return resp.status, resp.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as exc:
        return exc.code, exc.read().decode("utf-8", "replace")[:200]


def http_get(url: str, timeout: int = 15) -> tuple[int, str]:
    req = urllib.request.Request(url, method="GET")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return resp.status, resp.read().decode("utf-8", "replace")[:200]
    except urllib.error.HTTPError as exc:
        return exc.code, exc.read().decode("utf-8", "replace")[:200]


def submit_indexnow(key: str, urls: list[str]) -> dict:
    if not key:
        return {"submitted": 0, "batches": 0, "skipped": "indexnow_unconfigured"}
    if not urls:
        return {"submitted": 0, "batches": 0}
    host = urllib.parse.urlparse(ORIGIN).hostname or "libereal.cn"
    payload = {
        "host": host,
        "key": key,
        "keyLocation": f"{ORIGIN}/{key}.txt",
        "urlList": urls,
    }
    status, text = http_json(INDEXNOW_ENDPOINT, payload)
    if status not in (200, 202):
        return {"submitted": 0, "batches": 0, "error": f"indexnow_http_{status}:{text[:200]}"}
    return {"submitted": len(urls), "batches": 1}


def submit_baidu(token: str, site: str, urls: list[str]) -> dict:
    if not token:
        return {"submitted": 0, "batches": 0, "skipped": "baidu_push_unconfigured"}
    if not urls:
        return {"submitted": 0, "batches": 0}
    submitted = 0
    batches = 0
    success = 0
    remain = None
    endpoint = (
        f"{BAIDU_ENDPOINT}?site={urllib.parse.quote(site, safe='')}"
        f"&token={urllib.parse.quote(token, safe='')}"
    )
    for offset in range(0, len(urls), BAIDU_BATCH):
        batch = urls[offset : offset + BAIDU_BATCH]
        status, text = http_text(endpoint, "\n".join(batch))
        if status != 200:
            return {
                "submitted": submitted,
                "batches": batches,
                "error": f"baidu_push_http_{status}:{text[:200]}",
            }
        try:
            parsed = json.loads(text)
        except json.JSONDecodeError:
            return {
                "submitted": submitted,
                "batches": batches,
                "error": f"baidu_push_invalid_json:{text[:200]}",
            }
        success += int(parsed.get("success") or 0)
        if isinstance(parsed.get("remain"), int):
            remain = parsed["remain"]
        submitted += len(batch)
        batches += 1
    result = {"submitted": submitted, "batches": batches, "success": success}
    if remain is not None:
        result["remain"] = remain
    return result


def ping_bing_sitemap() -> dict:
    sitemap = f"{ORIGIN}/sitemap.xml"
    url = f"{BING_PING}?sitemap={urllib.parse.quote(sitemap, safe='')}"
    status, _text = http_get(url)
    if status == 410:
        return {"ok": True, "skipped": "bing_sitemap_ping_retired"}
    if status != 200:
        return {"ok": False, "error": f"bing_sitemap_ping_{status}"}
    return {"ok": True}


def main() -> int:
    args = parse_args()
    app_root = Path(args.app_root)
    env = load_env(app_root / ".env")
    key = env_get(env, "INDEXNOW_KEY")
    token = env_get(env, "BAIDU_PUSH_TOKEN")
    site = hostname_only(env_get(env, "BAIDU_PUSH_SITE") or ORIGIN)
    db_path = env_get(env, "DATABASE_PATH") or str(app_root / "prisma" / "dev.db")
    if key:
        public_dir = app_root / "public"
        write_key_file(public_dir / "indexnow-key.txt", key)
        write_key_file(public_dir / f"{key}.txt", key)
    urls = list_recent_urls(db_path)
    result = {
        "ok": True,
        "urlCount": len(urls),
        "indexNow": submit_indexnow(key, urls),
        "baiduPush": submit_baidu(token, site, urls),
        "sitemapPing": ping_bing_sitemap(),
    }
    result["ok"] = not result["indexNow"].get("error")
    json.dump(result, sys.stdout, ensure_ascii=False)
    sys.stdout.write("\n")
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
