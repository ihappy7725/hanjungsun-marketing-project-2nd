"""KPI Blueprint. [민지] — README 5·7장"""
from flask import Blueprint

bp = Blueprint(
    "kpi",
    __name__,
    url_prefix="/kpi",
    template_folder="templates",
    static_folder="static",
)

from . import models, routes  # noqa: E402,F401  (bp를 먼저 만든 뒤 불러옵니다)
