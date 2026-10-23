"""공통 기반 — 공통 레이아웃·메뉴·디자인 토큰. [PM1 상준만 수정]"""
from flask import Blueprint

bp = Blueprint(
    "platform_core",
    __name__,
    url_prefix="/platform_core",
    template_folder="templates",
    static_folder="static",
)

# 메뉴 이름(시안 이름 vs 모듈 이름)은 README 6.8 확정 항목입니다. 확정 전에는 모듈 이름을 씁니다.
# icon: 선 아이콘(stroke 1.5)의 SVG path, 24x24 기준
NAV_MENUS = [
    {"blueprint": "home", "no": "01", "label": "HOME",
     "icon": "M3 11l9-7 9 7M5 10v10h14V10"},
    {"blueprint": "market_analysis", "no": "02", "label": "현지 시장 분석",
     "icon": "M4 20V10M10 20V4M16 20v-7M22 20H2"},
    {"blueprint": "content_studio", "no": "03", "label": "콘텐츠 스튜디오",
     "icon": "M4 4h16v16H4zM4 15l5-5 4 4 3-3 4 4"},
    {"blueprint": "kpi", "no": "04", "label": "KPI",
     "icon": "M3 17l6-6 4 4 8-8M15 7h6v6"},
    {"blueprint": "influencer_marketing", "no": "05", "label": "인플루언서 마케팅",
     "icon": "M12 12a4 4 0 100-8 4 4 0 000 8zM4 21c0-4 4-6 8-6s8 2 8 6"},
]


@bp.app_context_processor
def inject_nav_menus():
    return {"nav_menus": NAV_MENUS}
