"""HOME 뉴스 본문 확인·등록 명령. [주연]

python -B -m home.news_import --help
.env를 읽지 않으며 공통 앱·DB를 초기화하지 않습니다.
법령·공지처럼 팀이 그대로 행동하게 되는 자료만 여기로 등록합니다.
일반 동향은 화면의 뉴스 검색으로 보고, 등록하지 않습니다.
출처 내용의 진실성은 사람이 확인합니다. 본문을 받아 왔다는 사실이 사실 확인이 아닙니다.
"""
import argparse
from html.parser import HTMLParser
from pathlib import Path
import re
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit
from urllib.request import Request, urlopen

from .event_import import ReviewError, _atomic_write, _confirm, _no_secrets, _print, _snapshot, _token
from .routes import _validate_news_row

NEWS_PATH = Path(__file__).parent / "data" / "news.json"
_SKIP_TAGS = {"script", "style", "noscript", "template", "svg"}
_MAX_BYTES = 3_000_000
_MAX_TEXT = 20_000
_TIMEOUT = 15


class _Article(HTMLParser):
    """기사 화면에서 사람이 읽는 글자만 모읍니다. 태그·스크립트는 버립니다."""

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


def _news_document():
    raw, document = _snapshot(NEWS_PATH)
    if not isinstance(document, dict) or document.get("schema_version") != 1 or not isinstance(document.get("news"), list):
        raise ReviewError("뉴스 파일 형식을 확인해주세요.")
    ids = [row.get("news_id") for row in document["news"] if isinstance(row, dict)]
    if (len(ids) != len(document["news"]) or any(not isinstance(i, str) or not i for i in ids)
            or len(ids) != len(set(ids))):
        raise ReviewError("뉴스 ID 누락·중복을 확인해주세요.")
    return raw, document


def fetch(url):
    """기사 본문 글자만 받아 화면에 보여 줍니다. 저장하지 않고 요약하지 않습니다."""
    address = urlsplit(url)
    if address.scheme != "https" or not address.hostname or address.username or address.password:
        raise ReviewError("https 기사 주소만 열 수 있습니다.")
    try:
        with urlopen(Request(url, headers={"Accept": "text/html"}), timeout=_TIMEOUT) as response:
            if urlsplit(response.geturl()).scheme != "https":
                raise ReviewError("이동한 주소가 https가 아니어서 중단했습니다.")
            body = response.read(_MAX_BYTES + 1)
    except HTTPError as error:
        error.close()
        raise ReviewError("기사 서버가 요청을 거절했습니다. 브라우저에서 직접 열어 확인해주세요.") from None
    except (URLError, TimeoutError, OSError):
        raise ReviewError("기사에 연결하지 못했습니다. 브라우저에서 직접 열어 확인해주세요.") from None
    if len(body) > _MAX_BYTES:
        raise ReviewError("문서가 너무 커서 읽지 않았습니다. 브라우저에서 직접 열어 확인해주세요.")
    charset = "utf-8"
    match = re.search(rb'charset=["\']?([\w\-]+)', body[:4000], re.IGNORECASE)
    if match:
        charset = match.group(1).decode("ascii", "ignore") or "utf-8"
    try:
        html = body.decode(charset, "replace")
    except LookupError:
        html = body.decode("utf-8", "replace")
    parser = _Article()
    parser.feed(html)
    text = "\n".join(parser.parts)
    _print({"operation": "fetch", "host": address.hostname, "characters": len(text),
            "truncated": len(text) > _MAX_TEXT,
            "notice": "본문 글자만 옮긴 것이며 사실 확인이 아닙니다. 법령·공지는 반드시 원문을 직접 확인하세요."})
    print(text[:_MAX_TEXT])


def stage(input_path, confirm=None):
    """사람이 작성한 검증 JSON을 승인 대기 상태로 넣습니다. 화면에는 보이지 않습니다."""
    path = Path(input_path)
    if path.suffix.lower() != ".json":
        raise ReviewError("검토 입력은 JSON 파일만 허용합니다. .env는 읽지 않습니다.")
    input_raw, row = _snapshot(path)
    _no_secrets(row)
    if not isinstance(row, dict) or row.get("verification_status") != "verified":
        raise ReviewError("담당자가 검증을 마친 자료만 넣을 수 있습니다.")
    if row.get("registration_status") != "pending_approval":
        raise ReviewError("등록 승인 대기 상태(pending_approval)로 작성해주세요.")
    _validate_news_row(row)
    raw, document = _news_document()
    if any(existing["news_id"] == row["news_id"] for existing in document["news"]):
        raise ReviewError("같은 뉴스 ID가 이미 있습니다. 기존 기록을 덮어쓰지 않습니다.")
    token = _token("news-stage", raw, input_raw)
    _print({"operation": "stage", "news_id": row["news_id"], "title": row["title"],
            "confirmation_token": token,
            "notice": "형식 검사 통과. 원문 사실성은 담당자가 확인해야 합니다. 화면에는 아직 보이지 않습니다."})
    if _confirm(token, confirm):
        document["news"].append(row)
        _atomic_write(NEWS_PATH, raw, document)
        _print({"saved": "pending_only", "news_id": row["news_id"]})


def register(news_id, confirm=None):
    """승인 대기 뉴스를 화면 노출 상태로 바꿉니다."""
    raw, document = _news_document()
    matches = [row for row in document["news"] if row["news_id"] == news_id]
    if len(matches) != 1:
        raise ReviewError("등록할 뉴스 ID를 확인해주세요.")
    row = matches[0]
    if row.get("verification_status") != "verified" or row.get("registration_status") != "pending_approval":
        raise ReviewError("검증 완료·승인 대기 상태인 뉴스만 등록할 수 있습니다.")
    _validate_news_row(row)
    token = _token("news-register", raw, news_id.encode())
    _print({"operation": "register", "news_id": news_id, "title": row["title"],
            "confirmation_token": token,
            "notice": "등록 미리보기입니다. 승인 후 같은 명령에 --confirm 토큰을 지정하세요."})
    if _confirm(token, confirm):
        row["registration_status"] = "approved"
        _validate_news_row(row)
        _atomic_write(NEWS_PATH, raw, document)
        _print({"saved": "news_published", "news_id": news_id})


def main(argv=None):
    parser = argparse.ArgumentParser(description="HOME 뉴스 본문 확인·승인 등록 (자동 사실 검증 아님)")
    commands = parser.add_subparsers(dest="command", required=True)
    read = commands.add_parser("fetch", help="기사 본문 글자만 확인. 저장·요약 없음")
    read.add_argument("--url", required=True)
    prepare = commands.add_parser("stage", help="검증 JSON을 승인 대기로 추가. 기본은 미리보기")
    prepare.add_argument("--input", required=True)
    prepare.add_argument("--confirm")
    approve = commands.add_parser("register", help="승인 대기 뉴스를 화면에 노출. 기본은 미리보기")
    approve.add_argument("--news-id", required=True)
    approve.add_argument("--confirm")
    args = parser.parse_args(argv)
    try:
        if args.command == "fetch":
            fetch(args.url)
        elif args.command == "stage":
            stage(args.input, args.confirm)
        else:
            register(args.news_id, args.confirm)
    except ReviewError as error:
        print(str(error))
        return 1
    except (OSError, ValueError, TypeError, KeyError, AttributeError) as error:
        print(f"자료 형식에 오류가 있습니다: {error}")
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
