"""HOME 현지 뉴스 검색. [주연]

구글 뉴스 공개 RSS를 1회 조회해 제목·언론사·발행일·원문 링크만 돌려줍니다.
요약하지 않고, 사실 여부를 판정하지 않으며, 결과를 파일·DB에 저장하지 않습니다.
공개 RSS만 사용하므로 API 키가 필요 없고 .env를 읽지 않습니다.
검색 결과는 검증된 자료가 아니므로 화면에서 미검증임을 반드시 표시합니다.
"""
import re
from email.utils import parsedate_to_datetime
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode, urlsplit
from urllib.request import Request, urlopen
from xml.etree import ElementTree

# 한국어 라벨과 현지어 검색어를 미리 짝지어 둡니다. 팀원이 베트남어를 몰라도 고를 수 있게 하려는 것입니다.
# market_analysis/countries.py에도 현지어 검색어가 있지만 공개 함수가 아니어서 가져다 쓰지 않습니다. (README 8장)
PRESETS = (
    ("food_rules", "식품 규제·표시", "quy định ghi nhãn an toàn thực phẩm"),
    ("trade", "수출입·통관", "xuất nhập khẩu thực phẩm thủ tục hải quan"),
    ("retail", "현지 유통·판매 채널", "bán lẻ siêu thị kênh phân phối thực phẩm"),
    ("danang", "다낭 지역 동향", "Đà Nẵng doanh nghiệp thương mại"),
    ("gift", "선물세트·명절 소비", "quà tặng Tết sức mua tiêu dùng"),
    ("trend", "식품 소비 트렌드", "xu hướng tiêu dùng thực phẩm"),
)
_RSS = "https://news.google.com/rss/search"
# 검색어는 일반 문자·공백과 최소한의 기호만 받습니다. 베트남어 성조 문자는 \w에 포함됩니다.
_QUERY = re.compile(r"[^\W_]+(?:[\w \-·,.()&']*[^\W_])?", re.UNICODE)
_MAX_BYTES = 600_000
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
    return [{"key": key, "label": label} for key, label, _ in PRESETS]


def resolve(preset):
    for key, _, query in PRESETS:
        if key == preset:
            return query
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


def search(query):
    """검색어로 공개 RSS를 1회 조회해 미검증 목록을 반환합니다."""
    text = " ".join(str(query or "").split())
    if not 2 <= len(text) <= 60 or not _QUERY.fullmatch(text):
        raise SearchError("검색어는 2~60자의 일반 문자로 입력해주세요.")
    address = f"{_RSS}?{urlencode({'q': text, 'hl': 'vi', 'gl': 'VN', 'ceid': 'VN:vi'})}"
    request = Request(address, headers={"Accept": "application/rss+xml"})
    try:
        with urlopen(request, timeout=_TIMEOUT) as response:
            if urlsplit(response.geturl()).scheme != "https":
                raise SourceUnavailable("뉴스 검색 주소가 안전하지 않아 중단했습니다.")
            body = response.read(_MAX_BYTES + 1)
    except HTTPError as error:
        error.close()
        raise SourceUnavailable("뉴스 검색이 지금 요청을 거절했습니다. 잠시 후 다시 시도해주세요.") from None
    except (URLError, TimeoutError, OSError):
        raise SourceUnavailable("뉴스 검색에 연결하지 못했습니다. 잠시 후 다시 시도해주세요.") from None
    if len(body) > _MAX_BYTES:
        raise SourceUnavailable("검색 결과가 너무 커서 읽지 않았습니다. 검색어를 좁혀주세요.")
    try:
        root = ElementTree.fromstring(body)
    except ElementTree.ParseError:
        raise SourceUnavailable("검색 결과 형식을 읽을 수 없습니다. 잠시 후 다시 시도해주세요.") from None
    items = []
    for node in root.iter("item"):
        title = (node.findtext("title") or "").strip()
        link = (node.findtext("link") or "").strip()
        if not title or not _safe_url(link):
            continue
        publisher = (node.findtext("source") or "").strip()
        # 구글 뉴스 제목은 "제목 - 언론사" 형태입니다. 언론사를 따로 보여 주므로 제목 뒤 중복만 떼어냅니다.
        if publisher and title.endswith(f" - {publisher}"):
            title = title[: -len(publisher) - 3].strip()
        elif not publisher and " - " in title:
            title, publisher = (part.strip() for part in title.rsplit(" - ", 1))
        items.append({
            "title": title,
            "publisher": publisher or "언론사 미표기",
            "published_at": _published(node.findtext("pubDate")),
            "url": link,
            "verification_status": "unverified",
            "is_demo": False,
        })
        if len(items) >= _MAX_ITEMS:
            break
    return items
