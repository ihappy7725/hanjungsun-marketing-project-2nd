"""인플루언서 발굴 (담당: 진혁) - 외부 제공업체 어댑터와 표준 후보 레코드.

흐름: 후보 발굴(API 또는 TikTok One 화면·직접 입력·CSV) → 지표 표준화 → 중복 확인 → 기존 인플루언서 DB 등록
      → 기존 협업 메일·일정·광고 단가 기능에서 그대로 사용

원칙
- API가 주지 않은 값은 만들지 않습니다(None). 평균 조회수는 중앙값 칸에 넣지 않습니다.
- 데이터마다 출처 종류·제공업체·수집일·신뢰 수준을 붙입니다.
- 광고비 추정치는 견적·계약가(광고 단가 탭)와 섞지 않습니다.
- 키가 없는 제공업체는 목록에서 '키 없음'으로만 표시되고, 기존 기능에는 영향이 없습니다.
"""
import csv
import io
import json
import os
import re
import unicodedata
import urllib.parse
from datetime import date, datetime, timedelta, timezone

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
# 타깃 그룹: 누구를 겨냥한 채널인지. 버튼을 누르면 [발굴] 검색 조건이 바뀌고, 등록할 때 이 그룹이 붙습니다.
SEGMENTS = [
    {"key": "vn_food", "name": "베트남(인) · 식품(맛집·먹방)", "category": "맛집 리뷰", "platform": "tt", "country": "Vietnam", "language": "vi",
     "keyword": "review đồ ăn | mukbang | review quán ăn", "cats": ["Food", "Mukbang"]},
    {"key": "vn_snack", "name": "베트남(인) · 간식·디저트", "category": "디저트·먹방", "platform": "tt", "country": "Vietnam", "language": "vi",
     "keyword": "đồ ăn vặt | bánh ngọt | món tráng miệng", "cats": ["Dessert"]},
    {"key": "vn_kfood", "name": "베트남(인) · K-푸드·K-컬처", "category": "K-컬처", "platform": "tt", "country": "Vietnam", "language": "vi",
     "keyword": "đồ ăn Hàn Quốc | ăn thử đồ Hàn | bánh mochi Hàn Quốc", "cats": ["Korean Food"]},
    {"key": "vn_life", "name": "베트남(인) · 라이프스타일", "category": "라이프스타일", "platform": "tt", "country": "Vietnam", "language": "vi",
     "keyword": "vlog cuộc sống | vlog ăn uống", "cats": ["Lifestyle"]},
    {"key": "kr_danang", "name": "한국(인) · 다낭 여행 유튜버", "category": "여행", "platform": "yt", "country": "Korea", "language": "ko",
     "keyword": "다낭 여행 | 다낭 브이로그 | 다낭 맛집", "cats": []},
]
SEGMENT_NAMES = [x["name"] for x in SEGMENTS]
SEGMENT_UNSET = "미분류"
COUNTRY_CODE = {"vietnam": "vn", "vn": "vn", "베트남": "vn", "korea": "kr", "kr": "kr", "한국": "kr", "south korea": "kr"}


def segment_name(value):
    """허용된 타깃 그룹 이름만 돌려줍니다 (모르는 값은 빈 문자열)."""
    v = str(value or "").strip()
    return v if v in SEGMENT_NAMES else ""


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


NANO_MIN = 1000  # 인플루언서 기준: Nano(팔로워 1천) 이상. 1천 미만으로 확인된 계정은 발굴 결과에서 뺌


def plain_name(s):
    """검색하기 쉬운 이름: 꾸민 글꼴(𝙃𝙤̀𝙖)을 일반 글자로, 이모지·장식 기호는 공백으로. 베트남어 성조는 유지."""
    s = unicodedata.normalize("NFKC", str(s or ""))
    out = []
    for ch in s:
        cat = unicodedata.category(ch)
        if ch in "\u200d\ufe0e\ufe0f" or 0x1F3FB <= ord(ch) <= 0x1F3FF:  # 이모지 결합 문자·피부색 표시
            continue
        if cat[0] in "LNM" or ch in " .,_-&()'/":
            out.append(ch)
        else:
            out.append(" ")
    return unicodedata.normalize("NFC", re.sub(r"\s+", " ", "".join(out)).strip(" .,_-"))


def name_key(platform, name):
    """주소를 모르는 계정의 중복 확인 키: 플랫폼 + 정리한 이름(소문자)"""
    n = plain_name(name).lower()
    return f"name:{platform}:{n}" if n else ""


def search_links(name, handle=""):
    """사용자가 직접 눌러 여는 검색 링크(자동 수집 아님). 계정 ID를 알면 ID로, 모르면 이름으로 찾습니다."""
    q = (handle or plain_name(name)).strip()
    if not q:
        return {}
    e = urllib.parse.quote(q)
    return {"TikTok": f"https://www.tiktok.com/search/user?q={e}",
            "Instagram": f"https://www.instagram.com/explore/search/keyword/?q={e}",
            "YouTube": f"https://www.youtube.com/results?search_query={e}&sp=EgIQAg%253D%253D",
            "Facebook": f"https://www.facebook.com/search/top?q={e}",
            "Google": f"https://www.google.com/search?q={urllib.parse.quote(q + ' influencer')}"}


def existing_keys(influencers):
    """기존 인플루언서의 채널 주소로 만든 계정 키 → (id, 이름). 주소가 없는 채널은 '플랫폼+이름' 키로 대신합니다."""
    out = {}
    for i in influencers:
        for p, ch in (i.get("pf") or {}).items():
            k = account_key(p, (ch or {}).get("url") or "")
            if k:
                out[k] = (i["id"], i["name"])
            nk = name_key(p, i.get("name"))
            if nk:
                out.setdefault(nk, (i["id"], i["name"]))
    return out


