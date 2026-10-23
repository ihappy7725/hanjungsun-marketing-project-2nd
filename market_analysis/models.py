"""현지 시장 분석 DB 테이블. [상준]

테이블 이름 접두어: market_analysis_  (README 8장 DB 충돌 방지)
예정 테이블: market_analysis_trend_* · _competitor · _country · _culture · _event · _insight
다른 탭의 ID는 외래키 없이 문자열 칸으로 저장합니다.
"""
from platform_core.extensions import db  # noqa: F401
