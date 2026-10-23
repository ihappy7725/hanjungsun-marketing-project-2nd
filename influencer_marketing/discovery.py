"""인플루언서 발굴 (담당: 진혁) - 외부 제공업체 어댑터와 표준 후보 레코드.

흐름: 후보 발굴(API 또는 TikTok One 화면·직접 입력·CSV) → 지표 표준화 → 중복 확인 → 기존 인플루언서 DB 등록
      → 기존 협업 메일·일정·광고 단가 기능에서 그대로 사용

원칙
- API가 주지 않은 값은 만들지 않습니다(None). 평균 조회수는 중앙값 칸에 넣지 않습니다.
- 데이터마다 출처 종류·제공업체·수집일·신뢰 수준을 붙입니다.
- 광고비 추정치는 견적·계약가(광고 단가 탭)와 섞지 않습니다.
- 키가 없는 제공업체는 목록에서 '키 없음'으로만 표시되고, 기존 기능에는 영향이 없습니다.
"""
import re
import urllib.parse
from datetime import date

from . import external_api as ext

# ---------------------------------------------------------------- 출처·신뢰도
SOURCE_TYPES = {
    "official_api": {"label": "공식 API 확인값", "confidence": "high"},
    "saas": {"label": "전문 SaaS 제공값", "confidence": "medium"},
    "saas_estimate": {"label": "SaaS 추정값", "confidence": "low"},
    "manual": {"label": "직접 확인한 값", "confidence": "high"},
    "submitted": {"label": "인플루언서·에이전시 제출 자료", "confidence": "low"},
    "demo": {"label": "시연용 가상 데이터", "confidence": "demo"},
}
CONFIDENCE_LABEL = {"high": "높음", "medium": "보통", "low": "낮음", "demo": "시연"}
# 기존 '지표 출처' 선택값 → 출처 종류 (기존 값은 그대로 두고 대응만 추가)
METRIC_SOURCE_TYPE = {
    "직접 확인": "manual", "TikTok One": "manual", "TikTok One (화면 확인)": "manual", "인플루언서 제출": "submitted",
    "에이전시 자료": "submitted", "YouTube API": "official_api", "Instagram API": "official_api",
    "Phyllo": "saas", "Modash": "saas", "HypeAuditor": "saas",
}
PLATFORM_NAMES = {"tt": "TikTok", "ig": "Instagram", "yt": "YouTube", "fb": "Facebook"}
CATEGORY_KEYWORDS = {  # YouTube 키워드 검색용 베트남어 검색어
    "Food": "review đồ ăn", "Dessert": "bánh ngọt", "Mukbang": "mukbang",
    "Korean Food": "đồ ăn Hàn Quốc", "Lifestyle": "vlog cuộc sống",
}
CATEGORY_TO_LOCAL = {"Food": "맛집 리뷰", "Dessert": "디저트·먹방", "Mukbang": "디저트·먹방", "Korean Food": "K-컬처", "Lifestyle": "라이프스타일"}


def source_type_of(metrics_source, is_demo=False):
    if is_demo:
        return "demo"
    return METRIC_SOURCE_TYPE.get(metrics_source or "", "manual")


def confidence_of(source_type):
    return SOURCE_TYPES.get(source_type, SOURCE_TYPES["manual"])["confidence"]


# ---------------------------------------------------------------- 계정 식별 (중복 확인)
_ACCOUNT_PATTERNS = {
    "tt": [r"tiktok\.com/@([^/?#\s]+)"],
    "ig": [r"instagram\.com/([^/?#\s]+)"],
    "yt": [r"youtube\.com/channel/(UC[\w-]{22})", r"youtube\.com/(@[^/?#\s]+)", r"youtube\.com/(?:c|user)/([^/?#\s]+)"],
    "fb": [r"facebook\.com/([^/?#\s]+)"],
}


