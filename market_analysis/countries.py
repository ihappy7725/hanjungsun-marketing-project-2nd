"""국가 등록부 + 현지어 검색어 대응표. 국가 추가 = 한 줄 추가. [상준]"""

DEFAULT_COUNTRY = "VN"

COUNTRIES = {
    "VN": {"name": "베트남", "city": "다낭", "language": "vi", "timezone": "Asia/Ho_Chi_Minh"},
}

# 한국어 검색어 → 현지어 검색어 (Google Trends 비교 검색어는 5개 이하)
SEARCH_TERMS = {
    "VN": {},
}
