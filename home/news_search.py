"""HOME 현지 뉴스 검색. [주연]

공개 RSS만 1회씩 조회해 제목·언론사·발행일·원문 링크만 돌려줍니다.
요약하지 않고, 사실 여부를 판정하지 않으며, 결과를 파일·DB에 저장하지 않습니다.
API 키를 쓰지 않으므로 .env를 읽지 않습니다.
검색 결과는 검증된 자료가 아니므로 화면에서 미검증임을 반드시 표시합니다.
"""
import re
from email.utils import parsedate_to_datetime
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode, urlsplit
from urllib.request import Request, urlopen
from xml.etree import ElementTree

# 한국어 라벨, 현지어 검색어, 영문 매체에서 찾을 낱말을 함께 둡니다.
# 현지어 검색어에는 따옴표·제외어·기간 제한을 넣어 관련 없는 기사를 줄입니다.
# market_analysis/countries.py에도 현지어 검색어가 있지만 공개 함수가 아니어서 가져다 쓰지 않습니다. (README 8장)
PRESETS = (
    ("food_rules", "식품 규제·표시",
     '("an toàn thực phẩm" OR "ghi nhãn thực phẩm" OR "quy định thực phẩm") when:90d',
     ("food safety", "food label", "nutrition label", "food regulation")),
    ("trade", "수출입·통관",
     '("xuất khẩu thực phẩm" OR "nhập khẩu thực phẩm" OR "thủ tục hải quan") when:60d',
     ("export", "import", "customs", "tariff")),
    ("retail", "현지 유통·판매 채널",
     '("bán lẻ thực phẩm" OR "siêu thị" OR "kênh phân phối") -"công đoàn" -"bóng đá" when:60d',
     ("retail", "supermarket", "convenience store", "distribution")),
    ("danang", "다낭 지역 동향",
     '"Đà Nẵng" ("xuất khẩu" OR "thực phẩm" OR "bán lẻ" OR "hội chợ" OR "xúc tiến thương mại") -"công đoàn" -"bóng đá" -"giao thông" -"mưa lũ" when:30d',
     ("da nang", "danang")),
    ("gift", "선물세트·명절 소비",
     '("quà tặng Tết" OR "giỏ quà Tết" OR "sức mua Tết") when:120d',
     ("tet gift", "gift set", "gift basket", "year-end shopping")),
    ("trend", "식품 소비 트렌드",
     '("xu hướng tiêu dùng" OR "thị trường thực phẩm" OR "người tiêu dùng Việt") when:60d',
     ("consumer spending", "retail sales", "food market", "consumer trend")),
)
_GOOGLE = "https://news.google.com/rss/search"
# 베트남 최대 언론사의 영문판입니다. 키가 필요 없고 제목이 처음부터 영어로 옵니다.
_VNEXPRESS = (
    ("https://e.vnexpress.net/rss/business.rss", "VnExpress 영문 · 경제"),
    ("https://e.vnexpress.net/rss/news.rss", "VnExpress 영문 · 종합"),
)
# 직접 입력 검색어는 일반 문자·공백과 최소한의 기호만 받습니다. 베트남어 성조 문자는 \w에 포함됩니다.
_QUERY = re.compile(r"[^\W_]+(?:[\w \-·,.()&']*[^\W_])?", re.UNICODE)
_MAX_BYTES = 800_000
_MAX_ITEMS = 12
_TIMEOUT = 8


class SearchError(Exception):
    """화면에 그대로 보여도 되는 검색 오류. 응답 원문·주소를 담지 않습니다."""

    status = 400


class SourceUnavailable(SearchError):
    """외부 RSS를 불러오지 못한 경우입니다. 빈 결과나 만들어 낸 자료로 대체하지 않습니다."""

    status = 502


def preset_labels():
    """화면에 표시할 한국어 라벨만 전달합니다. 현지어 검색어는 서버에만 둡니다."""
    return [{"key": key, "label": label} for key, label, _, _ in PRESETS]


def _preset(key):
    for row in PRESETS:
        if row[0] == key:
            return row
    raise SearchError("준비된 검색 항목이 아닙니다.")


def _safe_url(value):
    url = urlsplit(value)
    return bool(url.scheme == "https" and url.hostname and not url.username and not url.password)


def _published(value):
    """RSS 발행 시각을 날짜만 남깁니다. 형식이 다르면 비워 두고 꾸며 넣지 않습니다."""
    if not isinstance(value, str) or not value.strip():
        return ""
    try:
        return parsedate_to_datetime(value).date().isoformat()
    except (TypeError, ValueError):
        return ""