def account_key(platform, ref):
    """같은 플랫폼의 같은 계정이면 같은 값. 예: ('tt', 'https://www.tiktok.com/@Abc?lang=vi') → 'tt:abc'"""
    s = urllib.parse.unquote((ref or "").strip())
    if not s or platform not in _ACCOUNT_PATTERNS:
        return ""
    for pat in _ACCOUNT_PATTERNS[platform]:
        m = re.search(pat, s, re.I)
        if m:
            s = m.group(1)
            break
    else:
        if re.search(r"https?://", s):
            return ""
    s = s.strip().strip("/")
    if platform == "yt":
        if re.match(r"^UC[\w-]{22}$", s):
            return f"yt:{s}"
        return f"yt:@{s.lstrip('@').lower()}"
    return f"{platform}:{s.lstrip('@').lower()}"


def profile_url(platform, handle):
    h = (handle or "").strip().lstrip("@")
    if not h:
        return ""
    if platform == "yt":
        return f"https://www.youtube.com/channel/{h}" if re.match(r"^UC[\w-]{22}$", h) else f"https://www.youtube.com/@{h}"
    return {"tt": f"https://www.tiktok.com/@{h}", "ig": f"https://www.instagram.com/{h}/", "fb": f"https://www.facebook.com/{h}"}.get(platform, "")


def existing_keys(influencers):
    """기존 인플루언서의 채널 주소로 만든 계정 키 → (id, 이름)"""
    out = {}
    for i in influencers:
        for p, ch in (i.get("pf") or {}).items():
            k = account_key(p, (ch or {}).get("url") or "")
            if k:
                out[k] = (i["id"], i["name"])
    return out


# ---------------------------------------------------------------- 제공업체 목록
def providers():
    st = ext.status()
    return [
        {"key": "youtube", "name": "YouTube Data API", "configured": st["youtube"]["configured"], "platforms": ["yt"],
         "source_type": "official_api", "search": True,
         "filters": ["카테고리(키워드)", "최소·최대 구독자"], "not_supported": ["참여율", "베트남 시청자 비중", "조회수 중앙값(검색 단계)"],
         "cost": "검색 1번 약 101유닛 (하루 10,000유닛)"},
        {"key": "modash", "name": "Modash", "configured": st["modash"]["configured"], "platforms": ["tt", "ig", "yt"],
         "source_type": "saas", "search": True,
         "filters": ["국가", "팔로워", "최소 조회수", "참여율", "언어", "베트남 시청자 비중"], "not_supported": ["카테고리"],
         "cost": "결과 1건마다 크레딧 차감 (유료 계약)"},
        {"key": "hypeauditor", "name": "HypeAuditor", "configured": st["hypeauditor"]["configured"], "platforms": ["tt", "ig", "yt"],
         "source_type": "saas", "search": True, "sandbox": st["hypeauditor"]["env"] == "sandbox",
         "filters": ["국가", "팔로워", "평균 조회수", "참여율", "언어", "베트남 시청자 비중"], "not_supported": ["카테고리"],
         "cost": "페이지당 Discovery 1회 차감 (샌드박스 모드는 시험용 데이터)"},
        {"key": "phyllo", "name": "Phyllo", "configured": st["phyllo"]["configured"], "platforms": ["tt", "ig", "yt"],
         "source_type": "saas", "search": False, "filters": [], "not_supported": ["검색 기능 없음 (개별 프로필 확인만)"],
         "cost": "요금제에 따라 다름"},
        {"key": "tiktok_one", "name": "TikTok One", "configured": False, "platforms": ["tt"], "source_type": "manual",
         "search": False, "filters": [], "not_supported": ["API 권한 미확인 → 화면 연계(이동·기준 복사·직접 입력·CSV)"],
         "cost": "광고주 계정으로 화면 이용"},
    ]


# ---------------------------------------------------------------- 검색 실행
def _youtube_rows(f):
    cats = f.get("categories") or []
    q = f.get("keyword") or " | ".join(CATEGORY_KEYWORDS[c] for c in cats if c in CATEGORY_KEYWORDS) or "review đồ ăn"
    rows = []
    for c in ext.youtube_search(q, 25):
        rows.append({"provider": "YouTube Data API", "source_type": "official_api", "platform": "yt",
                     "handle": c.get("handle") or c["channel_id"], "name": c["title"], "url": c["url"],
                     "followers": c.get("subscribers"), "median_views": None, "views_basis": "",
                     "avg_views": None, "er": None, "vn_audience": None, "country": c.get("country", ""), "language": "",
                     "provider_id": c["channel_id"]})
    return rows, {"query": q}


