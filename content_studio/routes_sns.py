"""화면, 대화·이전 작업·버전·첫 화면 API, 영상 API. [유진]

API는 /content_studio/api/... 아래에 둡니다.
포스터·카드뉴스를 대화로 고치는 규칙은 designs.py(희주)에 있고, 여기서는 부르기만 합니다.
"""
import copy
import json
import os
import re
import threading
import time
import urllib.error
import uuid
import urllib.request
from datetime import datetime, timedelta, timezone

from flask import current_app, g, jsonify, render_template, request, send_from_directory, url_for

from platform_core.extensions import db

from . import bp
from . import higgsfield
from .designs import (ARTWORK_ROLE, DESIGN_RATIOS, DESIGN_REVISE_HINT, IMAGE_MODE, MAX_PAGES, MIN_PAGES,
                      apply_design_ai, design_ai_messages, make_cardnews, make_poster, revise_design)
from .models_sns import KINDS, SnsChat, SnsCreditLog, SnsDesign, SnsMessage
from .products import COMMON_IMAGES, PRODUCTS, get_product
from .videos import (PRODUCT_EN, TITLE_LIMIT, ai_messages, apply_ai, apply_translation, make_draft, normalize_scenes,
                     phrase_pairs, refresh_prompts, revise_draft, scene_kind, translate_messages, video_title)

TABS = ("poster", "video")  # 카드뉴스 탭은 2026-10-27 유진 결정으로 뺌 (예전 카드뉴스 작업은 DB에 남고 목록에서만 숨김)
REVISE_HINT = '예: 고급스럽게·브이로그 느낌으로·미니어처로·판타지로·ASMR로, 더 밝게, 카메라 천천히, 10초로, 소리 켜줘, 2번 자막 "…"'
DEFAULT_RATIO = {"video": "9:16", "poster": "3:4", "cardnews": "3:4"}  # 포스터·카드뉴스 3:4 (2026-10-27, 4:5는 기존 작업용)
DESIGN_KINDS = ("poster", "cardnews")  # 만들기·고치기 규칙은 희주 designs.py


@bp.route("/")
def index():
    # 탭이 없으면 메인 탭(추천 + 세 탭 작업 목록)
    tab = request.args.get("tab") or "main"
    if tab not in ("main", *TABS):
        tab = "main"
    # 포스터·카드뉴스 첫 화면(희주 renderStart)의 제품 고르기 칸에 쓰는 목록
    products = [{"id": item["id"], "name_ko": item["name_ko"]} for item in PRODUCTS]
    return render_template("content_studio/content_studio_index.html", tab=tab, products=products)


# ---------- 도우미 ----------
def _error(message, status=400):
    return jsonify({"ok": False, "error": message}), status


def _get_chat(chat_id):
    return db.session.get(SnsChat, chat_id)


def _chat_info(chat):
    # 영상은 요청 문장(chat.title) 대신 짧은 주제("발렌타인데이 - 망고스틴 찹쌀떡")를 보여 줍니다. DB 제목은 그대로 둡니다.
    doc = chat.design.doc if chat.kind == "video" and chat.design else None
    return {
        "id": chat.id,
        "kind": chat.kind,
        "title": video_title(doc, chat.event_id) if doc else chat.title,
        "product_id": chat.product_id,
        "event_id": chat.event_id,
        "updated_at": chat.updated_at.isoformat(),
    }


def _design_state(chat):
    design = chat.design
    doc = design.doc if design else None
    if doc and chat.kind == "video":
        # 한국어 프롬프트에서 누른 표현을 영어에서 강조할 대응표. 화면에 보낼 때만 붙이고 저장하지 않습니다.
        # cuts: 컷마다 미리보기 이미지(없으면 None). 이것도 화면용이라 저장하지 않습니다.
        doc = {**doc, "phrase_pairs": phrase_pairs(doc), "cuts": _cuts(doc)}
    return {
        "design": doc,
        "can_undo": bool(design and design.can_undo),
        "can_redo": bool(design and design.can_redo),
    }


def _touch(chat):
    chat.updated_at = datetime.now(timezone.utc)


def _find_products(body, text):
    """만들 제품들(products.py 순서). 화면에서 고른 product_ids(여러 개) → product_id(하나) → 문장 속 제품 이름 순서로 찾습니다.
    문장에 "전체 제품·모든 맛"이 있으면 전체. 못 찾으면 []."""
    ids = body.get("product_ids")
    if isinstance(ids, list) and ids:
        found = [item for item in PRODUCTS if item["id"] in ids]
        if found:
            return found
    if body.get("product_id"):
        product = get_product(body["product_id"])
        return [product] if product else []
    if re.search(r"전체\s*(제품|메뉴|맛)|모든\s*(제품|메뉴|맛)", text):
        return list(PRODUCTS)
    rest, found = text, []
    for product in sorted(PRODUCTS, key=lambda item: len(item["name_ko"]), reverse=True):  # 긴 이름 먼저
        if product["name_ko"] in rest:
            found.append(product["id"])
            rest = rest.replace(product["name_ko"], " ")
    return [item for item in PRODUCTS if item["id"] in found]


# ---------- AI (OpenAI) ----------
# 키는 KPI와 같은 OPENAI_API_KEY (서버에서만 사용, 앱은 OS 환경변수만 읽음). 모델·한도는 README 10장 결정.
OPENAI_URL = "https://api.openai.com/v1/chat/completions"
OPENAI_MODEL = "gpt-4o-mini"
AI_DAILY_LIMIT = 200  # 하루(한국 시간) 호출 수. 서버 메모리에서 세므로 서버를 다시 켜면 0부터 셉니다.
_ai_usage = {"day": None, "count": 0}
_ai_lock = threading.Lock()


def _ai_take_turn():
    """오늘 한도 안이면 1회 쓰고 True."""
    today = datetime.now(KST).date()
    with _ai_lock:
        if _ai_usage["day"] != today:
            _ai_usage.update(day=today, count=0)
        if _ai_usage["count"] >= AI_DAILY_LIMIT:
            return False
        _ai_usage["count"] += 1
        return True