def _feed(address):
    """RSS를 1회 받아 항목 목록으로 돌려줍니다. 실패는 호출한 쪽에서 알립니다."""
    try:
        with urlopen(Request(address, headers={"Accept": "application/rss+xml"}), timeout=_TIMEOUT) as response:
            if urlsplit(response.geturl()).scheme != "https":
                raise SourceUnavailable("뉴스 주소가 안전하지 않아 중단했습니다.")
            body = response.read(_MAX_BYTES + 1)
    except HTTPError as error:
        error.close()
        raise SourceUnavailable("뉴스 제공처가 요청을 거절했습니다. 잠시 후 다시 시도해주세요.") from None
    except (URLError, TimeoutError, OSError):
        raise SourceUnavailable("뉴스 제공처에 연결하지 못했습니다. 잠시 후 다시 시도해주세요.") from None
    if len(body) > _MAX_BYTES:
        raise SourceUnavailable("응답이 너무 커서 읽지 않았습니다. 검색어를 좁혀주세요.")
    try:
        return list(ElementTree.fromstring(body).iter("item"))
    except ElementTree.ParseError:
        raise SourceUnavailable("검색 결과 형식을 읽을 수 없습니다. 잠시 후 다시 시도해주세요.") from None


def _item(node, source_label, strip_publisher=True):
    title = (node.findtext("title") or "").strip()
    link = (node.findtext("link") or "").strip()
    if not title or not _safe_url(link):
        return None
    publisher = (node.findtext("source") or "").strip()
    # 구글 뉴스 제목은 "제목 - 언론사" 형태입니다. 언론사를 따로 보여 주므로 제목 뒤 중복만 떼어냅니다.
    if strip_publisher:
        if publisher and title.endswith(" - " + publisher):
            title = title[: -len(publisher) - 3].strip()
        elif not publisher and " - " in title:
            title, publisher = (part.strip() for part in title.rsplit(" - ", 1))
    return {"title": title, "publisher": publisher or source_label, "source_label": source_label,
            "published_at": _published(node.findtext("pubDate")), "url": link,
            "verification_status": "unverified", "is_demo": False}


def _google(query):
    address = _GOOGLE + "?" + urlencode({"q": query, "hl": "vi", "gl": "VN", "ceid": "VN:vi"})
    rows = []
    for node in _feed(address):
        item = _item(node, "구글 뉴스")
        if item:
            rows.append(item)
    return rows


def _vnexpress(terms):
    """영문 매체에서 해당 주제의 낱말이 들어간 기사만 고릅니다. 전체 기사를 그대로 섞지 않습니다."""
    needles = tuple(term.casefold() for term in terms)
    rows = []
    for address, label in _VNEXPRESS:
        for node in _feed(address):
            item = _item(node, label, strip_publisher=False)
            if not item:
                continue
            haystack = (item["title"] + " " + (node.findtext("description") or "")).casefold()
            if any(needle in haystack for needle in needles):
                rows.append(item)
    return rows


def _merge(groups):
    """같은 기사가 두 번 나오지 않게 제목 기준으로 추립니다."""
    seen, rows = set(), []
    for group in groups:
        for item in group:
            key = re.sub(r"[^\w]+", "", item["title"].casefold())
            if key and key in seen:
                continue
            seen.add(key)
            rows.append(item)
    rows.sort(key=lambda item: item["published_at"], reverse=True)
    return rows[:_MAX_ITEMS]


def search(query=None, preset=None):
    """검색 결과와 불러오지 못한 출처 목록을 함께 돌려줍니다.

    한 출처가 실패해도 조용히 빼지 않고 어디가 빠졌는지 알립니다.
    """
    failed = []
    if preset:
        _, label, vi_query, terms = _preset(preset)
        groups = []
        try:
            groups.append(_google(vi_query))
        except SourceUnavailable:
            failed.append("구글 뉴스")
        try:
            groups.append(_vnexpress(terms))
        except SourceUnavailable:
            failed.append("VnExpress 영문")
        if not groups:
            raise SourceUnavailable("뉴스 제공처 모두에 연결하지 못했습니다. 잠시 후 다시 시도해주세요.")
        return _merge(groups), failed
    text = " ".join(str(query or "").split())
    if not 2 <= len(text) <= 60 or not _QUERY.fullmatch(text):
        raise SearchError("검색어는 2~60자의 일반 문자로 입력해주세요.")
    return _merge([_google(text)]), failed
