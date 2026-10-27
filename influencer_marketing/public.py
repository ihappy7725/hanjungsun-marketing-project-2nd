"""인플루언서 마케팅 → 다른 기능에 공개하는 함수 (담당: 진혁).

사용하는 곳 (README 7장)
- HOME(주연): get_collaborations(), get_today_tasks(), get_home_summary()
- KPI(민지):  get_quote_summary(), get_creator_list()

규칙
- 다른 기능은 이 함수만 부르고, models.py·routes.py를 직접 import하지 않습니다.
- 오류가 나도 예외를 밖으로 던지지 않고 빈 목록([])을 돌려줍니다. 부르는 쪽 화면이 멈추지 않게 하기 위해서입니다.
- 반환 필드는 지우지 않고 추가만 합니다. 형식을 바꿀 때는 사용하는 담당자에게 먼저 알립니다.
- 날짜는 'YYYY-MM-DD' 문자열, 값이 없으면 빈 문자열("")입니다.
- 시연 데이터는 is_demo=True 로 표시됩니다. 화면에 '시연 데이터'로 구분해 주세요.
- Flask 요청 처리 중(또는 app context 안)에서 불러야 합니다.
"""

STATUS_VALUES = ["candidate", "sent", "replied", "negotiating", "confirmed", "shot", "posted", "declined"]


def _link(**params):
    try:
        from flask import url_for
        return url_for("influencer_marketing.index", **params)
    except Exception:
        return "/influencer_marketing/"


def get_collaborations(event_id=None, include_demo=True):
    """협업(인플루언서) 목록.

    Args:
        event_id (str | None): 기념일 ID로 거르기. None이면 전체.
        include_demo (bool): False면 시연 데이터를 뺍니다.

    Returns:
        list[dict], 각 항목:
            collaboration_id (str)   협업 ID (= 인플루언서 ID). 바뀌지 않습니다.
            event_id (str)           연결된 기념일 ID (현지 시장 분석의 event_id). 없으면 ""
            influencer (str)         인플루언서 이름
            main_platform (str)      대표 채널 이름 (TikTok/Facebook/YouTube/Instagram). 없으면 ""
            followers (int | None)   대표 채널 팔로워
            status (str)             candidate|sent|replied|negotiating|confirmed|shot|posted|declined
            status_label (str)       한국어 상태 이름 (예: "계약 확정")
            available_shoot_dates (list[str])  회신에서 받은 촬영 가능일
            shoot_date (str)         확정 촬영일
            post_date (str)          게시 예정일
            is_demo (bool)
            link (str)               인플루언서 마케팅 화면 주소

    Example:
        [{"collaboration_id": "inf_261023a1b2c3", "event_id": "vn_teachers_day_2026", "influencer": "...",
          "main_platform": "TikTok", "followers": 182000, "status": "confirmed", "status_label": "계약 확정",
          "available_shoot_dates": ["2026-11-05"], "shoot_date": "2026-11-05", "post_date": "2026-11-12",
          "is_demo": False, "link": "/influencer_marketing/?event_id=vn_teachers_day_2026"}]
    """
    try:
        from . import models as store
        from .routes import PLATFORM_NAME, STATUS_NAME, main_platform

        out = []
        for i in store.list_influencers():
            if event_id and i.get("eventId") != event_id:
                continue
            if not include_demo and i.get("example"):
                continue
            mp = main_platform(i)
            r = i.get("resp") or {}
            out.append({
                "collaboration_id": i["id"], "event_id": i.get("eventId") or "", "influencer": i["name"],
                "main_platform": PLATFORM_NAME.get(mp["k"], "") if mp else "", "followers": int(mp["f"]) if mp else None,
                "status": i.get("status") or "candidate", "status_label": STATUS_NAME.get(i.get("status") or "candidate", ""),
                "available_shoot_dates": list(r.get("shoot") or []), "shoot_date": i.get("confirmedShoot") or "",
                "post_date": i.get("postDate") or r.get("post") or "", "is_demo": bool(i.get("example")),
                "link": _link(event_id=i["eventId"]) if i.get("eventId") else _link(),
            })
        return out
    except Exception:
        return []


