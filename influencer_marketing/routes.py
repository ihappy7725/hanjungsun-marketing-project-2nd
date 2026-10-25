"""인플루언서 마케팅 화면·요청 처리 (담당: 진혁).

화면:  GET  /influencer_marketing/                (?event_id=... 로 기념일별 보기)
보고서: GET  /influencer_marketing/report          (브라우저에서 PDF로 저장)
API:   /influencer_marketing/api/...              (아래 각 함수 참고)
CSV:   /influencer_marketing/export/<종류>.csv
"""
import csv
import io
import re
import secrets
from datetime import date, datetime, timedelta

from flask import Response, jsonify, render_template, request, url_for

from . import bp
from . import discovery as disc
from . import external_api as ext
from . import models as store

# ---------------------------------------------------------------- 기준값
PLATFORMS = [("tt", "TikTok"), ("fb", "Facebook"), ("yt", "YouTube"), ("ig", "Instagram")]
PLATFORM_NAME = dict(PLATFORMS)
STATUSES = [
    ("candidate", "후보"), ("sent", "제안 발송"), ("replied", "회신 받음"), ("negotiating", "협상 중"),
    ("confirmed", "계약 확정"), ("shot", "촬영 완료"), ("posted", "게시 완료"), ("declined", "불가·보류"),
]
STATUS_NAME = dict(STATUSES)
CATEGORIES = ["디저트·먹방", "맛집 리뷰", "라이프스타일", "가족·육아", "K-컬처", "뷰티", "여행", "기타"]
CITIES = ["호치민", "하노이", "다낭", "기타"]
METRIC_SOURCES = ["직접 확인", "인플루언서 제출", "YouTube API", "Phyllo", "Instagram API", "TikTok One", "에이전시 자료",
                  "Modash", "HypeAuditor"]  # 뒤 2개는 발굴 기능에서 추가 (기존 값 유지)
PRICE_TYPES = {"public": "공개 참고가", "quote": "견적", "contract": "계약가"}
CURRENCIES = ["VND", "USD", "KRW"]
CONTENT_FORMATS = ["TikTok 영상", "Facebook 게시물", "Facebook Reels", "YouTube 영상", "YouTube Shorts", "Instagram Reels", "라이브 방송"]
# Best Martech 2026 가격표 KOL & KOC 항목 (게시물 1건, USD, VAT·광고비 별도). 개별 계약가가 아닌 공개 참고가.
TIERS = [
    {"k": "nano", "n": "Nano", "min": 0, "max": 10_000, "label": "1천~1만", "usd": [40, 190]},
    {"k": "micro", "n": "Micro", "min": 10_000, "max": 50_000, "label": "1만~5만", "usd": [190, 380]},
    {"k": "mid", "n": "Mid", "min": 50_000, "max": 100_000, "label": "5만~10만", "usd": [380, 765]},
    {"k": "macro", "n": "Macro", "min": 100_000, "max": 500_000, "label": "10만~50만", "usd": [765, 1910]},
    {"k": "mega", "n": "Mega", "min": 500_000, "max": None, "label": "50만 이상", "usd": [1910, None]},
]
DEFAULT_SETTINGS = {
    "brand": "한정선", "brandVi": "Hanjeongseon", "product": "찹쌀떡",
    "productVi": "bánh nếp Hàn Quốc Chapssaltteok", "productEn": "Korean chapssal-tteok (sweet rice cakes)",
    "company": "", "sender": "", "senderEmail": "", "senderZalo": "",
    "feeText": "협의 (팔로워·형식별 제안)", "feeVi": "Thỏa thuận theo kênh và hình thức nội dung",
    "feeEn": "Negotiable, based on channel and format",
    "period": "2026-12-01 ~ 2026-12-31", "deadline": "", "formLink": "",
    "guideKo": "- 영상 시작과 진행 중에 광고·협찬임을 분명히 표시 (예: \"Quảng cáo\" 표기, #QuangCao)\n- 제품을 직접 먹어 본 뒤 실제 경험만 이야기하기\n- 질병 예방·치료 등 건강 효능 표현 금지\n- 게시 전 초안 공유 후 확인받기",
    "guideVi": "- Ghi rõ đây là nội dung quảng cáo/hợp tác ở đầu và trong suốt video (ví dụ: nhãn \"Quảng cáo\", #QuangCao)\n- Chỉ chia sẻ trải nghiệm thật sau khi đã dùng thử sản phẩm\n- Không nêu công dụng phòng hay chữa bệnh của thực phẩm\n- Gửi bản nháp để chúng mình xem trước khi đăng",
    "guideEn": "- Clearly label the content as an ad/sponsored at the start and throughout (e.g. \"Quảng cáo\", #QuangCao)\n- Share only your genuine experience after trying the product\n- No claims that the food prevents or treats any illness\n- Please send a draft for review before posting",
    "vndPerUsd": 26300, "krwPerUsd": 1400,  # 예시값. 환율은 자동으로 가져오지 않고 사용자가 직접 입력합니다
    "rateSavedAt": "",  # 사용자가 환율을 직접 저장한 날 (비어 있으면 아직 예시값)
}

