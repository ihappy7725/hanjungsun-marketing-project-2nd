"""사진 업로드, 배경 제거(OpenCV), 숏폼 콘티, 광고 표현 검수. [희주]

API는 /content_studio/media/api/... 아래에 둡니다. 예: @bp.route("/media/api/remove-background", methods=["POST"])
업로드·결과 파일은 instance/uploads/content_studio/, instance/exports/content_studio/ 에 저장합니다.
"""
from . import bp  # noqa: F401