def get_today_tasks(limit=10, include_demo=True):
    """HOME '오늘 할 일'용 목록. 중요한 것부터 정렬됩니다.

    Returns:
        list[dict], 각 항목:
            task_id (str)            "<kind>:<collaboration_id>" 형태
            kind (str)               review(회신 확인) | late(회신 지연) | pick(촬영일 확정) | soon(촬영 임박) | stale(지표 오래됨)
            collaboration_id (str)
            influencer (str)
            title (str)              한 줄 설명 (예: "제안 후 9일째 회신 없음")
            detail (str)             해야 할 일
            due_date (str)           관련 날짜. 없으면 ""
            is_demo (bool)
            link (str)
    """
    try:
        from . import models as store
        from .routes import todo_items

        infs = [i for i in store.list_influencers() if include_demo or not i.get("example")]
        out = []
        for t in todo_items(infs)[:limit]:
            out.append({"task_id": f"{t['kind']}:{t['inf']['id']}", "kind": t["kind"], "collaboration_id": t["inf"]["id"],
                        "influencer": t["inf"]["name"], "title": t["title"], "detail": t["detail"], "due_date": t.get("due", ""),
                        "is_demo": bool(t["inf"].get("example")), "link": _link()})
        return out
    except Exception:
        return []


def get_quote_summary(include_demo=True):
    """KPI용 광고 단가 기록. 금액은 원래 통화와 USD·VND 환산값을 함께 줍니다.

    Returns:
        list[dict], 각 항목:
            quote_id (str), collaboration_id (str), influencer (str)
            platform (str)           TikTok/Facebook/YouTube/Instagram
            content_format (str)     예: "TikTok 영상"
            price_type (str)         public(공개 참고가) | quote(견적) | contract(계약가)
            amount (float), currency (str)   원래 금액과 통화 (VND/USD/KRW)
            amount_usd (float), amount_vnd (float)  인플루언서 마케팅 화면에 저장된 환율로 환산
            quoted_on (str)          받은 날짜
            followers (int | None), expected_views (int | None), actual_views (int | None)
            is_demo (bool)
        ※ 예산·광고비 계산 공식은 KPI(민지) 담당입니다. 여기서는 원자료만 줍니다.
    """
    try:
        from . import models as store
        from .routes import PLATFORM_NAME, quote_metrics, settings

        conf = settings()
        inf_map = {i["id"]: i for i in store.list_influencers()}
        out = []
        for q in store.list_quotes():
            if not include_demo and q.get("example"):
                continue
            m = quote_metrics(q, inf_map, conf)
            out.append({
                "quote_id": q["id"], "collaboration_id": q.get("infId") or "", "influencer": (m["inf"] or {}).get("name") or q.get("name") or "삭제됨",
                "platform": PLATFORM_NAME.get(q.get("platform"), ""), "content_format": q.get("format") or "", "price_type": q.get("layer") or "quote",
                "amount": float(q.get("amount") or 0), "currency": q.get("cur") or "VND", "amount_usd": round(m["usd"], 2),
                "amount_vnd": round(m["vnd"]), "quoted_on": q.get("date") or "", "followers": m["followers"] or None,
                "expected_views": m["exp_views"] or None, "actual_views": q.get("actualViews"), "is_demo": bool(q.get("example")),
            })
        return out
    except Exception:
        return []


PLATFORM_LABEL = {"tt": "TikTok", "yt": "YouTube", "ig": "Instagram", "fb": "Facebook"}