# ---------------------------------------------------------------- 시연 데이터 (실제 인물 아님)
DEMO_INFLUENCERS = [
    {"id": "demo_inf_a", "name": "크리에이터 A", "handle": "@vd_banhngot_a", "category": "디저트·먹방", "segment": disc.SEGMENT_NAMES[1], "city": "호치민",
     "email": "creator.a@example.com", "pf": {"tt": {"f": 182000, "v": 46000, "url": ""}, "fb": {"f": 95000, "v": 12000, "url": ""}},
     "metricsDate": "2026-10-15", "metricsSource": "인플루언서 제출", "status": "confirmed", "sentAt": "2026-10-08T09:00:00",
     "confirmedShoot": "2026-11-05", "postDate": "2026-11-12", "notes": "샘플 30개 발송 예정", "eventId": "",
     "resp": {"avail": "yes", "neg": ["2026-10-24"], "shoot": ["2026-11-05", "2026-11-07"], "post": "2026-11-12", "fee": 18000000,
              "cur": "VND", "formats": ["TikTok 영상"], "note": "팥 앙금 맛 위주로 시식 영상 희망", "review": False, "ambig": [],
              "raw": "", "via": "form", "at": "2026-10-14T10:00:00"}},
    {"id": "demo_inf_b", "name": "크리에이터 B", "handle": "@vd_anvat_b", "category": "맛집 리뷰", "segment": disc.SEGMENT_NAMES[0], "city": "하노이",
     "email": "creator.b@example.com", "pf": {"tt": {"f": 42000, "v": 15000, "url": ""}, "ig": {"f": 18000, "v": 4200, "url": ""}},
     "metricsDate": "2026-10-16", "metricsSource": "직접 확인", "status": "replied", "sentAt": "2026-10-09T09:00:00", "eventId": "",
     "resp": {"avail": "cond", "neg": ["2026-10-28"], "shoot": ["2026-11-10", "2026-11-12"], "post": "", "fee": 6500000, "cur": "VND",
              "formats": ["TikTok 영상", "Instagram Reels"], "note": "영상 2차 활용은 3개월까지만 가능하다는 조건", "review": True,
              "ambig": ["10/11 표기가 일/월인지 확인 필요"], "raw": "1) B - có thể nếu chỉ dùng lại video trong 3 tháng\n2) 28/10\n3) 10/11 hoặc 12/11\n5) 6,5 triệu",
              "via": "rule", "at": "2026-10-17T15:00:00"}},
    {"id": "demo_inf_c", "name": "크리에이터 C", "handle": "@vd_meva_be_c", "category": "가족·육아", "segment": disc.SEGMENT_NAMES[3], "city": "다낭",
     "email": "creator.c@example.com", "manager": "시연 매니지먼트",
     "pf": {"fb": {"f": 310000, "v": 38000, "url": ""}, "yt": {"f": 120000, "v": 21000, "url": ""}},
     "metricsDate": "2026-10-10", "metricsSource": "에이전시 자료", "status": "sent", "sentAt": "2026-10-12T09:00:00", "notes": "매니저 경유 연락", "eventId": ""},
    {"id": "demo_inf_d", "name": "크리에이터 D", "handle": "@vd_kfood_d", "category": "K-컬처", "segment": disc.SEGMENT_NAMES[2], "city": "호치민",
     "email": "creator.d@example.com", "pf": {"yt": {"f": 640000, "v": 150000, "url": ""}, "tt": {"f": 520000, "v": 210000, "url": ""}},
     "metricsDate": "2026-10-18", "metricsSource": "YouTube API", "status": "negotiating", "sentAt": "2026-10-07T09:00:00", "notes": "단가 협상 중", "eventId": "",
     "resp": {"avail": "yes", "neg": ["2026-10-27"], "shoot": ["2026-11-05", "2026-11-14"], "post": "2026-11-20", "fee": 2600, "cur": "USD",
              "formats": ["YouTube 영상", "YouTube Shorts"], "note": "", "review": False, "ambig": [], "raw": "", "via": "manual", "at": "2026-10-15T11:00:00"}},
    {"id": "demo_inf_e", "name": "크리에이터 E", "handle": "@vd_songdep_e", "category": "라이프스타일", "segment": disc.SEGMENT_NAMES[3], "city": "하노이",
     "email": "creator.e@example.com", "pf": {"ig": {"f": 26000, "v": 7000, "url": ""}, "tt": {"f": 9000, "v": 3500, "url": ""}},
     "metricsDate": "2026-08-20", "metricsSource": "직접 확인", "status": "candidate", "eventId": ""},
    {"id": "demo_inf_f", "name": "크리에이터 F", "handle": "@vd_review_f", "category": "맛집 리뷰", "segment": disc.SEGMENT_NAMES[0], "city": "호치민",
     "email": "creator.f@example.com", "pf": {"tt": {"f": 75000, "v": 9000, "url": ""}}, "metricsDate": "2026-10-11",
     "metricsSource": "TikTok One", "status": "declined", "sentAt": "2026-10-08T09:00:00", "eventId": "",
     "resp": {"avail": "no", "neg": [], "shoot": [], "post": "", "fee": None, "cur": "VND", "formats": [], "note": "12월까지 일정이 차 있음",
              "review": False, "ambig": [], "raw": "", "via": "manual", "at": "2026-10-13T09:00:00"}},
    {"id": "demo_inf_g", "name": "크리에이터 G", "handle": "@vd_danang_trip_g", "category": "여행", "segment": disc.SEGMENT_NAMES[4], "city": "다낭",
     "email": "creator.g@example.com", "pf": {"yt": {"f": 86000, "v": 24000, "url": ""}}, "metricsDate": "2026-10-20",
     "metricsSource": "직접 확인", "status": "candidate", "notes": "한국인 2030 대상 다낭 여행 브이로그", "eventId": ""},
]
DEMO_QUOTES = [
    {"id": "demo_q_1", "infId": "demo_inf_a", "name": "크리에이터 A", "platform": "tt", "format": "TikTok 영상", "layer": "contract",
     "date": "2026-10-20", "amount": 18000000, "cur": "VND", "followers": 182000, "actualViews": 61000, "cond": "VAT 별도, 2차 활용 1개월"},
    {"id": "demo_q_2", "infId": "demo_inf_b", "name": "크리에이터 B", "platform": "tt", "format": "TikTok 영상", "layer": "quote",
     "date": "2026-10-19", "amount": 6500000, "cur": "VND", "followers": 42000, "cond": "2차 활용 3개월"},
    {"id": "demo_q_3", "infId": "demo_inf_d", "name": "크리에이터 D", "platform": "yt", "format": "YouTube 영상", "layer": "quote",
     "date": "2026-10-18", "amount": 2600, "cur": "USD", "followers": 640000, "cond": "제작비 포함"},
    {"id": "demo_q_4", "infId": "demo_inf_c", "name": "크리에이터 C", "platform": "fb", "format": "Facebook Reels", "layer": "quote",
     "date": "2026-10-21", "amount": 24000000, "cur": "VND", "followers": 310000, "cond": "에이전시 수수료 포함"},
]


# ---------------------------------------------------------------- 공통 계산 (public.py도 사용)
def today_str():
    return date.today().isoformat()


def new_id(prefix):
    return f"{prefix}_{datetime.now().strftime('%y%m%d')}{secrets.token_hex(3)}"


def days_between(a, b):
    return (date.fromisoformat(b) - date.fromisoformat(a)).days


def settings():
    saved = store.get_setting("campaign", {}) or {}
    return {**DEFAULT_SETTINGS, **saved}


def main_platform(inf):
    best = None
    for key, _ in PLATFORMS:
        ch = (inf.get("pf") or {}).get(key) or {}
        f = ch.get("f") or 0
        if f and (best is None or f > best["f"]):
            best = {"k": key, "f": f, "v": ch.get("v") or 0}
    return best


def tier_of(followers):
    for t in TIERS:
        if followers >= t["min"] and (t["max"] is None or followers < t["max"]):
            return t
    return TIERS[0]


def to_usd(amount, currency, conf=None):
    conf = conf or settings()
    amount = float(amount or 0)
    if currency == "USD":
        return amount
    if currency == "KRW":
        return amount / (float(conf.get("krwPerUsd") or 1400))
    return amount / (float(conf.get("vndPerUsd") or 26300))


def quote_metrics(q, inf_map, conf):
    inf = inf_map.get(q.get("infId"))
    ch = ((inf or {}).get("pf") or {}).get(q.get("platform")) or {}
    followers = q.get("followers") or ch.get("f") or 0
    exp_views = q.get("expViews") or ch.get("v") or 0
    usd = to_usd(q.get("amount"), q.get("cur"), conf)
    vnd = usd * float(conf.get("vndPerUsd") or 26300)
    tier = tier_of(followers) if followers else None
    compare = None
    if tier:
        lo, hi = tier["usd"]
        compare = "lo" if usd < lo else ("hi" if hi and usd > hi else "in")
    return {
        "inf": inf, "followers": followers, "exp_views": exp_views, "usd": usd, "vnd": vnd, "tier": tier, "compare": compare,
        "per_1k_views": vnd / exp_views * 1000 if exp_views else None,
        "per_1k_followers": vnd / followers * 1000 if followers else None,
        "per_view_actual": vnd / q["actualViews"] if q.get("actualViews") else None,
    }


def calendar_events(influencers):
    """협의 가능(neg)·촬영 가능(shoot)·촬영 확정(conf)·게시(post) 일정 목록."""
    events = []
    for inf in influencers:
        r = inf.get("resp") or {}
        for d in r.get("neg") or []:
            events.append({"date": d, "type": "neg", "inf": inf})
        if not inf.get("confirmedShoot"):
            for d in r.get("shoot") or []:
                events.append({"date": d, "type": "shoot", "inf": inf})
        else:
            events.append({"date": inf["confirmedShoot"], "type": "conf", "inf": inf})
        post = inf.get("postDate") or r.get("post")
        if post:
            events.append({"date": post, "type": "post", "inf": inf})
    by_day = {}
    for e in events:
        if e["type"] == "conf":
            by_day.setdefault(e["date"], []).append(e)
    for same_day in by_day.values():
        if len(same_day) > 1:
            for e in same_day:
                e["clash"] = True
    return events


def todo_items(influencers, today=None):
    """회신 지연·회신 확인·촬영일 확정·촬영 임박·지표 오래됨. 우선순위 순."""
    today = today or today_str()
    items = []
    for inf in influencers:
        r = inf.get("resp") or {}
        status = inf.get("status") or "candidate"
        sent = (inf.get("sentAt") or "")[:10]
        if status == "sent" and sent and not inf.get("resp") and days_between(sent, today) >= 7:
            items.append({"kind": "late", "p": 2, "inf": inf, "title": f"제안 후 {days_between(sent, today)}일째 회신 없음",
                          "detail": "Zalo나 메신저로 한 번 더 연락해 보세요"})
        if r.get("review"):
            items.append({"kind": "review", "p": 1, "inf": inf, "title": "회신 내용 확인 필요",
                          "detail": " · ".join(r.get("ambig") or []) or "자동 정리 결과를 확인해야 해요"})
        if status in ("replied", "negotiating") and r.get("avail") != "no" and not inf.get("confirmedShoot") and r.get("shoot"):
            items.append({"kind": "pick", "p": 3, "inf": inf, "title": f"촬영 가능일 {len(r['shoot'])}개 중 확정 필요",
                          "detail": "일정 탭에서 촬영일을 확정하세요"})
        cs = inf.get("confirmedShoot")
        if cs and status == "confirmed" and cs >= today and days_between(today, cs) <= 14:
            items.append({"kind": "soon", "p": 4, "inf": inf, "title": f"촬영 {cs} (D-{days_between(today, cs)})",
                          "detail": "샘플 배송과 촬영 가이드 전달 여부를 확인하세요", "due": cs})
        md = inf.get("metricsDate")
        if md and status not in ("declined", "posted") and days_between(md, today) > 45:
            items.append({"kind": "stale", "p": 5, "inf": inf, "title": f"지표 기준일이 {days_between(md, today)}일 지남",
                          "detail": "팔로워·조회수를 다시 확인하세요"})
    return sorted(items, key=lambda x: x["p"])


