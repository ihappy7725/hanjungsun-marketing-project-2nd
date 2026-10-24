"""화면, 대화·이전 작업·버전·첫 화면 API, 영상 API. [유진]

API는 /content_studio/api/... 아래에 둡니다.
포스터·카드뉴스를 대화로 고치는 규칙은 designs.py(희주)에 있고, 여기서는 부르기만 합니다.
"""
from datetime import datetime, timezone

from flask import jsonify, render_template, request

from platform_core.extensions import db

from . import bp
from .models_sns import KINDS, SnsChat, SnsDesign, SnsMessage
from .products import PRODUCTS, get_product
from .videos import make_draft, normalize_scenes, refresh_prompts, revise_draft

TABS = ("poster", "cardnews", "video")
REVISE_HINT = '예: 더 밝게, 카메라 천천히, 10초로, 소리 켜줘, 2번 자막 "…"'


@bp.route("/")
def index():
    tab = request.args.get("tab", "poster")
    if tab not in TABS:
        tab = "poster"
    return render_template("content_studio/content_studio_index.html", tab=tab)


# ---------- 도우미 ----------
def _error(message, status=400):
    return jsonify({"ok": False, "error": message}), status


def _get_chat(chat_id):
    return db.session.get(SnsChat, chat_id)


def _chat_info(chat):
    return {
        "id": chat.id,
        "kind": chat.kind,
        "title": chat.title,
        "product_id": chat.product_id,
        "event_id": chat.event_id,
        "updated_at": chat.updated_at.isoformat(),
    }


def _design_state(chat):
    design = chat.design
    return {
        "design": design.doc if design else None,
        "can_undo": bool(design and design.can_undo),
        "can_redo": bool(design and design.can_redo),
    }


def _touch(chat):
    chat.updated_at = datetime.now(timezone.utc)


def _find_product(product_id, text):
    """product_id가 없으면 요청 문장 속 제품 이름으로 찾습니다. (긴 이름 먼저: '망고스틴 찹쌀떡' > '찹쌀떡')"""
    if product_id:
        return get_product(product_id)
    for product in sorted(PRODUCTS, key=lambda item: len(item["name_ko"]), reverse=True):
        if product["name_ko"] in text:
            return product
    return None


def _call_ai(kind, text, doc):
    """AI(GPT) 연결 자리 (README 2장). 연결 전에는 None을 돌려주고, 단어 규칙(videos.py)을 씁니다."""
    return None


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
    if kind != "video":
        return _error("포스터·카드뉴스 대화는 희주 담당 designs.py 연결 후 사용할 수 있습니다.", 501)

    chat = _get_chat(body["chat_id"]) if body.get("chat_id") else None
    if body.get("chat_id") and chat is None:
        return _error("작업을 찾을 수 없습니다.", 404)
    if chat and chat.kind != kind:
        return _error("이 작업은 다른 탭의 작업입니다.")

    changes = []
    if chat is None:
        product = _find_product(body.get("product_id"), text)
        if product is None:
            names = " / ".join(item["name_ko"] for item in PRODUCTS)
            return jsonify({"ok": True, "chat_id": None, "ask": "product", "reply": f"어떤 제품으로 만들까요? ({names})",
                            "changes": [], "design": None, "can_undo": False, "can_redo": False, "demo": True})
        try:
            duration = int(body.get("duration") or 5)
        except (TypeError, ValueError):
            duration = 5
        doc = _call_ai(kind, text, None) or make_draft(
            text,
            ratio=body.get("ratio") or "9:16",
            duration=duration,
            sound=bool(body.get("sound")),
            product=product["name_ko"],
            event=body.get("event"),
        )
        # 기념일 ID가 아직 없어(현지 시장 분석 get_events 준비 중) 이름을 그대로 저장합니다.
        chat = SnsChat(kind=kind, title=text[:40], product_id=product["id"], event_id=body.get("event"),
                       file_id=body.get("file_id"))
        chat.design = SnsDesign()
        chat.design.push(doc)
        db.session.add(chat)
        reply = f"{len(doc['scenes'])}컷 초안을 만들었어요. 프롬프트와 자막을 검토해 주세요."
    else:
        current = chat.design.doc if chat.design else None
        if current is None:
            return _error("이 작업에는 고칠 결과물이 없습니다.")
        doc = _call_ai(kind, text, current)
        if doc is None:
            doc, changes = revise_draft(current, text)
        if changes:
            chat.design.push(doc)
            reply = "바꿨어요: " + ", ".join(changes)
            if not doc["reviewed"]:
                reply += ". 영상이 바뀌어 프롬프트를 다시 검토해 주세요."
        else:
            reply = f"어떻게 고칠지 알아듣지 못했어요. {REVISE_HINT}"

    chat.messages.append(SnsMessage(role="user", text=text))
    chat.messages.append(SnsMessage(role="assistant", text=reply))
    _touch(chat)
    db.session.commit()
    return jsonify({"ok": True, "chat_id": chat.id, "reply": reply, "changes": changes, **_design_state(chat), "demo": True})


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
    kind = request.args.get("kind")
    if kind not in KINDS:
        return _error("탭 종류(kind)가 올바르지 않습니다.")
    items = []
    for chat in SnsChat.query.filter_by(kind=kind).order_by(SnsChat.updated_at.desc()):
        doc = chat.design.doc if chat.design else None
        item = {**_chat_info(chat)}
        if kind == "video" and doc:
            item.update({
                "summary": doc["summary"],
                "ratio": doc["ratio"],
                "duration": doc["duration"],
                "scenes": doc["scenes"],
                "video_url": doc["job"].get("video_url"),
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
    if chat.kind == "video":
        # 직접 고친 프롬프트(custom)·장면이 바뀌어 영상이 달라지면 다시 검토가 필요합니다.
        before = chat.design.doc
        try:
            doc = refresh_prompts(normalize_scenes(doc))  # 직접 고친 장면 시간 검사 + 영어·한국어 프롬프트
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
