"""인플루언서 마케팅 Blueprint. [진혁] — README 5·7장"""
from flask import Blueprint

bp = Blueprint(
    "influencer_marketing",
    __name__,
    url_prefix="/influencer_marketing",
    template_folder="templates",
    static_folder="static",
)

from . import models, routes  # noqa: E402,F401  (bp를 먼저 만든 뒤 불러옵니다)
