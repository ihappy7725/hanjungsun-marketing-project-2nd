"""SerpApi Google Trends 원본 수집기.

원본 응답만 반환합니다. 계산과 정규화는 services/trend_service.py에서 처리합니다.
"""
import json
import os
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import urlopen

API_URL = "https://serpapi.com/search.json"


class SerpApiError(RuntimeError):
    pass


def load_api_key():
    return os.environ.get("SERPAPI_API_KEY", "").strip()


class SerpApiTrendsCollector:
    MAX_TIMESERIES_QUERIES = 5

    def __init__(self, api_key=None, timeout=30, geo="VN", hl="vi", tz=-420):
        self.api_key = api_key if api_key is not None else load_api_key()
        self.timeout = timeout
        self.geo = geo
        self.hl = hl
        self.tz = tz

    def fetch(self, data_type, queries, date, **extra):
        if not self.api_key:
            raise SerpApiError("SERPAPI_API_KEY가 설정되지 않았습니다.")
        if isinstance(queries, str):
            queries = [queries]
        if data_type == "TIMESERIES" and len(queries) > self.MAX_TIMESERIES_QUERIES:
            raise SerpApiError("TIMESERIES는 한 번에 최대 5개 검색어만 비교할 수 있습니다.")
        if data_type != "TIMESERIES" and len(queries) != 1:
            raise SerpApiError(f"{data_type}는 검색어 하나만 사용할 수 있습니다.")

        params = {
            "engine": "google_trends",
            "data_type": data_type,
            "q": ",".join(queries),
            "geo": self.geo,
            "hl": self.hl,
            "tz": self.tz,
            "date": date,
            **extra,
            "api_key": self.api_key,
        }
        try:
            with urlopen(f"{API_URL}?{urlencode(params)}", timeout=self.timeout) as response:
                payload = json.loads(response.read().decode("utf-8"))
        except HTTPError as error:
            raise SerpApiError(f"SerpApi HTTP 오류 {error.code}: {self._error_message(error)}") from None
        except (URLError, TimeoutError) as error:
            raise SerpApiError(f"SerpApi 연결 실패 또는 시간초과: {error}") from None
        except json.JSONDecodeError:
            raise SerpApiError("SerpApi 응답을 해석하지 못했습니다.") from None

        if payload.get("error"):
            raise SerpApiError(f"SerpApi 오류: {payload['error']}")
        payload.get("search_parameters", {}).pop("api_key", None)
        payload.get("search_metadata", {}).pop("json_endpoint", None)
        return payload

    @staticmethod
    def _error_message(error):
        try:
            return json.loads(error.read().decode("utf-8")).get("error", "")
        except Exception:
            return ""
