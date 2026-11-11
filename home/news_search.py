"""HOME 현지 뉴스 검색. [주연]

공개 RSS를 조회해 제목·언론사·발행일·원문 링크와 설명 기반 영향 단서를 돌려줍니다.
사실 여부를 판정하지 않으며, 결과를 파일·DB에 저장하지 않습니다.
API 키를 쓰지 않으므로 .env를 읽지 않습니다.
검색 결과는 검증된 자료가 아니므로 화면에서 미검증임을 반드시 표시합니다.
"""
import re
import time
import unicodedata
from concurrent.futures import ThreadPoolExecutor
from datetime import date, timedelta
from functools import lru_cache
from html import unescape
from http.client import HTTPException
from email.utils import parsedate_to_datetime
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit
from urllib.request import Request, urlopen
from xml.etree import ElementTree

from .news_content import article_content, normalize_text as _normalize, resolve_google_urls, tls_context, usable_summary

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
     '("xu hướng tiêu dùng" OR "thị trường thực phẩm" OR "người tiêu dùng Việt") ("thực phẩm" OR "bánh" OR "đồ uống" OR "đồ ngọt") when:60d',
     ("consumer spending", "retail sales", "food market", "consumer trend")),
)
_GOOGLE = "https://news.google.com/rss/search"
# 베트남 최대 언론사의 영문판입니다. 키가 필요 없고 제목이 처음부터 영어로 옵니다.
_VNEXPRESS = (
    ("https://e.vnexpress.net/rss/business.rss", "VnExpress 영문 · 경제"),
    ("https://e.vnexpress.net/rss/news.rss", "VnExpress 영문 · 종합"),
)
# 직접 입력 검색어는 일반 문자·공백과 최소한의 기호만 받습니다. 베트남어 성조 문자는 \w에 포함됩니다.
_NATIVE_FEEDS = (
    ("https://tuoitre.vn/rss/kinh-doanh.rss", "Tuổi Trẻ"),
    ("https://thanhnien.vn/rss/kinh-te.rss", "Thanh Niên"),
)
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
        with urlopen(Request(address, headers={"Accept": "application/rss+xml"}), timeout=_TIMEOUT, context=tls_context()) as response:
            if urlsplit(response.geturl()).scheme != "https":
                raise SourceUnavailable("뉴스 주소가 안전하지 않아 중단했습니다.")
            body = response.read(_MAX_BYTES + 1)
    except HTTPError as error:
        error.close()
        raise SourceUnavailable("뉴스 제공처가 요청을 거절했습니다. 잠시 후 다시 시도해주세요.") from None
    except (URLError, HTTPException, TimeoutError, OSError):
        raise SourceUnavailable("뉴스 제공처에 연결하지 못했습니다. 잠시 후 다시 시도해주세요.") from None
    if len(body) > _MAX_BYTES:
        raise SourceUnavailable("응답이 너무 커서 읽지 않았습니다. 검색어를 좁혀주세요.")
    try:
        return list(ElementTree.fromstring(body).iter("item"))
    except ElementTree.ParseError:
        raise SourceUnavailable("검색 결과 형식을 읽을 수 없습니다. 잠시 후 다시 시도해주세요.") from None


def _item(node, source_label, strip_publisher=True):
    title = unescape(node.findtext("title") or "").strip()
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
    description_html = node.findtext("description") or ""
    # 연결된 제목 목록은 본문 근거가 아닙니다. 이미지 링크 밖의 RSS 설명만 남깁니다.
    description = _plain_text(re.sub(r"<a\b[^>]*>.*?</a\s*>", " ", description_html, flags=re.I | re.S))
    # Google RSS의 설명은 연결된 제목 목록인 경우가 많습니다. 제목 자체를 근거로 재사용하지 않습니다.
    description = description.replace(title, "").strip()
    return {"title": title, "publisher": publisher or source_label, "source_label": source_label,
            "published_at": _published(node.findtext("pubDate")), "url": link,
            "verification_status": "unverified", "is_demo": False,
            "description": description,
            "description_kind": "link_metadata" if strip_publisher else "publisher_summary",
            "publisher_url": node.find("source").get("url", "") if node.find("source") is not None else "",
            "content_summary": _plain_text(node.findtext("{http://purl.org/rss/1.0/modules/content/}encoded") or "")}