# ---------------------------------------------------------------- 제공업체 목록
def providers():
    """[발굴] '조회할 곳' 목록: YouTube → 참고 자료 CSV(reference_data) → 유료 API·검색 없는 서비스 순서."""
    st = ext.status()
    youtube = {"key": "youtube", "name": "YouTube Data API", "configured": st["youtube"]["configured"], "platforms": ["yt"],
               "source_type": "official_api", "search": True,
               "filters": ["카테고리(키워드)", "최소·최대 구독자"], "not_supported": ["참여율", "베트남 시청자 비중", "조회수 중앙값(검색 단계)"],
               "cost": "검색 1번 약 101유닛 (하루 10,000유닛)"}
    return [youtube] + ref_providers() + _api_providers_tail(st)


def _api_providers_tail(st):
    """YouTube 다음에 보일 기존 제공업체(순서 유지)."""
    return [
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


# ---------------------------------------------------------------- 참고 자료 CSV (reference_data 폴더)
# 폴더에 CSV를 넣고 sources.json에 이름·기준일을 적으면 [발굴] '조회할 곳'에 나타납니다. 외부 사이트에 접속하지 않고 파일만 읽습니다.
REF_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "reference_data")
REF_MAX_BYTES = 5 * 1024 * 1024
_PF_BY_NAME = {"tiktok": "tt", "instagram": "ig", "youtube": "yt", "facebook": "fb", "tt": "tt", "ig": "ig", "yt": "yt", "fb": "fb"}
_ref_cache = {}


def _ref_manifest():
    try:
        with open(os.path.join(REF_DIR, "sources.json"), encoding="utf-8") as f:
            items = json.load(f).get("sources") or []
    except (OSError, ValueError, AttributeError):
        items = []
    out, seen = [], set()
    for it in items:
        fn = os.path.basename(str(it.get("file") or ""))
        if fn.lower().endswith(".csv") and fn not in seen:
            seen.add(fn)
            out.append({"file": fn, "label": str(it.get("label") or fn)[:60], "as_of": str(it.get("as_of") or "")[:10],
                        "note": str(it.get("note") or "")[:80], "detail": str(it.get("detail") or "")[:80],
                        "kind": "demo" if it.get("kind") == "demo" else "real"})
    try:  # 설정에 없는 CSV도 파일 이름으로 보여 줌
        for fn in sorted(os.listdir(REF_DIR)):
            if fn.lower().endswith(".csv") and fn not in seen:
                out.append({"file": fn, "label": fn[:-4][:60], "as_of": "", "note": "", "detail": "sources.json에 기준일 미기재", "kind": "real"})
    except OSError:
        pass
    return out


def _num_or_none(v):
    v = str(v or "").replace(",", "").strip()
    if not v:
        return None
    try:
        n = float(v)
    except ValueError:
        return None
    return int(n) if n == int(n) else n


def _ref_load(src):
    """CSV 한 개를 표준 후보 레코드 목록으로 읽습니다. 파일이 바뀌면 다시 읽습니다."""
    path = os.path.join(REF_DIR, src["file"])
    try:
        st = os.stat(path)
    except OSError:
        return [], "파일을 찾지 못했어요"
    if st.st_size > REF_MAX_BYTES:
        return [], "파일이 5MB를 넘어요"
    key = (path, st.st_mtime, st.st_size)
    if key in _ref_cache:
        return _ref_cache[key]
    with open(path, "rb") as f:
        raw = f.read()
    text = raw.decode("utf-8-sig", errors="replace")
    head = next(csv.reader(io.StringIO(text)), [])
    rows = []
    as_of = src["as_of"] or date.today().isoformat()
    provider = f"{src['label']}({as_of[2:].replace('-', '/')} 기준)"[:60]  # Ver_023: 26/10/24 기준
    if "레코드 ID" in head and "분류" in head:  # Ver_003 실제 자료 형식
        for r in csv.DictReader(io.StringIO(text)):
            pf = _PF_BY_NAME.get((r.get("플랫폼") or "").strip().lower())
            if not pf:
                continue
            url = (r.get("프로필 URL") or "").strip()
            fol = _num_or_none(r.get("팔로워·구독자"))
            rows.append({"provider": provider, "source_type": "saas_estimate", "platform": pf, "handle": "", "url": url,
                         "name": r.get("계정명(Nox 표기)") or "", "followers": fol, "median_views": _num_or_none(r.get("조회수 중앙값")),
                         "views_basis": "", "avg_views": _num_or_none(r.get("평균 조회수")), "er": _num_or_none(r.get("참여율(%)")),
                         "vn_audience": _num_or_none(r.get("베트남 시청자 비중(%)")), "country": "VN", "language": "vi",
                         "collected_on": as_of, "segment": r.get("타깃 그룹 제안") or "",
                         "notes": f"{r.get('레코드 ID', '')} · Nox {r.get('순위 종류', '')} {r.get('Nox 순위', '')}위 · {r.get('분류', '')}({r.get('색', '')}) · 식품 관련성 {r.get('식품 관련성 점수(0~3)') or '-'}/3"
                                  + (f" · 팔로워는 {r.get('팔로워 출처')} 추정({r.get('팔로워 기준일')})" if fol is not None else ""),
                         "ref_class": r.get("분류") or "", "ref_color": r.get("색") or "", "ref_identity": r.get("순위 계정과 동일 여부") or "",
                         "ref_food": r.get("식품 관련성 점수(0~3)") or "", "ref_next": r.get("다음 할 일") or "",
                         "ref_rank": f"{r.get('순위 종류', '')} {r.get('Nox 순위', '')}위", "ref_fol_src": f"{r.get('팔로워 출처', '')} {r.get('팔로워 기준일', '')}".strip(),
                         "no_url": not url, "display_name": r.get("계정명(Nox 표기)") or "",
                         # 분야는 화면의 카테고리 필터로 정하지 않고, 타깃 그룹의 기본 분야(없으면 기타)를 씀
                         "category": next((x["category"] for x in SEGMENTS if x["name"] == (r.get("타깃 그룹 제안") or "")), "기타")})
        err = ""
    elif "레코드 ID" in head and "가상 계정명" in head:  # Ver_003 가상 자료 형식
        for r in csv.DictReader(io.StringIO(text)):
            pf = _PF_BY_NAME.get((r.get("플랫폼") or "").strip().lower())
            if not pf:
                continue
            seg = r.get("타깃 그룹") or ""
            rows.append({"provider": provider, "source_type": "demo", "platform": pf, "handle": "", "url": r.get("가상 프로필 URL") or "",
                         "name": r.get("가상 계정명") or "", "followers": _num_or_none(r.get("팔로워·구독자")),
                         "median_views": _num_or_none(r.get("조회수 중앙값")), "views_basis": "median", "avg_views": None,
                         "er": _num_or_none(r.get("참여율(%)")), "vn_audience": _num_or_none(r.get("베트남 시청자 비중(%)")),
                         "country": "KR" if seg.startswith("한국") else "VN", "language": "ko" if seg.startswith("한국") else "vi",
                         "collected_on": as_of, "segment": seg, "category": r.get("분야") or "",
                         "notes": f"[DEMO_SYNTHETIC·발표용 가상 계정] {r.get('레코드 ID', '')} · {r.get('도시', '')}",
                         "ref_class": r.get("분류(가상 예시)") or "", "ref_color": "보라", "ref_identity": "가상 계정(실존하지 않음)",
                         "ref_food": "", "ref_next": "발표·시연용", "ref_rank": "", "ref_fol_src": "가상값", "no_fill": True, "no_url": False})
        err = ""
    else:  # 그 밖의 CSV는 '파일로 여러 명 가져오기'와 같은 규칙으로 정제
        try:
            recs, _errors, _report = cleanse_file(raw, source_type="saas", provider=provider, is_demo=src["kind"] == "demo", today=as_of)
        except ValueError as e:
            return [], str(e)
        for r in recs:
            r.pop("_line", None); r.pop("_issues", None)
            r.update({"handle": "", "ref_class": "", "ref_color": "", "ref_identity": "", "ref_food": "", "ref_next": "", "ref_rank": "",
                      "ref_fol_src": "", "no_url": not r.get("url"), "no_fill": src["kind"] == "demo"})
            rows.append(r)
        err = ""
    _ref_cache.clear()
    _ref_cache[key] = (rows, err)
    return rows, err


