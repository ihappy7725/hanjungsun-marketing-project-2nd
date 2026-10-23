"""콘텐츠 스튜디오 Blueprint. [유진] — README 5·7장

한 폴더를 유진·희주가 나눠 씁니다. 각 파일 첫 줄의 [담당자]만 그 파일을 수정합니다.
API: /content_studio/api/... (유진) · /content_studio/media/api/... (희주)
"""
from flask import Blueprint

bp = Blueprint(
    "content_studio",
    __name__,
    url_prefix="/content_studio",
    template_folder="templates",
    static_folder="static",
)

from . import models_sns, routes_media, routes_sns  # noqa: E402,F401  (bp를 먼저 만든 뒤 불러옵니다)
