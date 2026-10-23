"""KPI DB 테이블. [민지]

테이블 이름 접두어: kpi_  (README 8장 DB 충돌 방지)
예정 테이블: kpi_marketing_budget · kpi_ad_performance_daily · kpi_voc_reviews
다른 탭의 ID는 외래키 없이 문자열 칸으로 저장합니다.
"""
from platform_core.extensions import db  # noqa: F401
