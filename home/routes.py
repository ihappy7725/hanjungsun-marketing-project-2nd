"""HOME 화면·API. [주연]

API는 /home/api/... 아래에만 추가합니다. 다른 기능 데이터는 그 기능의 public.py로만 읽습니다. (README 8장)
"""
import calendar
import hashlib
import json
from datetime import date, datetime, timedelta
from functools import wraps
from pathlib import Path
from urllib.parse import urlsplit

from flask import current_app, jsonify, render_template, request
from itsdangerous import BadSignature, SignatureExpired, URLSafeTimedSerializer
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from sqlalchemy.orm.exc import StaleDataError

from platform_core.extensions import db

from . import bp
from .holiday_feed import provisional
from .models import TASK_CATEGORIES, HomeCampaign, HomeCampaignCollaborationLink, HomeSchedule, HomeTask
from .news_search import SearchError, preset_labels, search
from .translate import TARGETS, available, translate_titles

_EVENTS_PATH = Path(__file__).parent / "data" / "events.json"
_NEWS_PATH = Path(__file__).parent / "data" / "news.json"

# 브라우저 업무 전용 API. 현지 일정·뉴스 원본 API와 구분합니다.
_WORK_MODELS = {
    "campaigns": HomeCampaign, "tasks": HomeTask,
    "schedules": HomeSchedule, "links": HomeCampaignCollaborationLink,
}
_WORK_STATES = {
    "campaigns": {"preparing", "active", "done", "blocked", "cancelled", "archived"},
    "tasks": {"todo", "doing", "blocked", "done", "cancelled"},
}
_WORK_TABS = {"", "market_analysis", "content_studio", "influencer_marketing", "kpi"}


class _WorkInputError(Exception):
    def __init__(self, message, status=400):
        super().__init__(message)
        self.status = status


def _work_api(callback):
    """저장 실패를 빈 정상 결과로 바꾸지 않고, 원본·SQL을 노출하지 않습니다."""
    @wraps(callback)
    def wrapped(*args, **kwargs):
        try:
            result = callback(*args, **kwargs)
        except _WorkInputError as error:
            db.session.rollback()
            result = jsonify(error=str(error)), error.status
        except (IntegrityError, StaleDataError):
            db.session.rollback()
            result = jsonify(error="같은 기록의 추가 또는 다른 화면의 변경과 겹쳤습니다. 새로고침해주세요."), 409
        except SQLAlchemyError:
            db.session.rollback()
            result = jsonify(error="저장소에 연결하지 못했습니다. DB 준비 상태를 확인해주세요. 기록은 저장하지 않았습니다."), 503
        # 업무 응답을 브라우저·중간 캐시에 보관하지 않습니다.
        from flask import make_response
        response = make_response(result)
        response.headers["Cache-Control"] = "no-store"
        return response
    return wrapped


def _work_model(resource):
    model = _WORK_MODELS.get(resource)
    if model is None:
        raise _WorkInputError("지원하지 않는 업무 자료 종류입니다.", 404)
    return model


def _work_fields(model):
    return {column.name for column in model.__table__.columns} - {"revision", "import_batch_id"}


def _work_item(row):
    result = {}
    for field in _work_fields(type(row)) | {"revision"}:
        value = getattr(row, field)
        result[field] = value.isoformat() if isinstance(value, date) else value
    return result


def _work_body(max_bytes=128 * 1024):
    # JSON 요청만 받습니다. 다른 사이트가 보내는 저장 요청도 거부합니다.
    origin = request.headers.get("Origin")
    if ((origin and urlsplit(origin)[:2] != urlsplit(request.host_url)[:2])
            or request.headers.get("Sec-Fetch-Site") == "cross-site"):
        raise _WorkInputError("이 대시보드에서 보낸 저장 요청만 처리할 수 있습니다.", 403)
    if not request.is_json:
        raise _WorkInputError("JSON 형식으로 보내주세요.", 415)
    if request.content_length is None or request.content_length > max_bytes:
        raise _WorkInputError("저장 요청이 너무 크거나 크기를 확인할 수 없습니다.", 413)
    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        raise _WorkInputError("기록 한 건을 JSON 객체로 보내주세요.")
    return data


