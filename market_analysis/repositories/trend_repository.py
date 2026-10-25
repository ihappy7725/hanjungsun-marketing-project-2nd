import json
import os
from copy import deepcopy
from datetime import datetime
from pathlib import Path

PACKAGE_DIR = Path(__file__).resolve().parents[1]


class TrendRepository:
    """트렌드 JSON 파일 저장소. DB로 바꿀 때 이 클래스만 교체합니다."""

    def __init__(self, data_dir=None, config_dir=None):
        self.data_dir = Path(data_dir or PACKAGE_DIR / "data")
        self.config_dir = Path(config_dir or PACKAGE_DIR / "config")

    def get_keywords(self, country_code):
        config = self._read(self.config_dir / f"trend_keywords_{country_code.lower()}.json")
        # 검색어가 목록이면 Google Trends의 + 연산자로 합친 하나의 검색어로 사용합니다.
        for category in (config or {}).get("categories", []):
            if isinstance(category["representative_query"], list):
                category["representative_queries"] = category["representative_query"]
                category["representative_query"] = " + ".join(category["representative_query"])
        for theme in (config or {}).get("seasonality_themes", []):
            if isinstance(theme["query"], list):
                theme["queries"] = theme["query"]
                theme["query"] = " + ".join(theme["query"])
        return config

    def keywords_path(self, country_code):
        return self.config_dir / f"trend_keywords_{country_code.lower()}.json"

    def get_suggestions(self, country_code):
        return self._read(self.data_dir / f"candidate_suggestions_{country_code.lower()}.json")

    def save_suggestions(self, country_code, data):
        self._write(self.data_dir / f"candidate_suggestions_{country_code.lower()}.json", data)

    def get_latest(self, country_code):
        """마지막 정상 데이터. 갱신에 실패한 영역은 이전 값이 그대로 남아 있습니다."""
        return self._read(self.data_dir / f"trends_{country_code.lower()}.json")

    def save_latest(self, country_code, data):
        self._write(self.data_dir / f"trends_{country_code.lower()}.json", data)

    def get_ads(self, country_code):
        return self._read(self.data_dir / f"ad_trends_{country_code.lower()}.json")

    def save_ads(self, country_code, data):
        self._write(self.data_dir / f"ad_trends_{country_code.lower()}.json", data)

    def get_ad_research(self, country_code):
        """담당자가 조사한 광고 트렌드 보고서(화면용 정리본)."""
        return self._read(self.data_dir / f"ad_research_{country_code.lower()}.json")

    def ad_source_path(self, country_code):
        for suffix in (".json", ".csv"):
            path = self.data_dir / f"ad_cases_{country_code.lower()}{suffix}"
            if path.exists():
                return path
        return self.data_dir / f"ad_cases_{country_code.lower()}.csv"

    def save_raw(self, name, payload, now=None):
        stamp = (now or datetime.now()).strftime("%Y-%m-%d_%H%M%S")
        self._write(self.data_dir / "raw" / f"{name}_{stamp}.json", payload)

    @staticmethod
    def _read(path):
        if not path.exists():
            return None
        with path.open(encoding="utf-8-sig") as file:
            return deepcopy(json.load(file))

    @staticmethod
    def _write(path, data):
        path.parent.mkdir(parents=True, exist_ok=True)
        temp_path = path.with_suffix(path.suffix + ".tmp")
        with temp_path.open("w", encoding="utf-8") as file:
            json.dump(data, file, ensure_ascii=False, indent=2)
        os.replace(temp_path, path)