def ref_providers():
    out = []
    for i, src in enumerate(_ref_manifest()):
        rows, err = _ref_load(src)
        pfs = sorted({r["platform"] for r in rows})
        as_of = src["as_of"][2:].replace("-", "/") if src["as_of"] else "기준일 미기재"  # Ver_023: 26/10/24
        demo = src["kind"] == "demo"
        out.append({"key": f"ref:{src['file']}", "name": src["label"], "configured": bool(rows), "platforms": pfs or ["tt", "ig", "yt"],
                    "source_type": "demo" if demo else "saas_estimate", "search": True, "ref": True, "kind": src["kind"],
                    "note": (f"(*{src['note'] or '발표용 가상 데이터'} · {as_of}" if demo else f"({src['note'] + ' ' if src['note'] else ''}{as_of} 기준")
                            + (f", {src['detail']}" if src["detail"] else "") + ")",
                    "count": len(rows), "error": err,
                    "filters": ["플랫폼", "팔로워(값 있는 계정만)", "참여율(값 있는 계정만)"],
                    "not_supported": ["카테고리·키워드(파일의 분류 사용)"],
                    "cost": f"무료 · 파일 {len(rows)}개 계정" if rows else (err or "읽을 계정이 없어요")})
    return out


def _ref_search(provider, platform, f, include_excluded=False):
    src = next((s for s in _ref_manifest() if f"ref:{s['file']}" == provider), None)
    if not src:
        raise ext.ApiError("참고 자료 파일을 찾지 못했어요. reference_data 폴더와 sources.json을 확인하세요")
    rows, err = _ref_load(src)
    if err and not rows:
        raise ext.ApiError(f"참고 자료를 읽지 못했어요: {err}")
    total = len(rows)
    rows = [dict(r) for r in rows if r["platform"] == platform]
    for r in rows:
        k = account_key(platform, r.get("url") or "")
        r["handle"] = k.split(":", 1)[1].lstrip("@") if k else ""
        r["display_name"] = r.get("display_name") or r.get("name") or ""
        r["name"] = plain_name(r["display_name"]) or r["display_name"]  # 등록·검색용 이름(꾸민 글꼴·이모지 제거)
        r["search_links"] = search_links(r["name"], "" if r["handle"].startswith("UC") else r["handle"])
    pf_total = len(rows)
    if not include_excluded:
        rows = [r for r in rows if not str(r.get("ref_class") or "").startswith("D")]
    hidden_excluded = pf_total - len(rows)
    return rows, {"ref": True, "label": src["label"], "as_of": src["as_of"], "kind": src["kind"], "total": total,
                  "platform_total": pf_total, "hidden_excluded": hidden_excluded}


