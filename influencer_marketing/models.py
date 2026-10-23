"""인플루언서 마케팅 DB 테이블. [진혁]

테이블 이름 접두어: influencer_marketing_  (README 8장 DB 충돌 방지)
예정 테이블: influencer_marketing_influencers · _quotes · _settings
다른 탭의 ID는 외래키 없이 문자열 칸으로 저장합니다.
"""
from platform_core.extensions import db  # noqa: F401