def _google(query):
    address = _GOOGLE + "?" + urlencode({"q": query, "hl": "vi", "gl": "VN", "ceid": "VN:vi"})
    rows = []
    for node in _feed(address):
        item = _item(node, "구글 뉴스")
        if item:
            rows.append(item)
    return rows


def _vnexpress(terms):
    """영문 매체에서 주제에 맞는 기사만 읽고 출처별 실패를 구분합니다."""
    needles = tuple(term.casefold() for term in terms)
    rows, failed, succeeded = [], [], False
    for address, label in _VNEXPRESS:
        try:
            nodes = _feed(address)
            succeeded = True
        except SourceUnavailable:
            failed.append(label)
            continue
        for node in nodes:
            item = _item(node, label, strip_publisher=False)
            if not item:
                continue
            haystack = (item["title"] + " " + (node.findtext("description") or "")).casefold()
            if any(needle in haystack for needle in needles):
                rows.append(item)
    if not succeeded:
        raise SourceUnavailable("영문 RSS를 불러오지 못했습니다.")
    return rows, failed


@lru_cache(maxsize=16)
def _cached_native_feed(address, bucket):
    return _feed(address)


def _native(preset):
    """실제 요약을 제공하는 발행사 RSS. 각 출처의 실패를 별도로 반환합니다."""
    def read(feed):
        address, label = feed
        try:
            rows = []
            for node in _cached_native_feed(address, int(time.monotonic() // 300)):
                item = _item(node, label, strip_publisher=False)
                if not item:
                    continue
                text = _words(item["title"] + " " + item["description"])
                if not _has(text, _TOPICS["food"]):
                    continue
                topic = {
                    "food_rules": _TOPICS["compliance"], "trade": ("import", "export", "customs", "nhập khẩu", "xuất khẩu", "hải quan", "통관"),
                    "retail": _TOPICS["retail"], "danang": ("Đà Nẵng", "Da Nang"), "gift": _TOPICS["gifting"],
                }.get(preset)
                if topic and not _has(text, topic):
                    continue
                item["publisher_url"] = "https://" + urlsplit(address).netloc
                rows.append(item)
            return rows, []
        except SourceUnavailable:
            return [], [label]
    with ThreadPoolExecutor(max_workers=2) as pool:
        outputs = list(pool.map(read, _NATIVE_FEEDS))
    return [item for rows, _ in outputs for item in rows], [label for _, failed in outputs for label in failed]


def _summary(item):
    for key in ("analysis_text", "content_summary", "description"):
        if key == "description" and item.get("description_kind") == "link_metadata":
            continue
        text = str(item.get(key) or "")
        if usable_summary(text, item.get("title", ""), item.get("publisher", "")):
            return text[:7000]
    return ""


def prepare_articles(items):
    """수집과 분류를 분리합니다. 원본 상태를 유지한 복사본에 분석 자료만 추가합니다."""
    unresolved = [item.get("url", "") for item in items if not _summary(item) and urlsplit(item.get("url", "")).hostname == "news.google.com"]
    resolved = resolve_google_urls(unresolved)
    def prepare(item):
        row = dict(item)
        text = _summary(row)
        source = row.get("analysis_source", "publisher_rss")
        analysis_url = row.get("analysis_url") or row.get("url", "")
        state = "ready"
        if not text:
            original_url = row.get("url", "")
            content = article_content(resolved.get(original_url, original_url))
            if original_url in unresolved and original_url not in resolved:
                content = {"state": "unavailable", "text": "", "source": "none", "url": ""}
            text = _plain_text(content["text"], limit=7000)
            source, state, analysis_url = content["source"], content["state"], content["url"]
            if not usable_summary(text, row.get("title", ""), row.get("publisher", "")):
                text = ""
                state = "unavailable" if state == "unavailable" else "insufficient"
        row["analysis_text"] = text
        row["analysis"] = {"state": state, "source": source if text else "none", "url": analysis_url if text else "", "characters": len(text)}
        return row
    with ThreadPoolExecutor(max_workers=4) as pool:
        return list(pool.map(prepare, items))


def _merge(groups, start=None, end=None):
    """기간 안의 고유 기사 최대 12건. 별도 언론사의 동명 보도는 보존합니다."""
    seen_urls, seen_titles, rows = {}, {}, []
    for group in groups:
        for item in group:
            published = item.get("published_at", "")
            if (start or end) and (not published or (start and published < start) or (end and published > end)):
                continue
            url = urlsplit(item["url"])
            query = [(k, v) for k, v in parse_qsl(url.query) if not k.lower().startswith("utm_") and k.lower() not in {"fbclid", "gclid"}]
            url_key = urlunsplit((url.scheme.lower(), url.netloc.lower().removeprefix("www."), url.path.rstrip("/"), urlencode(sorted(query)), ""))
            publisher = urlsplit(item.get("publisher_url") or "").netloc.lower().removeprefix("www.") or _normalize(item["publisher"])
            title_key = (_words(item["title"]), publisher, published)
            duplicate = seen_urls.get(url_key) or seen_titles.get(title_key)
            if duplicate is not None:
                text = _summary(item)
                if text and not _summary(duplicate):
                    duplicate.update(analysis_text=text, analysis_source="publisher_rss", analysis_url=item["url"])
                continue
            row = dict(item)
            seen_urls[url_key] = row
            seen_titles[title_key] = row
            rows.append(row)
    rows.sort(key=lambda item: (item["published_at"], bool(_summary(item))), reverse=True)
    return rows[:_MAX_ITEMS]


def search(query=None, preset=None, start=None, end=None):
    """검색 결과와 불러오지 못한 출처 목록을 함께 돌려줍니다.

    한 출처가 실패해도 조용히 빼지 않고 어디가 빠졌는지 알립니다.
    """
    start, end = _period(start, end)
    failed = []
    def dated_query(text):
        if start or end:
            text = re.sub(r"\bwhen:\d+[dhmy]\b", "", text)
            if start:
                text += " after:" + (date.fromisoformat(start) - timedelta(days=1)).isoformat()
            if end:
                text += " before:" + (date.fromisoformat(end) + timedelta(days=1)).isoformat()
        return text
    if preset:
        _, label, vi_query, terms = _preset(preset)
        groups = []
        with ThreadPoolExecutor(max_workers=3) as pool:
            google = pool.submit(_google, dated_query(vi_query))
            english = pool.submit(_vnexpress, terms)
            native = pool.submit(_native, preset)
            for job, source in ((google, "구글 뉴스"), (english, "VnExpress 영문")):
                try:
                    received = job.result()
                    if source == "VnExpress 영문" and isinstance(received, tuple):
                        rows, partial = received
                        failed.extend(partial)
                        groups.append(rows)
                    else:
                        groups.append(received)
                except SourceUnavailable:
                    failed.append(source)
            rows, missing = native.result()
            failed.extend(missing)
            if rows or not missing:
                groups.append(rows)
        if not groups:
            raise SourceUnavailable("뉴스 제공처 모두에 연결하지 못했습니다. 잠시 후 다시 시도해주세요.")
        return _merge(groups, start, end), failed
    text = " ".join(str(query or "").split())
    if not 2 <= len(text) <= 60 or not _QUERY.fullmatch(text):
        raise SearchError("검색어는 2~60자의 일반 문자로 입력해주세요.")
    groups = []
    try:
        groups.append(_google(dated_query(text)))
    except SourceUnavailable:
        failed.append("구글 뉴스")
    native, missing = _native("trend")
    words = [_normalize(word) for word in text.split()]
    matching = [item for item in native if all(word in _normalize(item["title"] + " " + item["description"]) for word in words)]
    if matching:
        groups.append(matching)
    if not groups:
        raise SourceUnavailable("뉴스 제공처에 연결하지 못했습니다. 잠시 후 다시 시도해주세요.")
    return _merge(groups, start, end), failed


def _period(start, end):
    values = []
    for value in (start, end):
        if value in (None, ""):
            values.append(None)
            continue
        try:
            parsed = date.fromisoformat(value)
            if parsed.isoformat() != value or not date(1900, 1, 2) <= parsed <= date(9999, 12, 30):
                raise ValueError
        except (TypeError, ValueError):
            raise SearchError("기간은 YYYY-MM-DD 형식의 날짜로 입력해주세요.") from None
        values.append(value)
    if all(values) and values[0] > values[1]:
        raise SearchError("시작일은 종료일보다 늦을 수 없습니다.")
    return values


def _plain_text(value, limit=4000):
    # RSS HTML을 실행하거나 원문을 추가 요청하지 않습니다.
    return re.sub(r"\s+", " ", unescape(re.sub(r"<[^>]*>", " ", value))).strip()[:limit]


def _words(value):
    # 의미 검사에서는 베트남어 성조를 유지합니다. giá tăng(가격 상승)과 gia tăng(증가)은 다릅니다.
    return re.sub(r"[^\w]+", " ", unicodedata.normalize("NFC", str(value).casefold())).strip()


def _has(text, phrases):
    text = _words(text)
    for phrase in phrases:
        needle = re.escape(_words(phrase))
        ending = r"(?:의|은|는|이|가|에|에서|으로|와|과|을|를|도|로)?" if re.search(r"[가-힣]", phrase) else ""
        if re.search(r"(?<!\w)" + needle + ending + r"(?!\w)", text):
            return True
    return False


_TOPICS = {
    "food": ("food", "dessert", "mochi", "confectionery", "thực phẩm", "bánh", "đồ uống", "bánh kẹo", "kẹo ngọt", "nông sản", "trái cây", "sữa", "kẹo", "sữa tươi", "sữa bột", "thị trường sữa", "rice", "fruit", "beverage", "bakery", "식품", "디저트", "과일", "음료"),
    "retail": ("retail", "distribution", "supermarket", "delivery", "siêu thị", "bán lẻ", "phân phối", "유통", "배달"),
    "gifting": ("tet", "gift", "quà tặng", "quà Tết", "tết", "선물", "명절"),
    "compliance": ("regulation", "label", "customs", "tariff", "recall", "import ban", "quy định", "ghi nhãn", "hải quan", "thu hồi sản phẩm", "thu hồi thực phẩm", "thu hồi lô hàng", "cấm nhập khẩu", "규제", "표시", "통관", "회수", "수입 금지"),
    "demand": ("demand", "consumer", "tourism", "nhu cầu", "tiêu dùng", "du lịch", "수요", "소비", "관광"),
}
_REASONS = {
    "insufficient": "분류에 필요한 실제 기사 요약이나 본문을 확보하지 못했습니다.",
    "fetch_failed": "기사 내용을 불러오지 못해 판단을 보류합니다. 원문을 직접 확인해주세요.",
    "no_signal": "관련 주제이지만 한정선 진출에 대한 영향 방향을 판단할 단서가 부족합니다.",
    "scope": "베트남 식품 및 디저트 시장과 적용 대상의 관련성을 확인해야 합니다.",
    "unclear": "가정, 부정 또는 적용 대상이 불명확한 표현이 있어 원문 확인이 필요합니다.",
    "mixed": "긍정과 부담 단서가 함께 있어 한 방향으로 판단하기 어렵습니다.",
    "opportunity": "수요 또는 유통 확대 단서가 있어 Hanjungsun의 판매 기회 검토에 참고할 수 있습니다. 사업 효과는 미확정입니다.",
    "caution": "규제, 표시 또는 비용 단서가 있어 진출 준비 조건을 검토해야 합니다. 실제 적용은 미확정입니다.",
    "risk": "수입 금지, 회수 또는 공급 중단 단서가 있어 식품 진출 영향 확인이 필요합니다. Hanjungsun에 대한 적용은 미확정입니다.",
    "failed": "분류 처리에 실패했습니다. 원문을 직접 확인해주세요.",
}


_OPPORTUNITY_SIGNALS = (
    "demand grows", "demand rises", "rising demand", "retail expansion", "distribution expands",
    "nhu cầu tăng", "mở rộng phân phối", "mở rộng thị trường", "mở rộng sản xuất", "mở rộng danh mục", "gia tăng giá trị", "phát triển sản phẩm", "mở ra cơ hội", "cơ hội mới", "tăng sức mua", "sức mua tăng", "tiêu thụ tăng", "tăng trưởng", "demand increases", "sales grow", "retail sales rise", "growing demand", "수요 증가", "유통 확대",
)
_RISK_SIGNALS = (
    "import ban", "food recall", "product recall", "recall notice", "recalled food", "supply disruption", "cấm nhập khẩu", "thu hồi sản phẩm", "thu hồi thực phẩm", "thu hồi lô hàng", "thu hồi bánh", "thu hồi sữa", "gián đoạn cung ứng",
    "수입 금지", "회수", "공급 중단", "đình chỉ sản xuất", "đình chỉ kinh doanh", "đình chỉ lưu hành", "ngộ độc thực phẩm", "hàng giả",
)
_CAUTION_SIGNALS = _TOPICS["compliance"] + ("cost increase", "higher costs", "chi phí tăng", "giá tăng", "tăng giá bán", "tăng giá nguyên liệu", "tăng giá thực phẩm", "비용 증가")
_UNCERTAIN_SIGNALS = (
    "may", "might", "could", "proposal", "proposed", "unclear", "not", "no", "denied", "draft",
    "dự thảo", "có thể", "chưa", "không", "đề xuất", "검토", "미정", "가능성", "lifted", "revoked",
    "abolished", "removed", "exemption", "cancelled", "dỡ bỏ", "bãi bỏ", "hủy bỏ", "miễn", "해제", "철회", "폐지",
)


_GEOGRAPHY = ("Vietnam", "Việt Nam", "Vietnamese", "Việt", "người Việt", "người tiêu dùng Việt", "hàng Việt", "thị trường Việt", "Đà Nẵng", "Da Nang", "Hà Nội", "Hanoi", "HCMC", "TP HCM", "Ho Chi Minh", "베트남", "다낭", "하노이", "호찌민")
_FOREIGN = ("France", "Singapore", "Thailand", "China", "United States", "Japan", "Malaysia", "Pháp", "Trung Quốc", "Thái Lan", "Mỹ", "Hoa Kỳ", "Nhật Bản")
_RULE_VERSION = "rules-v2-content"


@lru_cache(maxsize=1000)
def _classify_cached(version, title, description, publisher, published, url):
    """제목의 문맥과 실제 요약/본문을 함께 평가합니다. 규제 적용 판정은 하지 않습니다."""
    text = _words(title + " " + description)
    topics = tuple(key for key, terms in _TOPICS.items() if _has(text, terms))
    if not publisher or not published or not usable_summary(description, title, publisher):
        return "hold", "insufficient", topics
    if not _has(text, _GEOGRAPHY) or "food" not in topics:
        return "hold", "scope", topics
    if not _has(_words(description), _TOPICS["food"]) and _has(_words(description), (
            "hotel", "hotels", "tourism", "tours", "cosmetics", "semiconductor", "gold", "steel", "real estate",
            "khách sạn", "mỹ phẩm", "bất động sản", "thép", "관광", "호텔", "화장품", "부동산")):
        return "hold", "scope", topics
    signals = {"opportunity": _OPPORTUNITY_SIGNALS, "risk": _RISK_SIGNALS, "caution": _CAUTION_SIGNALS}
    matches = set()
    uncertain = _has(_words(description), ("not confirmed", "unconfirmed", "chưa xác nhận", "미확인", "확인되지"))
    foreign_signal = False
    for part in re.split(r"(?<=[.!?])\s+|[;\n]", description):
        evidence = _words(part)
        if not evidence:
            continue
        # 다른 나라를 명시한 문장에 베트남 제목의 문맥을 전파하지 않습니다.
        if _has(evidence, _FOREIGN) and not _has(evidence, _GEOGRAPHY):
            foreign_signal |= any(_has(evidence, phrases) for phrases in signals.values())
            continue
        if not _has(evidence, _TOPICS["food"]) and not _has(_words(title), _TOPICS["food"]):
            continue
        found = {key for key, phrases in signals.items() if _has(evidence, phrases)}
        if found:
            matches.update(found)
            uncertain |= _has(evidence, _UNCERTAIN_SIGNALS) or bool(re.search(r"않|아니|불확실", evidence))
    if "opportunity" in matches and matches & {"risk", "caution"}:
        return "hold", "mixed", topics
    if uncertain:
        return "hold", "unclear", topics
    for key in ("risk", "caution", "opportunity"):
        if key in matches:
            return key, key, topics
    return "hold", "scope" if foreign_signal else "no_signal", topics


def classify_article(item):
    """영향 메타데이터만 반환합니다. 원본·출처·확인·등록 상태를 변경하지 않습니다."""
    try:
        text = _summary(item)
        category, reason, topics = _classify_cached(_RULE_VERSION, str(item.get("title") or ""), text,
            str(item.get("publisher") or ""), str(item.get("published_at") or ""), str(item.get("url") or ""))
        if reason == "insufficient" and item.get("analysis", {}).get("state") == "unavailable":
            reason = "fetch_failed"
    except Exception:
        category, reason, topics = "hold", "failed", ()
    return {"category": category, "reason_code": reason, "reason": _REASONS[reason],
            "topics": list(topics), "method": "rules", "version": _RULE_VERSION}