def get_creator_list(platform=None, segment=None):
    """베트남 크리에이터 목록(reference_data/creator_list_vn.csv) 중 대시보드에 쓰는 계정. [발굴] 화면과 같은 기준·같은 결과.

    대시보드 사용 기준: 팔로워(YouTube는 구독자) 수가 있고 1,000 이상(Nano 이상),
    분야(타깃 그룹)가 대시보드 5개 중 하나, 분류가 'D 제외'가 아님. 기준 밖 계정은 CSV에만 있고 여기서는 빠집니다.

    Args:
        platform (str | None): "TikTok" / "YouTube" / "Instagram" / "Facebook" 중 하나로 거르기. None이면 전체.
        segment (str | None): 분야(타깃 그룹) 이름으로 거르기. 예: "베트남(인) · 간식·디저트". None이면 전체.

    Returns:
        list[dict] (팔로워 많은 순), 각 항목:
            creator_id (str)          레코드 ID. 바뀌지 않습니다 (예: "R3-TT-001", "G-TT-005")
            name (str)                계정명
            platform (str)            TikTok/YouTube/Instagram/Facebook
            followers (int)           팔로워 수 (YouTube는 구독자 수)
            tier (str)                규모: Nano/Micro/Mid/Macro/Mega
            segment (str)             분야(타깃 그룹). 예: "베트남(인) · 식품(맛집·먹방)"
            category (str)            세부 분야. 예: "맛집 리뷰"
            profile_url (str)         프로필 주소. 없으면 ""
            follower_source (str)     팔로워 수 출처 사이트·기사 이름
            follower_source_url (str) 출처 주소. 없으면 ""
            follower_as_of (str)      출처의 기준일(출처마다 표기가 다를 수 있음). 없으면 ""
            list_as_of (str)          목록 기준일 'YYYY-MM-DD'
            is_demo (bool)            시연 데이터 여부 (이 목록은 실제 계정 자료라 False)
        ※ 팔로워 수는 모두 제3자 추정치(직접 확인 전)이며, 단가·견적 정보는 없습니다.
          견적·계약 금액은 get_quote_summary()를 쓰세요.
    """
    try:
        from . import discovery as disc
        from .routes import TIERS

        src = next((s for s in disc._ref_manifest() if s["file"] == "creator_list_vn.csv"), None)
        if not src:
            return []
        rows, _err = disc._ref_load(src)
        out = []
        for r in rows:
            if not disc.dashboard_usable(r):
                continue
            pf = PLATFORM_LABEL.get(r.get("platform"), "")
            if (platform and pf != platform) or (segment and r.get("segment") != segment):
                continue
            f = int(r["followers"])
            tier = next((t["n"] for t in TIERS if f >= t["min"] and (t.get("max") is None or f < t["max"])), "")
            out.append({
                "creator_id": r.get("record_id") or "", "name": disc.plain_name(r.get("name") or "") or r.get("name") or "",
                "platform": pf, "followers": f, "tier": tier, "segment": r.get("segment") or "", "category": r.get("category") or "",
                "profile_url": r.get("url") or "", "follower_source": r.get("fol_source") or "",
                "follower_source_url": r.get("fol_source_url") or "", "follower_as_of": r.get("fol_as_of") or "",
                "list_as_of": src.get("as_of") or "", "is_demo": src.get("kind") == "demo",
            })
        out.sort(key=lambda x: -x["followers"])
        return out
    except Exception:
        return []


# HOME 요약용: 할 일 종류 (인플루언서 '요약' 화면의 오늘의 할 일과 같은 순서·같은 기준)
TASK_KINDS = [
    ("review", "회신 확인 필요"), ("late", "제안 후 7일 넘게 회신 없음"), ("pick", "촬영일 확정 대기"), ("soon", "14일 안 촬영"),
    ("outlier", "단가 이상값"), ("need_url", "주소 직접 확인 필요"), ("unsent", "제안 미발송"), ("stale", "지표 기준일 45일 지남"),
]
_CONFIRMED = ("confirmed", "shot", "posted")


