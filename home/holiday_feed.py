"""HOME 법정 공휴일 자동 표시. [주연]

먼 미래 연도에도 베트남 법정 공휴일이 달력에 뜨도록 연도별로 한 번 조회해 보관합니다.
여기서 만드는 일정은 **확정이 아닙니다.** 법으로 정해진 날짜일 뿐이며,
실제로 며칠 쉬는지(대체휴일·보상근무일)는 해마다 정부 공문으로 따로 정해집니다.
그래서 모든 항목은 provisional=True, verification_status="unverified"로 표시합니다.
확정 자료는 사람이 원문을 확인해 events.json에 등록하며, 등록된 날짜가 우선합니다.

조회에 실패하면 그 연도를 비워 둡니다. 빈 값이나 만들어 낸 날짜로 대체하지 않습니다.
"""
import json
import os
from datetime import date, timedelta
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

# routes가 이 모듈을 부르고 event_import가 routes를 부르므로, 공용 도구는 함수 안에서 불러옵니다.

CACHE_PATH = Path(__file__).parent / "data" / "holiday_cache.json"
# 베트남 노동법이 정한 법정 공휴일만 받습니다. 제공업체가 함께 주는 관습일·기념일은 제외합니다.
# 묶음 이름이 같은 항목은 연속된 날짜를 하나의 연휴로 합칩니다.
STATUTORY = {
    "international new year's day": ("신정", "newyear"),
    "vietnamese new year's eve": ("설 연휴", "tet"),
    "vietnamese new year": ("설 연휴", "tet"),
    "tet holiday": ("설 연휴", "tet"),
    "hung kings festival": ("훙왕 기일", "hung"),
    "liberation day/reunification day": ("통일기념일", "reunification"),
    "international labor day": ("노동절", "labor"),
    "independence day": ("국경일", "national"),
    "independence day observed": ("국경일", "national"),
}
SOURCE_NAME = "Calendarific 공휴일 자료 (법정일 기준 · 연휴 기간 미확정)"
MIN_YEAR = 2020
MAX_AHEAD = 12


def _key():
    key = os.environ.get("CALENDARIFIC_API_KEY", "").strip()
    if not key:
        raise ReviewError("실행 환경에 CALENDARIFIC_API_KEY가 없습니다.")
    return key


def _cache():
    from .event_import import ReviewError, _snapshot
    if not CACHE_PATH.exists():
        return b"", {"schema_version": 1, "years": {}}
    raw, document = _snapshot(CACHE_PATH)
    if not isinstance(document, dict) or document.get("schema_version") != 1 or not isinstance(document.get("years"), dict):
        raise ReviewError("공휴일 보관 파일 형식을 확인해주세요.")
    return raw, document


def _fetch(year):
    """해당 연도를 1회 조회해 법정 공휴일 날짜만 돌려줍니다."""
    from .event_import import ReviewError
    key = _key()
    address = "https://calendarific.com/api/v2/holidays?" + urlencode(
        {"api_key": key, "country": "VN", "year": year})
    try:
        with urlopen(Request(address, headers={"Accept": "application/json"}), timeout=25) as response:
            payload = json.loads(response.read(4_000_001))
    except HTTPError as error:
        status = error.code
        error.close()
        if status == 429:
            raise ReviewError("공휴일 조회 한도에 도달했습니다. 재시도하지 않습니다.") from None
        raise ReviewError("공휴일 조회가 거절되었습니다.") from None
    except (URLError, TimeoutError, OSError, ValueError):
        raise ReviewError("공휴일 조회에 실패했습니다.") from None
    if not isinstance(payload, dict) or payload.get("meta", {}).get("code") != 200:
        raise ReviewError("공휴일 조회 응답이 정상이 아닙니다.")
    rows = payload.get("response", {}).get("holidays")
    if not isinstance(rows, list):
        raise ReviewError("공휴일 목록 형식을 확인할 수 없습니다.")
    found = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        name = row.get("name")
        value = (row.get("date") or {}).get("iso") if isinstance(row.get("date"), dict) else None
        if not isinstance(name, str) or not isinstance(value, str):
            continue
        label = STATUTORY.get(name.casefold().strip())
        if not label:
            continue
        try:
            parsed = date.fromisoformat(value)
        except ValueError:
            continue
        if parsed.year != year:
            continue
        found.append({"date": value, "label": label[0], "group": label[1]})
    found.sort(key=lambda item: item["date"])
    return found