# ---------------------------------------------------------------- 검색 실행
def _youtube_rows(f):
    cats = f.get("categories") or []
    kr = f.get("country_code") == "kr"
    q = f.get("keyword") or ("다낭 여행" if kr else " | ".join(CATEGORY_KEYWORDS[c] for c in cats if c in CATEGORY_KEYWORDS) or "review đồ ăn")
    rows = []
    for c in ext.youtube_search(q, 25, region="KR" if kr else "VN", lang=f.get("language") or ("ko" if kr else "vi")):
        rows.append({"provider": "YouTube Data API", "source_type": "official_api", "platform": "yt",
                     "handle": c.get("handle") or c["channel_id"], "name": c["title"], "url": c["url"],
                     "followers": c.get("subscribers"), "median_views": None, "views_basis": "",
                     "avg_views": None, "er": None, "vn_audience": None, "country": c.get("country", ""), "language": "",
                     "provider_id": c["channel_id"]})
    return rows, {"query": q, "region": "KR" if kr else "VN"}


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
    f["country_code"] = COUNTRY_CODE.get((f.get("country") or "").lower(), "")
    if provider == "youtube":
        if platform != "yt":
            raise ext.ApiError("YouTube Data API는 YouTube 채널만 검색할 수 있어요")
        rows, meta = _youtube_rows(f)
    elif provider == "modash":
        rows, meta = ext.modash_search(platform, f)
    elif provider == "hypeauditor":
        rows, meta = ext.hypeauditor_search(platform, f)
    elif provider.startswith("ref:"):
        rows, meta = _ref_search(provider, platform, f, bool(f.get("include_excluded")))
    elif provider in ("phyllo", "tiktok_one"):
        raise ext.ApiError("이 서비스는 검색 기능이 없어요. TikTok One 연계(직접 입력·CSV)나 다른 제공업체를 쓰세요")
    else:
        raise ext.ApiError("알 수 없는 제공업체예요")
    rows = [standardize(r, f) for r in rows]
    below = [r for r in rows if r.get("followers") is not None and r["followers"] < NANO_MIN]
    rows = [r for r in rows if not (r.get("followers") is not None and r["followers"] < NANO_MIN)]
    before = len(rows)
    rows = apply_filters(rows, f)
    meta = {**(meta or {}), "returned": before, "after_filter": len(rows), "below_nano": len(below),
            "category_filter_applied": provider == "youtube" and bool(f.get("categories")) and f.get("country_code") != "kr"}
    return rows, meta


# ---------------------------------------------------------------- 등록용 변환
def to_channel(r):
    """표준 레코드 → 기존 인플루언서 채널 지표(pf[platform]) 형식. 기존 키(f, v, url)는 그대로 쓰고 추가 키만 덧붙임."""
    st = r.get("source_type") or "manual"
    return {"f": r.get("followers"), "v": r.get("median_views"), "url": r.get("url") or profile_url(r["platform"], r.get("handle")),
            "avg": r.get("avg_views"), "er": r.get("er"), "aud_vn": r.get("vn_audience"), "country": r.get("country") or "",
            "lang": r.get("language") or "", "src": st, "prov": r.get("provider") or "", "at": r.get("collected_on") or date.today().isoformat(),
            "conf": confidence_of(st), **({"need_url": True} if not (r.get("url") or r.get("handle")) else {})}


# ---------------------------------------------------------------- 외부 파일 정제 (CSV·TSV)
# 사용자가 정당하게 받은 파일(SaaS 내보내기, 에이전시 자료, 인플루언서 제출 자료, 우리 양식)만 처리합니다.
# 사이트 자동 접속·크롤링은 하지 않습니다. 정제 결과는 미리보기로만 돌려주고, 저장은 사용자가 고른 행만 합니다.
MAX_UPLOAD_BYTES = 5 * 1024 * 1024
MAX_ROWS = 2000

FIELD_LABEL = {"platform": "플랫폼", "url": "계정 주소·핸들", "name": "이름", "followers": "팔로워", "median_views": "조회수 중앙값",
               "avg_views": "평균 조회수", "views_unknown": "조회수(기준 불명)", "er": "참여율", "vn_audience": "베트남 시청자 비중",
               "language": "콘텐츠 언어", "country": "활동 국가", "source": "출처", "collected_on": "수집일", "category": "분야", "notes": "메모", "segment": "타깃 그룹"}
_HEADER_ALIASES = {
    "platform": ["플랫폼", "platform", "network", "socialnetwork", "nềntảng", "mạngxãhội"],
    "url": ["계정주소또는핸들", "계정주소", "주소", "핸들", "url", "profileurl", "profilelink", "link", "account", "accounturl",
            "username", "handle", "channelurl", "channellink", "tàikhoản", "đườngdẫn", "liênkết"],
    "name": ["이름", "채널명", "name", "fullname", "displayname", "creator", "creatorname", "influencer", "channelname",
             "nickname", "tên", "tênkênh"],
    "followers": ["팔로워", "구독자", "followers", "followercount", "subscribers", "subscribercount", "fans", "audiencesize",
                  "ngườitheodõi", "lượttheodõi", "ngườiđăngký"],
    "median_views": ["조회수중앙값", "medianviews", "medianview", "viewsmedian"],
    "avg_views": ["평균조회수", "averageviews", "avgviews", "meanviews", "viewsavg", "viewsaverage", "lượtxemtrungbình"],
    "views_unknown": ["조회수", "views", "viewcount", "lượtxem"],
    "er": ["참여율", "engagementrate", "er", "engagement", "engrate", "tỷlệtươngtác"],
    "vn_audience": ["베트남시청자비중", "vietnamaudience", "audiencevietnam", "vnaudience", "audiencevn", "vietnam"],
    "language": ["콘텐츠언어", "언어", "language", "lang", "contentlanguage", "ngônngữ"],
    "country": ["활동국가", "국가", "country", "location", "creatorcountry", "quốcgia"],
    "source": ["출처", "source", "datasource", "nguồn"],
    "collected_on": ["수집일", "기준일", "collectedon", "collected", "date", "asof", "updated", "lastupdated", "ngàythuthập", "ngày"],
    "category": ["분야", "category", "categories", "niche", "topic", "danhmục"],
    "notes": ["메모", "notes", "note", "comment", "comments", "ghichú"],
    "segment": ["타깃그룹", "타깃", "타겟그룹", "segment", "targetgroup", "target"],
}
_ALIAS_INDEX = {a: f for f, names in _HEADER_ALIASES.items() for a in names}
_PLATFORM_WORDS = {"tiktok": "tt", "tt": "tt", "instagram": "ig", "insta": "ig", "ig": "ig", "youtube": "yt", "yt": "yt",
                   "facebook": "fb", "fb": "fb"}