def market_events():
    """현지 시장 분석(상준)의 기념일 목록. 아직 없거나 오류가 나도 빈 목록으로 처리합니다."""
    try:
        from market_analysis.public import get_events  # README 7장: 인플루언서 마케팅 → market_analysis/public.py 허용
        rows = get_events() or []
        return [{"event_id": e.get("event_id"), "name": e.get("name", ""), "date": e.get("date", "")}
                for e in rows if isinstance(e, dict) and e.get("event_id")]
    except Exception:
        return []


# ---------------------------------------------------------------- 회신 자동 정리 (규칙 기반)
_DATE_RE = re.compile(r"(\d{1,2})[/\-.](\d{1,2})(?:[/\-.](\d{2,4}))?")
_FEE_RE = [re.compile(r"(\d[\d.,]*)\s*(triệu|trieu|tr\b|million)", re.I),
           re.compile(r"(\d[\d.,]{3,})\s*(vnd|vnđ|đồng|dong|đ|₫)", re.I)]


def blank_reply():
    return {"avail": "", "neg": [], "shoot": [], "post": "", "fee": None, "cur": "VND", "formats": [], "note": "",
            "review": True, "ambig": [], "raw": "", "via": "rule"}


def _guess_year(day, month, today):
    """연도가 없으면 올해로 보고, 60일 넘게 지난 날짜면 내년으로 봅니다."""
    y = today.year
    try:
        d = date(y, month, day)
    except ValueError:
        return None
    if (today - d).days > 60:
        y += 1
    return y


def parse_reply(text, today=None):
    """베트남어·영어·한국어 회신에서 가능 여부·날짜(dd/mm)·희망 비용을 뽑습니다. 결과는 반드시 사람이 확인합니다."""
    today = today or date.today()
    r = blank_reply()
    r["raw"] = text
    low = text.lower()
    m = re.search(r"1\)[^\n]*?\b([abc])\b", text, re.I)
    if m:
        r["avail"] = {"a": "yes", "b": "cond", "c": "no"}[m.group(1).lower()]
    elif re.search(r"không thể|từ chối|rất tiếc|unfortunately|can'?t|cannot|not available|불가|어렵", low):
        r["avail"] = "no"
    elif re.search(r"điều kiện|nếu|condition|if you|조건", low):
        r["avail"] = "cond"
    elif re.search(r"có thể|đồng ý|sẵn sàng|\bok\b|\byes\b|happy to|가능", low):
        r["avail"] = "yes"

    context = "shoot"
    for line in text.splitlines():
        l = line.lower()
        if re.search(r"2\)|trao đổi|thống nhất|discuss|meet|협의", l):
            context = "neg"
        elif re.search(r"3\)|quay|film|shoot|촬영", l):
            context = "shoot"
        elif re.search(r"4\)|đăng|post|upload|게시", l):
            context = "post"
        for dm in _DATE_RE.finditer(line):
            day, month = int(dm.group(1)), int(dm.group(2))
            if not (1 <= day <= 31 and 1 <= month <= 12):
                continue
            year = dm.group(3)
            year = (int(year) + 2000 if len(year) == 2 else int(year)) if year else _guess_year(day, month, today)
            try:
                iso = date(year, month, day).isoformat()
            except (TypeError, ValueError):
                continue
            if day <= 12 and day != month:
                r["ambig"].append(f"{dm.group(0)}을 {month}월 {day}일(일/월 순서)로 읽었어요")
            if context == "neg":
                r["neg"].append(iso)
            elif context == "post":
                r["post"] = r["post"] or iso
            else:
                r["shoot"].append(iso)
        if r["fee"] is None:
            for rx in _FEE_RE:
                fm = rx.search(line)
                if fm:
                    raw = re.sub(r"[.,](?=\d{3}\b)", "", fm.group(1)).replace(",", ".")
                    try:
                        n = float(raw)
                    except ValueError:
                        continue
                    if re.match(r"tri|tr|million", fm.group(2), re.I):
                        n *= 1_000_000
                    r["fee"] = int(round(n))
                    break
    r["neg"] = sorted(set(r["neg"]))
    r["shoot"] = sorted(set(r["shoot"]))
    r["ambig"] = list(dict.fromkeys(r["ambig"]))[:3]
    if not r["avail"]:
        r["ambig"].insert(0, "협업 가능 여부를 찾지 못했어요")
    r["note"] = text.strip()[:300]
    return r


# ---------------------------------------------------------------- 입력 검증
class InputError(ValueError):
    pass


def _num(v):
    if v in (None, ""):
        return None
    try:
        n = float(v)
    except (TypeError, ValueError):
        raise InputError("숫자 칸에 숫자가 아닌 값이 있어요")
    if n < 0:
        raise InputError("숫자는 0 이상이어야 해요")
    return int(n) if n == int(n) else n


def _date(v):
    if not v:
        return ""
    try:
        return date.fromisoformat(str(v)[:10]).isoformat()
    except ValueError:
        raise InputError("날짜 형식은 YYYY-MM-DD 여야 해요")


def clean_influencer(data, existing=None):
    out = dict(existing or {})
    name = str(data.get("name", out.get("name", ""))).strip()
    if not name:
        raise InputError("이름을 입력해 주세요")
    out["id"] = data.get("id") or out.get("id") or new_id("inf")
    out["name"] = name[:120]
    for k in ("handle", "email", "zalo", "manager", "notes", "eventId", "metricsSource"):
        if k in data:
            out[k] = str(data.get(k) or "").strip()
    if "segment" in data:
        out["segment"] = disc.segment_name(data.get("segment"))  # 모르는 값은 미분류(빈 값)
    out.setdefault("segment", "")
    for k, allowed in (("category", CATEGORIES), ("city", CITIES)):
        if data.get(k):
            out[k] = data[k] if data[k] in allowed else allowed[-1]
        elif not out.get(k):
            out[k] = allowed[-1]
    if "status" in data:
        if data["status"] not in STATUS_NAME:
            raise InputError("알 수 없는 진행 상태예요")
        out["status"] = data["status"]
    for k in ("metricsDate", "confirmedShoot", "postDate"):
        if k in data:
            out[k] = _date(data[k])
    if "sentAt" in data:
        out["sentAt"] = str(data.get("sentAt") or "")[:25]
    if "pf" in data:
        pf = {}
        for key, _ in PLATFORMS:
            ch = (data.get("pf") or {}).get(key)
            if ch:
                f, v, url = _num(ch.get("f")), _num(ch.get("v")), str(ch.get("url") or "").strip()
                extra = _clean_channel_extra(ch)
                if f or v or url or extra.get("avg") or extra.get("er"):
                    pf[key] = {"f": f, "v": v, "url": url, **extra}
        out["pf"] = pf
    if "resp" in data:
        out["resp"] = data["resp"]
    if out.get("confirmedShoot") and out.get("status") in ("candidate", "sent", "replied", "negotiating"):
        out["status"] = "confirmed"
    out.setdefault("status", "candidate")
    out["example"] = bool(out.get("example"))
    return out


CHANNEL_EXTRA = ("avg", "er", "aud_vn", "country", "lang", "src", "prov", "at", "conf")


