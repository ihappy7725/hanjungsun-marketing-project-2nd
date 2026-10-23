"""현지 시장 분석 공개 함수 — 다른 탭은 market_analysis 중 이 파일만 import합니다. [상준]

지금은 껍데기 단계라 형식만 맞추고 빈 목록을 돌려줍니다. (README 8·10장: 껍데기 먼저 머지)
형식을 바꿀 때는 사용하는 담당자(주연·유진·희주·진혁)에게 먼저 알리고, 필드는 지우지 말고 추가만 합니다.
오류가 나거나 데이터가 없으면 [] 를 돌려줍니다.
"""
import json
import unicodedata
from pathlib import Path

_DATA_DIR = Path(__file__).parent / "data"


def get_events(country="VN", year=None):
    """기념일·공휴일·과일 시즌 목록.

    반환: list[dict]
        event_id  str  예: "vn_teachers_day_2026"  ({국가코드}_{이름}_{연도})
        country   str  예: "VN"
        name      str  예: "스승의 날"
        date      str  "YYYY-MM-DD"
        type      str  "holiday" | "anniversary" | "fruit_season"
    기간·지역·출처·is_demo 필드 추가 여부는 README 8장 확정 항목입니다.
    """
    return []


def get_news_summary(country="VN", limit=5):
    """뉴스 요약 목록 (요약은 이 탭에서 한 번만 하고 저장해 둔 결과를 돌려줍니다).

    반환: list[dict]
        news_id       str
        country       str
        title         str
        summary       str
        source        str
        published_at  str  "YYYY-MM-DD"
    """
    return []


def get_content_guidelines(country="VN"):
    """콘텐츠 제작 가이드라인 — 피할 표현·권장 색/숫자/소재/메시지·생성 프롬프트 규칙·출처.

    원본: market_analysis/data/content_guidelines_<국가코드 소문자>.json (이 탭만 수정)
    반환: dict (파일이 없거나 읽기 실패 시 {})
        status              str   "draft" | "confirmed"
        reviewed_at         str   "YYYY-MM-DD"
        disclaimer          str   화면에 함께 표시할 안내 (법적 판단 아님)
        avoid_expressions   list  {id, category, severity("block"|"warn"), keywords{ko,vi,en}, reason, suggestion, verified, source_ids}
        visual_cautions     list  {id, severity, rule, related_rule_id}
        recommended         dict  colors, avoid_colors, numbers, motifs, messages, occasions
        required_notices    list  {id, rule, verified, source_ids}
        prompt_rules        list[str]  포스터·카드뉴스·영상 생성 프롬프트에 그대로 넣을 문장
        sources             list  {id, title, publisher, type, url, checked_at}

    사용 예 (콘텐츠 스튜디오 designs.py):
        from market_analysis.public import get_content_guidelines
        rules = get_content_guidelines("VN").get("prompt_rules", [])
    """
    path = _DATA_DIR / f"content_guidelines_{country.lower()}.json"
    try:
        with path.open(encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return {}


def check_ad_copy(text, country="VN"):
    """광고 문구에서 피할 표현을 찾습니다. 참고 안내이며 법적 판단이 아닙니다.

    반환: list[dict] (걸린 표현이 없거나 오류 시 [])
        rule_id     str   avoid_expressions의 id
        category    str   "law" | "politics" | "culture"
        severity    str   "block"(쓰지 않음) | "warn"(주의)
        matched     list  [{"lang": "vi", "keyword": "ngon nhất"}]
        reason      str
        suggestion  str
        verified    bool  False면 원문 조항 미확인
        sources     list  [{"title", "url"}]

    사용 예 (콘텐츠 스튜디오 routes_media.py 광고 표현 검수):
        from market_analysis.public import check_ad_copy
        findings = check_ad_copy(request.json.get("text", ""), "VN")
    """
    guidelines = get_content_guidelines(country)
    if not text or not guidelines:
        return []

    target = _normalize(text)
    sources = {s["id"]: s for s in guidelines.get("sources", [])}
    findings = []
    for rule in guidelines.get("avoid_expressions", []):
        matched = [
            {"lang": lang, "keyword": keyword}
            for lang, keywords in rule.get("keywords", {}).items()
            for keyword in keywords
            if _normalize(keyword) in target
        ]
        if not matched:
            continue
        findings.append({
            "rule_id": rule["id"],
            "category": rule.get("category", ""),
            "severity": rule.get("severity", "warn"),
            "matched": matched,
            "reason": rule.get("reason", ""),
            "suggestion": rule.get("suggestion", ""),
            "verified": rule.get("verified", False),
            "sources": [
                {"title": sources[sid]["title"], "url": sources[sid]["url"]}
                for sid in rule.get("source_ids", [])
                if sid in sources
            ],
        })
    return findings


def _normalize(text):
    # 베트남어 성조 글자는 입력 방식에 따라 조합형/완성형이 섞이므로 NFC로 맞춘 뒤 대소문자를 무시합니다.
    return unicodedata.normalize("NFC", text).casefold()
