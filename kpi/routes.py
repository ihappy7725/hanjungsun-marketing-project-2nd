"""KPI 화면·API. [민지]

API는 /kpi/api/... 아래에만 추가합니다. 다른 기능 데이터는 그 기능의 public.py로만 읽습니다. (README 8장)
"""
from flask import render_template

from . import bp


@bp.route("/")
def index():
    return render_template("kpi/kpi_index.html")
