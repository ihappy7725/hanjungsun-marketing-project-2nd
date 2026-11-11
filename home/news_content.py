"""HOME 기사 텍스트 추출. 공개 언론 원문만 읽고 파일·DB에는 저장하지 않습니다."""
import json
import re
import ssl
from pathlib import Path
import time
import unicodedata
from collections import OrderedDict
from concurrent.futures import ThreadPoolExecutor
from html.parser import HTMLParser
from http.client import HTTPException
from threading import Lock
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode, urlsplit
from urllib.request import HTTPRedirectHandler, HTTPSHandler, Request, build_opener

_SKIP_TAGS = {"script", "style", "noscript", "template", "svg"}
_VOID = {"area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"}
_DOMAINS = ("vnexpress.net", "tuoitre.vn", "thanhnien.vn", "tienphong.vn", "vietnamplus.vn", "vietnamnews.vn",
            "dantri.com.vn", "vneconomy.vn", "plo.vn", "congthuong.vn", "baodanang.vn", "baochinhphu.vn", "congly.vn", "baodautu.vn", "thuonghieucongluan.com.vn", "hatinh.gov.vn", "vietnambiz.vn", "baotintuc.vn", "vtv.vn", "thegioitiepthi.dantri.com.vn", "thegioitiepthi.vn")
_BODY_CACHE = OrderedDict()
_RESOLVE_CACHE = OrderedDict()
_CACHE_LOCK = Lock()
_MAX_BYTES = 1_500_000
_TIMEOUT = 5


def normalize_text(value):
    text = unicodedata.normalize("NFKD", str(value).casefold()).replace("đ", "d")
    text = unicodedata.normalize("NFC", "".join(c for c in text if not unicodedata.combining(c)))
    return re.sub(r"[^\w]+", " ", text).strip()


def usable_summary(value, title="", publisher=""):
    """기사 문장과 제목·언론사 메타데이터를 구분합니다. 80자 조건은 사용하지 않습니다."""
    text = normalize_text(value)
    if not text or text in {normalize_text(title), normalize_text(publisher)}:
        return False
    return len(text.split()) >= 4 or len(re.findall(r"[가-힣]", text)) >= 12


class ArticleText(HTMLParser):
    """기존 뉴스 관리 CLI가 사용하는 일반 텍스트 추출 인터페이스입니다."""
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.parts = []
        self._skip = 0

    def handle_starttag(self, tag, attrs):
        if tag in _SKIP_TAGS:
            self._skip += 1

    def handle_endtag(self, tag):
        if tag in _SKIP_TAGS and self._skip:
            self._skip -= 1

    def handle_data(self, data):
        if not self._skip and data.strip():
            self.parts.append(data.strip())


class ArticleDocument(ArticleText):
    """기사 본문 영역, 구조화된 기사 본문, 발행사 요약을 우선 추출합니다."""
    def __init__(self):
        super().__init__()
        self.frames = []
        self.body_parts = {1: [], 2: [], 3: []}
        self.summary = ""
        self.json_parts = []
        self._json_buffer = None
        self.structured_body = ""

    def handle_starttag(self, tag, attrs):
        super().handle_starttag(tag, attrs)
        attrs = dict(attrs)
        if tag == "meta" and (attrs.get("property") or attrs.get("name", "")).lower() in {"og:description", "description"}:
            self.summary = self.summary or attrs.get("content", "")
        if tag == "script" and attrs.get("type", "").lower() == "application/ld+json":
            self._json_buffer = []
        parent = self.frames[-1] if self.frames else ("", False, 0)
        marker = " ".join([attrs.get("class", ""), attrs.get("id", ""), attrs.get("role", "")]).lower()
        excluded = parent[1] or tag in _SKIP_TAGS | {"nav", "footer", "aside", "form"} or bool(re.search(r"\b(?:menu|advert|advertisement|sidebar|related|recommend|comments?|newsletter|cookie|breadcrumb|share|social)\b", marker))
        zone = parent[2]
        if tag == "main":
            zone = max(zone, 1)
        if tag == "article" or attrs.get("itemprop") == "articleBody":
            zone = max(zone, 2)
        if re.search(r"fck_detail|detail-content|detail__cmain|article[-_]?(?:body|content)|content[-_]?(?:detail|article|body)|post[-_]body", marker):
            zone = 3
        if tag not in _VOID:
            self.frames.append((tag, excluded, zone))

    def handle_startendtag(self, tag, attrs):
        self.handle_starttag(tag, attrs)
        if tag not in _VOID:
            self.handle_endtag(tag)

    def handle_endtag(self, tag):
        if tag == "script" and self._json_buffer is not None:
            self.json_parts.append("".join(self._json_buffer)[:150_000])
            self._json_buffer = None
        super().handle_endtag(tag)
        for index in range(len(self.frames) - 1, -1, -1):
            if self.frames[index][0] == tag:
                if tag in {"p", "div", "section", "article", "main", "li", "h1", "h2"}:
                    for parts in self.body_parts.values():
                        parts.append("\n")
                del self.frames[index:]
                break

    def handle_data(self, data):
        super().handle_data(data)
        if self._json_buffer is not None:
            self._json_buffer.append(data)
        if self.frames and not self.frames[-1][1] and self.frames[-1][2] and data.strip():
            self.body_parts[self.frames[-1][2]].append(data.strip() + " ")

    def content(self):
        def body_in(value):
            if isinstance(value, list):
                return next((text for item in value if (text := body_in(item))), "")
            if isinstance(value, dict):
                types = value.get("@type", [])
                types = [types] if isinstance(types, str) else types
                if isinstance(types, list) and set(types) & {"Article", "NewsArticle", "ReportageNewsArticle", "BlogPosting"} and isinstance(value.get("articleBody"), str):
                    return value["articleBody"]
                return body_in(value.get("@graph", []))
            return ""
        for raw in self.json_parts:
            try:
                body = body_in(json.loads(raw))
                if usable_summary(body):
                    return body[:7000], "article_body"
            except (ValueError, TypeError):
                continue
        for zone in (3, 2, 1):
            body = re.sub(r"[ \t]+", " ", "".join(self.body_parts[zone])).strip()
            if usable_summary(body):
                return body[:7000], "article_body"
        return self.summary[:4000], "publisher_summary"


