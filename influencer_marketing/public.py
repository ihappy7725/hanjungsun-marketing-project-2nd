"""인플루언서 마케팅 → 다른 기능에 공개하는 함수 (담당: 진혁).

사용하는 곳 (README 7장)
- HOME(주연): get_collaborations(), get_today_tasks()
- KPI(민지):  get_quote_summary()

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