def apply_filters(rows, f):
    """API가 거르지 못한 조건을 한 번 더 적용. 값이 없으면 빼지 않고 '확인 불가'로 표시."""
    checks = [("min_followers", "followers", lambda v, t: v >= t, "팔로워"),
              ("max_followers", "followers", lambda v, t: v <= t, "팔로워"),
              ("min_views", None, None, "조회수"),
              ("min_er", "er", lambda v, t: v >= t, "참여율"),
              ("min_vn_audience", "vn_audience", lambda v, t: v >= t, "베트남 시청자 비중")]
    out = []
    for r in rows:
        unverified, ok = [], True
        for fk, rk, test, label in checks:
            t = f.get(fk)
            if t in (None, "", 0):
                continue
            t = float(t)
            if fk == "min_views":
                v = r.get("median_views") if r.get("median_views") is not None else r.get("avg_views")
                if v is None:
                    unverified.append(label)
                elif v < t:
                    ok = False
                continue
            v = r.get(rk)
            if v is None:
                unverified.append(label)
            elif not test(float(v), t):
                ok = False
        if f.get("country_code") and r.get("country") and r["country"].lower() != f["country_code"].lower():
            unverified.append("활동 국가(채널 표기 국가가 다름)")
        if ok:
            r["unverified"] = sorted(set(unverified))
            out.append(r)
    return out


def standardize(r, f=None):
    st = r.get("source_type") or "saas"
    r.setdefault("handle", "")
    r["handle"] = (r["handle"] or "").lstrip("@")
    if not r.get("url"):
        r["url"] = profile_url(r["platform"], r["handle"] or r.get("provider_id", ""))
    r["collected_on"] = r.get("collected_on") or date.today().isoformat()
    r["confidence"] = confidence_of(st)
    r["source_label"] = SOURCE_TYPES.get(st, {}).get("label", "")
    r["category"] = r.get("category") or (CATEGORY_TO_LOCAL.get((f or {}).get("categories", [None])[0]) if (f or {}).get("categories") else "")
    r.setdefault("unverified", [])
    r.setdefault("est_cost", None)  # SaaS가 추정 광고비를 주는 경우에만 표시용으로 채움 (견적·계약가 아님)
    return r


def search(provider, platform, f):
    f = dict(f or {})
    f["country_code"] = "vn" if (f.get("country") or "").lower() in ("vietnam", "vn", "베트남") else ""
    if provider == "youtube":
        if platform != "yt":
            raise ext.ApiError("YouTube Data API는 YouTube 채널만 검색할 수 있어요")
        rows, meta = _youtube_rows(f)
    elif provider == "modash":
        rows, meta = ext.modash_search(platform, f)
    elif provider == "hypeauditor":
        rows, meta = ext.hypeauditor_search(platform, f)
    elif provider in ("phyllo", "tiktok_one"):
        raise ext.ApiError("이 서비스는 검색 기능이 없어요. TikTok One 연계(직접 입력·CSV)나 다른 제공업체를 쓰세요")
    else:
        raise ext.ApiError("알 수 없는 제공업체예요")
    rows = [standardize(r, f) for r in rows]
    before = len(rows)
    rows = apply_filters(rows, f)
    meta = {**(meta or {}), "returned": before, "after_filter": len(rows),
            "category_filter_applied": provider == "youtube" and bool(f.get("categories"))}
    return rows, meta


# ---------------------------------------------------------------- 등록용 변환
def to_channel(r):
    """표준 레코드 → 기존 인플루언서 채널 지표(pf[platform]) 형식. 기존 키(f, v, url)는 그대로 쓰고 추가 키만 덧붙임."""
    st = r.get("source_type") or "manual"
    return {"f": r.get("followers"), "v": r.get("median_views"), "url": r.get("url") or profile_url(r["platform"], r.get("handle")),
            "avg": r.get("avg_views"), "er": r.get("er"), "aud_vn": r.get("vn_audience"), "country": r.get("country") or "",
            "lang": r.get("language") or "", "src": st, "prov": r.get("provider") or "", "at": r.get("collected_on") or date.today().isoformat(),
            "conf": confidence_of(st)}