def allowed_article_url(value):
    try:
        url = urlsplit(value)
        return (url.scheme == "https" and url.port in (None, 443) and not url.username and not url.password
                and any(url.hostname == domain or (url.hostname or "").endswith("." + domain) for domain in _DOMAINS))
    except (TypeError, ValueError):
        return False


class _SafeRedirect(HTTPRedirectHandler):
    max_redirections = 3
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        if not allowed_article_url(newurl):
            raise ValueError("지원하지 않는 기사 이동 주소")
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def tls_context():
    context = ssl.create_default_context()
    # 일부 macOS Python 배포에는 기본 CA 파일이 없습니다. 검증은 유지하고 OS CA를 사용합니다.
    if not context.cert_store_stats()["x509_ca"]:
        for path in ("/etc/ssl/cert.pem", "/etc/ssl/certs/ca-certificates.crt"):
            if Path(path).is_file():
                context.load_verify_locations(cafile=path)
                break
    return context


def _download_article(url):
    opener = build_opener(_SafeRedirect(), HTTPSHandler(context=tls_context()))
    request = Request(url, headers={"Accept": "text/html", "User-Agent": "Mozilla/5.0 (compatible; HanjungsunNews/1.0)"})
    with opener.open(request, timeout=_TIMEOUT) as response:
        if not allowed_article_url(response.geturl()) or "html" not in response.headers.get("Content-Type", "").lower():
            raise ValueError("기사 HTML 필요")
        body = response.read(_MAX_BYTES + 1)
        if len(body) > _MAX_BYTES:
            raise ValueError("기사 응답 크기 초과")
        charset = response.headers.get_content_charset() or "utf-8"
        return body.decode(charset, "replace")



class _GoogleRedirect(HTTPRedirectHandler):
    max_redirections = 2
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        target = urlsplit(newurl)
        if target.scheme != "https" or target.hostname != "news.google.com" or target.port not in (None, 443):
            raise ValueError("Google 뉴스 밖의 중계 이동")
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def _google_request(path, data=None):
    opener = build_opener(_GoogleRedirect(), HTTPSHandler(context=tls_context()))
    headers = {"User-Agent": "Mozilla/5.0 (compatible; HanjungsunNews/1.0)"}
    if data is not None:
        headers["Content-Type"] = "application/x-www-form-urlencoded;charset=UTF-8"
    request = Request("https://news.google.com" + path, data=data, headers=headers)
    with opener.open(request, timeout=_TIMEOUT) as response:
        body = response.read(_MAX_BYTES + 1)
        if len(body) > _MAX_BYTES:
            raise ValueError("Google 응답 크기 초과")
        return body.decode("utf-8", "replace")