_SOURCE_WORDS = {"직접 확인": "manual", "tiktok one 화면 확인": "manual", "인플루언서 제출": "submitted", "에이전시 자료": "submitted"}


def _norm_head(h):
    return re.sub(r"[\s_\-().%#:/.,\[\]]", "", (h or "").strip().lstrip("﻿").lower())


def _guess_field(h):
    n = _norm_head(h)
    if not n:
        return None
    if n in _ALIAS_INDEX:
        return _ALIAS_INDEX[n]
    has = lambda *ws: any(w in n for w in ws)  # noqa: E731
    views = has("view", "조회", "xem", "play")
    if views and has("median", "중앙"):
        return "median_views"
    if views and has("avg", "average", "mean", "평균", "trungbình"):
        return "avg_views"
    if has("vietnam", "베트남") and has("audience", "시청자", "khángiả", "%", "share"):
        return "vn_audience"
    if has("growth", "change", "증가", "변화", "tăng"):
        return None
    if has("follower", "subscriber", "팔로워", "구독자", "theodõi", "đăngký"):
        return "followers"
    if has("engagement", "참여", "tươngtác"):
        return "er"
    if views:
        return "views_unknown"
    if has("url", "link", "주소", "handle", "username") and not has("image", "picture", "avatar", "photo", "사진"):
        return "url"
    return None


def map_headers(heads):
    """원본 열 이름 → 표준 필드. 같은 필드에 열이 여러 개면 첫 번째만 쓰고 나머지는 '사용 안 함'으로 알려 줍니다."""
    mapping, used, unused = {}, set(), []
    for h in heads:
        f = _guess_field(h)
        if f and f not in used:
            mapping[h] = f
            used.add(f)
        elif (h or "").strip():
            unused.append(h)
    if "median_views" in used or "avg_views" in used:  # 기준이 분명한 열이 있으면 기준 불명 열은 쓰지 않음
        for h, f in list(mapping.items()):
            if f == "views_unknown":
                del mapping[h]
                unused.append(h)
    return mapping, unused


def decode_upload(raw):
    """엑셀·도구마다 다른 글자 인코딩을 판별. (텍스트, 인코딩 이름)"""
    if raw[:2] in (b"\xff\xfe", b"\xfe\xff"):
        return raw.decode("utf-16"), "UTF-16"
    for enc, label in (("utf-8-sig", "UTF-8"), ("cp949", "CP949 (한국어 엑셀)"), ("cp1258", "CP1258 (베트남어 Windows)")):
        try:
            return raw.decode(enc), label
        except UnicodeDecodeError:
            continue
    return raw.decode("utf-8", errors="replace"), "UTF-8 (일부 글자 깨짐)"


def read_table(text):
    sample = text[:4096]
    try:
        delim = csv.Sniffer().sniff(sample, delimiters=",\t;").delimiter
    except csv.Error:
        delim = "\t" if sample.count("\t") > sample.count(",") else ","
    rows = list(csv.reader(io.StringIO(text), delimiter=delim))
    while rows and not any(c.strip() for c in rows[0]):
        rows.pop(0)
    if not rows:
        return [], [], delim
    heads = [c.strip() for c in rows[0]]
    body = [r for r in rows[1:] if any(c.strip() for c in r)]
    return heads, body, delim


_MULT = [(r"(triệu|trieu|million|mn|tr|m)$", 1e6), (r"(tỷ|tỉ|ty|billion|bn|b)$", 1e9), (r"(nghìn|ngàn|nghin|ngan|thousand|k)$", 1e3),
         (r"억$", 1e8), (r"만$", 1e4), (r"천$", 1e3)]
_EMPTY = {"", "-", "–", "n/a", "na", "none", "null", "없음", "비공개", "?", "không có"}


def _plain_number(s, decimal_hint):
    """'1.234.567' '1,234.5' '12,5' 같은 표기를 float로. decimal_hint=True면 구분자 하나는 소수점으로 봄."""
    s = s.replace(" ", "").replace(" ", "")
    if not re.fullmatch(r"[\d.,]+", s) or not re.search(r"\d", s):
        return None
    if "," in s and "." in s:
        dec = "," if s.rfind(",") > s.rfind(".") else "."
        s = s.replace("." if dec == "," else ",", "").replace(dec, ".")
    else:
        sep = "," if "," in s else ("." if "." in s else "")
        if sep:
            parts = s.split(sep)
            if len(parts) > 2 or (not decimal_hint and len(parts[-1]) == 3):
                s = s.replace(sep, "")  # 천 단위 구분자
            else:
                s = s.replace(sep, ".")
    try:
        return float(s)
    except ValueError:
        return None