def _clean_channel_extra(ch):
    """발굴 기능에서 추가된 채널 지표 키 (모두 선택). 기존 f·v·url 형식은 그대로."""
    out = {}
    if ch.get("avg") not in (None, ""):
        out["avg"] = _num(ch["avg"])
    for k in ("er", "aud_vn"):
        if ch.get(k) not in (None, ""):
            n = _num(ch[k])
            if n is not None and n > 100:
                raise InputError("참여율·시청자 비중은 0~100(%) 사이여야 해요")
            out[k] = n
    for k, n in (("country", 40), ("lang", 20), ("prov", 60)):
        if ch.get(k):
            out[k] = str(ch[k]).strip()[:n]
    if ch.get("src") in disc.SOURCE_TYPES:
        out["src"] = ch["src"]
        out["conf"] = disc.confidence_of(ch["src"])
    if ch.get("at"):
        out["at"] = _date(ch["at"])
    return out


def record_snapshots(before, after):
    """채널 지표가 바뀌면 시점 기록을 남깁니다 (덮어써도 이전 값은 기록에 남음)."""
    keys = ("f", "v", "avg", "er", "aud_vn")
    for p, ch in (after.get("pf") or {}).items():
        old = ((before or {}).get("pf") or {}).get(p) or {}
        if not any(ch.get(k) is not None for k in keys) or all(old.get(k) == ch.get(k) for k in keys):
            continue
        st = ch.get("src") or disc.source_type_of(after.get("metricsSource"), after.get("example"))
        if after.get("example"):
            st = "demo"
        try:
            store.add_snapshot({"id": new_id("snap"), "infId": after["id"], "platform": p, "followers": ch.get("f"),
                                "medianViews": ch.get("v"), "avgViews": ch.get("avg"), "er": ch.get("er"), "vnAudience": ch.get("aud_vn"),
                                "sourceType": st, "provider": ch.get("prov") or after.get("metricsSource") or "",
                                "confidence": disc.confidence_of(st), "collectedOn": ch.get("at") or after.get("metricsDate") or today_str(),
                                "example": bool(after.get("example"))})
        except Exception:
            pass  # 기록 실패가 저장 자체를 막지 않게


def clean_reply(data):
    r = blank_reply()
    if data.get("avail") not in ("yes", "cond", "no"):
        raise InputError("협업 가능 여부를 골라 주세요")
    r.update({
        "avail": data["avail"],
        "neg": sorted({_date(d) for d in data.get("neg") or [] if d}),
        "shoot": sorted({_date(d) for d in data.get("shoot") or [] if d}),
        "post": _date(data.get("post")),
        "fee": _num(data.get("fee")),
        "cur": data.get("cur") if data.get("cur") in CURRENCIES else "VND",
        "formats": [f for f in data.get("formats") or [] if f in CONTENT_FORMATS],
        "note": str(data.get("note") or "")[:1000],
        "raw": str(data.get("raw") or "")[:6000],
        "via": data.get("via") if data.get("via") in ("rule", "manual", "form") else "manual",
        "review": False, "ambig": [], "at": datetime.now().isoformat(timespec="seconds"),
    })
    return r


# ---------------------------------------------------------------- 화면
@bp.route("/")
def index():
    boot = {
        "apiBase": url_for("influencer_marketing.index"),
        "influencers": store.list_influencers(),
        "quotes": store.list_quotes(),
        "settings": settings(),
        "events": market_events(),
        "eventFilter": request.args.get("event_id", ""),
        "today": today_str(),
        "consts": {"tiers": TIERS, "categories": CATEGORIES, "cities": CITIES, "sources": METRIC_SOURCES,
                   "formats": CONTENT_FORMATS, "sourceTypes": disc.SOURCE_TYPES, "confidence": disc.CONFIDENCE_LABEL,
                   "discoveryCategories": list(disc.CATEGORY_KEYWORDS), "segments": disc.SEGMENTS,
                   "segmentUnset": disc.SEGMENT_UNSET},
    }
    return render_template("influencer_marketing/influencer_index.html", boot=boot)


@bp.route("/report")
def report():
    """보고서 화면. 브라우저 인쇄(Ctrl+P) → 'PDF로 저장'으로 PDF를 만듭니다."""
    conf = settings()
    infs = store.list_influencers()
    order = [s for s, _ in STATUSES]
    infs.sort(key=lambda i: (order.index(i.get("status") or "candidate"), i["name"]))
    inf_map = {i["id"]: i for i in infs}
    today = today_str()
    sent = [i for i in infs if i.get("sentAt")]
    replied = [i for i in sent if i.get("resp")]
    rows = []
    for i in infs:
        mp = main_platform(i)
        rows.append({"inf": i, "status": STATUS_NAME.get(i.get("status"), ""), "platform": PLATFORM_NAME.get(mp["k"]) if mp else "",
                     "followers": mp["f"] if mp else None, "views": mp["v"] if mp else None})
    type_name = {"neg": "협의 가능", "conf": "촬영 확정", "post": "게시 예정"}
    events = [e for e in calendar_events(infs) if e["type"] != "shoot" and e["date"] >= today]
    events.sort(key=lambda e: e["date"])
    quotes = []
    for q in store.list_quotes():
        m = quote_metrics(q, inf_map, conf)
        quotes.append({"q": q, "m": m, "price_type": PRICE_TYPES.get(q.get("layer"), ""), "platform": PLATFORM_NAME.get(q.get("platform"), "")})
    summary = {"total": len(infs), "sent": len(sent), "reply_rate": round(len(replied) / len(sent) * 100) if sent else 0,
               "confirmed": len([i for i in infs if i.get("status") in ("confirmed", "shot", "posted")])}
    return render_template("influencer_marketing/influencer_report.html", conf=conf, rows=rows, events=events[:25],
                           type_name=type_name, quotes=quotes, summary=summary, today=today,
                           has_demo=any(i.get("example") for i in infs) or any(q["q"].get("example") for q in quotes))


# ---------------------------------------------------------------- API
def _error(msg, code=400):
    return jsonify({"error": msg}), code


@bp.post("/api/influencers")
def api_save_influencer():
    data = request.get_json(silent=True) or {}
    existing = store.get_influencer(data["id"]) if data.get("id") else None
    try:
        clean = clean_influencer(data, existing)
    except InputError as e:
        return _error(str(e))
    saved = store.save_influencer(clean)
    record_snapshots(existing, saved)
    return jsonify(saved)


@bp.delete("/api/influencers/<influencer_id>")
def api_delete_influencer(influencer_id):
    store.delete_influencer(influencer_id)
    return jsonify({"ok": True})


@bp.post("/api/influencers/<influencer_id>/reply")
def api_save_reply(influencer_id):
    inf = store.get_influencer(influencer_id)
    if not inf:
        return _error("인플루언서를 찾을 수 없어요", 404)
    try:
        reply = clean_reply(request.get_json(silent=True) or {})
    except InputError as e:
        return _error(str(e))
    inf["resp"] = reply
    if reply["avail"] == "no":
        inf["status"] = "declined"
    elif inf.get("status") in ("candidate", "sent"):
        inf["status"] = "replied"
    return jsonify(store.save_influencer(inf))


@bp.delete("/api/influencers/<influencer_id>/reply")
def api_delete_reply(influencer_id):
    """잘못 입력한 회신 삭제. 상태는 '제안 발송'으로 되돌리고(발송 기록이 없으면 '후보'), 확정 촬영일·게시일은 그대로 둡니다."""
    inf = store.get_influencer(influencer_id)
    if not inf:
        return _error("인플루언서를 찾을 수 없어요", 404)
    if not inf.get("resp"):
        return _error("지울 회신이 없어요")
    inf["resp"] = None
    if inf.get("status") in ("replied", "negotiating", "declined"):
        inf["status"] = "sent" if inf.get("sentAt") else "candidate"
    return jsonify(store.save_influencer(inf))


@bp.post("/api/parse-reply")
def api_parse_reply():
    text = str((request.get_json(silent=True) or {}).get("text") or "").strip()
    if not text:
        return _error("회신 내용을 붙여 넣어 주세요")
    return jsonify(parse_reply(text[:6000]))


