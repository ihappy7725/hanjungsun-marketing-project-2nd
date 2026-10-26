"""HOME Blueprint. [주연] — README 5·7장"""
from flask import Blueprint

bp = Blueprint(
    "home",
    __name__,
    url_prefix="/home",
    template_folder="templates",
    static_folder="static",
)

from . import cli, models, routes  # noqa: E402,F401  (bp를 먼저 만든 뒤 불러옵니다)