def _summary_block(influencers, quotes, inf_map, conf, today):
    """인플루언서 '요약' 화면(influencer_main.js overview)과 같은 계산."""
    from .routes import quote_metrics, todo_items

    funnel = {
        "registered": len(influencers),
        "sent": sum(1 for i in influencers if i.get("sentAt")),
        "replied": sum(1 for i in influencers if i.get("sentAt") and i.get("resp")),
        "confirmed": sum(1 for i in influencers if i.get("status") in _CONFIRMED),
    }
    tasks = {k: 0 for k, _ in TASK_KINDS}
    for t in todo_items(influencers, today):
        tasks[t["kind"]] = tasks.get(t["kind"], 0) + 1
    for q in quotes:
        m = quote_metrics(q, inf_map, conf)
        if m["tier"] and m["usd"]:
            lo, hi = m["tier"]["usd"]
            if m["usd"] > (hi or lo) * 10 or m["usd"] < lo / 10:
                tasks["outlier"] += 1
    tasks["need_url"] = sum(1 for i in influencers
                            if any(ch and ch.get("need_url") and not ch.get("url") for ch in (i.get("pf") or {}).values()))
    tasks["unsent"] = sum(1 for i in influencers if (i.get("status") or "candidate") == "candidate" and not i.get("sentAt"))
    return {"funnel": funnel, "tasks": tasks, "task_total": sum(tasks.values())}


def get_home_summary():
    """HOME용 인플루언서 '요약' — 진행 단계 인원과 확인할 일의 종류별 건수.
    인플루언서 탭 '요약' 화면과 같은 계산 기준이며, 실제 자료·시연(DEMO)·합계를 따로 줍니다.

    Returns:
        dict:
            ok (bool)        True면 정상 조회(0건이어도 True). False면 조회 실패 — 숫자 대신 "불러오지 못함"으로 표시하세요.
            error (str)      실패 이유(ok=False일 때). 정상이면 ""
            as_of (str)      계산 기준일 'YYYY-MM-DD'
            real / demo / all (dict)   실제 자료만 / 시연 데이터만 / 둘 다 합친 값. 각 dict:
                funnel (dict)    registered(등록) · sent(제안 보냄) · replied(회신 받음) · confirmed(확정: 계약 확정·촬영 완료·게시 완료) 인원
                tasks (dict)     할 일 종류별 건수 — 키는 TASK_KINDS 순서:
                                 review(회신 확인 필요) · late(제안 후 7일 넘게 회신 없음) · pick(촬영일 확정 대기) ·
                                 soon(14일 안 촬영) · outlier(단가 이상값) · need_url(주소 직접 확인 필요) ·
                                 unsent(제안 미발송) · stale(지표 기준일 45일 지남)
                task_total (int) tasks 합계
            task_labels (dict)   tasks 키 → 한국어 이름
            link (str)           인플루언서 탭 주소
        실패 시에도 같은 키를 주되 숫자는 모두 0, ok=False 입니다.
    """
    labels = dict(TASK_KINDS)
    empty = {"funnel": {"registered": 0, "sent": 0, "replied": 0, "confirmed": 0},
             "tasks": {k: 0 for k, _ in TASK_KINDS}, "task_total": 0}
    base = {"as_of": "", "task_labels": labels, "link": _link()}
    try:
        from . import models as store
        from .routes import settings, today_str

        conf, today = settings(), today_str()
        infs, quotes = store.list_influencers(), store.list_quotes()
        inf_map = {i["id"]: i for i in infs}
        pick = lambda rows, demo: [x for x in rows if bool(x.get("example")) == demo]
        return {"ok": True, "error": "", **base, "as_of": today,
                "real": _summary_block(pick(infs, False), pick(quotes, False), inf_map, conf, today),
                "demo": _summary_block(pick(infs, True), pick(quotes, True), inf_map, conf, today),
                "all": _summary_block(infs, quotes, inf_map, conf, today)}
    except Exception as e:  # 부르는 쪽(HOME)이 멈추지 않도록 예외 대신 ok=False
        return {"ok": False, "error": f"인플루언서 요약을 불러오지 못했어요 ({e.__class__.__name__})", **base,
                "real": empty, "demo": empty, "all": empty}