@bp.post("/api/quotes")
def api_save_quote():
    d = request.get_json(silent=True) or {}
    try:
        inf = store.get_influencer(d.get("infId") or "")
        if not inf:
            raise InputError("인플루언서를 골라 주세요")
        amount = _num(d.get("amount"))
        if not amount:
            raise InputError("금액을 입력해 주세요")
        platform = d.get("platform") if d.get("platform") in PLATFORM_NAME else "tt"
        q = {"id": d.get("id") or new_id("quote"), "infId": inf["id"], "name": inf["name"], "platform": platform,
             "format": d.get("format") if d.get("format") in CONTENT_FORMATS else "", "layer": d.get("layer") if d.get("layer") in PRICE_TYPES else "quote",
             "date": _date(d.get("date")) or today_str(), "amount": amount, "cur": d.get("cur") if d.get("cur") in CURRENCIES else "VND",
             "followers": ((inf.get("pf") or {}).get(platform) or {}).get("f"), "expViews": _num(d.get("expViews")),
             "actualViews": _num(d.get("actualViews")), "cond": str(d.get("cond") or "")[:300], "example": False}
    except InputError as e:
        return _error(str(e))
    return jsonify(store.save_quote(q))


@bp.delete("/api/quotes/<quote_id>")
def api_delete_quote(quote_id):
    store.delete_quote(quote_id)
    return jsonify({"ok": True})


@bp.put("/api/settings")
def api_save_settings():
    d = request.get_json(silent=True) or {}
    merged = settings()
    for k in DEFAULT_SETTINGS:
        if k in d:
            merged[k] = d[k]
    try:
        before = settings()
        for k in ("vndPerUsd", "krwPerUsd"):
            merged[k] = _num(merged[k]) or DEFAULT_SETTINGS[k]
        if any(k in d for k in ("vndPerUsd", "krwPerUsd")) and (merged["vndPerUsd"], merged["krwPerUsd"]) != (before["vndPerUsd"], before["krwPerUsd"]) or d.get("rateConfirm"):
            merged["rateSavedAt"] = today_str()
        merged["rateSavedAt"] = str(merged.get("rateSavedAt") or "")[:10]
        merged["deadline"] = _date(merged.get("deadline"))
    except InputError as e:
        return _error(str(e))
    return jsonify(store.save_setting("campaign", merged))


CAMPAIGN_PRESET_KEY = "campaign_presets"


@bp.get("/api/campaign-presets")
def api_campaign_presets():
    """저장해 둔 캠페인 정보 목록 (이름순)."""
    return jsonify(sorted(store.get_setting(CAMPAIGN_PRESET_KEY, []) or [], key=lambda x: x.get("name", "")))


@bp.post("/api/campaign-presets")
def api_save_campaign_preset():
    """현재 캠페인 정보를 이름 붙여 저장. 같은 이름이 있으면 overwrite=true일 때만 덮어씁니다."""
    d = request.get_json(silent=True) or {}
    name = str(d.get("name") or "").strip()[:40]
    if not name:
        return _error("저장할 이름을 입력하세요")
    data = d.get("data") if isinstance(d.get("data"), dict) else {}
    allowed = {k: v for k, v in data.items() if k in DEFAULT_SETTINGS and k not in ("vndPerUsd", "krwPerUsd", "rateSavedAt")}
    presets = store.get_setting(CAMPAIGN_PRESET_KEY, []) or []
    hit = next((p for p in presets if p.get("name") == name), None)
    if hit and not d.get("overwrite"):
        return jsonify({"exists": True, "name": name}), 409
    if len(presets) >= 30 and not hit:
        return _error("저장된 캠페인이 30개예요. 쓰지 않는 것을 지운 뒤 저장하세요")
    item = {"name": name, "data": {k: (str(v)[:2000] if v is not None else "") for k, v in allowed.items()}, "saved_at": today_str()}
    presets = [p for p in presets if p.get("name") != name] + [item]
    store.save_setting(CAMPAIGN_PRESET_KEY, presets)
    return jsonify(sorted(presets, key=lambda x: x.get("name", "")))


@bp.delete("/api/campaign-presets")
def api_delete_campaign_preset():
    name = str((request.get_json(silent=True) or {}).get("name") or "")
    presets = [p for p in (store.get_setting(CAMPAIGN_PRESET_KEY, []) or []) if p.get("name") != name]
    store.save_setting(CAMPAIGN_PRESET_KEY, presets)
    return jsonify(sorted(presets, key=lambda x: x.get("name", "")))


@bp.post("/api/demo/seed")
def api_seed_demo():
    for inf in DEMO_INFLUENCERS:
        store.save_influencer({**inf, "example": True})
    for q in DEMO_QUOTES:
        store.save_quote({**q, "example": True})
    return jsonify({"influencers": store.list_influencers(), "quotes": store.list_quotes()})


@bp.post("/api/demo/clear")
def api_clear_demo():
    store.clear_demo()
    return jsonify({"influencers": store.list_influencers(), "quotes": store.list_quotes()})


# ---------------------------------------------------------------- CSV
INF_HEAD = ["ID", "이름", "핸들", "분야", "지역", "이메일", "Zalo", "매니지먼트",
            "TikTok 팔로워", "TikTok 조회수 중앙값", "TikTok 주소", "Facebook 팔로워", "Facebook 조회수 중앙값", "Facebook 주소",
            "YouTube 구독자", "YouTube 조회수 중앙값", "YouTube 주소", "Instagram 팔로워", "Instagram 조회수 중앙값", "Instagram 주소",
            "규모", "상태", "연결 기념일 ID", "제안 발송일", "협업 가능 여부", "협의 가능일", "촬영 가능일", "확정 촬영일", "게시 예정일",
            "희망 비용", "통화", "지표 기준일", "지표 출처", "메모", "시연 데이터", "타깃 그룹"]
CSV_COLS = {"tt": ("TikTok 팔로워", "TikTok 조회수 중앙값", "TikTok 주소"), "fb": ("Facebook 팔로워", "Facebook 조회수 중앙값", "Facebook 주소"),
            "yt": ("YouTube 구독자", "YouTube 조회수 중앙값", "YouTube 주소"), "ig": ("Instagram 팔로워", "Instagram 조회수 중앙값", "Instagram 주소")}


def _cell(v):
    s = "" if v is None else str(v)
    if s[:1] in ("=", "+", "-", "@", "\t", "\r"):
        try:
            float(s)
        except ValueError:
            s = "'" + s  # 엑셀 수식 주입 방지
    return s


def _csv_response(filename, head, rows):
    buf = io.StringIO()
    w = csv.writer(buf, lineterminator="\r\n")
    w.writerow(head)
    for r in rows:
        w.writerow([_cell(c) for c in r])
    data = "﻿" + buf.getvalue()  # UTF-8 BOM: 엑셀에서 한글·베트남어가 깨지지 않게
    return Response(data, mimetype="text/csv; charset=utf-8",
                    headers={"Content-Disposition": f'attachment; filename="{filename}"'})


def _stamp():
    return date.today().strftime("%Y%m%d")


@bp.get("/export/influencers.csv")
def export_influencers():
    rows = []
    for i in store.list_influencers():
        r = i.get("resp") or {}
        mp = main_platform(i)
        ch = lambda k: [(i.get("pf") or {}).get(k, {}).get(x, "") for x in ("f", "v", "url")]  # noqa: E731
        rows.append([i["id"], i["name"], i.get("handle"), i.get("category"), i.get("city"), i.get("email"), i.get("zalo"), i.get("manager"),
                     *ch("tt"), *ch("fb"), *ch("yt"), *ch("ig"), tier_of(mp["f"])["n"] if mp else "", STATUS_NAME.get(i.get("status"), ""),
                     i.get("eventId"), (i.get("sentAt") or "")[:10], {"yes": "가능", "cond": "조건부", "no": "불가"}.get(r.get("avail"), ""),
                     " ".join(r.get("neg") or []), " ".join(r.get("shoot") or []), i.get("confirmedShoot"), i.get("postDate") or r.get("post"),
                     r.get("fee") or "", (r.get("cur") or "VND") if r.get("fee") else "", i.get("metricsDate"), i.get("metricsSource"),
                     i.get("notes"), "Y" if i.get("example") else "", i.get("segment") or ""])
    return _csv_response(f"influencer_list_{_stamp()}.csv", INF_HEAD, rows)


@bp.get("/export/template.csv")
def export_template():
    return _csv_response("influencer_import_template.csv", INF_HEAD, [])


