"""HOME 화면·API. [주연]

API는 /home/api/... 아래에만 추가합니다. 다른 기능 데이터는 그 기능의 public.py로만 읽습니다. (README 8장)
"""
import json
from datetime import date
from pathlib import Path
from urllib.parse import urlsplit

from flask import jsonify, render_template, request

from . import bp

_EVENTS_PATH = Path(__file__).parent / "data" / "events.json"


def _load_events(start, end):
    """HOME 관리 일정만 읽습니다. 보류 후보 파일은 읽지 않습니다.

    문법·필드 검사는 출처의 사실성을 자동 보증하지 않습니다.
    자료 검증·등록 승인은 HOME 담당자가 별도로 수행합니다.
    한 건이라도 잘못되면 목록 전체를 실패로 처리해 조용한 누락을 막습니다.
    """
    document = json.loads(_EVENTS_PATH.read_text(encoding="utf-8"))
    if not isinstance(document, dict) or document.get("schema_version") != 1:
        raise ValueError("지원하지 않는 일정 자료 형식")
    rows = document.get("events")
    if not isinstance(rows, list):
        raise ValueError("일정 목록 필요")
    seen = set()
    result = []
    for row in rows:
        if not isinstance(row, dict):
            raise ValueError("일정 객체 필요")
        required = ("event_id", "name", "official_name", "region", "applies_to",
                    "description", "schedule_nature", "original_period", "verification_notes")
        if any(not isinstance(row.get(key), str) or not row[key].strip() for key in required):
            raise ValueError("필수 일정 필드 누락")
        if row["event_id"] in seen:
            raise ValueError("중복 일정 ID")
        seen.add(row["event_id"])
        if (row.get("country") != "VN" or row.get("is_demo") is not False
                or row.get("date_precision") != "day"
                or row.get("verification_status") != "verified"
                or row.get("registration_status") != "approved"
                or row.get("type") not in {"holiday", "anniversary", "regional_event", "fruit_season"}
                or row.get("event_status") not in {"scheduled", "not_applicable"}):
            raise ValueError("등록 불가 일정")
        dates = {}
        for key in ("start_date", "end_date", "verified_at"):
            value = row.get(key)
            if not isinstance(value, str):
                raise ValueError("날짜 문자열 필요")
            dates[key] = date.fromisoformat(value)
            if dates[key].isoformat() != value:
                raise ValueError("YYYY-MM-DD 필요")
        if dates["end_date"] < dates["start_date"] or row.get("year") != dates["start_date"].year:
            raise ValueError("일정 기간·연도 불일치")
        sources = row.get("sources")
        if not isinstance(sources, list) or len(sources) < 2:
            raise ValueError("검증 출처 부족")
        roles, urls = set(), set()
        for source in sources:
            if not isinstance(source, dict):
                raise ValueError("출처 객체 필요")
            if any(not isinstance(source.get(key), str) or not source[key].strip()
                   for key in ("publisher", "title", "url", "supports")):
                raise ValueError("출처 필드 누락")
            url = urlsplit(source["url"])
            if url.scheme != "https" or not url.hostname or url.username or url.password:
                raise ValueError("HTTPS 원문 주소 필요")
            roles.add(source.get("role"))
            urls.add(source["url"])
        if len(urls) < 2 or not {"primary", "independent_corrob"} <= roles:
            raise ValueError("교차 검증 근거 부족")
        if dates["start_date"] <= end and dates["end_date"] >= start:
            result.append(row)
    return sorted(result, key=lambda row: (row["start_date"], row["event_id"]))


@bp.route("/")
def index():
    return render_template("home/home_index.html")


@bp.get("/api/signals")
def signals():
    """일정은 HOME 파일, 뉴스·협업은 기존 공개 함수에서 읽습니다. DB에는 쓰지 않습니다."""
    try:
        start = date.fromisoformat(request.args.get("start", ""))
        end = date.fromisoformat(request.args.get("end", ""))
        if end < start or end.year - start.year > 5:
            raise ValueError
    except ValueError:
        return jsonify(error="조회 기간은 시작일 이후, 최대 5년 범위로 입력해주세요."), 400

    result = {}

    def read(name, callback):
        try:
            rows = callback()
            if not isinstance(rows, list) or not all(isinstance(row, dict) for row in rows):
                raise TypeError("공개 함수의 목록 응답이 필요합니다.")
            result[name] = {"state": "ok", "items": rows}
        except Exception:
            # 예외 내용에는 원본 자료가 들어갈 수 있어 응답·로그에 내보내지 않습니다.
            result[name] = {"state": "error", "items": []}

    def events():
        return _load_events(start, end)

    def news():
        from market_analysis.public import get_news_summary
        return get_news_summary(country="VN", limit=3)

    def collaborations():
        from influencer_marketing.public import get_collaborations
        return get_collaborations(include_demo=False)

    def tasks():
        from influencer_marketing.public import get_today_tasks
        return get_today_tasks(limit=10, include_demo=False)

    read("events", events)
    read("news", news)
    read("collaborations", collaborations)
    read("attention", tasks)
    return jsonify(result)
