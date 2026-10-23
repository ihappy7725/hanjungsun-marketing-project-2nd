"""인플루언서 마케팅 공개 함수 — HOME·KPI는 influencer_marketing 중 이 파일만 import합니다. [진혁]

껍데기입니다. 진혁 개인 브랜치의 구현본으로 교체합니다. (README 8장: 구현·시험 완료)
오류가 나면 [], 값이 없으면 "" 또는 None을 돌려줍니다. 필드는 지우지 말고 추가만 합니다.
"""


def get_collaborations(event_id=None, include_demo=True):
    """협업 목록.

    반환 필드: collaboration_id, event_id, influencer, main_platform, followers, status, status_label,
              available_shoot_dates, shoot_date, post_date, is_demo, link
    status: candidate | sent | replied | negotiating | confirmed | shot | posted | declined
    """
    return []


def get_today_tasks(limit=10, include_demo=True):
    """인플루언서 오늘의 할 일.

    반환 필드: task_id, kind, collaboration_id, influencer, title, detail, due_date, is_demo, link
    kind: review | late | pick | soon | stale
    """
    return []


def get_quote_summary(include_demo=True):
    """광고 단가 요약 (KPI용).

    반환 필드: quote_id, collaboration_id, influencer, platform, content_format,
              price_type(public | quote | contract), amount, currency, amount_usd, amount_vnd,
              quoted_on, followers, expected_views, actual_views, is_demo
    """
    return []