def _work_validate(resource, data, row=None, campaign_ids=None):
    model = _work_model(resource)
    fields = _work_fields(model)
    allowed = fields | ({"revision"} if row is not None else set())
    if data.keys() - allowed:
        raise _WorkInputError("지원하지 않는 저장 항목이 있습니다. 기록을 확인해주세요.")
    primary_keys = {column.name for column in model.__table__.primary_key}
    if row is not None:
        revision = data.get("revision")
        if type(revision) is not int or revision < 1:
            raise _WorkInputError("수정 전 기록의 수정 번호(revision)가 필요합니다.")
        if revision != row.revision:
            raise _WorkInputError("다른 화면에서 기록이 바뀌었습니다. 새로고침 후 다시 수정해주세요.", 409)
        if primary_keys & data.keys():
            raise _WorkInputError("기록 ID는 바꿀 수 없습니다.")
        if not data.keys() - {"revision"}:
            raise _WorkInputError("수정할 항목이 없습니다.")
        values = {field: getattr(row, field) for field in fields}
    else:
        values = {
            column.name: column.default.arg if column.default is not None else None
            for column in model.__table__.columns if column.name in fields
        }
    values.update({key: value for key, value in data.items() if key in fields})
    for field in fields:
        value = values[field]
        column = model.__table__.columns[field]
        if isinstance(column.type, db.Date):
            if value in (None, "") and column.nullable:
                values[field] = None
                continue
            if isinstance(value, str):
                try:
                    parsed = date.fromisoformat(value)
                except ValueError:
                    raise _WorkInputError(f"{field}: YYYY-MM-DD 형식의 실제 날짜를 입력해주세요.") from None
                if parsed.isoformat() != value:
                    raise _WorkInputError(f"{field}: YYYY-MM-DD 형식으로 입력해주세요.")
                values[field] = parsed
            elif type(value) is not date:
                raise _WorkInputError(f"{field}: 날짜가 필요합니다.")
        elif isinstance(column.type, db.Boolean):
            if type(value) is not bool:
                raise _WorkInputError(f"{field}: 참 또는 거짓 값이 필요합니다.")
        elif isinstance(column.type, db.Integer):
            if type(value) is not int or not -(2 ** 31) <= value < 2 ** 31:
                raise _WorkInputError(f"{field}: 정수가 필요합니다.")
        else:
            if value is None and column.nullable:
                continue
            limit = column.type.length or (3000 if field == "memo" else 10000)
            if not isinstance(value, str) or len(value) > limit:
                raise _WorkInputError(f"{field}: {limit}자 이내의 문자열이 필요합니다.")
            if field in primary_keys | {"campaign_id", "collaboration_id"}:
                if not value.strip() or value != value.strip() or "/" in value:
                    raise _WorkInputError(f"{field}: 비어 있지 않은 ID가 필요합니다.")
    if resource in _WORK_STATES and values["status"] not in _WORK_STATES[resource]:
        raise _WorkInputError("지원하지 않는 상태입니다.")
    if resource == "campaigns" and not values["name"].strip():
        raise _WorkInputError("이벤트 이름을 입력해주세요.")
    if resource == "tasks":
        if values["category"] not in TASK_CATEGORIES:
            raise _WorkInputError("업무 종류를 확인해주세요. 미지정·조사·콘텐츠·협업·회의·기타 중 선택할 수 있습니다.")
        if not values["title"].strip() or values["importance"] not in {"normal", "high"}:
            raise _WorkInputError("업무명과 중요도를 확인해주세요.")
        if values["related_tab"] not in _WORK_TABS:
            raise _WorkInputError("관련 탭을 확인해주세요.")
        if values["start_date"] and values["due_date"] and values["start_date"] > values["due_date"]:
            raise _WorkInputError("시작일이 마감일보다 늦습니다.")
        due_time = values["due_time"]
        if due_time:
            try:
                parsed = datetime.strptime(due_time, "%H:%M")
            except ValueError:
                raise _WorkInputError("시간은 00:00~23:59 범위로 입력해주세요.") from None
            if parsed.strftime("%H:%M") != due_time:
                raise _WorkInputError("시간은 HH:MM 형식으로 입력해주세요.")
        if values["completed_at"]:
            try:
                completed = datetime.fromisoformat(values["completed_at"].replace("Z", "+00:00"))
                if completed.utcoffset() != timedelta(0):
                    raise ValueError
            except ValueError:
                raise _WorkInputError("완료 시각은 시간대가 포함된 UTC ISO 형식으로 보내주세요.") from None
    if resource == "schedules" and not (values["title"].strip() or values["name"].strip()):
        raise _WorkInputError("일정 이름을 입력해주세요.")
    campaign_id = values.get("campaign_id")
    if (campaign_id is not None and campaign_id not in (campaign_ids or set())
            and db.session.get(HomeCampaign, campaign_id) is None):
        raise _WorkInputError("연결할 이벤트가 없습니다. 이벤트를 먼저 저장해주세요.")
    return values