def parse_count(v):
    """팔로워·조회수: '1.2M' '12,5K' '1.234.567' '15 triệu' '3만' → 숫자. (값, 문제 설명 또는 '')"""
    s = str(v or "").strip().strip("'\"").lower().replace("+", "")
    if s in _EMPTY:
        return None, ""
    mult = 1
    for pat, m in _MULT:
        if re.search(pat, s):
            s, mult = re.sub(pat, "", s).strip(), m
            break
    n = _plain_number(s, decimal_hint=mult != 1)
    if n is None:
        return None, f"숫자로 읽지 못함('{str(v)[:20]}')"
    n = n * mult
    return (int(round(n)) if mult != 1 or n == int(n) else n), ""


def parse_pct_column(values):
    """참여율·시청자 비중 열 전체를 보고 판단. 모든 값이 1 이하이고 % 표시가 없으면 비율(0~1)로 보고 ×100."""
    parsed, issues = [], []
    has_pct_sign = any("%" in str(v) for v in values)
    for v in values:
        s = str(v or "").strip().strip("'\"").replace("%", "").lower()
        if s in _EMPTY:
            parsed.append(None)
            issues.append("")
            continue
        n = _plain_number(s, decimal_hint=True)
        parsed.append(n)
        issues.append("" if n is not None else f"비율로 읽지 못함('{str(v)[:20]}')")
    nums = [n for n in parsed if n is not None]
    scaled = bool(nums) and not has_pct_sign and max(nums) <= 1
    out = []
    for n, issue in zip(parsed, issues):
        if n is not None and scaled:
            n = round(n * 100, 4)
        if n is not None and n > 100:
            n, issue = None, "100%를 넘는 값"
        out.append((n, issue))
    return out, scaled


def parse_date(v):
    s = str(v or "").strip()[:19]
    if not s:
        return "", ""
    m = re.match(r"^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})", s)
    if m:
        y, mo, d = int(m[1]), int(m[2]), int(m[3])
    else:
        m = re.match(r"^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})", s)  # 베트남식 일/월/연
        if not m:
            return "", f"날짜로 읽지 못함('{s[:20]}')"
        d, mo, y = int(m[1]), int(m[2]), int(m[3])
    try:
        return date(y, mo, d).isoformat(), ""
    except ValueError:
        return "", f"날짜로 읽지 못함('{s[:20]}')"


def detect_platform(value, ref, default=""):
    v = re.sub(r"[^a-z]", "", str(value or "").lower())
    if v in _PLATFORM_WORDS:
        return _PLATFORM_WORDS[v]
    r = str(ref or "").lower()
    for dom, p in (("tiktok.com", "tt"), ("instagram.com", "ig"), ("youtube.com", "yt"), ("youtu.be", "yt"), ("facebook.com", "fb"), ("fb.com", "fb")):
        if dom in r:
            return p
    return default if default in PLATFORM_NAMES else ""


def cleanse_file(raw, source_type="", provider="", default_platform="", is_demo=False, today=None):
    """업로드 파일 → (정제된 원본 레코드 목록, 행 오류, 정제 리포트). 레코드는 routes._record_from_input으로 한 번 더 검증합니다.

    source_type이 비어 있으면 행마다 '출처' 열(우리 양식)을 따르고, 없으면 '직접 확인'으로 봅니다.
    """
    today = today or date.today().isoformat()
    if len(raw) > MAX_UPLOAD_BYTES:
        raise ValueError("파일이 너무 커요 (5MB 이하)")
    text, enc = decode_upload(raw)
    heads, body, delim = read_table(text)
    if not heads:
        raise ValueError("빈 파일이에요")
    mapping, unused = map_headers(heads)
    if "url" not in mapping.values():
        raise ValueError("계정 주소(또는 @핸들) 열을 찾지 못했어요. 찾은 열: " + ", ".join(h for h in heads if h)[:200])
    col = {f: heads.index(h) for h, f in mapping.items()}
    get = lambda row, f: (row[col[f]].strip().removeprefix("'") if f in col and col[f] < len(row) else "")  # noqa: E731
    truncated = len(body) > MAX_ROWS
    body = body[:MAX_ROWS]
    pct = {f: parse_pct_column([get(r, f) for r in body]) for f in ("er", "vn_audience")}
    report = {"encoding": enc, "delimiter": {",": "쉼표", "\t": "탭", ";": "세미콜론"}.get(delim, delim), "rows_read": len(body),
              "truncated": truncated, "mapping": [{"column": h, "field": f, "label": FIELD_LABEL[f]} for h, f in mapping.items()],
              "unused_columns": unused, "fixed_cells": 0, "blanked_cells": 0, "pct_scaled": [FIELD_LABEL[f] for f, (_, s) in pct.items() if s],
              "views_basis_unknown": "views_unknown" in mapping.values(), "date_filled": 0, "duplicates_in_file": [], "skipped_example": 0}
    records, errors, seen = [], [], {}
    for i, row in enumerate(body):
        line = i + 2
        if get(row, "notes").startswith("이 줄은 예시"):
            report["skipped_example"] += 1
            continue
        ref = get(row, "url")
        if not ref:
            continue
        issues = []
        platform = detect_platform(get(row, "platform"), ref, default_platform)
        k = account_key(platform, ref) if platform else ""
        if k and k in seen:
            report["duplicates_in_file"].append({"line": line, "same_as_line": seen[k]})
            continue
        if k:
            seen[k] = line
        nums = {}
        for f in ("followers", "median_views", "avg_views", "views_unknown"):
            rawv = get(row, f)
            n, issue = parse_count(rawv)
            nums[f] = n
            if issue:
                issues.append(f"{FIELD_LABEL[f]} {issue}")
                report["blanked_cells"] += 1
            elif n is not None and str(n) != rawv.strip():
                report["fixed_cells"] += 1
        for f in ("er", "vn_audience"):
            n, issue = pct[f][0][i]
            nums[f] = n
            if issue:
                issues.append(f"{FIELD_LABEL[f]} {issue}")
                report["blanked_cells"] += 1
        notes = get(row, "notes")
        if nums["views_unknown"] is not None and nums["avg_views"] is None and nums["median_views"] is None:
            nums["avg_views"] = nums["views_unknown"]  # 기준을 모르면 중앙값 칸에 넣지 않음
            issues.append("조회수 기준 불명 → 평균 칸에 저장")
        collected, issue = parse_date(get(row, "collected_on"))
        if issue:
            issues.append(f"수집일 {issue}")
        if not collected:
            collected = today
            report["date_filled"] += 1
        if is_demo:
            st, prov = "demo", provider or "시연용 파일"
        elif source_type:
            st, prov = source_type, provider
        else:
            src = get(row, "source")
            st = _SOURCE_WORDS.get(src.lower(), "manual")
            prov = "TikTok One (화면 확인)" if "tiktok one" in src.lower() else (src or provider)
        rec = {"platform": platform, "url": ref, "name": get(row, "name"), "followers": nums["followers"],
               "median_views": nums["median_views"], "avg_views": nums["avg_views"], "er": nums["er"], "vn_audience": nums["vn_audience"],
               "language": get(row, "language"), "country": get(row, "country"), "source_type": st, "provider": prov or "외부 파일",
               "collected_on": collected, "category": get(row, "category"), "segment": segment_name(get(row, "segment")),
               "notes": "; ".join(x for x in [notes] + [x for x in issues if "기준 불명" in x] if x), "_line": line, "_issues": issues}
        records.append(rec)
    return records, errors, report


