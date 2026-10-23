"""HOME DB 테이블. [주연]

테이블 이름 접두어: home_  (README 8장 DB 충돌 방지)
예정 테이블: home_campaigns · home_tasks · home_schedules · home_campaign_collaboration_links
다른 탭의 ID는 외래키 없이 문자열 칸으로 저장합니다.
"""
from platform_core.extensions import db  # noqa: F401
