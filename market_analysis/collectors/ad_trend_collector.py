"""수동 조사한 공개 광고 사례(CSV 또는 JSON) 읽기.

V1은 TikTok Creative Center를 자동 크롤링하지 않습니다. 담당자가 공개 광고를
검토해 기록한 파일만 읽고, 필수 필드 검사와 중복 제거를 합니다.
"""
import csv
import json
from datetime import date
from pathlib import Path

FIELDS = (
    "platform", "brand", "ad_url", "objective", "format", "duration_seconds",
    "opening_hook", "visual_style", "product_shot", "subtitle_style",
    "creator_type", "cta", "performance_band", "collected_at",
)
REQUIRED_FIELDS = (
    "platform", "brand", "ad_url", "format", "duration_seconds",
    "opening_hook", "subtitle_style", "cta", "collected_at",
)


class AdTrendCollector:
    def __init__(self, source_path):
        self.source_path = Path(source_path)

    def collect(self):
        """Returns {"cases": [...], "ideas": [...], "rejected": [...]}."""
        if not self.source_path.exists():
            return {"cases": [], "ideas": [], "rejected": []}
        rows, ideas = self._read()

        cases, rejected, seen_urls = [], [], set()
        for line_no, row in enumerate(rows, start=1):
            case = {field: str(row.get(field, "") or "").strip() for field in FIELDS}
            problem = self._validate(case)
            if not problem and case["ad_url"] in seen_urls:
                problem = "중복 광고"
            if problem:
                rejected.append({"row": line_no, "ad_url": case["ad_url"], "reason": problem})
                continue
            seen_urls.add(case["ad_url"])
            case["duration_seconds"] = float(case["duration_seconds"])
            cases.append(case)
        return {"cases": cases, "ideas": ideas, "rejected": rejected}

    def _read(self):
        if self.source_path.suffix.lower() == ".json":
            with self.source_path.open(encoding="utf-8-sig") as file:
                data = json.load(file)
            if isinstance(data, list):
                return data, []
            return data.get("cases", []), [str(item) for item in data.get("ideas", []) if str(item).strip()]
        with self.source_path.open(encoding="utf-8-sig", newline="") as file:
            return list(csv.DictReader(file)), []

    @staticmethod
    def _validate(case):
        missing = [field for field in REQUIRED_FIELDS if not case[field]]
        if missing:
            return f"필수 필드 누락: {', '.join(missing)}"
        if not case["ad_url"].startswith(("http://", "https://")):
            return "ad_url은 원문 링크여야 합니다."
        try:
            if float(case["duration_seconds"]) <= 0:
                raise ValueError
        except ValueError:
            return "duration_seconds는 양수여야 합니다."
        try:
            date.fromisoformat(case["collected_at"][:10])
        except ValueError:
            return "collected_at은 YYYY-MM-DD 형식이어야 합니다."
        return None