@bp.get("/export/schedule.csv")
def export_schedule():
    names = {"neg": "협의 가능", "shoot": "촬영 가능", "conf": "촬영 확정", "post": "게시 예정"}
    ev = sorted(calendar_events(store.list_influencers()), key=lambda e: e["date"])
    rows = [[e["date"], e["inf"]["name"], names[e["type"]], STATUS_NAME.get(e["inf"].get("status"), ""), "Y" if e.get("clash") else "",
             e["inf"].get("eventId"), e["inf"].get("email"), e["inf"].get("zalo")] for e in ev]
    return _csv_response(f"influencer_schedule_{_stamp()}.csv", ["날짜", "인플루언서", "구분", "상태", "겹침", "연결 기념일 ID", "이메일", "Zalo"], rows)


@bp.get("/export/quotes.csv")
def export_quotes():
    conf = settings()
    inf_map = {i["id"]: i for i in store.list_influencers()}
    cmp_name = {"in": "범위 안", "hi": "높음", "lo": "낮음"}
    rows = []
    for q in store.list_quotes():
        m = quote_metrics(q, inf_map, conf)
        rnd = lambda v: round(v) if v is not None else ""  # noqa: E731
        rows.append([q.get("date"), (m["inf"] or {}).get("name") or q.get("name"), PLATFORM_NAME.get(q.get("platform")), q.get("format"),
                     PRICE_TYPES.get(q.get("layer")), q.get("amount"), q.get("cur"), rnd(m["usd"]), rnd(m["vnd"]), m["followers"] or "",
                     m["exp_views"] or "", rnd(m["per_1k_views"]), rnd(m["per_1k_followers"]), q.get("actualViews") or "",
                     rnd(m["per_view_actual"]), m["tier"]["n"] if m["tier"] else "", cmp_name.get(m["compare"], ""), q.get("cond"),
                     "Y" if q.get("example") else ""])
    head = ["날짜", "인플루언서", "채널", "형식", "구분", "금액", "통화", "USD 환산", "VND 환산", "팔로워", "예상 조회수",
            "조회 1천회당(VND)", "팔로워 1천명당(VND)", "실제 조회수", "실제 1회 조회당(VND)", "규모", "참고가 비교", "포함 조건", "시연 데이터"]
    return _csv_response(f"influencer_quotes_{_stamp()}.csv", head, rows)


@bp.post("/api/import-csv")
def api_import_csv():
    f = request.files.get("file")
    if not f:
        return _error("CSV 파일을 골라 주세요")
    text = f.read().decode("utf-8-sig", errors="replace")
    reader = csv.DictReader(io.StringIO(text))
    if not reader.fieldnames or "이름" not in [h.strip() for h in reader.fieldnames]:
        return _error("첫 줄에 '이름' 열이 필요해요. 내보내기의 빈 양식을 쓰세요")
    status_by_name = {v: k for k, v in STATUSES}
    count, skipped = 0, 0
    for raw in reader:
        row = {(k or "").strip(): (v or "").strip().removeprefix("'") for k, v in raw.items()}
        if not row.get("이름"):
            continue
        pf = {}
        for key, (fc, vc, uc) in CSV_COLS.items():
            if row.get(fc) or row.get(vc) or row.get(uc):
                pf[key] = {"f": re.sub(r"[^\d.]", "", row.get(fc, "")), "v": re.sub(r"[^\d.]", "", row.get(vc, "")), "url": row.get(uc, "")}
        data = {"name": row["이름"], "handle": row.get("핸들", ""), "category": row.get("분야", ""), "city": row.get("지역", ""),
                "segment": row.get("타깃 그룹", ""),
                "email": row.get("이메일", ""), "zalo": row.get("Zalo", ""), "manager": row.get("매니지먼트", ""),
                "eventId": row.get("연결 기념일 ID", ""), "metricsDate": row.get("지표 기준일", ""), "notes": row.get("메모", ""),
                "metricsSource": row.get("지표 출처") if row.get("지표 출처") in METRIC_SOURCES else METRIC_SOURCES[0]}
        data = {k: v for k, v in data.items() if v not in ("", None)}  # 빈 칸은 기존 값을 지우지 않음
        if "segment" in data and not disc.segment_name(data["segment"]):
            data.pop("segment")  # 모르는 타깃 그룹 이름은 기존 값을 바꾸지 않음
        if pf:
            data["pf"] = pf
        if status_by_name.get(row.get("상태", "")):
            data["status"] = status_by_name[row["상태"]]
        existing = store.get_influencer(row["ID"]) if row.get("ID") else None
        if row.get("ID") and not existing:
            data["id"] = row["ID"]
        try:
            clean = clean_influencer(data, existing)
            clean["example"] = bool(existing and existing.get("example"))  # 시연 데이터 표시는 가져오기로 바뀌지 않음
            store.save_influencer(clean)
            count += 1
        except InputError:
            skipped += 1
    return jsonify({"imported": count, "skipped": skipped, "influencers": store.list_influencers()})


# ---------------------------------------------------------------- 외부 API (YouTube·Phyllo)
def _ext(fn, *args):
    try:
        return jsonify(fn(*args))
    except ext.ApiError as e:
        return _error(str(e))
    except Exception as e:  # 예상 못 한 응답 형식 등
        return _error(f"처리 중 문제가 생겼어요: {type(e).__name__}", 500)


@bp.get("/api/integrations/status")
def api_integrations_status():
    return jsonify(ext.status())


@bp.post("/api/integrations/youtube/test")
def api_youtube_test():
    return _ext(ext.youtube_test)


@bp.post("/api/integrations/phyllo/test")
def api_phyllo_test():
    return _ext(ext.phyllo_test)


@bp.post("/api/youtube/channel")
def api_youtube_channel():
    return _ext(ext.youtube_channel, str((request.get_json(silent=True) or {}).get("ref") or ""))


@bp.post("/api/youtube/search")
def api_youtube_search():
    return _ext(ext.youtube_search, str((request.get_json(silent=True) or {}).get("q") or ""))


@bp.post("/api/phyllo/profile")
def api_phyllo_profile():
    d = request.get_json(silent=True) or {}
    return _ext(ext.phyllo_profile, str(d.get("platform") or ""), str(d.get("ref") or ""))


@bp.post("/api/youtube/add-candidate")
def api_youtube_add_candidate():
    """검색 결과 채널을 후보로 등록. 같은 채널이 이미 있으면 등록하지 않습니다."""
    d = request.get_json(silent=True) or {}
    cid = str(d.get("channel_id") or "")
    if not re.match(r"^UC[\w-]{22}$", cid):
        return _error("채널 정보가 올바르지 않아요")
    for i in store.list_influencers():
        if cid in (((i.get("pf") or {}).get("yt") or {}).get("url") or ""):
            return _error(f"이미 등록된 채널이에요 ({i['name']})")
    data = {"name": str(d.get("title") or "이름 없음")[:120], "handle": str(d.get("handle") or ""), "status": "candidate",
            "pf": {"yt": {"f": d.get("subscribers"), "v": None, "url": f"https://www.youtube.com/channel/{cid}"}},
            "metricsDate": today_str(), "metricsSource": "YouTube API", "notes": "YouTube 검색으로 추가"}
    try:
        return jsonify(store.save_influencer(clean_influencer(data)))
    except InputError as e:
        return _error(str(e))


@bp.post("/api/youtube/refresh-all")
def api_youtube_refresh_all():
    """유튜브 주소가 있는 인플루언서의 구독자·조회수 중앙값을 한꺼번에 갱신. 1명당 약 3유닛."""
    done, failed = [], []
    for i in store.list_influencers():
        yt = (i.get("pf") or {}).get("yt") or {}
        if not yt.get("url") or i.get("example"):
            continue
        try:
            r = ext.youtube_channel(yt["url"])
        except ext.ApiError as e:
            failed.append({"name": i["name"], "error": str(e)})
            if "사용량" in str(e) or "API 키" in str(e) or "사용 설정" in str(e) or "제한" in str(e):
                break  # 키·할당량 문제면 나머지도 모두 실패하므로 중단
            continue
        pf = dict(i.get("pf") or {})
        pf["yt"] = {**yt, "f": r["subscribers"] if r["subscribers"] is not None else yt.get("f"),  # 추가 키(평균·참여율 등)는 유지
                    "v": r["median_views"] if r["median_views"] is not None else yt.get("v"), "url": yt["url"],
                    "src": "official_api", "prov": "YouTube Data API", "at": today_str(), "conf": "high"}
        saved = store.save_influencer({**i, "pf": pf, "metricsDate": today_str(), "metricsSource": "YouTube API"})
        record_snapshots(i, saved)
        done.append(i["name"])
    return jsonify({"updated": done, "failed": failed, "influencers": store.list_influencers(), "status": ext.status()})