@bp.route("/api/work/<resource>", methods=["GET", "POST"])
@_work_api
def work_records(resource):
    """실제 HOME 업무의 목록 조회·한 건 추가. 예시 및 브라우저 이관은 다루지 않습니다."""
    model = _work_model(resource)
    if request.method == "GET":
        if request.args.keys() - {"campaign_id"}:
            raise _WorkInputError("지원하지 않는 조회 조건입니다.")
        query = db.select(model)
        if "campaign_id" in request.args:
            if resource == "campaigns":
                raise _WorkInputError("이벤트 목록에는 campaign_id 조건을 사용할 수 없습니다.")
            query = query.where(model.campaign_id == request.args["campaign_id"])
        query = query.order_by(*model.__table__.primary_key.columns)
        rows = db.session.execute(query).scalars().all()
        return jsonify(items=[_work_item(row) for row in rows])
    values = _work_validate(resource, _work_body())
    identity = tuple(values[column.name] for column in model.__table__.primary_key)
    if db.session.get(model, identity) is not None:
        raise _WorkInputError("이미 같은 ID의 기록이 있습니다. 기존 기록은 바꾸지 않았습니다.", 409)
    row = model(**values)
    db.session.add(row)
    db.session.flush()
    item = _work_item(row)
    db.session.commit()
    return jsonify(item=item), 201


@bp.patch("/api/work/<resource>/<record_id>")
@_work_api
def update_work_record(resource, record_id):
    """수정 번호가 일치할 때만 한 건 수정합니다. ID와 이관 표시는 수정하지 않습니다."""
    model = _work_model(resource)
    if resource == "links":
        raise _WorkInputError("협업 연결의 ID는 수정할 수 없습니다.", 405)
    data = _work_body()
    row = db.session.get(model, record_id)
    if row is None:
        raise _WorkInputError("수정할 기록이 없습니다.", 404)
    values = _work_validate(resource, data, row)
    for field, value in values.items():
        setattr(row, field, value)
    db.session.flush()
    item = _work_item(row)
    db.session.commit()
    return jsonify(item=item)


