"""HOME 뉴스 제목 번역. [주연]

DeepL API로 기사 제목만 번역합니다. 요약·본문은 번역하지 않습니다.
키는 실행 환경의 DEEPL_API_KEY에서만 읽습니다. .env를 직접 읽지 않습니다.
키 값은 응답·로그·오류 메시지에 넣지 않습니다.
번역에 실패하면 원문을 그대로 돌려주고 번역된 것처럼 꾸미지 않습니다.
"""
import json
import os
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

# 대시보드 언어 코드와 DeepL 언어 코드의 대응입니다. 베트남어 화면은 원문을 그대로 봅니다.
TARGETS = {"ko": "KO", "en": "EN-US"}
_FREE = "https://api-free.deepl.com/v2/translate"
_PRO = "https://api.deepl.com/v2/translate"
_MAX_ITEMS = 12
_MAX_CHARS = 300
_TIMEOUT = 8
# 같은 제목을 다시 번역하지 않습니다. 무료 한도를 아끼기 위한 것이며 자료 저장이 아닙니다.
_CACHE = {}
_CACHE_LIMIT = 1000


def _key():
    return os.environ.get("DEEPL_API_KEY", "").strip()


def available():
    """키가 있을 때만 번역 기능을 화면에 노출합니다."""
    return bool(_key())


def _request(texts, code, key):
    fields = [("target_lang", code), ("source_lang", "VI")]
    fields += [("text", text) for text in texts]
    # 무료 계정 키는 :fx로 끝나며 전용 주소를 씁니다.
    address = _FREE if key.endswith(":fx") else _PRO
    request = Request(address, data=urlencode(fields).encode("utf-8"),
                      headers={"Authorization": "DeepL-Auth-Key " + key,
                               "Content-Type": "application/x-www-form-urlencoded"})
    with urlopen(request, timeout=_TIMEOUT) as response:
        payload = json.loads(response.read(500_000))
    rows = payload.get("translations")
    if not isinstance(rows, list) or len(rows) != len(texts):
        raise ValueError("번역 응답 형식 오류")
    results = []
    for row in rows:
        text = row.get("text") if isinstance(row, dict) else None
        if not isinstance(text, str):
            raise ValueError("번역 응답 형식 오류")
        results.append(text)
    return results


def translate_titles(titles, target):
    """제목 목록을 번역합니다. (결과 목록, 번역 실패 여부)를 돌려줍니다.

    번역 대상이 아니거나 키가 없으면 실패가 아니라 원문 그대로를 돌려줍니다.
    """
    code = TARGETS.get(target)
    key = _key()
    rows = [title if isinstance(title, str) else "" for title in titles]
    if not code or not key or not rows:
        return rows, False
    pending, order = [], {}
    for text in rows[:_MAX_ITEMS]:
        clipped = text[:_MAX_CHARS]
        if not clipped.strip() or (code, clipped) in _CACHE or clipped in order:
            continue
        order[clipped] = True
        pending.append(clipped)
    if pending:
        try:
            for source, result in zip(pending, _request(pending, code, key)):
                if len(_CACHE) >= _CACHE_LIMIT:
                    _CACHE.clear()
                _CACHE[(code, source)] = result
        except HTTPError as error:
            error.close()
            # 한도 초과·인증 실패 모두 원문 표시로 넘깁니다. 키가 드러나는 내용은 남기지 않습니다.
            return rows, True
        except (URLError, TimeoutError, OSError, ValueError, TypeError):
            return rows, True
    return [_CACHE.get((code, text[:_MAX_CHARS]), text) for text in rows], False
