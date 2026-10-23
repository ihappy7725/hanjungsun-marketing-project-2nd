"""현지 시장 분석 Blueprint. [상준] — README 5·7장"""
from flask import Blueprint

bp = Blueprint(
    "market_analysis",
    __name__,
    url_prefix="/market_analysis",
    template_folder="templates",
    static_folder="static",
)

from . import models, routes  # noqa: E402,F401  (bp를 먼저 만든 뒤 불러옵니다)