# ---------------------------------------------------------------- 인플루언서 발굴 (외부 후보 → 기존 DB)
def _mark_duplicates(rows):
    keys = disc.existing_keys(store.list_influencers())
    for r in rows:
        k = disc.account_key(r["platform"], r.get("url") or r.get("handle"))
        hit = keys.get(k) if k else None
        r["account_key"] = k
        r["duplicate"] = bool(hit)
        r["duplicate_of"] = {"id": hit[0], "name": hit[1]} if hit else None
    return rows


@bp.get("/api/discovery/providers")
def api_discovery_providers():
    return jsonify(disc.providers())


@bp.post("/api/discovery/search")
def api_discovery_search():
    d = request.get_json(silent=True) or {}
    platform = d.get("platform") if d.get("platform") in PLATFORM_NAME else "tt"
    try:
        rows, meta = disc.search(str(d.get("provider") or ""), platform, d.get("filters") or {})
    except ext.ApiError as e:
        return _error(str(e))
    except Exception as e:
        return _error(f"처리 중 문제가 생겼어요: {type(e).__name__}", 500)
    return jsonify({"rows": _mark_duplicates(rows), "meta": meta})


@bp.post("/api/discovery/check")
def api_discovery_check():
    d = request.get_json(silent=True) or {}
    platform = d.get("platform") if d.get("platform") in PLATFORM_NAME else ""
    k = disc.account_key(platform, str(d.get("ref") or ""))
    if not k:
        return _error("플랫폼과 계정 주소(또는 @핸들)를 확인하세요")
    hit = disc.existing_keys(store.list_influencers()).get(k)
    return jsonify({"account_key": k, "duplicate": bool(hit), "duplicate_of": {"id": hit[0], "name": hit[1]} if hit else None,
                    "url": disc.profile_url(platform, k.split(":", 1)[1])})


@bp.post("/api/discovery/enrich")
def api_discovery_enrich():
    """[지표 채우기] YouTube 후보의 최근 영상으로 조회수 중앙값·참여율을 채웁니다 (채널당 약 3유닛, 최대 25개).
    다른 플랫폼은 Phyllo(키·권한이 있을 때)로 시도하고, 실패한 행은 그대로 둡니다. 값을 만들지 않습니다."""
    d = request.get_json(silent=True) or {}
    rows = [r for r in (d.get("rows") or []) if isinstance(r, dict)][:25]
    out, failed = [], []
    for r in rows:
        r = dict(r)
        ref = str(r.get("url") or r.get("handle") or "")
        try:
            if r.get("platform") == "yt":
                ch = ext.youtube_channel(ref)
                if ch.get("subscribers") is not None:
                    r["followers"] = ch["subscribers"]
                r["median_views"] = ch.get("median_views")
                r["er"] = ch.get("er")
                r["views_basis"] = "median"
                r["enriched"] = f"최근 영상 {ch.get('videos_used', 0)}개 기준 (참여율은 공식 API 값으로 계산)"
            elif r.get("platform") in ("tt", "ig"):
                pr = ext.phyllo_profile(r["platform"], ref)
                for k_src, k_dst in (("followers", "followers"), ("median_views", "median_views"), ("avg_views", "avg_views"), ("engagement_rate", "er")):
                    if pr.get(k_src) is not None:
                        r[k_dst] = pr[k_src]
                r["source_type"] = "saas"
                r["provider"] = "Phyllo"
                r["confidence"] = disc.confidence_of("saas")
                r["source_label"] = disc.SOURCE_TYPES["saas"]["label"]
                r["enriched"] = "Phyllo 공개 프로필 분석"
            else:
                raise ext.ApiError("이 플랫폼은 자동으로 채울 수 없어요")
            r["collected_on"] = today_str()
        except ext.ApiError as e:
            failed.append({"name": r.get("name") or r.get("handle"), "error": str(e)})
        out.append(r)
    f = d.get("filters") or {}
    if f:
        for r in out:
            r.pop("unverified", None)
        kept = disc.apply_filters(out, {**f, "country_code": "vn" if (f.get("country") or "").lower() in ("vietnam", "vn") else ""})
    else:
        kept = out
    return jsonify({"rows": _mark_duplicates(kept), "removed": len(out) - len(kept), "failed": failed})


@bp.post("/api/discovery/fill")
def api_discovery_fill():
    """[주소로 지표 채우기] 후보 직접 입력 칸용. YouTube는 공식 API, TikTok·Instagram은 Phyllo(권한이 있을 때)."""
    d = request.get_json(silent=True) or {}
    platform, ref = str(d.get("platform") or ""), str(d.get("ref") or "").strip()
    if not ref:
        return _error("계정 주소 또는 @핸들을 먼저 넣어 주세요")
    try:
        if platform == "yt":
            ch = ext.youtube_channel(ref)
            return jsonify({"name": ch["title"], "url": ch["url"], "followers": ch["subscribers"], "median_views": ch["median_views"],
                            "avg_views": None, "er": ch.get("er"), "source": "manual|YouTube API", "provider": "YouTube API",
                            "source_type": "official_api", "note": ch.get("note", "")})
        if platform in ("tt", "ig"):
            pr = ext.phyllo_profile(platform, ref)
            return jsonify({"name": "", "url": "", "followers": pr["followers"], "median_views": pr["median_views"], "avg_views": pr["avg_views"],
                            "er": pr["engagement_rate"], "provider": "Phyllo", "source_type": "saas", "note": pr.get("note", "")})
        return _error("Facebook은 자동으로 채울 수 없어요. 직접 입력해 주세요")
    except ext.ApiError as e:
        return _error(str(e) + " — 직접 입력해 주세요")


def _record_from_input(r):
    platform = r.get("platform") if r.get("platform") in PLATFORM_NAME else None
    if not platform:
        raise InputError("플랫폼을 골라 주세요")
    ref = str(r.get("url") or r.get("handle") or "").strip()
    k = disc.account_key(platform, ref)
    if not k:
        raise InputError("계정 주소 또는 @핸들을 확인하세요")
    handle = k.split(":", 1)[1]
    st = r.get("source_type") if r.get("source_type") in disc.SOURCE_TYPES else "manual"
    rec = {"platform": platform, "handle": handle.lstrip("@"), "name": str(r.get("name") or "").strip()[:120] or handle.lstrip("@"),
           "url": ref if ref.startswith("http") else disc.profile_url(platform, handle),
           "followers": _num(r.get("followers")), "median_views": _num(r.get("median_views")), "avg_views": _num(r.get("avg_views")),
           "er": _num(r.get("er")), "vn_audience": _num(r.get("vn_audience")), "country": str(r.get("country") or "")[:40],
           "language": str(r.get("language") or "")[:20], "provider": str(r.get("provider") or "")[:60], "source_type": st,
           "collected_on": _date(r.get("collected_on")) or today_str(), "category": r.get("category") or "",
           "notes": str(r.get("notes") or "")[:300], "account_key": k, "segment": disc.segment_name(r.get("segment"))}
    for fld in ("er", "vn_audience"):
        if rec[fld] is not None and rec[fld] > 100:
            raise InputError("참여율·시청자 비중은 0~100(%) 사이여야 해요")
    return rec


