"""HOME 일정 수동 수집·검토·등록 명령. [주연]

python -B -m home.event_import --help
.env를 읽지 않으며 공통 앱·DB를 초기화하지 않습니다.
출처 내용의 진실성은 사람이 확인합니다. URL·체크값만으로 사실을 인증하지 않습니다.
"""
import argparse
from copy import deepcopy
from datetime import date
import hashlib
import json
import os
from pathlib import Path
import tempfile
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode, urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener

from .routes import _validate_event_document

DATA = Path(__file__).parent / "data"
CANDIDATES_PATH = DATA / "event_candidates.json"
EVENTS_PATH = DATA / "events.json"
REVIEW_CHECKS = (
    "originals_opened", "dates_match", "scope_match", "independent_sources",
    "latest_notice_checked", "conflicts_resolved",
)
REVIEW_NOTES = ("reviewed_by", "comparison_notes", "independence_notes", "latest_notice_result")


class ReviewError(Exception):
    """비밀값이나 외부 응답을 포함하지 않는 관리용 오류."""


def _print(value):
    print(json.dumps(value, ensure_ascii=False, indent=2))


def _snapshot(path):
    raw = path.read_bytes()
    return raw, json.loads(raw.decode("utf-8-sig"))


def _candidate_document(document):
    if (not isinstance(document, dict) or document.get("schema_version") != 1
            or document.get("calendar_eligible") is not False
            or not isinstance(document.get("candidates"), list)):
        raise ReviewError("후보 파일 형식을 확인해주세요.")
    ids = [c.get("candidate_id") for c in document["candidates"] if isinstance(c, dict)]
    if (len(ids) != len(document["candidates"]) or any(not isinstance(i, str) or not i for i in ids)
            or len(ids) != len(set(ids))):
        raise ReviewError("후보 ID 누락·중복을 확인해주세요.")


def _no_secrets(value):
    """등록 근거에 API 인증값·Calendarific 조회 주소를 저장하지 않습니다."""
    if isinstance(value, dict):
        for key, item in value.items():
            if any(part in key.lower() for part in ("api_key", "apikey", "secret", "password", "access_token")):
                raise ReviewError("등록 자료에 인증값 필드를 넣을 수 없습니다.")
            _no_secrets(item)
    elif isinstance(value, list):
        for item in value:
            _no_secrets(item)
    elif isinstance(value, str):
        lower = value.lower()
        if any(part in lower for part in ("api_key=", "apikey=", "access_token=", "calendarific.com/api/")):
            raise ReviewError("인증값이나 API 호출 주소를 자료에 넣을 수 없습니다.")


def reviewed_event(candidate):
    """사람이 작성한 검증 기록을 검사하고 등록 미리보기용 복사본을 반환합니다."""
    _no_secrets(candidate)
    if (not isinstance(candidate, dict) or candidate.get("verification_status") != "verified"
            or candidate.get("registration_status") != "pending_approval"):
        raise ReviewError("검증 완료·등록 승인 대기 후보만 등록할 수 있습니다.")
    event, review = candidate.get("event"), candidate.get("review")
    if not isinstance(event, dict) or not isinstance(review, dict):
        raise ReviewError("event와 review 검증 기록이 필요합니다.")
    if any(review.get(key) is not True for key in REVIEW_CHECKS):
        raise ReviewError("원문·날짜·범위·독립성·최신 공지·불일치 확인이 모두 필요합니다.")
    if any(not isinstance(review.get(key), str) or not review[key].strip() for key in REVIEW_NOTES):
        raise ReviewError("검토자와 비교·독립성·최신 공지 확인 메모가 필요합니다.")
    verified = date.fromisoformat(event.get("verified_at", ""))
    if verified > date.today() or review.get("reviewed_at") != verified.isoformat():
        raise ReviewError("실제 검토일과 확인일이 같아야 하며 미래일일 수 없습니다.")
    if event.get("verification_status") != "verified" or event.get("registration_status") != "pending_approval":
        raise ReviewError("event에도 검증 완료·등록 승인 대기 상태가 필요합니다.")
    result = deepcopy(event)
    result["registration_status"] = "approved"
    _validate_event_document({"schema_version": 1, "events": [result]})
    if result["type"] in {"holiday", "anniversary"}:
        primary = [s for s in result["sources"] if s.get("role") == "primary"]
        if not any((urlsplit(s["url"]).hostname or "").endswith(".gov.vn") for s in primary):
            raise ReviewError("공휴일·기념일은 베트남 정부 원문 출처가 필요합니다.")
    return result


