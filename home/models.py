"""HOME DB 테이블. [주연]

테이블 이름 접두어: home_  (README 8장 DB 충돌 방지)
예정 테이블: home_campaigns · home_tasks · home_schedules · home_campaign_collaboration_links
다른 탭의 ID는 외래키 없이 문자열 칸으로 저장합니다.

현재 단계에는 모델·테이블을 생성하지 않습니다. HOME 업무는 브라우저에 저장합니다.
DB 적용 시 이 파일에 위 4개 테이블을 정의하고 routes.py에 HOME 저장 API를 추가합니다.
실제 SQLite 파일은 공통 app.py 설정의 instance/dashboard.sqlite3에 놓입니다.
home/db/ 폴더를 별도로 만들거나 공통 DB 연결 설정을 이 파일에서 바꾸지 않습니다.
기존 기록이 쌓인 뒤의 구조 변경은 백업·이관 방법을 PM1과 먼저 합의합니다.
"""
from platform_core.extensions import db  # noqa: F401