@bp.post("/api/discovery/register")
def api_discovery_register():
    """선택한 후보를 기존 인플루언서 DB에 '후보' 상태로 등록. 같은 플랫폼의 같은 계정은 등록하지 않습니다."""
    d = request.get_json(silent=True) or {}
    records = d.get("records") or []
    if not isinstance(records, list) or not records:
        return _error("등록할 후보를 골라 주세요")
    keys = disc.existing_keys(store.list_influencers())
    created, skipped, errors = [], [], []
    for raw in records[:200]:
        try:
            rec = _record_from_input(raw)
        except InputError as e:
            errors.append({"name": str(raw.get("name") or raw.get("handle") or ""), "error": str(e)})
            continue
        hit = keys.get(rec["account_key"])
        if hit:
            skipped.append({"name": rec["name"], "existing": hit[1], "existing_id": hit[0]})
            continue
        src_name = {"official_api": "YouTube API" if rec["platform"] == "yt" else "직접 확인", "submitted": "인플루언서 제출",
                    "manual": "TikTok One" if "TikTok One" in rec["provider"] else "직접 확인"}.get(rec["source_type"], rec["provider"].split(" ")[0])
        if src_name not in METRIC_SOURCES:
            src_name = "직접 확인"
        data = {"name": rec["name"], "handle": "@" + rec["handle"].lstrip("@"), "status": "candidate",
                "segment": rec["segment"],
                "category": rec["category"] if rec["category"] in CATEGORIES else next((x["category"] for x in disc.SEGMENTS if x["name"] == rec["segment"]), ""),
                "pf": {rec["platform"]: disc.to_channel(rec)}, "metricsDate": rec["collected_on"], "metricsSource": src_name,
                "notes": ("발굴: " + (rec["provider"] or disc.SOURCE_TYPES[rec["source_type"]]["label"]) + (" · " + rec["notes"] if rec["notes"] else ""))[:500],
                "eventId": str(d.get("eventId") or "")}
        try:
            clean = clean_influencer(data)
            clean["example"] = rec["source_type"] == "demo"  # 샌드박스·시연 값은 시연 데이터로 표시
            saved = store.save_influencer(clean)
            record_snapshots(None, saved)
            keys[rec["account_key"]] = (saved["id"], saved["name"])
            created.append({"id": saved["id"], "name": saved["name"], "account_key": rec["account_key"]})
        except InputError as e:
            errors.append({"name": rec["name"], "error": str(e)})
    return jsonify({"created": created, "skipped": skipped, "errors": errors, "influencers": store.list_influencers()})


@bp.get("/api/influencers/<influencer_id>/snapshots")
def api_snapshots(influencer_id):
    return jsonify(store.list_snapshots(influencer_id))


DISC_HEAD = ["플랫폼", "계정 주소 또는 핸들", "이름", "팔로워", "조회수 중앙값", "평균 조회수", "참여율(%)", "베트남 시청자 비중(%)",
             "콘텐츠 언어", "활동 국가", "출처", "수집일", "분야", "메모", "타깃 그룹"]
MAX_UPLOAD_READ = 5 * 1024 * 1024 + 1  # 5MB 초과 여부만 알면 되므로 그 이상은 읽지 않음
DISC_SOURCE = {"직접 확인": "manual", "TikTok One 화면 확인": "manual", "인플루언서 제출": "submitted", "에이전시 자료": "submitted"}


@bp.get("/export/discovery_template.csv")
def export_discovery_template():
    sample = ["TikTok", "https://www.tiktok.com/@example_account", "(예시) 계정 이름", "120000", "35000", "", "6.5", "72", "vi",
              "Vietnam", "TikTok One 화면 확인", today_str(), "디저트·먹방", "이 줄은 예시예요. 지우고 쓰세요", disc.SEGMENT_NAMES[1]]
    return _csv_response("influencer_discovery_template.csv", DISC_HEAD, [sample])


@bp.post("/api/discovery/import-csv")
def api_discovery_import_csv():
    """발굴 후보 파일(CSV·TSV)을 정제해 미리보기로 돌려줍니다 (아직 저장하지 않음). 저장은 /api/discovery/register.

    우리 양식뿐 아니라 SaaS 내보내기·에이전시 자료처럼 열 이름·숫자 표기·인코딩이 다른 파일도 정제합니다.
    선택 입력(form): source = '' | 'saas' | 'submitted' | 'manual', provider = 제공처 이름, platform = 기본 플랫폼, demo = '1'
    응답: rows, errors (기존 필드) + report (정제 결과 요약, 추가 필드)
    """
    f = request.files.get("file")
    if not f:
        return _error("CSV 파일을 골라 주세요")
    form = request.form
    st = form.get("source", "")
    st = st if st in ("saas", "submitted", "manual") else ""
    platform = form.get("platform", "") if form.get("platform", "") in PLATFORM_NAME else ""
    try:
        records, errors, report = disc.cleanse_file(f.read(MAX_UPLOAD_READ), source_type=st, provider=str(form.get("provider", ""))[:60],
                                                    default_platform=platform, is_demo=form.get("demo") == "1", today=today_str())
    except ValueError as e:
        return _error(str(e))
    rows = []
    for raw_rec in records:
        line, issues = raw_rec.pop("_line"), raw_rec.pop("_issues")
        try:
            rec = _record_from_input(raw_rec)
        except InputError as e:
            errors.append({"line": line, "error": str(e)})
            continue
        rec["confidence"] = disc.confidence_of(rec["source_type"])
        rec["source_label"] = disc.SOURCE_TYPES[rec["source_type"]]["label"]
        rec["views_basis"] = "median" if rec["median_views"] is not None else ("average" if rec["avg_views"] is not None else "")
        rec["unverified"] = []
        rec["cleansing"] = issues
        rec["line"] = line
        rows.append(rec)
    report["rows_ok"] = len(rows)
    report["row_errors"] = len(errors)
    return jsonify({"rows": _mark_duplicates(rows), "errors": errors, "report": report})


# ---------------------------------------------------------------- 인기 순위 (공식 API만 사용, 크롤링 없음)
RANKING_SETTING_KEY = "ranking_last"


@bp.get("/api/discovery/ranking")
def api_discovery_ranking_get():
    """순위 종류 목록과 마지막으로 가져온 순위(있으면)."""
    return jsonify({"kinds": disc.ranking_kinds(), "sizes": list(disc.RANKING_SIZES), "last": store.get_setting(RANKING_SETTING_KEY)})


@bp.post("/api/discovery/ranking")
def api_discovery_ranking():
    """공식 API로 인기 순위를 가져와 기준 시각과 함께 저장합니다. 등록은 /api/discovery/register."""
    d = request.get_json(silent=True) or {}
    try:
        rows, meta = disc.build_ranking(str(d.get("kind") or ""), d.get("size") or 50,
                                        d.get("platform") if d.get("platform") in PLATFORM_NAME else "tt", str(d.get("keyword") or "")[:80],
                                        food_only=d.get("food_only", True) is not False, region=str(d.get("region") or "VN"))
    except ext.ApiError as e:
        return _error(str(e))
    except (TypeError, ValueError):
        return _error("순위 개수는 30·50·100 중에서 고르세요")
    except Exception as e:
        return _error(f"처리 중 문제가 생겼어요: {type(e).__name__}", 500)
    data = {"rows": _mark_duplicates(rows), "meta": meta}
    store.save_setting(RANKING_SETTING_KEY, data)
    return jsonify(data)


@bp.get("/export/ranking.csv")
def export_ranking():
    last = store.get_setting(RANKING_SETTING_KEY) or {}
    meta, rows = last.get("meta") or {}, last.get("rows") or []
    at = meta.get("collected_at") or {}
    head = ["순위", "플랫폼", "이름", "계정", "주소", "팔로워·구독자", "영상 제목", "영상 조회수", "영상 주소", "출처", "신뢰도",
            "등록 여부", "순위 종류", "집계 기준", "기준 시각(한국)", "기준 시각(베트남)", "기준 시각(UTC)"]
    out = [[r.get("rank"), PLATFORM_NAME.get(r.get("platform"), ""), r.get("name"), r.get("handle"), r.get("url"), r.get("followers"),
            r.get("video_title", ""), r.get("video_views", ""), r.get("video_url", ""), r.get("provider"), r.get("source_label"),
            "등록됨" if r.get("duplicate") else "신규", meta.get("label", ""), meta.get("basis", ""), at.get("kst", ""), at.get("ict", ""),
            at.get("utc", "")] for r in rows]
    return _csv_response(f"influencer_ranking_{_stamp()}.csv", head, out)


@bp.post("/api/integrations/modash/test")
def api_modash_test():
    return _ext(ext.modash_test)


@bp.post("/api/integrations/hypeauditor/test")
def api_hypeauditor_test():
    return _ext(ext.hypeauditor_test)
