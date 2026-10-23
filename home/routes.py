"""HOME 화면·API. [주연]

API는 /home/api/... 아래에만 추가합니다. 다른 기능 데이터는 그 기능의 public.py로만 읽습니다. (README 8장)
"""
from datetime import date

from flask import jsonify, render_template, request

from . import bp


@bp.route("/")
def index():
    return render_template("home/home_index.html")


@bp.get("/api/signals")
def signals():
    """공개 함수로만 읽습니다. HOME DB나 원본 데이터에는 쓰지 않습니다."""
    try:
        start = date.fromisoformat(request.args.get("start", ""))
        end = date.fromisoformat(request.args.get("end", ""))
        if end < start or end.year - start.year > 5:
            raise ValueError
    except ValueError:
        return jsonify(error="조회 기간은 시작일 이후, 최대 5년 범위로 입력해주세요."), 400

    result = {}

    def read(name, callback):
        try:
            rows = callback()
            if not isinstance(rows, list) or not all(isinstance(row, dict) for row in rows):
                raise TypeError("공개 함수의 목록 응답이 필요합니다.")
            result[name] = {"state": "ok", "items": rows}
        except Exception:
            # 예외 내용에는 원본 자료가 들어갈 수 있어 응답·로그에 내보내지 않습니다.
            result[name] = {"state": "error", "items": []}

    def events():
        from market_analysis.public import get_events
        return [item for year in range(start.year, end.year + 1)
                for item in get_events(country="VN", year=year)]

    def news():
        from market_analysis.public import get_news_summary
        return get_news_summary(country="VN", limit=3)

    def collaborations():
        from influencer_marketing.public import get_collaborations
        return get_collaborations(include_demo=False)

    def tasks():
        from influencer_marketing.public import get_today_tasks
        return get_today_tasks(limit=10, include_demo=False)

    read("events", events)
    read("news", news)
    read("collaborations", collaborations)
    read("attention", tasks)
    return jsonify(result)