def sync(years, today=None):
    """지정한 연도를 조회해 보관합니다. 이미 보관된 연도는 다시 부르지 않습니다."""
    from .event_import import _atomic_write
    raw, document = _cache()
    limit = (today or date.today()).year + MAX_AHEAD
    added = []
    for year in years:
        if not MIN_YEAR <= year <= limit:
            continue
        if str(year) in document["years"]:
            continue
        document["years"][str(year)] = {"fetched_at": (today or date.today()).isoformat(),
                                        "days": _fetch(year)}
        added.append(year)
    if added:
        if raw:
            _atomic_write(CACHE_PATH, raw, document)
        else:
            CACHE_PATH.write_text(json.dumps(document, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return added


def _events(year, days):
    """연속된 같은 묶음의 날짜를 하나의 일정으로 합칩니다."""
    events, run = [], []

    def flush():
        if not run:
            return
        start, end = run[0]["date"], run[-1]["date"]
        label, group = run[0]["label"], run[0]["group"]
        events.append({
            "event_id": "auto_vn_%s_%s" % (group, year),
            "name": label + " (예정)",
            "official_name": label,
            "start_date": start,
            "end_date": end,
            "type": "holiday",
            "region": "베트남 전국",
            "applies_to": "법정 공휴일. 실제 연휴 기간은 정부 공문으로 확정됩니다.",
            "date_precision": "day",
            "is_demo": False,
            "provisional": True,
            "verification_status": "unverified",
            "registration_status": "auto",
            "source_name": SOURCE_NAME,
            "description": "법으로 정해진 공휴일입니다. 대체휴일·보상근무일이 더해질 수 있어 실제 쉬는 기간은 달라집니다.",
            "verification_notes": "제공업체 자료만으로 표시한 미확정 일정입니다. 정부 공문을 확인해 등록하면 이 표시는 사라집니다.",
        })
        run.clear()

    for day in days:
        if run and run[-1]["group"] == day["group"] and \
                date.fromisoformat(day["date"]) - date.fromisoformat(run[-1]["date"]) == timedelta(days=1):
            run.append(day)
            continue
        flush()
        run.append(day)
    flush()
    return events


def provisional(start, end, registered):
    """조회 기간에 걸치는 미확정 공휴일을 돌려줍니다. 등록된 일정과 겹치면 뺍니다."""
    from .event_import import ReviewError
    try:
        _, document = _cache()
    except ReviewError:
        return []
    taken = set()
    for row in registered:
        first, last = date.fromisoformat(row["start_date"]), date.fromisoformat(row["end_date"])
        while first <= last:
            taken.add(first.isoformat())
            first += timedelta(days=1)
    rows = []
    for year in range(start.year, end.year + 1):
        stored = document["years"].get(str(year))
        if not isinstance(stored, dict) or not isinstance(stored.get("days"), list):
            continue
        for event in _events(year, stored["days"]):
            if event["start_date"] > end.isoformat() or event["end_date"] < start.isoformat():
                continue
            # 사람이 확인해 등록한 날짜가 있으면 그쪽만 보여 줍니다. 같은 날이 두 번 나오지 않게 합니다.
            span, cursor = [], date.fromisoformat(event["start_date"])
            while cursor <= date.fromisoformat(event["end_date"]):
                span.append(cursor.isoformat())
                cursor += timedelta(days=1)
            if any(day in taken for day in span):
                continue
            rows.append(event)
    return rows