def _token(operation, *parts):
    digest = hashlib.sha256(operation.encode())
    for part in parts:
        digest.update(len(part).to_bytes(8, "big"))
        digest.update(part)
    return digest.hexdigest()


def _atomic_write(path, original, document):
    """같은 폴더의 임시 파일을 교체하고, 교체 직전 원본 변경을 검사합니다."""
    pending = None
    try:
        with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=path.parent,
                                         prefix=".home-event-", suffix=".tmp", delete=False) as stream:
            pending = Path(stream.name)
            json.dump(document, stream, ensure_ascii=False, indent=2)
            stream.write("\n")
            stream.flush()
            os.fsync(stream.fileno())
        if path.read_bytes() != original:
            raise ReviewError("파일이 다른 작업에서 변경되었습니다. 저장하지 않았습니다. 다시 미리보기하세요.")
        os.replace(pending, path)
    finally:
        if pending is not None:
            pending.unlink(missing_ok=True)


def _confirm(token, supplied):
    if supplied is None:
        return False
    if supplied != token:
        raise ReviewError("미리보기 이후 입력·후보·등록 자료가 변경되었습니다. 새 토큰으로 다시 확인하세요.")
    return True


def stage(input_path, confirm=None):
    """정부·독립 원문을 대조한 사람이 작성한 JSON만 후보 파일에 추가합니다."""
    path = Path(input_path)
    if path.suffix.lower() != ".json":
        raise ReviewError("검토 입력은 JSON 파일만 허용합니다. .env는 읽지 않습니다.")
    input_raw, candidate = _snapshot(path)
    reviewed_event(candidate)
    if not isinstance(candidate.get("candidate_id"), str) or not candidate["candidate_id"].strip():
        raise ReviewError("candidate_id가 필요합니다.")
    raw, document = _snapshot(CANDIDATES_PATH)
    _candidate_document(document)
    if any(c["candidate_id"] == candidate["candidate_id"] for c in document["candidates"]):
        raise ReviewError("같은 후보 ID가 이미 있습니다. 기존 기록을 덮어쓰지 않습니다.")
    token = _token("stage", raw, input_raw)
    _print({"operation": "stage", "candidate": candidate, "confirmation_token": token,
            "notice": "형식 검사 통과. 원문 사실성은 담당자가 확인해야 합니다. 캘린더에는 등록되지 않습니다."})
    if _confirm(token, confirm):
        document["candidates"].append(candidate)
        _atomic_write(CANDIDATES_PATH, raw, document)
        _print({"saved": "candidate_only", "candidate_id": candidate["candidate_id"]})


def register(candidate_id, confirm=None):
    candidate_raw, candidates = _snapshot(CANDIDATES_PATH)
    _candidate_document(candidates)
    matches = [c for c in candidates["candidates"] if c["candidate_id"] == candidate_id]
    if len(matches) != 1:
        raise ReviewError("등록할 후보 ID를 확인해주세요.")
    event = reviewed_event(matches[0])
    raw, document = _snapshot(EVENTS_PATH)
    _validate_event_document(document)
    if any(e["event_id"] == event["event_id"] or (
        e["official_name"].strip().casefold() == event["official_name"].strip().casefold()
        and e["start_date"] == event["start_date"] and e["end_date"] == event["end_date"]
        and e["region"] == event["region"] and e["applies_to"] == event["applies_to"]
    ) for e in document["events"]):
        raise ReviewError("같은 ID 또는 동일 명칭·기간·범위의 일정이 이미 있습니다. 덮어쓰지 않습니다.")
    token = _token("register", raw, candidate_raw, candidate_id.encode())
    _print({"operation": "register", "event": event, "confirmation_token": token,
            "notice": "등록 미리보기입니다. 승인 후 같은 명령에 --confirm 토큰을 지정하세요."})
    if _confirm(token, confirm):
        document["events"].append(event)
        _validate_event_document(document)
        if CANDIDATES_PATH.read_bytes() != candidate_raw:
            raise ReviewError("검토 후보가 변경되었습니다. 저장하지 않았습니다.")
        _atomic_write(EVENTS_PATH, raw, document)
        _print({"saved": "calendar_event", "event_id": event["event_id"]})


def classify(types):
    """제공업체의 유형은 임시 분류입니다. 최종 유형·휴무 여부를 확정하지 않습니다."""
    if not isinstance(types, list) or not all(isinstance(t, str) for t in types):
        return "review_required"
    labels = {t.casefold().strip() for t in types}
    # 근무일·지역 휴일·종교일 등은 별도 확인이 필요하므로 자동 공휴일 처리하지 않습니다.
    if labels and labels <= {"national holiday", "public holiday"}:
        return "holiday_candidate"
    if labels == {"observance"}:
        return "anniversary_candidate"
    if labels and labels <= {"season", "clock change/daylight saving time"}:
        return "excluded_from_marketing_calendar"
    return "review_required"