# ---------------------------------------------------------------- 인기 순위 (공식 API만 사용, 크롤링 없음)
RANKING_KINDS = {
    "yt_popular_videos": {"label": "YouTube 베트남 인기 영상 (조회수)", "platform": "yt", "provider": "youtube",
                          "basis": "YouTube 공식 인기 차트(videos.list chart=mostPopular, 지역 VN)의 영상 순서. 각 영상의 조회수 표시",
                          "cost": "50개당 1유닛 + 채널 정보 50개당 1유닛"},
    "yt_popular_channels": {"label": "YouTube 인기 영상의 채널 (구독자 순)", "platform": "yt", "provider": "youtube",
                            "basis": "YouTube 베트남 인기 차트에 오른 영상의 채널을 구독자 수로 다시 정렬 (베트남 전체 채널 순위가 아님)",
                            "cost": "약 2~6유닛"},
    "yt_keyword_channels": {"label": "YouTube 키워드 채널 (구독자 순)", "platform": "yt", "provider": "youtube",
                            "basis": "키워드로 검색한 베트남 지역 채널을 구독자 수로 정렬 (수집한 채널 중 순위, 베트남 전체 순위가 아님)",
                            "cost": "50개당 약 101유닛 (검색 100유닛)"},
    "modash_followers": {"label": "Modash 베트남 크리에이터 (팔로워 순)", "provider": "modash",
                         "basis": "Modash 검색(크리에이터 위치 베트남, 팔로워 내림차순) 결과", "cost": "결과 수만큼 크레딧 차감"},
    "hype_followers": {"label": "HypeAuditor 베트남 크리에이터 (팔로워 순)", "provider": "hypeauditor",
                       "basis": "HypeAuditor 검색(계정 국가 베트남) 결과를 팔로워 수로 정렬", "cost": "페이지마다 조회 1회 차감"},
}
RANKING_SIZES = (30, 50, 100)
# 식품 관련만 보기: YouTube에는 '음식' 카테고리가 없어서 ① 무관한 카테고리를 빼고 ② 제목·태그·설명에 음식 단어가 있는 영상만 남깁니다.
EXCLUDED_CATEGORIES = {"10": "음악", "17": "스포츠", "20": "게임", "25": "뉴스·정치"}
FOOD_WORDS = [
    "ăn", "ăn thử", "ăn vặt", "đồ ăn", "món", "món ngon", "món ăn", "bánh", "ẩm thực", "nấu", "nấu ăn", "quán ăn", "review quán",
    "đặc sản", "tráng miệng", "chè", "trà sữa", "lẩu", "phở", "bún", "cơm", "mochi", "mukbang", "food", "foods", "eating",
    "cooking", "recipe", "dessert", "snack", "snacks", "먹방", "음식", "요리", "디저트",
]
_FOOD_RE = re.compile(r"(?<!\w)(" + "|".join(re.escape(w) for w in sorted(FOOD_WORDS, key=len, reverse=True)) + r")(?!\w)", re.I)


def is_food_video(v):
    """무관한 카테고리가 아니고, 제목·태그·설명에 음식 단어가 있으면 True. (단어 단위로 찾아 'văn' 같은 단어 속 'ăn'은 제외)"""
    if v.get("category_id") in EXCLUDED_CATEGORIES:
        return False
    text = " ".join([v.get("title") or "", " ".join(v.get("tags") or []), v.get("description") or ""])
    return bool(_FOOD_RE.search(unicodedata.normalize("NFC", text)))
_KST, _ICT = timezone(timedelta(hours=9)), timezone(timedelta(hours=7))


def ranking_kinds():
    """화면에 보여 줄 순위 종류. Modash·HypeAuditor는 키가 있을 때만 포함합니다."""
    st = ext.status()
    out = []
    for k, m in RANKING_KINDS.items():
        conf = st[m["provider"]]["configured"]
        if m["provider"] in ("modash", "hypeauditor") and not conf:
            continue
        out.append({"key": k, "label": m["label"], "basis": m["basis"], "cost": m["cost"], "configured": conf,
                    "platforms": [m["platform"]] if m.get("platform") else ["tt", "ig", "yt"],
                    "needs_keyword": k == "yt_keyword_channels"})
    return out