def _migration_digest(value):
    """내용은 기록하지 않고, 같은 내용인지 비교할 수 있는 확인값만 만듭니다."""
    encoded = json.dumps(value, ensure_ascii=True, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(encoded.encode("utf-8")).hexdigest()


def _migration_json(values):
    return {key: value.isoformat() if isinstance(value, date) else value
            for key, value in values.items()}


def _migration_records(backup):
    """기존 내보내기 형식을 검사합니다. 원본의 알 수 없는 필드는 버리지 않습니다."""
    if (not isinstance(backup, dict)
            or set(backup) != {"app", "format", "exported_at", "mode", "counts", "data"}
            or backup["app"] != "hanjeongseon-home"
            or type(backup["format"]) is not int or backup["format"] != 1):
        raise _WorkInputError("HOME의 ‘내보내기’로 저장한 백업 파일을 선택해주세요.")
    if backup["mode"] != "work":
        raise _WorkInputError("예시 데이터 (DEMO)는 서버로 옮길 수 없습니다. 내 업무 백업을 선택해주세요.")
    try:
        exported = datetime.fromisoformat(backup["exported_at"].replace("Z", "+00:00"))
        if exported.utcoffset() != timedelta(0):
            raise ValueError
    except (AttributeError, TypeError, ValueError):
        raise _WorkInputError("백업 파일의 저장 시각을 확인해주세요.") from None
    store = backup["data"]
    if (not isinstance(store, dict)
            or set(store) != {"version", "campaigns", "tasks", "schedules", "links", "preferences"}
            or type(store["version"]) is not int or store["version"] != 1
            or any(not isinstance(store[kind], list) for kind in _WORK_MODELS)):
        raise _WorkInputError("백업의 저장 형식이나 알 수 없는 항목을 확인해주세요. 기록은 버리지 않았습니다.")
    preferences = store["preferences"]
    if (not isinstance(preferences, dict)
            or preferences.keys() - {"selected", "preset", "range_start", "range_end"}
            or any(not isinstance(value, str) for value in preferences.values())):
        raise _WorkInputError("백업의 화면 설정을 확인해주세요. 알 수 없는 설정은 임의로 버리지 않습니다.")
    counts = backup["counts"]
    if (not isinstance(counts, dict) or set(counts) != {"campaigns", "tasks"}
            or any(type(counts[kind]) is not int or counts[kind] != len(store[kind])
                   for kind in counts)):
        raise _WorkInputError("백업에 적힌 기록 수와 실제 기록 수가 다릅니다.")
    if sum(len(store[kind]) for kind in _WORK_MODELS) > 5000:
        raise _WorkInputError("한 번에 옮길 수 있는 기록은 합계 5,000건입니다.", 413)
    campaign_ids = set()
    for row in store["campaigns"]:
        if not isinstance(row, dict) or not isinstance(row.get("id"), str):
            raise _WorkInputError("백업의 이벤트 ID를 확인해주세요.")
        campaign_ids.add(row["id"])
    records = {}
    for kind, model in _WORK_MODELS.items():
        records[kind], seen = [], set()
        for index, row in enumerate(store[kind], 1):
            if not isinstance(row, dict):
                raise _WorkInputError(f"{kind}의 {index}번째 기록이 올바른 형식이 아닙니다.")
            try:
                values = _work_validate(kind, row, campaign_ids=campaign_ids)
            except _WorkInputError as error:
                raise _WorkInputError(f"{kind}의 {index}번째 기록: {error}", error.status) from None
            identity = tuple(values[column.name] for column in model.__table__.primary_key)
            if identity in seen:
                raise _WorkInputError(f"{kind} 백업 안에 같은 ID가 두 번 있습니다.")
            seen.add(identity)
            records[kind].append(values)
        records[kind].sort(key=lambda row: tuple(row[c.name] for c in model.__table__.primary_key))
    return records


def _migration_comparison(records):
    counts, snapshot, additions = {}, {}, {}
    for kind, model in _WORK_MODELS.items():
        # 빈 백업이어도 실제 테이블 준비 여부를 확인합니다. 미준비를 성공으로 표시하지 않습니다.
        db.session.execute(db.select(model).limit(0))
        counts[kind] = {"new": 0, "same": 0, "conflict": 0}
        snapshot[kind], additions[kind] = [], []
        for values in records[kind]:
            identity = tuple(values[column.name] for column in model.__table__.primary_key)
            row = db.session.get(model, identity)
            if row is None:
                state, existing = "new", None
                additions[kind].append(values)
            else:
                existing = _work_item(row)
                content = {key: value for key, value in existing.items() if key != "revision"}
                state = "same" if content == _migration_json(values) else "conflict"
                existing["import_batch_id"] = row.import_batch_id
            counts[kind][state] += 1
            snapshot[kind].append({"id": identity, "existing": existing})
    return counts, _migration_digest(snapshot), additions


def _migration_signer():
    return URLSafeTimedSerializer(current_app.config["SECRET_KEY"], salt="home-browser-migration-v1")


def _store_signer():
    return URLSafeTimedSerializer(current_app.config["SECRET_KEY"], salt="home-work-store-v1")


def _store_snapshot():
    data, versions = {"version": 1}, {}
    for kind, model in _WORK_MODELS.items():
        rows = db.session.execute(db.select(model).order_by(*model.__table__.primary_key.columns)).scalars().all()
        data[kind], versions[kind] = [], []
        for row in rows:
            item = _work_item(row)
            versions[kind].append({**item, "import_batch_id": row.import_batch_id})
            data[kind].append({key: value for key, value in item.items() if key != "revision"})
    digest = _migration_digest(versions)
    return data, digest


@bp.route("/api/work/store", methods=["GET", "POST"])
@_work_api
def work_store():
    """화면의 한 동작을 모두 저장하거나 모두 취소합니다. 원본 이관과 별개입니다."""
    body = None if request.method == "GET" else _work_body(max_bytes=3 * 1024 * 1024)
    if body is not None and set(body) != {"token", "data", "delete_campaign_ids"}:
        raise _WorkInputError("저장 항목을 확인해주세요.")
    # SQLite에서 네 목록을 같은 시점으로 읽고, 저장 중에는 다른 쓰기를 막습니다.
    if db.engine.dialect.name == "sqlite":
        db.session.execute(db.text("BEGIN" if body is None else "BEGIN IMMEDIATE"))
    current, digest = _store_snapshot()
    if body is None:
        return jsonify(data=current, token=_store_signer().dumps({"snapshot": digest}), task_categories_enabled=True)
    if not isinstance(body["token"], str) or len(body["token"]) > 4096:
        raise _WorkInputError("저장 전 서버 기록을 먼저 불러와주세요.")
    try:
        checked = _store_signer().loads(body["token"], max_age=43200)
    except (BadSignature, SignatureExpired):
        raise _WorkInputError("저장 정보가 만료됐거나 바뀌었습니다. 새로고침해주세요.", 409) from None
    if not isinstance(checked, dict) or checked.get("snapshot") != digest:
        raise _WorkInputError("다른 화면에서 기록이 바뀌었습니다. 덮어쓰지 않도록 멈췄습니다. 새로고침해주세요.", 409)
    incoming = body["data"]
    if (not isinstance(incoming, dict) or set(incoming) != {"version", *_WORK_MODELS}
            or type(incoming["version"]) is not int or incoming["version"] != 1
            or any(not isinstance(incoming[kind], list) for kind in _WORK_MODELS)):
        raise _WorkInputError("저장할 기록의 형식을 확인해주세요.")
    if sum(len(incoming[kind]) for kind in _WORK_MODELS) > 5000:
        raise _WorkInputError("한 번에 저장할 수 있는 기록은 5,000건입니다.", 413)
    deleted = body["delete_campaign_ids"]
    if (not isinstance(deleted, list) or any(not isinstance(value, str) for value in deleted)
            or len(deleted) != len(set(deleted))):
        raise _WorkInputError("삭제를 확인한 이벤트 목록이 필요합니다.")
    campaign_ids = set()
    for row in incoming["campaigns"]:
        if not isinstance(row, dict) or not isinstance(row.get("id"), str):
            raise _WorkInputError("이벤트 ID를 확인해주세요.")
        campaign_ids.add(row["id"])
    previous_ids = {row["id"] for row in current["campaigns"]}
    if set(deleted) != previous_ids - campaign_ids:
        raise _WorkInputError("확인하지 않은 이벤트 삭제는 저장하지 않습니다.")
    normalized, old_by_id, new_by_id = {}, {}, {}
    for kind, model in _WORK_MODELS.items():
        def identity(row):
            return tuple(row[column.name] for column in model.__table__.primary_key)
        normalized[kind], new_by_id[kind] = [], {}
        old_by_id[kind] = {identity(row): row for row in current[kind]}
        for row in incoming[kind]:
            if not isinstance(row, dict):
                raise _WorkInputError("기록 한 건의 형식이 올바르지 않습니다.")
            values = _work_validate(kind, row, campaign_ids=campaign_ids)
            if values.get("campaign_id") is not None and values["campaign_id"] not in campaign_ids:
                raise _WorkInputError("저장할 이벤트에 연결되지 않은 업무·일정·협업이 있습니다.")
            key = identity(values)
            if key in new_by_id[kind]:
                raise _WorkInputError("같은 ID가 두 번 포함되어 있습니다.")
            new_by_id[kind][key] = values
            normalized[kind].append(values)
        for key in old_by_id[kind].keys() - new_by_id[kind].keys():
            previous = old_by_id[kind][key]
            if kind != "campaigns" and previous.get("campaign_id") not in deleted:
                raise _WorkInputError("확인한 이벤트에 속하지 않은 기록은 삭제할 수 없습니다.")
    # 새 부모를 먼저 추가하고, 남길 자식의 연결 변경을 적용한 뒤 삭제를 처리합니다.
    for kind, model in _WORK_MODELS.items():
        for values in normalized[kind]:
            key = tuple(values[column.name] for column in model.__table__.primary_key)
            row = db.session.get(model, key)
            if row is None:
                db.session.add(model(**values))
            else:
                for field, value in values.items():
                    setattr(row, field, value)
        db.session.flush()
    # 명시적으로 확인한 이벤트와 그 자식만 삭제합니다. 다른 탭은 조회·수정하지 않습니다.
    for kind in ("links", "schedules", "tasks", "campaigns"):
        model = _WORK_MODELS[kind]
        for key in old_by_id[kind].keys() - new_by_id[kind].keys():
            db.session.delete(db.session.get(model, key))
        db.session.flush()
    data, new_digest = _store_snapshot()
    token = _store_signer().dumps({"snapshot": new_digest})
    db.session.commit()
    return jsonify(data=data, token=token, task_categories_enabled=True)


@bp.post("/api/work/migration/preview")
@_work_api
def migration_preview():
    """미리보기는 검사·비교만 하며 기록을 추가하거나 수정하지 않습니다."""
    backup = _work_body(max_bytes=3 * 1024 * 1024)
    records = _migration_records(backup)
    counts, snapshot, _ = _migration_comparison(records)
    can_import = not any(row["conflict"] for row in counts.values())
    token = _migration_signer().dumps({"source": _migration_digest(backup), "snapshot": snapshot}) if can_import else None
    return jsonify(counts=counts, can_import=can_import, token=token, expires_in=1800,
                   notice="아직 옮기지 않았습니다. 같은 기록은 건너뛰며, 내용이 다르면 전체 작업을 멈춥니다.")


@bp.post("/api/work/migration/commit")
@_work_api
def migration_commit():
    """미리 본 파일·서버 상태가 일치할 때만 새 기록을 한 번에 저장합니다."""
    body = _work_body(max_bytes=3 * 1024 * 1024)
    if set(body) != {"backup", "token", "confirmed"} or body.get("confirmed") is not True:
        raise _WorkInputError("검사 결과를 확인한 뒤 옮기기를 승인해주세요.")
    if not isinstance(body["token"], str) or len(body["token"]) > 4096:
        raise _WorkInputError("먼저 백업 파일을 검사해주세요.")
    try:
        checked = _migration_signer().loads(body["token"], max_age=1800)
    except (BadSignature, SignatureExpired):
        raise _WorkInputError("검사 결과가 만료됐거나 바뀌었습니다. 파일을 다시 검사해주세요.", 409) from None
    if checked.get("source") != _migration_digest(body["backup"]):
        raise _WorkInputError("검사한 뒤 파일 내용이 바뀌었습니다. 다시 검사해주세요.", 409)
    # 공통 앱은 SQLite를 사용합니다. 비교부터 저장 완료까지 다른 쓰기를 막습니다.
    # 새 테이블 생성이나 기존 DB 구조 변경은 실행하지 않습니다.
    if db.engine.dialect.name == "sqlite":
        db.session.execute(db.text("BEGIN IMMEDIATE"))
    records = _migration_records(body["backup"])
    counts, snapshot, additions = _migration_comparison(records)
    if (snapshot != checked.get("snapshot")
            or any(row["conflict"] for row in counts.values())):
        raise _WorkInputError("검사 후 서버 기록이 바뀌었습니다. 덮어쓰지 않도록 멈췄습니다. 다시 검사해주세요.", 409)
    content = {kind: [_migration_json(row) for row in rows] for kind, rows in records.items()}
    batch_id = "home_import_" + _migration_digest(content)
    added = {}
    for kind, model in _WORK_MODELS.items():
        added[kind] = []
        for values in additions[kind]:
            row = model(**values, import_batch_id=batch_id)
            db.session.add(row)
            added[kind].append({"id": {column.name: values[column.name]
                                       for column in model.__table__.primary_key}, "revision": 1})
        # 부모 이벤트를 먼저 저장합니다. 어느 단계든 실패하면 요청 전체를 취소합니다.
        db.session.flush()
    receipt = {"app": "hanjeongseon-home-migration", "format": 1, "batch_id": batch_id,
               "source_digest": checked["source"], "added": added, "counts": counts}
    db.session.commit()
    return jsonify(receipt=receipt, notice="서버로 옮겼습니다. 브라우저 원본과 백업은 그대로입니다. 내 업무는 서버에서 불러오고 저장합니다.")


def _load_events(start, end):
    """HOME 관리 일정만 읽습니다. 보류 후보 파일은 읽지 않습니다.

    문법·필드 검사는 출처의 사실성을 자동 보증하지 않습니다.
    자료 검증·등록 승인은 HOME 담당자가 별도로 수행합니다.
    한 건이라도 잘못되면 목록 전체를 실패로 처리해 조용한 누락을 막습니다.
    """
    document = json.loads(_EVENTS_PATH.read_text(encoding="utf-8"))
    rows = _validate_event_document(document)
    picked = [row for row in rows if row["start_date"] <= end.isoformat() and row["end_date"] >= start.isoformat()]
    # 보관해 둔 법정 공휴일을 함께 보여 줍니다. 미확정 표시가 붙으며 등록 일정과 겹치면 빠집니다.
    picked += provisional(start, end, rows)
    return sorted(
        picked,
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
        # 승인 전 후보는 화면에 올리지 않고 건너뜁니다. 형식 검사는 등록 도구가 수행합니다.
        if row.get("verification_status") != "verified" or row.get("registration_status") != "approved":
            continue
        _validate_news_row(row, seen)
        result.append(row)
    return sorted(result, key=lambda row: (row["published_at"], row["news_id"]), reverse=True)[:3]


def _validate_news_row(row, seen=None):
    """뉴스 한 건의 형식과 교차 검증 근거를 검사합니다. 출처의 사실성은 보증하지 않습니다.

    화면 API와 등록 도구(news_import.py)가 같은 규칙을 쓰도록 분리했습니다.
    """
    if not isinstance(row, dict):
        raise ValueError("뉴스 객체 필요")
    required = ("news_id", "title", "summary", "region", "source", "url", "verification_notes")
    if any(not isinstance(row.get(key), str) or not row[key].strip() for key in required):
        raise ValueError("필수 뉴스 필드 누락")
    if seen is not None:
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


@bp.get("/api/news/presets")
def news_presets():
    """검색 버튼에 쓸 한국어 라벨만 전달합니다. 현지어 검색어는 서버에만 둡니다."""
    return jsonify(items=preset_labels(), translation=available(), targets=sorted(TARGETS))


@bp.get("/api/news/search")
def news_search():
    """공개 RSS 조회 결과를 그대로 전달합니다. 요약·사실 판정·저장을 하지 않습니다.

    여기서 돌려주는 자료는 검증된 자료가 아니며 화면에 미검증으로 표시해야 합니다.
    불러오지 못하면 빈 목록이나 만들어 낸 자료로 대체하지 않고 실패를 그대로 알립니다.
    """
    preset = request.args.get("preset", "").strip()
    try:
        items, failed = search(query=request.args.get("q", ""), preset=preset or None)
    except SearchError as error:
        return jsonify(error=str(error), items=[]), error.status
    except Exception:
        # 예외 내용에는 외부 응답이 들어갈 수 있어 응답에 내보내지 않습니다.
        return jsonify(error="지금은 뉴스 검색을 불러올 수 없습니다. 잠시 후 다시 시도해주세요.", items=[]), 502
    # 제목만 번역합니다. 번역된 제목인지 원문인지 화면에서 구분할 수 있게 함께 담습니다.
    translated, failed_translation = translate_titles([item["title"] for item in items],
                                                      request.args.get("target", "").strip())
    for item, title in zip(items, translated):
        item["title_original"] = item["title"]
        item["title"] = title
        item["translated"] = title != item["title_original"]
    return jsonify(items=items, unavailable=failed, translation_failed=failed_translation,
                   notice="검증하지 않은 검색 결과입니다. 원문을 열어 직접 확인해주세요.")