def _google_signature(url):
    parsed = urlsplit(url)
    match = re.fullmatch(r"/(?:rss/)?(?:articles|read)/([A-Za-z0-9_-]{1,2048})", parsed.path)
    if parsed.scheme != "https" or parsed.hostname != "news.google.com" or not match or parsed.port not in (None, 443) or parsed.username or parsed.password:
        return None
    article_id = match.group(1)
    html = _google_request("/rss/articles/" + article_id + "?hl=en-US&gl=US&ceid=US%3Aen")
    signature = re.search(r'data-n-a-sg="([^"<>]{1,1000})"', html)
    timestamp = re.search(r'data-n-a-ts="(\d{1,20})"', html)
    if not signature or not timestamp:
        return None
    return article_id, int(timestamp.group(1)), signature.group(1)


def resolve_google_urls(urls):
    """Google 중계 URL을 한 번의 묶음 요청으로 발행사 주소로 해석합니다.

    공개된 중계 프로토콜 참고: github.com/SSujitX/google-news-url-decoder
    비공식 인터페이스이므로 변경·차단 시 원문 수집 실패로 처리합니다.
    """
    now = time.monotonic()
    result, pending = {}, []
    with _CACHE_LOCK:
        for url in dict.fromkeys(urls):
            cached = _RESOLVE_CACHE.get(url)
            if cached and cached[0] > now:
                if cached[1]:
                    result[url] = cached[1]
            else:
                pending.append(url)
    if not pending:
        return result
    def signature(url):
        try:
            return _google_signature(url)
        except HTTPError as error:
            error.close()
        except (URLError, HTTPException, TimeoutError, OSError, ValueError, TypeError):
            pass
        return None
    with ThreadPoolExecutor(max_workers=4) as pool:
        signatures = list(pool.map(signature, pending))
    # RPC 필드 값은 Google 공개 중계 페이지가 사용하는 wire format입니다.
    context = [["X", "X", ["X", "X"], None, None, 1, 1, "US:en", None, 1, None, None, None, None, None, 0, 1], "X", "X", 1, [1, 1, 1], 1, 1, None, 0, 0, None, 0]
    requests = []
    for index, values in enumerate(signatures):
        if values:
            payload = ["garturlreq", context, *values]
            requests.append(["Fbv4je", json.dumps(payload, separators=(",", ":")), None, str(index)])
    if requests:
        try:
            raw = _google_request("/_/DotsSplashUi/data/batchexecute?rpcids=Fbv4je", urlencode({"f.req": json.dumps([requests], separators=(",", ":"))}).encode())
            for line in raw.splitlines():
                if not line.lstrip().startswith("["):
                    continue
                rows = json.loads(line)
                for row in rows:
                    if not isinstance(row, list) or len(row) < 3 or row[0] != "wrb.fr" or row[1] != "Fbv4je":
                        continue
                    decoded = json.loads(row[2]) if isinstance(row[2], str) else row[2]
                    key = next((str(cell) for cell in reversed(row[3:]) if cell is not None), "")
                    if decoded[0] == "garturlres" and key.isdigit() and int(key) < len(pending) and allowed_article_url(decoded[1]):
                        result[pending[int(key)]] = decoded[1]
        except HTTPError as error:
            error.close()
        except (URLError, HTTPException, TimeoutError, OSError, ValueError, TypeError, IndexError):
            pass
    with _CACHE_LOCK:
        for url in pending:
            if len(_RESOLVE_CACHE) >= 256:
                _RESOLVE_CACHE.popitem(last=False)
            resolved = result.get(url, "")
            _RESOLVE_CACHE[url] = (now + (1800 if resolved else 60), resolved)
    return result

def article_content(url):
    """지원하는 발행사의 원문만 읽습니다. Google 목록 페이지를 기사 본문으로 취급하지 않습니다."""
    if not allowed_article_url(url):
        return {"state": "unsupported", "text": "", "source": "none", "url": ""}
    now = time.monotonic()
    with _CACHE_LOCK:
        cached = _BODY_CACHE.get(url)
        if cached and cached[0] > now:
            _BODY_CACHE.move_to_end(url)
            return dict(cached[1])
    try:
        parser = ArticleDocument()
        parser.feed(_download_article(url))
        text, source = parser.content()
        result = {"state": "ready" if usable_summary(text) else "insufficient", "text": text, "source": source, "url": url}
    except HTTPError as error:
        error.close()
        result = {"state": "unavailable", "text": "", "source": "none", "url": url}
    except (URLError, HTTPException, TimeoutError, OSError, ValueError, LookupError, TypeError, RecursionError):
        result = {"state": "unavailable", "text": "", "source": "none", "url": url}
    with _CACHE_LOCK:
        if len(_BODY_CACHE) >= 256:
            _BODY_CACHE.popitem(last=False)
        _BODY_CACHE[url] = (now + (1800 if result["state"] == "ready" else 60), result)
    return dict(result)