def collected_at(now=None):
    """기준 시각: UTC 원본 + 한국(KST)·베트남(ICT) 표기."""
    now = (now or datetime.now(timezone.utc)).replace(microsecond=0)
    k, v = now.astimezone(_KST), now.astimezone(_ICT)
    return {"utc": now.isoformat().replace("+00:00", "Z"),
            "kst": k.strftime("%Y-%m-%d %H:%M") + " 한국 시간(KST, UTC+9)",
            "ict": v.strftime("%Y-%m-%d %H:%M") + " 베트남 시간(ICT, UTC+7)"}


def _channel_row(ch, provider, today):
    return {"platform": "yt", "handle": (ch.get("handle") or ch["channel_id"]).lstrip("@"), "name": ch.get("title", ""),
            "url": ch.get("url") or profile_url("yt", ch["channel_id"]), "followers": ch.get("subscribers"),
            "median_views": None, "avg_views": None, "er": None, "vn_audience": None, "country": ch.get("country", ""),
            "language": "", "provider": provider, "source_type": "official_api", "collected_on": today,
            "confidence": confidence_of("official_api"), "source_label": SOURCE_TYPES["official_api"]["label"],
            "total_views": ch.get("total_views"), "video_count": ch.get("video_count"), "unverified": []}


def build_ranking(kind, size=50, platform="tt", keyword="", now=None, food_only=True, region="VN"):
    """공식 API로 순위를 만들고 기준 시각·집계 기준을 붙입니다. (행 목록, 메타)"""
    if kind not in RANKING_KINDS:
        raise ext.ApiError("알 수 없는 순위 종류예요")
    size = int(size) if int(size or 0) in RANKING_SIZES else 50
    meta_kind = RANKING_KINDS[kind]
    at = collected_at(now)
    today = at["kst"][:10]
    rows = []
    food = None
    if kind in ("yt_popular_videos", "yt_popular_channels"):
        videos = ext.youtube_popular_videos("VN", 200 if (food_only or kind == "yt_popular_channels") else size)
        if food_only:
            chart_total = len(videos)
            videos = [v for v in videos if is_food_video(v)]
            food = {"applied": True, "chart_total": chart_total, "matched": len(videos),
                    "excluded_categories": list(EXCLUDED_CATEGORIES.values()),
                    "rule": "게임·음악·스포츠·뉴스 카테고리 제외 + 제목·태그·설명에 음식 관련 단어 포함"}
        chans = ext.youtube_channels_stats([v["channel_id"] for v in (videos[:size] if kind == "yt_popular_videos" else videos)])
        if kind == "yt_popular_videos":
            for v in videos[:size]:
                ch = chans.get(v["channel_id"]) or {"channel_id": v["channel_id"], "title": v["channel_title"], "subscribers": None}
                r = _channel_row(ch, "YouTube 인기 차트(VN)", today)
                r.update({"video_title": v["title"], "video_url": v["url"], "video_views": v["views"], "video_likes": v["likes"],
                          "video_published": v["published_at"]})
                rows.append(r)
        else:
            seen = []
            for v in videos:
                if v["channel_id"] in chans and v["channel_id"] not in seen:
                    seen.append(v["channel_id"])
            rows = [_channel_row(chans[c], "YouTube 인기 차트(VN) 채널", today) for c in seen]
            rows.sort(key=lambda r: -(r["followers"] or -1))
            rows = rows[:size]
    elif kind == "yt_keyword_channels":
        kw = (keyword or "").strip()
        if not kw:
            raise ext.ApiError("키워드를 입력하세요. 예: mukbang")
        region = "KR" if str(region).upper() == "KR" else "VN"
        rows = [_channel_row(ch, f"YouTube 검색 \"{kw[:30]}\" ({region})", today)
                for ch in ext.youtube_search_channels(kw, 50 if size <= 50 else 100, region=region, lang="ko" if region == "KR" else "vi")]  # 검색은 페이지(50개) 단위로 같은 비용이라 한 페이지를 다 모은 뒤 순위를 매김
        rows.sort(key=lambda r: -(r["followers"] or -1))
        rows = rows[:size]
    else:
        if platform not in ("tt", "ig", "yt"):
            raise ext.ApiError("플랫폼을 고르세요")
        fn = ext.modash_search if kind == "modash_followers" else ext.hypeauditor_search
        page, collected = (0 if kind == "modash_followers" else 1), []
        for _ in range(8):  # 크레딧 보호: 최대 8페이지
            got, _m = fn(platform, {"country": "Vietnam"}, page=page)
            known = {account_key(r["platform"], r.get("url") or r.get("handle")) for r in collected}
            new = [r for r in got if account_key(r["platform"], r.get("url") or r.get("handle")) not in known]
            if not new:  # 결과 없음 또는 같은 결과 반복 → 더 요청하지 않음(크레딧 보호)
                break
            collected += new
            if len(collected) >= size:
                break
            page += 1
        for r in collected:
            standardize(r)
        uniq = {}
        for r in collected:
            uniq.setdefault(account_key(r["platform"], r.get("url") or r.get("handle")) or id(r), r)
        rows = sorted(uniq.values(), key=lambda r: -(r.get("followers") or -1))[:size]
    for i, r in enumerate(rows, start=1):
        r["rank"] = i
    meta = {"kind": kind, "label": meta_kind["label"], "basis": meta_kind["basis"], "size": size, "count": len(rows),
            "platform": meta_kind.get("platform") or platform, "keyword": keyword if kind == "yt_keyword_channels" else "",
            "collected_at": at, "region": "한국(KR)" if (kind == "yt_keyword_channels" and str(region).upper() == "KR") else "베트남(VN)",
            "food_filter": food or {"applied": False}}
    return rows, meta