def _openai_json(messages):
    """OpenAI에 JSON 답을 요청합니다. (결과, 실패 이유) — 실패해도 예외를 내지 않습니다."""
    api_key = os.environ.get("OPENAI_API_KEY", "").strip()
    body = {"model": OPENAI_MODEL, "temperature": 0.4, "response_format": {"type": "json_object"}, "messages": messages}
    req = urllib.request.Request(
        OPENAI_URL,
        data=json.dumps(body).encode("utf-8"),
        headers={"Content-Type": "application/json", "Authorization": f"Bearer {api_key}"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=40) as resp:
            payload = json.loads(resp.read().decode("utf-8"))
        return json.loads(payload["choices"][0]["message"]["content"]), None
    except urllib.error.HTTPError as exc:
        hint = {401: "키 확인 필요", 429: "사용 한도·결제 상태 확인 필요", 404: "모델 이름 확인 필요"}.get(exc.code, "")
        return None, f"OpenAI HTTP {exc.code}" + (f", {hint}" if hint else "")
    except (urllib.error.URLError, TimeoutError) as exc:
        return None, f"OpenAI 연결 실패({exc.__class__.__name__})"
    except (ValueError, KeyError, IndexError, TypeError):
        return None, "OpenAI 응답 형식 오류"


def _call_ai(kind, text, doc, page=None):
    """AI로 고치기 요청을 이해합니다 (README 6장). 이미 있는 문서를 고칠 때만 씁니다(첫 생성은 None).
    영상: videos.py ai_messages / apply_ai, 포스터·카드뉴스: 희주 designs.py design_ai_messages / apply_design_ai
    (page = 지금 보는 장, 0부터). 이해했으면 (새 문서, 바꾼 것 목록), 아니면 None → 부른 쪽이 단어 규칙을 씁니다.
    키는 있는데 쓰지 못했으면(한도·실패) g.ai_note에 이유를 남겨 답장에 붙입니다."""
    if doc is None or not os.environ.get("OPENAI_API_KEY", "").strip():
        return None
    if kind == "video":
        messages, apply = ai_messages(doc, text), (lambda data: apply_ai(doc, data))
    elif kind in DESIGN_KINDS:
        messages, apply = design_ai_messages(doc, text, page), (lambda data: apply_design_ai(doc, data, page))
    else:
        return None
    if not _ai_take_turn():
        g.ai_note = f"오늘 AI 사용 한도({AI_DAILY_LIMIT}회)를 넘었어요"
        return None
    data, error = _openai_json(messages)
    result = apply(data) if error is None else None
    if result is None:
        g.ai_note = error or "AI 답을 읽지 못했어요"
        current_app.logger.warning("콘텐츠 스튜디오 AI 실패: %s", g.ai_note)
        return None
    return result if result[1] else None


def _ai_translate(lines, context):
    """[저장] 때 아는 표현으로 못 바꾼 한국어 줄 → 영어 줄 목록(AI 번역, 하루 한도에서 1회).
    키가 없거나 한도·실패면 None → 그 줄은 화면에 "영어에 반영하지 못한 줄"로 남습니다."""
    if not os.environ.get("OPENAI_API_KEY", "").strip() or not _ai_take_turn():
        return None
    data, error = _openai_json(translate_messages(lines, context))
    result = apply_translation(data, lines) if error is None else None
    if result is None:
        current_app.logger.warning("콘텐츠 스튜디오 AI 번역 실패: %s", error or "AI 답 형식 오류")
    return result


def _with_ai_note(reply):
    note = g.pop("ai_note", None)
    return f"{reply} (AI를 쓰지 못해 단어 규칙으로 처리했어요: {note})" if note else reply


# ---------- 대화 ----------
@bp.route("/api/messages", methods=["POST"])
def post_message():
    body = request.get_json(silent=True) or {}
    text = (body.get("text") or "").strip()
    kind = body.get("kind")
    if not text:
        return _error("보낼 내용을 입력해 주세요.")
    if kind not in KINDS:
        return _error("탭 종류(kind)가 올바르지 않습니다.")

    chat = _get_chat(body["chat_id"]) if body.get("chat_id") else None
    if body.get("chat_id") and chat is None:
        return _error("작업을 찾을 수 없습니다.", 404)
    if chat and chat.kind != kind:
        return _error("이 작업은 다른 탭의 작업입니다.")

    changes = []
    if chat is None:
        products = _find_products(body, text)
        product = products[0] if products else None
        if product is None:
            names = " / ".join(item["name_ko"] for item in PRODUCTS)
            return jsonify({"ok": True, "chat_id": None, "ask": "product", "reply": f"어떤 제품으로 만들까요? ({names})",
                            "changes": [], "design": None, "can_undo": False, "can_redo": False, "demo": True})
        ratio = body.get("ratio") or DEFAULT_RATIO[kind]
        # 포스터·카드뉴스 틀은 희주 담당 designs.py. 길이·소리는 영상 전용이라 쓰지 않습니다.
        if kind == "poster":
            doc = _call_ai(kind, text, None) or make_poster(text, ratio=ratio, product=product, event=body.get("event"))
        elif kind == "cardnews":
            # template(clean | photo | checklist | quote)이 없으면 문장에서 찾습니다("체크리스트형으로").
            doc = _call_ai(kind, text, None) or make_cardnews(
                text, ratio=ratio, product=product, event=body.get("event"), template=body.get("template"))
        else:
            try:
                duration = int(body.get("duration") or 5)
            except (TypeError, ValueError):
                duration = 5
            # 단어 규칙 초안을 먼저 만들고, AI가 있으면 요청에 맞게 다듬습니다.
            doc = make_draft(
                text,
                ratio=ratio,
                duration=duration,
                sound=bool(body.get("sound")),
                product=product["name_ko"],
                event=body.get("event"),
                products=[item["name_ko"] for item in products],
            )
            # 고른 제품마다 단면·포장 사진. 첫 장(첫 제품 단면)은 필수 제품 사진 칸(바꿀 수 있음), 나머지는 참고 사진으로 함께 보냅니다.
            photos = [photo for item in products for photo in _product_photos(item)]
            doc["image"], doc["ref_images"] = (photos[0] if photos else None), photos[1:]
            # 처음 만들 때 올린 레퍼런스 이미지·참고 영상(틀린 것은 빼고 저장)
            doc["user_refs"] = [ref for ref in map(_clean_upload, body.get("user_refs") or []) if ref][:USER_REFS_MAX]
            doc["ref_video"] = _clean_ref_video(body.get("ref_video")) or None
            refresh_prompts(doc)
            ai = _call_ai(kind, text, doc)
            if ai:
                doc = ai[0]
            # 화면에서 입력한 제목(비우면 규칙 제목). AI는 제목을 정하지 않습니다.
            title = _clean_title(body.get("title"))
            if title:
                doc["title"] = title
        # 기념일 ID가 아직 없어(현지 시장 분석 get_events 준비 중) 이름을 그대로 저장합니다.
        # 영상은 고른 제품 id를 모두(쉼표로) 저장합니다. 외래키가 아닌 문자열 칸입니다.
        product_ids = ",".join(item["id"] for item in products) if kind == "video" else product["id"]
        chat = SnsChat(kind=kind, title=text[:40], product_id=product_ids, event_id=body.get("event"),
                       file_id=body.get("file_id"))
        chat.design = SnsDesign()
        chat.design.push(doc)
        db.session.add(chat)
        if kind == "poster":
            reply = "포스터 초안을 만들었어요. 가운데에서 글자를 옮기고 고칠 수 있어요."
        elif kind == "cardnews":
            reply = f"카드뉴스 {len(doc['pages'])}장 초안을 만들었어요. 위 장 번호로 장을 옮기며 고칠 수 있어요."
        else:
            reply = _with_ai_note(f"{len(doc['scenes'])}컷 초안을 만들었어요. 프롬프트와 자막을 검토해 주세요.")
    else:
        current = chat.design.doc if chat.design else None
        if current is None:
            return _error("이 작업에는 고칠 결과물이 없습니다.")
        if kind in DESIGN_KINDS and current.get("mode") == IMAGE_MODE:
            # 그림 시안(Higgsfield 그림 문서)은 말로 고치기(그림 다시 그리기)가 2단계라, AI를 부르지 않고 안내만 합니다.
            reply = "그림 시안을 말로 고치기(그림 다시 그리기)는 준비 중이에요."
        elif kind in DESIGN_KINDS:
            # page: 화면에서 보고 있는 장(0부터). 없으면 1장 기준이고, "3장 배경 파랗게"처럼 말하면 그 장을 고칩니다.
            page = body.get("page")
            page = page if isinstance(page, int) and not isinstance(page, bool) else None
            ai = _call_ai(kind, text, current, page)  # AI가 없거나 실패하면 단어 규칙
            doc, changes = ai if ai else revise_design(current, text, page=page)
            if changes:
                chat.design.push(doc)
                reply = "바꿨어요: " + ", ".join(changes)
            else:
                reply = f"어떻게 고칠지 알아듣지 못했어요. {DESIGN_REVISE_HINT}"
            reply = _with_ai_note(reply)
        else:
            ai = _call_ai(kind, text, current)
            doc, changes = ai if ai else revise_draft(current, text)
            if changes:
                chat.design.push(doc)
                reply = "바꿨어요: " + ", ".join(changes)
                if not doc["reviewed"]:
                    reply += ". 영상이 바뀌어 프롬프트를 다시 검토해 주세요."
            else:
                reply = f"어떻게 고칠지 알아듣지 못했어요. {REVISE_HINT}"
            reply = _with_ai_note(reply)

    chat.messages.append(SnsMessage(role="user", text=text))
    chat.messages.append(SnsMessage(role="assistant", text=reply))
    _touch(chat)
    db.session.commit()
    return jsonify({"ok": True, "chat_id": chat.id, "reply": reply, "changes": changes, **_design_state(chat), "demo": True})


# ---------- 첫 화면 AI 초안으로 새 작업 (포스터·카드뉴스) ----------
# 희주 renderChoices가 만든 시안(그림 문서)을 받아 새 작업(SnsChat)과 첫 버전(SnsDesign)으로 저장합니다.
# 쓸 수 있는 비율은 희주 designs.py DESIGN_RATIOS를 그대로 씁니다(3:4 · 4:3 · 9:16 · 16:9 · 1:1 + 기존 작업용 4:5).
DESIGN_MAX_BYTES = 160 * 1024
TAB_LABELS = {"poster": "포스터", "cardnews": "카드뉴스", "video": "영상"}


def _check_design(kind, design):
    """첫 초안 형식 검사(README 8장 요소 JSON). 틀리면 이유, 맞으면 None."""
    if not isinstance(design, dict) or design.get("kind") != kind:
        return "초안(design)의 탭 종류가 올바르지 않습니다."
    if design.get("ratio") not in DESIGN_RATIOS[kind]:
        return f"{TAB_LABELS[kind]} 비율은 {' · '.join(DESIGN_RATIOS[kind])}만 쓸 수 있습니다."
    pages = design.get("pages")
    if not isinstance(pages, list) or not pages or not all(
            isinstance(page, dict) and isinstance(page.get("elements"), list) for page in pages):
        return "초안의 장(pages) 형식이 올바르지 않습니다."
    if len(json.dumps(design, ensure_ascii=False).encode("utf-8")) > DESIGN_MAX_BYTES:
        return "초안이 너무 큽니다. (160KB 이하)"
    return None


def _design_title(kind, design, product):
    """작업 제목: 1장의 제목 글자(40자), 없으면 '찹쌀떡 포스터'처럼 제품 + 탭 이름."""
    for item in design["pages"][0]["elements"]:
        if isinstance(item, dict) and item.get("role") == "title" and isinstance(item.get("text"), str) and item["text"].strip():
            return item["text"].strip()[:40]
    return f"{product['name_ko']} {TAB_LABELS[kind]}"


@bp.route("/api/chats", methods=["POST"])
def create_chat():
    body = request.get_json(silent=True) or {}
    kind, design = body.get("kind"), body.get("design")
    if kind not in DESIGN_KINDS:
        return _error("포스터·카드뉴스만 초안으로 새 작업을 만들 수 있습니다.")
    problem = _check_design(kind, design)
    if problem:
        return _error(problem)
    product = get_product(body.get("product_id"))
    if product is None:
        return _error("제품을 골라 주세요.")
    # 작업 이름: 새로 만들기에서 직접 입력한 제목(30자), 없으면 1장 제목 글자 규칙
    title = _clean_title(body.get("title")) or _design_title(kind, design, product)
    chat = SnsChat(kind=kind, title=title, product_id=product["id"])
    chat.design = SnsDesign()
    chat.design.push(design)
    db.session.add(chat)
    db.session.commit()
    return jsonify({"ok": True, "chat_id": chat.id, "reply": "", "changes": [], **_design_state(chat),
                    "demo": bool(design.get("demo", True))})


def _clean_title(value):
    """직접 입력한 영상 제목: 앞뒤 공백을 빼고 30자까지. 문자열이 아니거나 비면 None."""
    return (value.strip()[:TITLE_LIMIT] or None) if isinstance(value, str) else None


@bp.route("/api/chats/<int:chat_id>", methods=["PATCH"])
def rename_chat(chat_id):
    """영상 작업 이름 바꾸기. 모든 버전에 같은 제목을 적어 되돌려도 제목이 그대로입니다(새 버전·다시 검토 없음).
    빈 제목이면 직접 입력한 제목을 지우고 규칙 제목으로 돌아갑니다."""
    chat = _get_chat(chat_id)
    if chat is None or chat.design is None:
        return _error("작업을 찾을 수 없습니다.", 404)
    if chat.kind != "video":
        return _error("이름 바꾸기는 영상 작업만 됩니다.")
    title = (request.get_json(silent=True) or {}).get("title")
    if not isinstance(title, str):
        return _error("제목(title)이 없습니다.")
    title = _clean_title(title)
    versions = copy.deepcopy(chat.design.versions)
    for version in versions:
        if title:
            version["title"] = title
        else:
            version.pop("title", None)
    chat.design.versions = versions  # JSON 칸은 새 목록을 넣어야 저장됩니다.
    _touch(chat)
    db.session.commit()
    return jsonify({"ok": True, "chat": _chat_info(chat), **_design_state(chat)})


# ---------- 이전 작업 ----------
@bp.route("/api/chats")
def list_chats():
    query = SnsChat.query
    if request.args.get("kind") in KINDS:
        query = query.filter_by(kind=request.args["kind"])
    chats = query.order_by(SnsChat.updated_at.desc()).all()
    return jsonify({"ok": True, "chats": [_chat_info(chat) for chat in chats]})


@bp.route("/api/chats/<int:chat_id>")
def open_chat(chat_id):
    chat = _get_chat(chat_id)
    if chat is None:
        return _error("작업을 찾을 수 없습니다.", 404)
    messages = [{"role": m.role, "text": m.text, "cards": m.cards, "created_at": m.created_at.isoformat()}
                for m in chat.messages]
    return jsonify({"ok": True, "chat": _chat_info(chat), "messages": messages, **_design_state(chat)})


@bp.route("/api/chats/<int:chat_id>", methods=["DELETE"])
def delete_chat(chat_id):
    chat = _get_chat(chat_id)
    if chat is None:
        return _error("작업을 찾을 수 없습니다.", 404)
    db.session.delete(chat)
    db.session.commit()
    return jsonify({"ok": True})


# ---------- 첫 화면 ----------
@bp.route("/api/gallery")
def gallery():
    """작업 목록(최신순). kind를 주면 그 탭만, 비우면 세 탭 모두(메인 탭)."""
    kind = request.args.get("kind")
    if kind and kind not in KINDS:
        return _error("탭 종류(kind)가 올바르지 않습니다.")
    query = SnsChat.query.filter_by(kind=kind) if kind else SnsChat.query.filter(SnsChat.kind.in_(TABS))
    items = []
    for chat in query.order_by(SnsChat.updated_at.desc()):
        doc = chat.design.doc if chat.design else None
        item = {**_chat_info(chat)}
        if chat.kind == "video" and doc:
            job = doc.get("job") or {}
            item.update({
                "summary": doc["summary"],
                "ratio": doc["ratio"],
                "duration": doc["duration"],
                "scenes": doc["scenes"],
                "video_url": job.get("video_url"),
                "job_status": job.get("status"),
                # 썸네일 보기용: 처음 완성된 컷 미리보기 이미지(없으면 None)
                "thumb_url": next((cut["image_url"] for cut in _cuts(doc)
                                   if cut and cut.get("status") == higgsfield.DONE and cut.get("image_url")), None),
                "demo": doc.get("demo", False),
            })
        else:
            item["design"] = doc
        items.append(item)
    return jsonify({"ok": True, "items": items})


# ---------- 버전 ----------
@bp.route("/api/chats/<int:chat_id>/design", methods=["PUT"])
def save_design(chat_id):
    chat = _get_chat(chat_id)
    if chat is None:
        return _error("작업을 찾을 수 없습니다.", 404)
    doc = (request.get_json(silent=True) or {}).get("design")
    if not isinstance(doc, dict):
        return _error("저장할 결과물(design)이 없습니다.")
    if doc.get("kind", chat.kind) != chat.kind:
        return _error("이 작업과 결과물의 탭 종류가 다릅니다.")
    if chat.design is None:
        chat.design = SnsDesign()
    doc.pop("phrase_pairs", None)  # 화면용 대응표·컷 이미지 목록은 저장하지 않습니다.
    doc.pop("cuts", None)
    if chat.kind == "video":
        photo = _clean_photo(doc.get("image"))
        refs = [_clean_photo(item) for item in doc.get("ref_images") or []]
        user_refs = [_clean_upload(item) for item in doc.get("user_refs") or []]
        ref_video = _clean_ref_video(doc.get("ref_video"))
        if photo is False or False in refs:
            return _error("제품 사진 형식이 올바르지 않습니다. 다시 올려 주세요.")
        if None in user_refs or len(user_refs) > USER_REFS_MAX or ref_video is False:
            return _error(f"레퍼런스는 올린 이미지 {USER_REFS_MAX}장, 영상 1개까지입니다.")
        doc["image"], doc["ref_images"] = photo, [item for item in refs if item][:REF_IMAGES_MAX]  # 나머지 제품 사진
        doc["user_refs"], doc["ref_video"] = user_refs, ref_video
        # 직접 고친 프롬프트(custom)·장면이 바뀌어 영상이 달라지면 다시 검토가 필요합니다.
        before = chat.design.doc
        try:
            # 직접 고친 장면 시간 검사 + 영어·한국어 프롬프트(고친 한국어 중 모르는 표현은 AI 번역)
            doc = refresh_prompts(normalize_scenes(doc), translate=_ai_translate)
        except (KeyError, TypeError):
            return _error("영상 결과물 형식이 올바르지 않습니다. (README 8장)")
        if before is None or doc["prompt"] != before.get("prompt"):
            doc["reviewed"] = False
    chat.design.push(doc)
    _touch(chat)
    db.session.commit()
    return jsonify({"ok": True, **_design_state(chat)})


def _move(chat_id, step):
    chat = _get_chat(chat_id)
    if chat is None or chat.design is None:
        return _error("작업을 찾을 수 없습니다.", 404)
    moved = chat.design.undo() if step == "undo" else chat.design.redo()
    if moved:
        _touch(chat)
        db.session.commit()
    return jsonify({"ok": True, "moved": moved, **_design_state(chat)})


@bp.route("/api/chats/<int:chat_id>/design/undo", methods=["POST"])
def undo_design(chat_id):
    return _move(chat_id, "undo")


@bp.route("/api/chats/<int:chat_id>/design/redo", methods=["POST"])
def redo_design(chat_id):
    return _move(chat_id, "redo")


# ---------- ③ 생성 (Higgsfield CLI) ----------
# 미리보기 이미지(image)와 영상(video). 실행 전에 비용·계정 남은 크레딧·오늘 대시보드 사용량을 보여 주고,
# 화면에서 [실행]을 눌러 확인한 비용(credits)이 지금 비용과 같을 때만 요청합니다.
KST = timezone(timedelta(hours=9))
TARGETS = {"image": ("keyframes", "image_url"), "video": ("job", "video_url")}
RUNNING = ("queued", "in_progress", "processing")
REF_IMAGES_MAX = 7  # 제품 4종 × 단면·포장 = 8장 중 제품 사진 칸 1장을 뺀 나머지


def _today_used():
    """오늘(한국 시간 0시부터) 대시보드에서 쓴 Higgsfield 크레딧. 미리보기 이미지·영상 기록만 셉니다
    (희주 AI 배경 그림 job_kind="design_bg"는 달러 금액이라 이 한도에 섞지 않음)."""
    start = datetime.now(KST).replace(hour=0, minute=0, second=0, microsecond=0).astimezone(timezone.utc)
    rows = SnsCreditLog.query.filter(SnsCreditLog.created_at >= start,
                                     SnsCreditLog.job_kind.in_(("image", "video"))).all()
    return round(sum(row.credits for row in rows), 2)


def _video_chat(chat_id):
    chat = _get_chat(chat_id)
    if chat is None or chat.kind != "video" or chat.design is None or chat.design.doc is None:
        return None
    return chat


def _target():
    target = (request.get_json(silent=True) or {}).get("target") or request.args.get("target")
    return target if target in TARGETS else None


# 제품 사진: 희주 업로드 API(/media/api/upload)로 올린 파일. 문서 image = {file_id, url}. 영상·미리보기를 만들 때 필수입니다.
PHOTO_URL = re.compile(r"^/content_studio/media/uploads/([0-9a-f]{32})\.(jpg|png|webp)$")
# 제품 사진(products.py images, static/images/sns/). 새 영상 초안의 제품 사진 칸 기본값입니다.
PRODUCT_PHOTO_URL = re.compile(r"^/content_studio/static/images/sns/(product_[a-z0-9_]+\.(?:jpg|png|webp))$")
PHOTO_REQUIRED = "제품 사진을 먼저 올려 주세요."


def _clean_photo(image):
    """저장 전 검사: None이거나 서버가 만든 업로드 주소·제품 사진 주소만. 맞으면 {file_id, url}, 틀리면 False."""
    if not image:
        return None
    url = image.get("url", "") if isinstance(image, dict) else ""
    if match := PHOTO_URL.match(url):
        return {"file_id": match.group(1), "url": url}
    if PRODUCT_PHOTO_URL.match(url):
        return {"file_id": None, "url": url}
    return False


def _photo_path(doc):
    """문서의 제품 사진 → 서버의 파일 경로(Higgsfield CLI가 직접 올림). 없거나 파일이 사라졌으면 None."""
    url = (doc.get("image") or {}).get("url", "") if isinstance(doc.get("image"), dict) else ""
    if match := PHOTO_URL.match(url):
        path = os.path.join(current_app.config["UPLOAD_ROOT"], "content_studio", f"{match.group(1)}.{match.group(2)}")
    elif match := PRODUCT_PHOTO_URL.match(url):
        path = os.path.join(bp.static_folder, "images", "sns", match.group(1))
    else:
        return None
    return path if os.path.isfile(path) else None


def _product_photos(product):
    """제품의 단면·포장 사진 → 문서 image 값 목록(단면 먼저). 사진이 없으면 []."""
    images = product.get("images") or {"cut": product.get("image")}
    names = [images.get("cut"), images.get("pack")]
    return [{"file_id": None, "url": url_for("content_studio.static", filename=f"images/sns/{name}")} for name in names if name]


def _cuts(doc):
    """컷마다 미리보기 이미지 {request_id, status, image_url, scene} 또는 None (장면 순서).
    그림은 만들 때의 장면 글(영어)로 컷을 찾습니다 — 컷을 넣거나 지워도 맞는 그림을 따라가고, 장면을 고친 컷은 비어
    다시 만들어야 합니다. 예전 문서의 미리보기 이미지 하나(keyframe)는 1번 컷 그림입니다."""
    scenes = doc.get("scenes") or []
    pool = list(doc.get("keyframes") or [])
    old = doc.get("keyframe")
    if isinstance(old, dict) and scenes:
        pool.append({**old, "scene": scenes[0]["en"]})
    # 작업 ID 모양인 것만(이 값을 CLI에 그대로 넘기므로)
    pool = [item for item in pool if isinstance(item, dict) and higgsfield.UUID.fullmatch(str(item.get("request_id")))]
    cuts = []
    for scene in scenes:
        match = next((item for item in pool if item.get("scene") == scene.get("en")), None)
        if match:
            pool.remove(match)
        cuts.append(match)
    return cuts


def _done(cut):
    return cut["request_id"] if cut and cut.get("status") == higgsfield.DONE else None


def _static_photo(name):
    path = os.path.join(bp.static_folder, "images", "sns", name) if name else None
    return path if path and os.path.isfile(path) else None


def _photo_set(doc, kinds, scene_text=""):
    """보낼 제품 사진 [(경로, 역할 영어)]. kinds: 이번 요청에 들어가는 컷 종류(videos.py scene_kind) 집합.
    고른 제품이 카탈로그(products.py)에 있으면 사진을 자동으로 고릅니다:
    자르지 않은 동그란 찹쌀떡(공통 겉모습 사진)은 어떤 제품·컷이든 늘 첫 번째로 보냅니다(2026-10-27 유진 결정).
    그 뒤로: 속 → 고른 맛 단면(장면에 맛 이름이 있으면 그 맛만) · 선물 → 선물세트 2장 + 맛별 포장.
    직접 올린 사진만 있는 예전 작업은 겉모습 사진 + 그 사진들(제품 사진 칸 + 참고 사진)을 씁니다."""
    names = doc.get("products") or [doc.get("product")]
    items = [item for name in names for item in PRODUCTS if item["name_ko"] == name]
    image_url = (doc.get("image") or {}).get("url", "") if isinstance(doc.get("image"), dict) else ""
    whole = (_static_photo(COMMON_IMAGES["whole"]),
             "the outside of the rice cakes: round, soft and white with rice-flour dusting, the same for every flavor")
    if not items or PHOTO_URL.match(image_url):
        legacy = [_photo_path(doc), *(_photo_path({"image": item}) for item in doc.get("ref_images") or [])]
        return [whole, *((path, "the product photo") for path in legacy if path)] if whole[0] else \
            [(path, "the product photo") for path in legacy if path]
    photos = [whole]
    if "inside" in kinds:
        named = [item for item in items if PRODUCT_EN.get(item["name_ko"], "").lower() in scene_text.lower()]
        for item in named or items:
            en = PRODUCT_EN.get(item["name_ko"], item["name_ko"])
            photos.append((_static_photo(item["images"].get("cut")), f"the cross-section of {en}, showing its filling"))
    if "gift" in kinds:
        photos += [(_static_photo(COMMON_IMAGES["giftset_wrapped"]), "the gift set box wrapped in pink bojagi cloth"),
                   (_static_photo(COMMON_IMAGES["giftset_open"]), "the opened gift set box with individually wrapped rice cakes")]
        for item in items:
            en = PRODUCT_EN.get(item["name_ko"], item["name_ko"])
            photos.append((_static_photo(item["images"].get("pack")), f"the individual wrapping of {en}"))
    return [(path, role) for path, role in photos if path]


def _gen_args(doc, target, index=0):
    """index: 미리보기 이미지를 만들 컷(0부터)."""
    # 참고 사진: 컷 종류에 맞는 제품 사진(_photo_set) + 사용자가 올린 레퍼런스 이미지 / 참고 영상
    scenes = doc.get("scenes") or []
    users = [(path, "a mood reference (mood, composition and color only)")
             for path in (_photo_path({"image": item}) for item in doc.get("user_refs") or []) if path]
    if target == "image":
        text = scenes[index]["en"] if 0 <= index < len(scenes) else ""
        return higgsfield.image_args(doc, photos=[*_photo_set(doc, {scene_kind(text)}, text), *users], index=index)
    # 영상: 첫 컷 그림으로 시작, 마지막 컷 그림으로 끝(컷이 2개 이상일 때), 가운데 컷 그림은 참고 사진.
    # 이미지 10장 한도라 중요한 순서로: 겉모습 사진 → 가운데 컷 그림 → 단면·선물세트 사진 → 레퍼런스
    cuts = [_done(cut) for cut in _cuts(doc)]
    start = cuts[0] if cuts else None
    end = cuts[-1] if len(cuts) > 1 else None
    middle = [job for job in cuts[1:-1] if job]
    products = [path for path, _ in _photo_set(doc, {scene_kind(scene.get("en")) for scene in scenes} | {"outside"})]
    photos = [*products[:1], *middle, *products[1:], *(path for path, _ in users)]
    video = _ref_video_path(doc.get("ref_video"))
    return higgsfield.video_args(doc, start_image=start, end_image=end, photos=photos, videos=[video] if video else [])


# ---------- 레퍼런스 (사용자가 올린 분위기 참고 이미지·영상) ----------
# 이미지는 희주 업로드 API(/media/api/upload)로 올리고, 영상은 아래 API로 올립니다. 둘 다 instance/uploads/content_studio/.
USER_REFS_MAX = 4
REF_VIDEO_TYPES = {".mp4": "video/mp4", ".mov": "video/quicktime", ".webm": "video/webm"}
REF_VIDEO_MAX = 50 * 1024 * 1024  # 50MB
REF_VIDEO_NAME = re.compile(r"^([0-9a-f]{32})\.(mp4|mov|webm)$")


def _clean_upload(item):
    """레퍼런스 이미지 한 장: 업로드 주소만 {file_id, url}. 틀리면 None."""
    cleaned = _clean_photo(item)
    return cleaned if cleaned and cleaned.get("file_id") else None


def _clean_ref_video(item):
    """참고 영상: None이거나 이 서버가 만든 주소 {file_id, url}. 틀리면 False."""
    if not item:
        return None
    url = item.get("url", "") if isinstance(item, dict) else ""
    name = url.rsplit("/", 1)[-1]
    match = REF_VIDEO_NAME.match(name)
    if not match or url != url_for("content_studio.ref_video", name=name):
        return False
    return {"file_id": match.group(1), "url": url}


def _ref_video_path(item):
    cleaned = _clean_ref_video(item)
    if not cleaned:
        return None
    path = os.path.join(current_app.config["UPLOAD_ROOT"], "content_studio", cleaned["url"].rsplit("/", 1)[-1])
    return path if os.path.isfile(path) else None


@bp.route("/api/ref-video", methods=["POST"])
def upload_ref_video():
    """참고 영상 올리기(MP4·MOV·WEBM, 50MB 이하). 확장자와 파일 앞부분(영상 형식 표시)을 함께 봅니다."""
    upload = request.files.get("video")
    if not upload:
        return _error("영상을 먼저 골라 주세요.")
    ext = os.path.splitext(upload.filename or "")[1].lower()
    if ext not in REF_VIDEO_TYPES:
        return _error("MP4·MOV·WEBM 영상만 올릴 수 있습니다.")
    head = upload.stream.read(12)
    if not (head[4:8] == b"ftyp" if ext in (".mp4", ".mov") else head[:4] == b"\x1aE\xdf\xa3"):
        return _error("영상 파일이 아닙니다.")
    folder = os.path.join(current_app.config["UPLOAD_ROOT"], "content_studio")
    os.makedirs(folder, exist_ok=True)
    name = f"{uuid.uuid4().hex}{ext}"
    path, size = os.path.join(folder, name), len(head)
    with open(path, "wb") as out:
        out.write(head)
        while chunk := upload.stream.read(1024 * 1024):
            size += len(chunk)
            if size > REF_VIDEO_MAX:
                break
            out.write(chunk)
    if size > REF_VIDEO_MAX:
        os.remove(path)
        return _error("50MB 이하 영상만 올릴 수 있습니다.")
    return jsonify({"ok": True, "file_id": name.split(".")[0], "url": url_for("content_studio.ref_video", name=name)})


@bp.route("/api/ref-video/<name>")
def ref_video(name):
    match = REF_VIDEO_NAME.match(name)
    if not match:
        return _error("영상을 찾을 수 없습니다.", 404)
    folder = os.path.join(current_app.config["UPLOAD_ROOT"], "content_studio")
    if not os.path.isfile(os.path.join(folder, name)):
        return _error("영상을 찾을 수 없습니다.", 404)
    return send_from_directory(folder, name, mimetype=REF_VIDEO_TYPES[f".{match.group(2)}"])


def _scene_index():
    """미리보기 이미지를 만들 컷(0부터). 없으면 None = 모든 컷."""
    value = (request.get_json(silent=True) or {}).get("scene")
    return value if isinstance(value, int) and not isinstance(value, bool) else None


def _image_indexes(doc, scene):
    count = len(doc.get("scenes") or [])
    if scene is None:
        return list(range(count))
    return [scene] if 0 <= scene < count else None


def _quote(doc, target, scene=None):
    """무료 확인: 이번 비용 · 계정 남은 크레딧 · 오늘 사용량. 실행할 수 없으면 reason에 이유.
    미리보기 이미지는 컷마다 1장이라 비용 = 1장 비용(unit) × 장수(count). scene이 있으면 그 컷 1장만."""
    if target == "image":
        indexes = _image_indexes(doc, scene) or []
        unit = higgsfield.cost(_gen_args(doc, "image", indexes[0] if indexes else 0))
        credits = round(unit * len(indexes), 2)
        cuts = _cuts(doc)
        running = any(cuts[i] and cuts[i].get("status") in RUNNING for i in indexes)
    else:
        indexes, unit = [None], higgsfield.cost(_gen_args(doc, target))
        credits = unit
        running = (doc.get("job") or {}).get("status") in RUNNING
    balance = higgsfield.balance()
    used = _today_used()
    reason = None
    if running:
        reason = "이미 만드는 중입니다. 상태를 확인해 주세요."
    elif used + credits > higgsfield.DAILY_LIMIT:
        reason = f"오늘 대시보드 한도({higgsfield.DAILY_LIMIT})를 넘습니다. (오늘 {used:g} 사용)"
    elif credits > balance:
        reason = "계정에 남은 크레딧이 모자랍니다."
    return {"target": target, "credits": credits, "unit": unit, "count": len(indexes), "scene": scene,
            "balance": balance, "today_used": used,
            "daily_limit": higgsfield.DAILY_LIMIT, "allowed": reason is None, "reason": reason}


def _set_result(chat, target, job):
    """지금 보고 있는 버전에 영상 작업 상태를 적습니다. (새 버전을 만들지 않음 — 되돌리기 목록이 늘지 않게)"""
    key, url_key = TARGETS[target]
    versions = copy.deepcopy(chat.design.versions)
    doc = versions[chat.design.current]
    doc[key] = {"request_id": job["request_id"], "status": job["status"], url_key: job["url"]}
    chat.design.versions = versions  # JSON 칸은 새 목록을 넣어야 저장됩니다.


def _set_cuts(chat, jobs):
    """지금 버전의 컷 미리보기 이미지를 바꿉니다. jobs = {컷 번호(0부터): 작업}. 지금 장면에 맞지 않는 옛 그림은 정리합니다."""
    versions = copy.deepcopy(chat.design.versions)
    doc = versions[chat.design.current]
    cuts = _cuts(doc)
    for index, job in jobs.items():
        cuts[index] = {"request_id": job["request_id"], "status": job["status"], "image_url": job["url"],
                       "scene": doc["scenes"][index]["en"]}
    doc["keyframes"] = [cut for cut in cuts if cut]
    doc.pop("keyframe", None)
    chat.design.versions = versions


def _hf_error(error):
    status = 503 if error.code in ("missing", "login") else 502
    return jsonify({"ok": False, "error": str(error), "code": error.code}), status


@bp.route("/api/chats/<int:chat_id>/generate/quote", methods=["POST"])
def generate_quote(chat_id):
    chat, target = _video_chat(chat_id), _target()
    if chat is None:
        return _error("영상 작업을 찾을 수 없습니다.", 404)
    if target is None:
        return _error("만들 것(target: image/video)이 올바르지 않습니다.")
    if not _photo_path(chat.design.doc):
        return _error(PHOTO_REQUIRED)
    scene = _scene_index()
    if target == "image" and not _image_indexes(chat.design.doc, scene):
        return _error("컷 번호가 올바르지 않습니다.")
    try:
        return jsonify({"ok": True, "quote": _quote(chat.design.doc, target, scene)})
    except higgsfield.HiggsfieldError as error:
        return _hf_error(error)


@bp.route("/api/chats/<int:chat_id>/generate", methods=["POST"])
def generate(chat_id):
    """크레딧이 나가는 유일한 API. 화면에서 확인한 비용과 지금 비용이 같아야 보냅니다."""
    chat, target = _video_chat(chat_id), _target()
    if chat is None:
        return _error("영상 작업을 찾을 수 없습니다.", 404)
    if target is None:
        return _error("만들 것(target: image/video)이 올바르지 않습니다.")
    confirmed = (request.get_json(silent=True) or {}).get("credits")
    doc = chat.design.doc
    if not _photo_path(doc):
        return _error(PHOTO_REQUIRED)
    scene = _scene_index()
    indexes = _image_indexes(doc, scene) if target == "image" else None
    if target == "image" and not indexes:
        return _error("컷 번호가 올바르지 않습니다.")
    try:
        quote = _quote(doc, target, scene)
        if confirmed is None or float(confirmed) != quote["credits"]:
            return jsonify({"ok": False, "error": "비용이 바뀌었습니다. 다시 확인해 주세요.", "quote": quote}), 409
        if not quote["allowed"]:
            return jsonify({"ok": False, "error": quote["reason"], "quote": quote}), 409
        args = [_gen_args(doc, target, index) for index in indexes] if indexes else [_gen_args(doc, target)]
    except higgsfield.HiggsfieldError as error:
        return _hf_error(error)
    except (TypeError, ValueError):
        return _error("확인한 비용(credits)이 올바르지 않습니다.")

    # 미리보기 이미지는 컷마다 1건씩 보냅니다. 중간에 실패하면 거기서 멈추고, 이미 보낸 것만 저장·기록합니다.
    model = higgsfield.IMAGE_MODEL if target == "image" else higgsfield.VIDEO_MODEL
    jobs, sent, failure, unknown = {}, [], None, False
    for index, one in zip(indexes or [None], args):
        try:
            job = higgsfield.create(one)
        except higgsfield.HiggsfieldError as error:  # CLI가 실패를 알림 → 이 건은 크레딧이 나가지 않음
            failure = error
            break
        except Exception:  # 요청은 들어갔을 수 있음(예: 작업 ID를 못 받음) → 크레딧을 기록하고 다시 누르지 않게
            current_app.logger.exception("Higgsfield 생성 응답 처리 실패")
            sent.append(None)
            unknown = True
            break
        jobs[index] = job
        sent.append(job["request_id"])
    if not sent:
        return _hf_error(failure)

    # 여기부터는 요청이 Higgsfield에 들어간 뒤라, 오류가 나도 크레딧 기록은 꼭 남깁니다.
    unit = quote["unit"]
    spent = round(unit * len(sent), 2)
    try:
        _log_credits(chat, target, model, unit, sent)
        if target == "image":
            _set_cuts(chat, jobs)
        elif jobs:
            _set_result(chat, target, jobs[None])
        _touch(chat)
        db.session.commit()
    except Exception:
        current_app.logger.exception("Higgsfield 생성 뒤 저장 실패")
        db.session.rollback()
        return _submitted(chat, target, model, unit, sent)
    if unknown:
        return _submitted(chat, target, model, unit, [], spent)
    data = {"ok": True, "spent": spent, "today_used": quote["today_used"] + spent,
            "daily_limit": higgsfield.DAILY_LIMIT, **_design_state(chat)}
    if failure:  # 일부 컷만 보냄
        data["warning"] = f"{len(sent)}컷만 요청했어요. 나머지는 보내지 못했어요. ({failure})"
    return jsonify(data)


def _log_credits(chat, target, model, credits, request_ids):
    for request_id in request_ids:
        db.session.add(SnsCreditLog(chat_id=chat.id, job_kind=target, model=model, credits=credits,
                                    request_id=str(request_id)[:64] if request_id else None))


def _submitted(chat, target, model, credits, request_ids, spent=None):
    """요청은 들어갔는데 결과를 화면에 연결하지 못했을 때: 크레딧만 기록하고(request_ids 건마다), 다시 누르지 말라는 안내를 JSON으로."""
    try:
        _log_credits(chat, target, model, credits, request_ids)
        db.session.commit()
    except Exception:
        current_app.logger.exception("크레딧 기록 실패")
        db.session.rollback()
    return jsonify({"ok": False, "submitted": True, "spent": spent if spent is not None else round(credits * len(request_ids), 2),
                    "error": "요청은 Higgsfield에 들어갔어요(크레딧 사용). 다시 누르지 말고, 결과는 Higgsfield 내 작업 목록에서 확인해 주세요."}), 202


@bp.route("/api/chats/<int:chat_id>/generate/status")
def generate_status(chat_id):
    """무료. 결과가 늦어도 다시 만들지 않고 상태만 확인합니다(이중 결제 방지). 완료되면 남은 크레딧도 돌려줍니다."""
    chat, target = _video_chat(chat_id), _target()
    if chat is None:
        return _error("영상 작업을 찾을 수 없습니다.", 404)
    if target is None:
        return _error("만들 것(target: image/video)이 올바르지 않습니다.")
    doc = chat.design.doc
    try:
        if target == "image":  # 만드는 중인 컷만 확인
            cuts = _cuts(doc)
            if not any(cuts):
                return _error("아직 요청한 작업이 없습니다.")
            jobs = {i: higgsfield.get_job(cut["request_id"]) for i, cut in enumerate(cuts)
                    if cut and cut.get("status") in RUNNING}
            running = any(job["status"] in RUNNING for job in jobs.values())
        else:
            request_id = (doc.get("job") or {}).get("request_id")
            if not request_id or not higgsfield.UUID.fullmatch(str(request_id)):
                return _error("아직 요청한 작업이 없습니다.")
            job = higgsfield.get_job(request_id)
            running = job["status"] in RUNNING
        balance = higgsfield.balance() if not running else None
    except higgsfield.HiggsfieldError as error:
        return _hf_error(error)
    if target == "image":
        _set_cuts(chat, jobs)
    else:
        _set_result(chat, target, job)
    db.session.commit()
    return jsonify({"ok": True, "balance": balance, "today_used": _today_used(),
                    "daily_limit": higgsfield.DAILY_LIMIT, **_design_state(chat)})


# ---------- 포스터·카드뉴스 시안 그림 (Higgsfield, 2026-10-26 유진 결정) ----------
# 새로 만들기 [보내기] → 견적(무료) → 희주 design-assistant가 쓴 장별 프롬프트로 시안 3안 × 장수 그림 생성 → 상태 확인.
# 아직 작업(chat)이 없을 때 만들므로 크레딧 기록은 chat_id 없이 남기고, 영상과 같은 하루 한도(_today_used)에 셉니다.
# 끝난 그림은 instance/uploads/content_studio/design/에 내려받아 이 서버 주소로 돌려줍니다(외부 주소 만료·PNG 내보내기 대비).
DESIGN_PROPOSALS = 3
DESIGN_PROMPT_MAX = 2000
DESIGN_IMAGE_MAX = 20 * 1024 * 1024  # 내려받을 그림 한 장 최대 20MB
DESIGN_IMAGE_TYPES = {"image/jpeg": "jpg", "image/png": "png", "image/webp": "webp"}
DESIGN_IMAGE_NAME = re.compile(r"^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.(jpg|png|webp)$")


def _design_target(body):
    """(종류, 비율, 제품 목록, 장수). 제품은 product_ids(여러 개, products.py 순서) → product_id(하나) 순서로 찾습니다.
    틀리면 ValueError(화면에 보여 줄 글)."""
    kind, ratio = body.get("kind"), body.get("ratio")
    if kind not in DESIGN_KINDS:
        raise ValueError("포스터·카드뉴스만 시안 그림을 만들 수 있습니다.")
    if ratio not in higgsfield.IMAGE_RATIOS:
        raise ValueError("비율(ratio)이 올바르지 않습니다.")
    ids = body.get("product_ids")
    products = [item for item in PRODUCTS if item["id"] in ids] if isinstance(ids, list) else []
    if not products and get_product(body.get("product_id")):
        products = [get_product(body["product_id"])]
    if not products:
        raise ValueError("제품을 골라 주세요.")
    pages = body.get("pages", 1)
    if kind == "poster":
        pages = 1
    elif isinstance(pages, bool) or not isinstance(pages, int) or not MIN_PAGES <= pages <= MAX_PAGES:
        raise ValueError(f"카드뉴스 장수는 {MIN_PAGES}~{MAX_PAGES}장입니다.")
    return kind, ratio, products, pages


def _design_refs(value):
    """레퍼런스 이미지(첫 화면 레퍼런스 칸, 희주 업로드 API로 올린 것) [{file_id, url}] → 서버 파일 경로 목록.
    없으면 []. 4장을 넘거나 업로드 주소가 아니거나 파일이 사라졌으면 ValueError."""
    if value in (None, []):
        return []
    if not isinstance(value, list) or len(value) > USER_REFS_MAX:
        raise ValueError(f"레퍼런스 이미지는 {USER_REFS_MAX}장까지입니다.")
    cleaned = [_clean_upload(item) for item in value]
    paths = [_photo_path({"image": item}) if item else None for item in cleaned]
    if not all(paths):
        raise ValueError("레퍼런스 이미지를 찾을 수 없습니다. 다시 올려 주세요.")
    return paths


# 장 프롬프트에 선물세트·포장 이야기가 있을 때만 보자기 선물세트 사진을 보냅니다. "gift mood"처럼 분위기만 말한 것에는
# 걸리지 않게 물건을 가리키는 말만 찾습니다. 연 상자·개별 포장 사진은 꼬리표 글씨를 흉내 낸 가짜 글자가 생겨 보내지 않습니다.
GIFT_WORDS = re.compile(r"gift\s*(box|set|basket)|packag|wrapped|wrapping|bojagi|h[ộo]p\s*qu[àa]|set\s*qu[àa]|"
                        r"선물\s*(세트|상자|박스)|포장|보자기", re.I)


def _design_photos(products, refs=(), with_gift=False):
    """시안 그림에 보낼 사진 [(경로, 역할 영어)]. 중요한 순서로: 자르지 않은 찹쌀떡(겉모습) → 제품별 단면
    → 레퍼런스(분위기 참고) → (with_gift일 때) 보자기 포장 선물세트.
    Higgsfield 참고 이미지 한도(higgsfield.IMAGE_REFS)를 넘으면 뒤쪽부터 빠집니다."""
    names = [(item, PRODUCT_EN.get(item["name_ko"], item["name_ko"])) for item in products]
    photos = [(_static_photo(COMMON_IMAGES["whole"]),
               "the outside of the rice cakes: round, soft and white with rice-flour dusting, the same for every flavor")]
    photos += [(_static_photo((item.get("images") or {}).get("cut")), f"the cross-section of {en}, showing its filling")
               for item, en in names]
    photos += [(path, "a mood reference (mood, composition and color only)") for path in refs]
    if with_gift:
        photos.append((_static_photo(COMMON_IMAGES["giftset_wrapped"]), "the gift set box wrapped in pink bojagi cloth"))
    return [(path, role) for path, role in photos if path]


def _design_quote(ratio, photos, pages, proposals=DESIGN_PROPOSALS):
    """무료 확인: 시안 n안(proposals) × 장수의 비용 · 남은 크레딧 · 오늘 사용량. 실행할 수 없으면 reason에 이유.
    photos: 이번에 보낼 사진(_design_photos) — 참고 사진 수에 따라 비용이 달라질 수 있어 그대로 넣어 봅니다.
    비율 바꾸기(reratio)는 proposals=1(지금 작업의 장 수만큼)."""
    count = proposals * pages
    unit = higgsfield.cost(higgsfield.design_image_args("poster", ratio, photos))
    credits = round(unit * count, 2)
    balance = higgsfield.balance()
    used = _today_used()
    reason = None
    if used + credits > higgsfield.DAILY_LIMIT:
        reason = f"오늘 대시보드 한도({higgsfield.DAILY_LIMIT})를 넘습니다. (오늘 {used:g} 사용)"
    elif credits > balance:
        reason = "계정에 남은 크레딧이 모자랍니다."
    return {"credits": credits, "unit": unit, "count": count, "pages": pages, "proposals": proposals,
            "model": higgsfield.DESIGN_IMAGE_LABEL,
            "balance": balance, "today_used": used, "daily_limit": higgsfield.DAILY_LIMIT,
            "allowed": reason is None, "reason": reason}


@bp.route("/api/design-images/quote", methods=["POST"])
def design_images_quote():
    """무료. body: {kind, ratio, product_id, pages(카드뉴스만), ref_images(선택, [{file_id, url}] 4장까지)}"""
    body = request.get_json(silent=True) or {}
    try:
        _, ratio, products, pages = _design_target(body)
        photos = _design_photos(products, _design_refs(body.get("ref_images")))
        return jsonify({"ok": True, "quote": _design_quote(ratio, photos, pages)})
    except ValueError as error:
        return _error(str(error))
    except higgsfield.HiggsfieldError as error:
        return _hf_error(error)


def _design_prompts(value, pages):
    """[[장별 프롬프트] × 3안]. 틀리면 ValueError."""
    if not isinstance(value, list) or len(value) != DESIGN_PROPOSALS:
        raise ValueError(f"시안 {DESIGN_PROPOSALS}개의 프롬프트가 필요합니다.")
    for proposal in value:
        if not isinstance(proposal, list) or len(proposal) != pages:
            raise ValueError(f"시안마다 {pages}장의 프롬프트가 필요합니다.")
        for prompt in proposal:
            if not isinstance(prompt, str) or not prompt.strip() or len(prompt) > DESIGN_PROMPT_MAX:
                raise ValueError(f"프롬프트는 1~{DESIGN_PROMPT_MAX}자여야 합니다.")
    return value


@bp.route("/api/design-images", methods=["POST"])
def design_images():
    """크레딧이 나갑니다. body: {kind, ratio, product_id(s), pages, credits(화면에서 확인한 비용), ref_images(선택, 견적과 같게),
    포스터: proposals: [{layout: "A"|"B"|"C", texts: {badge_vi, eyebrow_vi, headline_vi, sub_vi}} × 3] → 베이스 템플릿으로 조립
    카드뉴스(와 예전 방식 포스터): prompts: [[장별] × 3]}
    견적과 같고 한도 안일 때만 장마다 1건씩 보냅니다. 중간에 실패하면 거기서 멈추고 이미 보낸 것만 기록합니다.
    응답 jobs: [[{request_id, status} 또는 None(못 보냄)] × 3안], prompts: [[장별 최종 프롬프트 전문] × 3안]"""
    body = request.get_json(silent=True) or {}
    try:
        kind, ratio, products, pages = _design_target(body)
        exact = kind == "poster" and body.get("proposals") is not None
        if exact:
            style = body.get("style") or ""  # 스타일 버튼 값 ("" = AI 추천)
            if style not in higgsfield.POSTER_STYLE_KEYS:
                raise ValueError("스타일 값이 올바르지 않습니다.")
            prompts = [[higgsfield.design_poster_prompt(products, item["layout"], ratio, item["texts"], style)]
                       for item in _poster_proposals(body.get("proposals"))]
        else:
            prompts = _design_prompts(body.get("prompts"), pages)
        refs = _design_refs(body.get("ref_images"))
        photos = _design_photos(products, refs)
        confirmed = body.get("credits")
        quote = _design_quote(ratio, photos, pages)
        if confirmed is None or float(confirmed) != quote["credits"]:
            return jsonify({"ok": False, "error": "비용이 바뀌었습니다. 다시 확인해 주세요.", "quote": quote}), 409
        if not quote["allowed"]:
            return jsonify({"ok": False, "error": quote["reason"], "quote": quote}), 409
    except (TypeError, ValueError) as error:
        return _error(str(error) or "요청 값이 올바르지 않습니다.")
    except higgsfield.HiggsfieldError as error:
        return _hf_error(error)

    # 선물세트·포장 이야기가 있는 장만 선물세트 사진을 함께 보냅니다(참고 사진 수와 관계없이 장당 비용은 같음).
    # 포스터 장면 프롬프트(희주 도우미가 자유롭게 쓴 것)에는 로고 자리·금지 규칙만 붙이고, 참고 사진은 "생김새만 참고"
    scene = kind == "poster" and not exact
    args = [higgsfield.design_image_args(higgsfield.poster_scene_prompt(prompt) if scene else prompt, ratio,
                                         _design_photos(products, refs, with_gift=bool(GIFT_WORDS.search(prompt))),
                                         exact_product=exact)
            for proposal in prompts for prompt in proposal]
    flat, response = _send_design_jobs(args, None, quote)
    if response is not None and not flat:
        return response
    jobs = [flat[p * pages:(p + 1) * pages] for p in range(len(prompts))]
    # 결과 아래 "프롬프트 전문" 토글·문서 pages[].prompt 저장용. 참고 사진 문장은 보낼 때마다 붙이므로 빼고 돌려줍니다
    # (비율 다시 그리기에서 두 번 붙지 않게).
    return _design_jobs_reply(jobs, flat, response, quote, prompts=prompts)


def _poster_proposals(value):
    """포스터 시안 3안 [{layout, texts}]. 틀리면 ValueError."""
    if not isinstance(value, list) or len(value) != DESIGN_PROPOSALS:
        raise ValueError(f"시안 {DESIGN_PROPOSALS}개의 레이아웃·문구가 필요합니다.")
    out = []
    for item in value:
        if not isinstance(item, dict) or item.get("layout") not in higgsfield.POSTER_LAYOUT_KEYS:
            raise ValueError("레이아웃은 A · B · C 중 하나여야 합니다.")
        texts = item.get("texts") or {}
        if not isinstance(texts, dict) or not all(isinstance(texts.get(key, ""), str) for key in higgsfield.POSTER_TEXT_KEYS):
            raise ValueError("문구(texts) 형식이 올바르지 않습니다.")
        out.append({"layout": item["layout"], "texts": texts})
    return out


# Higgsfield 일시 오류(서버 5xx, 참고 사진 올리기 실패): 생성 전에 끊긴 것이라 크레딧이 나가지 않아 다시 보내도 됩니다.
# "응답이 늦습니다"(시간 초과)는 요청이 들어갔을 수 있어 다시 보내지 않습니다(이중 결제 방지).
TRANSIENT_HF = re.compile(r"HTTP (502|503|504|520|522|524)\b|upload_url|failed to PUT", re.I)
TRANSIENT_RETRIES, TRANSIENT_WAIT = 2, 2  # 최대 2번 더, 2초 쉬고


def _create_with_retry(args):
    for attempt in range(TRANSIENT_RETRIES + 1):
        try:
            return higgsfield.create(args)
        except higgsfield.HiggsfieldError as error:
            if attempt == TRANSIENT_RETRIES or not TRANSIENT_HF.search(str(error)):
                raise
            current_app.logger.warning("Higgsfield 일시 오류, %s초 뒤 다시 보냄 (%s/%s): %s",
                                       TRANSIENT_WAIT, attempt + 1, TRANSIENT_RETRIES, error)
            time.sleep(TRANSIENT_WAIT)


def _log_design_prompt(request_id, args, chat_id):
    """보낸 그림 프롬프트를 instance/exports/content_studio/design_prompts.jsonl에 한 줄씩 남깁니다(원인 확인용, Git 제외).
    기록 실패가 생성 자체를 막지 않게 합니다."""
    try:
        folder = os.path.join(current_app.config["EXPORT_ROOT"], "content_studio")
        os.makedirs(folder, exist_ok=True)
        record = {"at": datetime.now(KST).isoformat(timespec="seconds"), "request_id": request_id, "chat_id": chat_id,
                  "model": args[0], "ratio": args[args.index("--aspect_ratio") + 1],
                  "prompt": args[args.index("--prompt") + 1],
                  "refs": [os.path.basename(args[i + 1]) for i, part in enumerate(args) if part == "--image-references"]}
        with open(os.path.join(folder, "design_prompts.jsonl"), "a", encoding="utf-8") as out:
            out.write(json.dumps(record, ensure_ascii=False) + "\n")
    except Exception:
        current_app.logger.exception("그림 프롬프트 기록 실패")


def _send_design_jobs(arg_list, chat_id, quote):
    """그림 요청을 차례로 보내고 보낸 만큼 크레딧을 기록합니다(시안 만들기·비율 바꾸기 공용).
    돌려줌: (결과 목록 — 장마다 {request_id, status} 또는 None(못 보냄), 문제 응답 또는 None).
    일시 오류는 장마다 최대 2번 다시 보내고(_create_with_retry), 그래도 실패하면 거기서 멈춥니다.
    하나도 못 보냈으면 결과 목록이 비고 문제 응답(_hf_error)이 옵니다. 보낸 프롬프트는 파일에 남깁니다."""
    results = [None] * len(arg_list)
    sent, failure, unknown = [], None, False
    for index, args in enumerate(arg_list):
        try:
            job = _create_with_retry(args)
        except higgsfield.HiggsfieldError as error:  # CLI가 실패를 알림 → 이 건은 크레딧이 나가지 않음
            failure = error
            break
        except Exception:  # 요청은 들어갔을 수 있음 → 크레딧을 기록하고 다시 누르지 않게
            current_app.logger.exception("Higgsfield 시안 그림 응답 처리 실패")
            sent.append(None)
            unknown = True
            break
        results[index] = {"request_id": job["request_id"], "status": job["status"]}
        sent.append(job["request_id"])
        _log_design_prompt(job["request_id"], args, chat_id)
    if not sent:
        return [], _hf_error(failure)
    try:
        for request_id in sent:
            db.session.add(SnsCreditLog(chat_id=chat_id, job_kind="image", model=higgsfield.DESIGN_IMAGE_MODEL,
                                        credits=quote["unit"], request_id=str(request_id)[:64] if request_id else None))
        db.session.commit()
    except Exception:
        current_app.logger.exception("시안 그림 크레딧 기록 실패")
        db.session.rollback()
    spent = round(quote["unit"] * len(sent), 2)
    if unknown:
        return results, (jsonify({"ok": False, "submitted": True, "spent": spent, "jobs": None,
                                  "error": "요청은 Higgsfield에 들어갔어요(크레딧 사용). 다시 누르지 말고, 결과는 Higgsfield 내 작업 목록에서 확인해 주세요."}), 202)
    return results, ({"warning": f"{len(sent)}장만 요청했어요. 나머지는 보내지 못했어요. ({failure})"} if failure else None)


def _design_jobs_reply(jobs, flat, problem, quote, prompts=None):
    """보낸 결과를 화면에 돌려줄 응답으로. problem: _send_design_jobs의 두 번째 값(202 응답 또는 경고 dict 또는 None).
    prompts: 실제로 보낸 프롬프트 전문(있으면 응답에 그대로)."""
    spent = round(quote["unit"] * sum(1 for job in flat if job), 2)
    extra = {"prompts": prompts} if prompts is not None else {}
    if isinstance(problem, tuple):  # 요청은 들어갔지만 작업 ID를 못 받음(202)
        payload, status = problem
        data = payload.get_json()
        data.update(jobs=jobs, **extra)
        return jsonify(data), status
    data = {"ok": True, "jobs": jobs, "spent": spent, "today_used": quote["today_used"] + spent,
            "daily_limit": higgsfield.DAILY_LIMIT, **extra}
    if problem:
        data.update(problem)
    return jsonify(data)


# ---------- 확정 뒤 비율 바꾸기 (그림 시안 작업, 2026-10-27 유진 결정) ----------
# 그림 시안은 그림 한 장이라 비율을 바꾸려면 새로 그립니다. 장마다 저장된 프롬프트(pages[].prompt)로, 지금 그림을 참고 삼아
# 새 비율로 생성합니다(장당 크레딧, 시안 만들기와 같은 하루 한도). 상태는 design-images/status, 저장은 PUT /chats/<id>/design
# (희주 편집기가 ratio·장별 artwork src를 바꾼 새 문서를 저장 → 새 버전이라 되돌리기 가능).
def _design_image_path(src):
    """우리 서버 그림 주소(/content_studio/api/design-images/<작업ID>.png) → 파일 경로. 아니거나 없으면 None."""
    name = str(src or "").rsplit("/", 1)[-1]
    if not DESIGN_IMAGE_NAME.match(name) or src != url_for("content_studio.design_image", name=name):
        return None
    path = os.path.join(_design_image_folder(), name)
    return path if os.path.isfile(path) else None


def _reratio_target(chat, body):
    """(새 비율, [(장 프롬프트, 지금 그림 경로)], 제품 목록). 틀리면 ValueError(화면에 보여 줄 글)."""
    doc = chat.design.doc if chat.design else None
    if not doc or doc.get("mode") != IMAGE_MODE:
        raise ValueError("그림 시안 작업만 비율을 바꿔 다시 그릴 수 있습니다.")
    ratio = body.get("ratio")
    if ratio not in DESIGN_RATIOS[chat.kind] or ratio not in higgsfield.IMAGE_RATIOS:
        raise ValueError("비율(ratio)이 올바르지 않습니다.")
    if ratio == doc.get("ratio"):
        raise ValueError("지금과 같은 비율입니다.")
    pages = []
    for page in doc.get("pages") or []:
        art = next((item for item in page.get("elements") or []
                    if isinstance(item, dict) and item.get("role") == ARTWORK_ROLE), None)
        prompt, path = page.get("prompt"), _design_image_path((art or {}).get("src"))
        if not isinstance(prompt, str) or not prompt.strip() or not path:
            raise ValueError("다시 그릴 프롬프트나 그림이 없는 장이 있습니다.")
        pages.append((prompt, path))
    if not pages:
        raise ValueError("다시 그릴 장이 없습니다.")
    products = [item for item in PRODUCTS if item["id"] in str(chat.product_id or "").split(",")]
    return ratio, pages, products


def _reratio_photos(prompt, path, products):
    """장 하나의 참고 사진: 지금 그림(구성·글자 유지 참고) + 제품 사진(선물 이야기가 있으면 선물세트까지)."""
    return [(path, "the current design of this page: keep its concept, products, colors, typography style and "
                   "all of its written text, only re-compose it for the new frame"),
            *_design_photos(products, with_gift=bool(GIFT_WORDS.search(prompt)))]


def _reratio_args(ratio, pages, products, kind="poster"):
    """장마다 그림 요청 인자. 프롬프트 끝에 새 비율로 다시 배치하라는 문장을 붙입니다.
    포스터 베이스 템플릿으로 만든 장(POSTER_BASE로 시작)은 만들 때처럼 "제품은 사진과 똑같이" 문장을 쓰고,
    포스터 장면 프롬프트로 만든 장은 만들 때처럼 로고 자리·금지 규칙을 붙입니다."""
    head = higgsfield.POSTER_BASE.split("\n", 1)[0]
    orientation, frame = higgsfield.poster_frame(ratio)

    def retarget(prompt):  # 템플릿 [TYPE] 줄의 예전 비율을 새 비율로
        return re.sub(r"^\w+ premium dessert advertising poster, \d+:\d+ [\w ]+?, high-end",
                      f"{orientation} premium dessert advertising poster, {ratio} {frame}, high-end", prompt, flags=re.M)
    def full(prompt):
        if prompt.startswith(head):
            return retarget(prompt)
        return higgsfield.poster_scene_prompt(prompt) if kind == "poster" else prompt
    return [higgsfield.design_image_args(
        f"{full(prompt).strip()} Re-compose this same design for a {ratio} frame, keeping the same text.",
        ratio, _reratio_photos(prompt, path, products), exact_product=prompt.startswith(head)) for prompt, path in pages]


def _reratio_quote(ratio, pages, products):
    """무료 확인: 지금 작업의 장 수 × 장당 비용 (시안 만들기 견적과 같은 형식, proposals=1)."""
    prompt, path = pages[0]
    return _design_quote(ratio, _reratio_photos(prompt, path, products), len(pages), proposals=1)


@bp.route("/api/chats/<int:chat_id>/reratio/quote", methods=["POST"])
def reratio_quote(chat_id):
    """무료. body: {ratio}"""
    chat = _get_chat(chat_id)
    if chat is None or chat.kind not in DESIGN_KINDS:
        return _error("포스터·카드뉴스 작업을 찾을 수 없습니다.", 404)
    try:
        ratio, pages, products = _reratio_target(chat, request.get_json(silent=True) or {})
        return jsonify({"ok": True, "quote": _reratio_quote(ratio, pages, products)})
    except ValueError as error:
        return _error(str(error))
    except higgsfield.HiggsfieldError as error:
        return _hf_error(error)


@bp.route("/api/chats/<int:chat_id>/reratio", methods=["POST"])
def reratio(chat_id):
    """크레딧이 나갑니다. body: {ratio, credits(화면에서 확인한 비용)}
    응답 jobs: [{request_id, status} 또는 None(못 보냄)] (장 순서). 문서는 바꾸지 않습니다(다 되면 화면이 PUT으로 저장)."""
    chat = _get_chat(chat_id)
    if chat is None or chat.kind not in DESIGN_KINDS:
        return _error("포스터·카드뉴스 작업을 찾을 수 없습니다.", 404)
    body = request.get_json(silent=True) or {}
    try:
        ratio, pages, products = _reratio_target(chat, body)
        args = _reratio_args(ratio, pages, products, chat.kind)
        quote = _reratio_quote(ratio, pages, products)
        confirmed = body.get("credits")
        if confirmed is None or float(confirmed) != quote["credits"]:
            return jsonify({"ok": False, "error": "비용이 바뀌었습니다. 다시 확인해 주세요.", "quote": quote}), 409
        if not quote["allowed"]:
            return jsonify({"ok": False, "error": quote["reason"], "quote": quote}), 409
    except (TypeError, ValueError) as error:
        return _error(str(error) or "요청 값이 올바르지 않습니다.")
    except higgsfield.HiggsfieldError as error:
        return _hf_error(error)
    flat, response = _send_design_jobs(args, chat.id, quote)
    if response is not None and not flat:
        return response
    return _design_jobs_reply(flat, flat, response, quote)


# ---------- 그림 시안 포스터 말로 고치기 (2026-10-27 유진 결정) ----------
# 편집 화면 아래 입력창의 요청("제목 더 크게" 등)을 받아, 지금 그림을 바탕으로 요청한 곳만 고쳐 다시 그립니다(장당 크레딧).
# 문서는 바꾸지 않고 작업 ID와 새 프롬프트만 돌려줍니다. 다 되면 화면(sns.js)이 그림 주소를 바꾼 새 버전을 PUT으로 저장합니다.
REDRAW_TEXT_MAX = 300
REDRAW_PROMPT = ("Edit the attached poster (photo 1) following only this request, written in Korean: \"{request}\". "
                 "Keep everything else the same: composition, product, colors and every piece of Vietnamese text exactly "
                 "as it is, unless the request changes it. Never render the Korean request itself; any text in the image "
                 "stays Vietnamese.")


def _redraw_target(chat, body):
    """(비율, 요청 글, 원래 장면 프롬프트, 지금 그림 경로, 제품 목록). 틀리면 ValueError(화면에 보여 줄 글)."""
    doc = chat.design.doc if chat.design else None
    if chat.kind != "poster" or not doc or doc.get("mode") != IMAGE_MODE:
        raise ValueError("그림 시안 포스터만 말로 고쳐 다시 그릴 수 있습니다.")
    text = " ".join(str(body.get("text") or "").split())
    if not text:
        raise ValueError("고칠 점을 입력해 주세요.")
    if len(text) > REDRAW_TEXT_MAX:
        raise ValueError(f"고칠 점은 {REDRAW_TEXT_MAX}자 이내로 적어 주세요.")
    if doc.get("ratio") not in higgsfield.IMAGE_RATIOS:
        raise ValueError("이 작업의 비율로는 다시 그릴 수 없습니다.")
    page = (doc.get("pages") or [{}])[0]
    art = next((item for item in page.get("elements") or []
                if isinstance(item, dict) and item.get("role") == ARTWORK_ROLE), None)
    path = _design_image_path((art or {}).get("src"))
    if not path:
        raise ValueError("지금 그림 파일을 찾을 수 없습니다.")
    products = [item for item in PRODUCTS if item["id"] in str(chat.product_id or "").split(",")]
    return doc["ratio"], text, str(page.get("prompt") or "").strip(), path, products


def _redraw_photos(path, products):
    return [(path, "the current poster to edit"), *_design_photos(products)]


@bp.route("/api/chats/<int:chat_id>/redraw/quote", methods=["POST"])
def redraw_quote(chat_id):
    """무료. body: {text}"""
    chat = _get_chat(chat_id)
    if chat is None:
        return _error("작업을 찾을 수 없습니다.", 404)
    try:
        ratio, _, _, path, products = _redraw_target(chat, request.get_json(silent=True) or {})
        return jsonify({"ok": True, "quote": _design_quote(ratio, _redraw_photos(path, products), 1, proposals=1)})
    except ValueError as error:
        return _error(str(error))
    except higgsfield.HiggsfieldError as error:
        return _hf_error(error)


@bp.route("/api/chats/<int:chat_id>/redraw", methods=["POST"])
def redraw(chat_id):
    """크레딧이 나갑니다. body: {text, credits(화면에서 확인한 비용)}
    응답: jobs [{request_id, status} 또는 None], prompts [다음에 이어 쓸 프롬프트(원래 장면 + 고친 요청)]."""
    chat = _get_chat(chat_id)
    if chat is None:
        return _error("작업을 찾을 수 없습니다.", 404)
    body = request.get_json(silent=True) or {}
    try:
        ratio, text, base, path, products = _redraw_target(chat, body)
        photos = _redraw_photos(path, products)
        quote = _design_quote(ratio, photos, 1, proposals=1)
        confirmed = body.get("credits")
        if confirmed is None or float(confirmed) != quote["credits"]:
            return jsonify({"ok": False, "error": "비용이 바뀌었습니다. 다시 확인해 주세요.", "quote": quote}), 409
        if not quote["allowed"]:
            return jsonify({"ok": False, "error": quote["reason"], "quote": quote}), 409
    except (TypeError, ValueError) as error:
        return _error(str(error) or "요청 값이 올바르지 않습니다.")
    except higgsfield.HiggsfieldError as error:
        return _hf_error(error)
    request_text = text.replace('"', "'")
    prompt = REDRAW_PROMPT.format(request=request_text) + (f" Original scene: {base}" if base else "")
    args = [higgsfield.design_image_args(higgsfield.poster_scene_prompt(prompt), ratio, photos, edit=True)]
    flat, response = _send_design_jobs(args, chat.id, quote)
    if response is not None and not flat:
        return response
    # 다음 고치기·비율 다시 그리기에 쓸 프롬프트: 원래 장면 + 이번에 고친 요청 (그림에 그리지 않게 표시)
    next_prompt = (base + " " if base else "") + f"(Edited by request, do not render this note: \"{request_text}\")"
    return _design_jobs_reply(flat, flat, response, quote, prompts=[next_prompt])


def _design_image_folder():
    return os.path.join(current_app.config["UPLOAD_ROOT"], "content_studio", "design")


def _saved_design_image(request_id):
    """이미 내려받은 그림 이름. 없으면 None."""
    folder = _design_image_folder()
    for ext in DESIGN_IMAGE_TYPES.values():
        if os.path.isfile(os.path.join(folder, f"{request_id}.{ext}")):
            return f"{request_id}.{ext}"
    return None


def _download_design_image(request_id, url):
    """끝난 그림을 내려받아 저장하고 이름을 돌려줍니다. https 그림(20MB 이하)만."""
    if not isinstance(url, str) or not url.startswith("https://"):
        raise ValueError("그림 주소가 올바르지 않습니다.")
    with urllib.request.urlopen(url, timeout=60) as response:
        ext = DESIGN_IMAGE_TYPES.get((response.headers.get("Content-Type") or "").split(";")[0].strip().lower())
        if not ext:
            raise ValueError("그림 파일이 아닙니다.")
        data = response.read(DESIGN_IMAGE_MAX + 1)
    if len(data) > DESIGN_IMAGE_MAX:
        raise ValueError("그림이 너무 큽니다.")
    folder = _design_image_folder()
    os.makedirs(folder, exist_ok=True)
    name = f"{request_id}.{ext}"
    temp = os.path.join(folder, f"{name}.part")
    with open(temp, "wb") as out:
        out.write(data)
    os.replace(temp, os.path.join(folder, name))
    return name


@bp.route("/api/design-images/status")
def design_images_status():
    """무료. ?ids=작업ID,작업ID… (이 대시보드가 보낸 작업만). 다시 만들지 않고 상태만 확인합니다.
    응답 jobs: {작업ID: {status, url(끝나면 이 서버 주소, 아니면 None)}}"""
    ids = [value for value in (request.args.get("ids") or "").split(",") if value]
    if not ids or len(ids) > DESIGN_PROPOSALS * MAX_PAGES or not all(higgsfield.UUID.fullmatch(value) for value in ids):
        return _error("작업 ID(ids)가 올바르지 않습니다.")
    known = {row.request_id for row in SnsCreditLog.query.filter(SnsCreditLog.request_id.in_(ids)).all()}
    if set(ids) - known:
        return _error("이 대시보드에서 요청한 작업이 아닙니다.", 404)
    jobs = {}
    try:
        for request_id in ids:
            name = _saved_design_image(request_id)
            if name:
                jobs[request_id] = {"status": higgsfield.DONE, "url": url_for("content_studio.design_image", name=name)}
                continue
            job = higgsfield.get_job(request_id)
            url = None
            if job["status"] == higgsfield.DONE and job["url"]:
                try:
                    url = url_for("content_studio.design_image", name=_download_design_image(request_id, job["url"]))
                except (OSError, ValueError, urllib.error.URLError):
                    current_app.logger.exception("시안 그림 내려받기 실패")
                    job["status"] = "processing"  # 다음 확인에서 다시 내려받기
            jobs[request_id] = {"status": job["status"], "url": url}
        running = any(job["status"] in RUNNING for job in jobs.values())
        balance = higgsfield.balance() if not running else None
    except higgsfield.HiggsfieldError as error:
        return _hf_error(error)
    return jsonify({"ok": True, "jobs": jobs, "running": running, "balance": balance,
                    "today_used": _today_used(), "daily_limit": higgsfield.DAILY_LIMIT})


@bp.route("/api/design-images/<name>")
def design_image(name):
    if not DESIGN_IMAGE_NAME.match(name) or not os.path.isfile(os.path.join(_design_image_folder(), name)):
        return _error("그림을 찾을 수 없습니다.", 404)
    return send_from_directory(_design_image_folder(), name)
