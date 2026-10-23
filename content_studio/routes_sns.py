"""화면, 대화·이전 작업·버전·첫 화면 API, 영상 API. [유진]

API는 /content_studio/api/... 아래에 둡니다.
포스터·카드뉴스를 대화로 고치는 규칙은 designs.py(희주)에 있고, 여기서는 부르기만 합니다.
"""
from flask import render_template, request

from . import bp

TABS = ("poster", "cardnews", "video")


@bp.route("/")
def index():
    tab = request.args.get("tab", "poster")
    if tab not in TABS:
        tab = "poster"
    return render_template("content_studio/content_studio_index.html", tab=tab)