class _NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def collect(year, request_api=False):
    if not request_api:
        raise ReviewError("실제 호출에는 --request-api가 필요합니다. 추가 호출 승인을 먼저 확인하세요.")
    key = os.environ.get("CALENDARIFIC_API_KEY", "").strip()
    if not key:
        raise ReviewError("실행 환경에 CALENDARIFIC_API_KEY가 없습니다. .env를 직접 읽지 않습니다.")
    request = Request("https://calendarific.com/api/v2/holidays?" + urlencode(
        {"api_key": key, "country": "VN", "year": year}), headers={"Accept": "application/json"})
    try:
        with build_opener(_NoRedirect()).open(request, timeout=25) as response:
            payload = json.loads(response.read(4_000_001))
    except HTTPError as error:
        status = error.code
        error.close()
        if status == 429:
            raise ReviewError("무료 호출 한도에 도달했습니다. 재시도·유료 전환 없이 중단합니다.") from None
        raise ReviewError("API가 요청을 거절했습니다. 주소·키·원본 오류는 출력하지 않습니다.") from None
    except (URLError, TimeoutError, OSError, ValueError):
        raise ReviewError("API 통신·응답 처리 실패. 재시도하지 않으며 오류 상세는 숨깁니다.") from None
    if not isinstance(payload, dict) or payload.get("meta", {}).get("code") != 200:
        raise ReviewError("API가 정상 자료 응답을 반환하지 않았습니다.")
    rows = payload.get("response", {}).get("holidays")
    if not isinstance(rows, list):
        raise ReviewError("API 일정 목록 형식을 확인할 수 없습니다.")
    preview = []
    for row in rows:
        if not isinstance(row, dict):
            raise ReviewError("API 일정 항목 형식 오류입니다.")
        name, types = row.get("name"), row.get("type")
        country, calendar_date = row.get("country"), row.get("date")
        if (not isinstance(name, str) or not isinstance(country, dict)
                or str(country.get("id", "")).casefold() != "vn"
                or not isinstance(calendar_date, dict)):
            raise ReviewError("베트남 일정의 필수 항목을 확인할 수 없습니다.")
        value = calendar_date.get("iso", "")
        try:
            valid = date.fromisoformat(value)
        except (ValueError, TypeError):
            raise ReviewError("API 날짜 형식 오류입니다.") from None
        if valid.year != year or valid.isoformat() != value:
            raise ReviewError("요청 연도와 API 날짜가 일치하지 않습니다.")
        preview.append({"provider_name": name.replace(key, "[REDACTED]"), "provider_date": value,
                        "provisional_classification": classify(types),
                        "verification_status": "unverified", "calendar_eligible": False})
    _print({"country": "VN", "year": year, "count": len(preview), "items": preview,
            "notice": "API 1회 호출 결과의 임시 분류. 파일 저장·원문 검증·캘린더 등록은 하지 않았습니다."})


def main(argv=None):
    parser = argparse.ArgumentParser(description="HOME 일정 후보 수집·검토·승인 등록 (자동 사실 검증 아님)")
    commands = parser.add_subparsers(dest="command", required=True)
    fetch = commands.add_parser("collect", help="베트남 일정 1회 조회·분류 미리보기. 원본 저장 없음")
    fetch.add_argument("--year", type=int, required=True)
    fetch.add_argument("--request-api", action="store_true")
    prepare = commands.add_parser("stage", help="사람이 검증한 입력 JSON을 후보에 추가. 기본은 미리보기")
    prepare.add_argument("--input", required=True)
    prepare.add_argument("--confirm")
    approve = commands.add_parser("register", help="검토 완료 후보를 캘린더에 추가. 기본은 미리보기")
    approve.add_argument("--candidate-id", required=True)
    approve.add_argument("--confirm")
    args = parser.parse_args(argv)
    try:
        if args.command == "collect":
            if not 1900 <= args.year <= 2100:
                raise ReviewError("연도는 1900~2100 범위여야 합니다. 무료 계정의 제공 범위는 별도 확인이 필요합니다.")
            collect(args.year, args.request_api)
        elif args.command == "stage":
            stage(args.input, args.confirm)
        else:
            register(args.candidate_id, args.confirm)
    except ReviewError as error:
        print(str(error))
        return 1
    except (OSError, ValueError, TypeError, KeyError, AttributeError):
        print("파일·입력·응답 형식에 오류가 있습니다. 자료와 키 보호를 위해 오류 상세는 표시하지 않습니다.")
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
