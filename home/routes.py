"""HOME 화면·API. [주연]

API는 /home/api/... 아래에만 추가합니다. 다른 기능 데이터는 그 기능의 public.py로만 읽습니다. (README 8장)
"""
import calendar
import json
from datetime import date
from pathlib import Path
from urllib.parse import urlsplit

from flask import jsonify, render_template, request

from . import bp

_EVENTS_PATH = Path(__file__).parent / "data" / "events.json"
_NEWS_PATH = Path(__file__).parent / "data" / "news.json"


def _load_events(start, end):
    """HOME 관리 일정만 읽습니다. 보류 후보 파일은 읽지 않습니다.

    문법·필드 검사는 출처의 사실성을 자동 보증하지 않습니다.
    자료 검증·등록 승인은 HOME 담당자가 별도로 수행합니다.
    한 건이라도 잘못되면 목록 전체를 실패로 처리해 조용한 누락을 막습니다.
    """
    document = json.loads(_EVENTS_PATH.read_text(encoding="utf-8"))
    rows = _validate_event_document(document)
    return sorted(
        (row for row in rows if row["start_date"] <= end.isoformat() and row["end_date"] >= start.isoformat()),
        key=lambda row: (row["start_date"], row["event_id"]),
    )


def _validate_event_document(document):
    """조회와 관리 명령이 공유하는 형식 검사. 원문의 진실성 검증은 담당자가 수행합니다."""
    if not isinstance(document, dict) or document.get("schema_version") != 1:
        raise ValueError("지원하지 않는 일정 자료 형식")
    rows = document.get("events")
    if not isinstance(rows, list):
        raise ValueError("일정 목록 필요")
    seen = set()
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
                or row.get("date_precision") not in {"day", "month"}
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
        if row["date_precision"] == "month":
            # 월 단위 자료는 과일 시즌만 허용하고, 달 경계에 맞지 않는 날짜는 거부합니다.
            # 원문이 월까지만 밝힌 기간에 임의의 시작일·종료일을 붙이지 않기 위해서입니다.
            end = dates["end_date"]
            if (row["type"] != "fruit_season" or dates["start_date"].day != 1
                    or end.day != calendar.monthrange(end.year, end.month)[1]):
                raise ValueError("월 단위는 과일 시즌의 달 경계 기간만 허용")
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
    return rows


def _load_news():
    """담당자가 검증·승인한 뉴스만 최대 3건 읽습니다. 수집·사실 판정은 하지 않습니다."""
    document = json.loads(_NEWS_PATH.read_text(encoding="utf-8"))
    if not isinstance(document, dict) or document.get("schema_version") != 1:
        raise ValueError("지원하지 않는 뉴스 자료 형식")
    rows = document.get("news")
    if not isinstance(rows, list):
        raise ValueError("뉴스 목록 필요")
    result, seen = [], set()
    for row in rows:
        if not isinstance(row, dict):
            raise ValueError("뉴스 객체 필요")
        if row.get("verification_status") != "verified" or row.get("registration_status") != "approved":
            continue
        required = ("news_id", "title", "summary", "region", "source", "url", "verification_notes")
        if any(not isinstance(row.get(key), str) or not row[key].strip() for key in required):
            raise ValueError("필수 뉴스 필드 누락")
        if row["news_id"] in seen:
            raise ValueError("중복 뉴스 ID")
        seen.add(row["news_id"])
        if row.get("country") != "VN" or row.get("is_demo") is not False:
            raise ValueError("실제 베트남 자료 필요")
        for key in ("published_at", "verified_at"):
            value = row.get(key)
            if not isinstance(value, str) or date.fromisoformat(value).isoformat() != value:
                raise ValueError("YYYY-MM-DD 필요")
        if row["verified_at"] < row["published_at"]:
            raise ValueError("발행일보다 앞선 확인일")
        if "suggestion" in row and not isinstance(row["suggestion"], str):
            raise ValueError("적용 제안 문자열 필요")
        sources = row.get("sources")
        if not isinstance(sources, list) or len(sources) < 2:
            raise ValueError("뉴스 검증 출처 부족")
        urls, roles = set(), set()
        for source in sources:
            if not isinstance(source, dict) or any(
                not isinstance(source.get(key), str) or not source[key].strip()
                for key in ("publisher", "title", "url", "supports", "role")
            ):
                raise ValueError("출처 필드 누락")
            url = urlsplit(source["url"])
            if url.scheme != "https" or not url.hostname or url.username or url.password:
                raise ValueError("HTTPS 원문 주소 필요")
            urls.add(source["url"])
            roles.add(source["role"])
        if row["url"] not in urls or len(urls) < 2 or not {"primary", "independent_corrob"} <= roles:
            raise ValueError("뉴스 교차 검증 근거 부족")
        result.append(row)
    return sorted(result, key=lambda row: (row["published_at"], row["news_id"]), reverse=True)[:3]


@bp.route("/")
def index():
    return render_template("home/home_index.html")


@bp.get("/api/signals")
def signals():
    """일정·뉴스는 HOME 파일, 협업은 기존 공개 함수에서 읽습니다. DB에는 쓰지 않습니다."""
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
        return _load_news()

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
