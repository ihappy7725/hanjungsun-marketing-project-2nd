"""외부 API 연동 (담당: 진혁) - YouTube Data API v3, Phyllo, Modash, HypeAuditor.

- API 키는 서버에서만 사용합니다(README 6장). 화면(JavaScript)으로는 절대 보내지 않습니다.
- 키는 환경변수에서 읽습니다. 변수 이름은 PM1(상준)에게 .env.example 추가를 요청합니다.
    YOUTUBE_API_KEY
    PHYLLO_CLIENT_ID, PHYLLO_CLIENT_SECRET, PHYLLO_ENV (sandbox | staging | production, 기본 sandbox)
    MODASH_API_KEY                       (Authorization: Bearer)
    HYPEAUDITOR_CLIENT_ID, HYPEAUDITOR_API_TOKEN (X-Auth-Id, X-Auth-Token), HYPEAUDITOR_SANDBOX (1이면 샌드박스 검색)
- TikTok One은 일반 광고주용 공개 API 권한이 확인되지 않아 API 연동 코드를 넣지 않았습니다(화면 연계만).
- 표준 라이브러리(urllib)만 써서 requirements.txt에 추가할 라이브러리가 없습니다.
- 최근 호출 기록(CALL_LOG)을 남겨 화면의 '연결 여부 확인' 탭과 터미널에서 과정을 확인할 수 있습니다.
"""
import base64
import json
import os
import re
import statistics
import time
import urllib.error
import urllib.parse
import urllib.request
from collections import deque
from datetime import datetime, timedelta, timezone

TIMEOUT = 15
CALL_LOG = deque(maxlen=60)
_QUOTA = {"date": "", "units": 0}
YT_BASE = "https://www.googleapis.com/youtube/v3/"
YT_COST = {"channels": 1, "playlistItems": 1, "videos": 1, "search": 100}
PHYLLO_BASE = {
    "sandbox": "https://api.sandbox.getphyllo.com",
    "staging": "https://api.staging.getphyllo.com",
    "production": "https://api.getphyllo.com",
}
PHYLLO_PLATFORM_NAMES = {"tt": "TikTok", "ig": "Instagram", "yt": "YouTube", "fb": "Facebook"}
MODASH_BASE = "https://api.modash.io/v1"
MODASH_PLATFORM = {"tt": "tiktok", "ig": "instagram", "yt": "youtube"}
HYPE_BASE = "https://hypeauditor.com/api/method/"
HYPE_PLATFORM = {"tt": "tiktok", "ig": "instagram", "yt": "youtube"}
SERVICE_KEYS = {"YouTube": "youtube", "Phyllo": "phyllo", "Modash": "modash", "HypeAuditor": "hypeauditor"}
SERVICE_STATE = {k: {"last_ok_at": "", "last_result": "", "last_error": "", "permission_denied": False,
                     "credits_exhausted": False, "credits": None} for k in SERVICE_KEYS.values()}


class ApiError(Exception):
    """화면에 그대로 보여 줄 한국어 메시지를 담습니다."""


# ---------------------------------------------------------------- 공통
def _env(name, default=""):
    try:
        from flask import current_app
        val = current_app.config.get(name)
        if val and not str(val).startswith("여기에"):
            return str(val).strip()
    except Exception:
        pass
    val = os.environ.get(name, default).strip()
    return "" if val.startswith("여기에") else val  # .env.example의 안내 문구가 그대로 남은 경우는 '없음'으로 처리


def _mask(v):
    if not v:
        return ""
    return v[:4] + "…" + v[-3:] if len(v) > 10 else "…" + v[-2:]


def _pacific_today():
    # YouTube 할당량은 미국 태평양 시간 자정에 초기화됨 (대략 UTC-8, 여름 UTC-7)
    return (datetime.now(timezone.utc) - timedelta(hours=8)).date().isoformat()


def _log(service, label, status, ms, units=0, detail=""):
    entry = {"time": datetime.now().strftime("%H:%M:%S"), "service": service, "call": label,
             "status": status, "ms": ms, "units": units, "detail": detail}
    CALL_LOG.appendleft(entry)
    st = SERVICE_STATE.get(SERVICE_KEYS.get(service, ""))
    if st is not None:
        if status == "성공":
            st.update(last_ok_at=datetime.now().isoformat(timespec="seconds"), last_result="ok", last_error="",
                      permission_denied=False, credits_exhausted=False)
        else:
            st.update(last_result="error", last_error=detail,
                      permission_denied=status in ("오류403",) and "권한" in detail,
                      credits_exhausted=status in ("오류402", "오류429") or "사용량" in detail or "크레딧" in detail)
    print(f"[API] {entry['time']} {service:<7} {label:<40} {status:<6} {ms:>5}ms"
          + (f"  {units}유닛" if units else "") + (f"  {detail}" if detail else ""), flush=True)


def _request(method, url, headers=None, body=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method, headers={"Accept": "application/json", **(headers or {})})
    if data is not None:
        req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT) as res:
            return res.status, json.loads(res.read().decode("utf-8") or "{}")
    except urllib.error.HTTPError as e:
        try:
            payload = json.loads(e.read().decode("utf-8") or "{}")
        except Exception:
            payload = {}
        return e.code, payload
    except urllib.error.URLError as e:
        raise ApiError(f"인터넷 연결 또는 회사 방화벽 때문에 서버에 닿지 못했어요 ({e.reason})")
    except TimeoutError:
        raise ApiError("응답이 너무 늦어 중단했어요. 잠시 후 다시 시도하세요")
    except (ConnectionError, OSError) as e:
        raise ApiError(f"서버 연결이 끊겼어요. 잠시 후 다시 시도하세요 ({type(e).__name__})")
    except ValueError:
        raise ApiError("서버가 알아볼 수 없는 응답을 보냈어요. 잠시 후 다시 시도하세요")


def call_log():
    return list(CALL_LOG)


def status():
    yk = _env("YOUTUBE_API_KEY")
    pid, psec = _env("PHYLLO_CLIENT_ID"), _env("PHYLLO_CLIENT_SECRET")
    env = (_env("PHYLLO_ENV", "sandbox") or "sandbox").lower()
    if _QUOTA["date"] != _pacific_today():
        _QUOTA.update(date=_pacific_today(), units=0)
    return {
        "youtube": {"configured": bool(yk), "key_hint": _mask(yk), "units_used": _QUOTA["units"], "daily_limit": 10000},
        "phyllo": {"configured": bool(pid and psec), "env": env, "env_ok": env in PHYLLO_BASE, "id_hint": _mask(pid),
                   "base_url": PHYLLO_BASE.get(env, "")},
        "modash": {"configured": bool(_env("MODASH_API_KEY")), "key_hint": _mask(_env("MODASH_API_KEY")), "env": "production"},
        "hypeauditor": {"configured": bool(_env("HYPEAUDITOR_CLIENT_ID") and _env("HYPEAUDITOR_API_TOKEN")),
                        "id_hint": _mask(_env("HYPEAUDITOR_CLIENT_ID")),
                        "env": "sandbox" if _hype_sandbox() else "production"},
        "tiktok_one": {"configured": False, "api_available": False,
                       "note": "일반 광고주용 크리에이터 검색 API 권한이 확인되지 않아 API 연동 없음. 화면 연계(이동·기준 복사·직접 입력·CSV) 사용"},
        "services": {k: dict(v) for k, v in SERVICE_STATE.items()},
        "log": call_log(),
    }


# ---------------------------------------------------------------- YouTube
def _yt_error(code, payload):
    err = (payload or {}).get("error") or {}
    reasons = {e.get("reason") for e in err.get("errors") or [] if isinstance(e, dict)}
    for d in err.get("details") or []:
        if isinstance(d, dict) and d.get("reason"):
            reasons.add(d["reason"])
    msg = err.get("message", "")
    if reasons & {"keyInvalid", "API_KEY_INVALID", "badRequest"} and "key" in msg.lower():
        return "API 키가 올바르지 않아요. Google Cloud 콘솔의 키를 다시 복사해 넣으세요"
    if reasons & {"quotaExceeded", "dailyLimitExceeded", "rateLimitExceeded"}:
        return "오늘 사용량(기본 10,000 유닛)을 다 썼어요. 한국 시간 오후 4~5시(미국 태평양 자정)에 초기화돼요"
    if reasons & {"accessNotConfigured", "SERVICE_DISABLED"}:
        return "이 키의 Google Cloud 프로젝트에서 'YouTube Data API v3'가 사용 설정되지 않았어요"
    if reasons & {"ipRefererBlocked", "API_KEY_HTTP_REFERRER_BLOCKED", "API_KEY_IP_ADDRESS_BLOCKED"} or "referer" in msg.lower() or "blocked" in msg.lower():
        return "키의 '사용 제한' 설정 때문에 막혔어요. 서버에서 쓰는 키는 'HTTP 리퍼러' 제한을 걸면 안 돼요 (IP 주소 제한 또는 없음 + API 제한: YouTube Data API v3)"
    return f"YouTube API 오류 {code}: {msg or '알 수 없는 오류'}"


def _yt(resource, params, label=None):
    key = _env("YOUTUBE_API_KEY")
    if not key:
        raise ApiError("YOUTUBE_API_KEY가 설정되지 않았어요")
    url = YT_BASE + resource + "?" + urllib.parse.urlencode({**params, "key": key})
    units = YT_COST.get(resource, 1)
    t0 = time.time()
    code, payload = _request("GET", url)
    ms = int((time.time() - t0) * 1000)
    if _QUOTA["date"] != _pacific_today():
        _QUOTA.update(date=_pacific_today(), units=0)
    _QUOTA["units"] += units  # 실패한 요청도 최소 1유닛 차감됨
    if code != 200:
        msg = _yt_error(code, payload)
        _log("YouTube", label or resource, f"오류{code}", ms, units, msg)
        raise ApiError(msg)
    _log("YouTube", label or resource, "성공", ms, units)
    return payload


def parse_youtube_ref(text):
    """채널 주소·핸들·채널 ID를 channels.list 조건으로 바꿉니다."""
    s = (text or "").strip()
    if not s:
        raise ApiError("유튜브 채널 주소나 @핸들을 입력하세요")
    m = re.search(r"(UC[\w-]{22})", s)
    if m:
        return {"id": m.group(1)}
    m = re.search(r"youtube\.com/@([^/?#\s]+)", s) or re.match(r"^@([^/?#\s]+)$", s)
    if m:
        return {"forHandle": "@" + urllib.parse.unquote(m.group(1))}
    m = re.search(r"youtube\.com/user/([^/?#\s]+)", s)
    if m:
        return {"forUsername": m.group(1)}
    if re.search(r"youtube\.com/(c/|watch|shorts/)", s):
        raise ApiError("이 주소 형식은 채널을 바로 찾을 수 없어요. 채널 페이지의 @핸들 주소(youtube.com/@이름)를 넣어 주세요")
    if re.match(r"^[\w.\-]{3,}$", s):
        return {"forHandle": "@" + s}
    raise ApiError("유튜브 채널 주소 형식을 알아보지 못했어요. 예: https://www.youtube.com/@채널이름")


def _iso_duration_seconds(d):
    m = re.match(r"P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?", d or "")
    if not m:
        return 0
    days, h, mi, s = (int(x or 0) for x in m.groups())
    return days * 86400 + h * 3600 + mi * 60 + s


def youtube_channel(ref, recent=15):
    """채널 정보 + 최근 영상 조회수 중앙값. 약 3유닛."""
    cond = parse_youtube_ref(ref)
    data = _yt("channels", {"part": "snippet,statistics,contentDetails", **cond}, "channels.list " + list(cond.values())[0])
    items = data.get("items") or []
    if not items:
        raise ApiError("채널을 찾지 못했어요. @핸들 철자를 확인하세요")
    ch = items[0]
    st, sn = ch.get("statistics") or {}, ch.get("snippet") or {}
    uploads = ((ch.get("contentDetails") or {}).get("relatedPlaylists") or {}).get("uploads")
    result = {
        "channel_id": ch.get("id"), "title": sn.get("title", ""), "handle": sn.get("customUrl", ""), "country": sn.get("country", ""),
        "url": f"https://www.youtube.com/channel/{ch.get('id')}",
        "subscribers": None if st.get("hiddenSubscriberCount") else int(st.get("subscriberCount", 0) or 0),
        "subscribers_hidden": bool(st.get("hiddenSubscriberCount")),
        "total_views": int(st.get("viewCount", 0) or 0), "video_count": int(st.get("videoCount", 0) or 0),
        "median_views": None, "videos_used": 0, "note": "",
        "er": None, "er_videos": 0,  # 참여율(%) = 최근 영상 (좋아요+댓글)÷조회수의 중앙값. 공식 API 값으로 계산한 추정치
    }
    if not uploads or not result["video_count"]:
        result["note"] = "공개 영상이 없어 조회수 중앙값을 계산하지 못했어요"
        return result
    pl = _yt("playlistItems", {"part": "contentDetails", "playlistId": uploads, "maxResults": 25}, "playlistItems.list 최근 영상")
    ids = [it["contentDetails"]["videoId"] for it in pl.get("items") or [] if it.get("contentDetails", {}).get("videoId")]
    if not ids:
        result["note"] = "최근 영상 목록이 비어 있어요"
        return result
    vids = _yt("videos", {"part": "statistics,contentDetails,snippet", "id": ",".join(ids[:25])}, f"videos.list {len(ids[:25])}개")
    cutoff = datetime.now(timezone.utc) - timedelta(days=3)
    views, ers = [], []
    for v in vids.get("items") or []:
        sn_v, st_v = v.get("snippet") or {}, v.get("statistics") or {}
        if sn_v.get("liveBroadcastContent") in ("live", "upcoming") or "viewCount" not in st_v:
            continue
        try:
            published = datetime.fromisoformat(sn_v.get("publishedAt", "").replace("Z", "+00:00"))
            if published > cutoff:
                continue  # 올라온 지 3일 안 된 영상은 조회수가 아직 쌓이는 중이라 제외
        except ValueError:
            pass
        views.append(int(st_v["viewCount"]))
        if int(st_v["viewCount"]) > 0 and "likeCount" in st_v:  # 좋아요 수를 숨긴 영상은 참여율 계산에서 제외
            ers.append((int(st_v.get("likeCount") or 0) + int(st_v.get("commentCount") or 0)) / int(st_v["viewCount"]) * 100)
        if len(views) >= recent:
            break
    if views:
        result["median_views"] = int(statistics.median(views))
        result["videos_used"] = len(views)
        result["note"] = f"최근 영상 {len(views)}개 조회수 중앙값 (올라온 지 3일 안 된 영상·라이브 제외). 광고 영상 여부는 구분하지 못해요"
    if ers:
        result["er"] = round(statistics.median(ers), 2)
        result["er_videos"] = len(ers)
    return result


def youtube_search(query, max_results=15, region="VN", lang="vi"):
    """채널 검색 + 구독자 수. 기본은 베트남 지역·베트남어 (한국인 대상은 region="KR", lang="ko"). 약 101유닛."""
    q = (query or "").strip()
    if not q:
        raise ApiError("검색어를 입력하세요. 예: review bánh Hàn Quốc")
    data = _yt("search", {"part": "snippet", "type": "channel", "q": q, "regionCode": region or "VN", "relevanceLanguage": lang or "vi",
                          "maxResults": max(1, min(int(max_results), 25))}, f"search.list \"{q[:20]}\"")
    ids = [it["id"]["channelId"] for it in data.get("items") or [] if (it.get("id") or {}).get("channelId")]
    if not ids:
        return []
    chs = _yt("channels", {"part": "snippet,statistics", "id": ",".join(ids)}, f"channels.list {len(ids)}개")
    out = []
    for ch in chs.get("items") or []:
        st, sn = ch.get("statistics") or {}, ch.get("snippet") or {}
        out.append({"channel_id": ch.get("id"), "title": sn.get("title", ""), "handle": sn.get("customUrl", ""),
                    "country": sn.get("country", ""), "description": (sn.get("description") or "")[:140],
                    "url": f"https://www.youtube.com/channel/{ch.get('id')}",
                    "subscribers": None if st.get("hiddenSubscriberCount") else int(st.get("subscriberCount", 0) or 0),
                    "total_views": int(st.get("viewCount", 0) or 0), "video_count": int(st.get("videoCount", 0) or 0)})
    order = {cid: i for i, cid in enumerate(ids)}
    return sorted(out, key=lambda x: order.get(x["channel_id"], 99))


def youtube_channels_stats(ids):
    """채널 ID 목록 → {id: 채널 정보}. 50개씩 나눠 조회 (50개당 1유닛)."""
    out, ids = {}, [i for i in dict.fromkeys(ids) if i]
    for n in range(0, len(ids), 50):
        part = ids[n:n + 50]
        chs = _yt("channels", {"part": "snippet,statistics", "id": ",".join(part)}, f"channels.list {len(part)}개")
        for ch in chs.get("items") or []:
            st, sn = ch.get("statistics") or {}, ch.get("snippet") or {}
            out[ch.get("id")] = {"channel_id": ch.get("id"), "title": sn.get("title", ""), "handle": sn.get("customUrl", ""),
                                 "country": sn.get("country", ""), "url": f"https://www.youtube.com/channel/{ch.get('id')}",
                                 "subscribers": None if st.get("hiddenSubscriberCount") else int(st.get("subscriberCount", 0) or 0),
                                 "total_views": int(st.get("viewCount", 0) or 0), "video_count": int(st.get("videoCount", 0) or 0)}
    return out


def youtube_popular_videos(region="VN", total=50):
    """YouTube 공식 인기 차트(videos.list chart=mostPopular). 지역별 최대 200개, 50개당 1유닛."""
    total = max(1, min(int(total), 200))
    items, token = [], None
    while len(items) < total:
        params = {"part": "snippet,statistics", "chart": "mostPopular", "regionCode": region, "maxResults": min(50, total - len(items))}
        if token:
            params["pageToken"] = token
        data = _yt("videos", params, f"videos.list 인기 차트 {region}")
        for v in data.get("items") or []:
            sn, st = v.get("snippet") or {}, v.get("statistics") or {}
            items.append({"video_id": v.get("id"), "title": sn.get("title", ""), "channel_id": sn.get("channelId", ""),
                          "channel_title": sn.get("channelTitle", ""), "published_at": (sn.get("publishedAt") or "")[:10],
                          "category_id": str(sn.get("categoryId") or ""), "tags": (sn.get("tags") or [])[:30],
                          "description": (sn.get("description") or "")[:300],
                          "views": int(st["viewCount"]) if st.get("viewCount") else None,
                          "likes": int(st["likeCount"]) if st.get("likeCount") else None,
                          "comments": int(st["commentCount"]) if st.get("commentCount") else None,
                          "url": f"https://www.youtube.com/watch?v={v.get('id')}"})
        token = data.get("nextPageToken")
        if not token or not data.get("items"):
            break
    return items[:total]


def youtube_search_channels(query, total=50, region="VN", lang="vi"):
    """키워드로 채널을 모음 (기본 베트남 지역·베트남어, 검색 1페이지=100유닛, 최대 50개). 구독자 수 포함."""
    q = (query or "").strip()
    if not q:
        raise ApiError("검색어를 입력하세요. 예: mukbang")
    total = max(1, min(int(total), 100))
    ids, token = [], None
    while len(ids) < total:
        params = {"part": "snippet", "type": "channel", "q": q, "regionCode": region or "VN", "relevanceLanguage": lang or "vi", "maxResults": 50}
        if token:
            params["pageToken"] = token
        data = _yt("search", params, f"search.list \"{q[:20]}\"")
        ids += [it["id"]["channelId"] for it in data.get("items") or [] if (it.get("id") or {}).get("channelId")]
        token = data.get("nextPageToken")
        if not token or not data.get("items"):
            break
    return list(youtube_channels_stats(ids[:total]).values())


def youtube_test():
    """키 확인용: 유튜브 공식 채널(@YouTube) 1건 조회. 1유닛."""
    data = _yt("channels", {"part": "snippet,statistics", "forHandle": "@YouTube"}, "연결 확인: channels.list @YouTube")
    items = data.get("items") or []
    if not items:
        raise ApiError("응답은 왔지만 채널 정보가 비어 있어요")
    st = items[0].get("statistics") or {}
    return {"ok": True, "message": f"연결됐어요. 시험 조회: {items[0]['snippet']['title']} 구독자 {int(st.get('subscriberCount', 0)):,}명"}


# ---------------------------------------------------------------- Phyllo
def _phyllo(method, path, body=None, label=None):
    pid, psec = _env("PHYLLO_CLIENT_ID"), _env("PHYLLO_CLIENT_SECRET")
    if not (pid and psec):
        raise ApiError("PHYLLO_CLIENT_ID 또는 PHYLLO_CLIENT_SECRET이 설정되지 않았어요")
    env = (_env("PHYLLO_ENV", "sandbox") or "sandbox").lower()
    if env not in PHYLLO_BASE:
        raise ApiError("PHYLLO_ENV는 sandbox, staging, production 중 하나여야 해요")
    token = base64.b64encode(f"{pid}:{psec}".encode()).decode()
    t0 = time.time()
    code, payload = _request(method, PHYLLO_BASE[env] + path, {"Authorization": "Basic " + token}, body)
    ms = int((time.time() - t0) * 1000)
    if code >= 400:
        err = (payload or {}).get("error") or payload or {}
        text = (err.get("message") or err.get("description") or err.get("error_code") or "") if isinstance(err, dict) else str(err)
        if code == 401:
            msg = f"Client ID/Secret이 틀렸거나, 키의 환경과 PHYLLO_ENV({env})가 달라요. 대시보드에서 키가 어느 환경용인지 확인하세요"
        elif code == 403:
            msg = "이 키의 요금제·권한으로는 이 기능을 쓸 수 없어요. Phyllo(InsightIQ) 영업팀에 공개 프로필 분석 권한을 문의하세요"
        elif code == 404:
            msg = "대상을 찾지 못했거나, 이 환경에서 제공하지 않는 기능이에요"
        elif code == 429:
            msg = "짧은 시간에 요청이 너무 많아요. 잠시 후 다시 시도하세요"
        else:
            msg = f"Phyllo 오류 {code}"
        if text:
            msg += f" (서버 메시지: {str(text)[:120]})"
        _log("Phyllo", label or path, f"오류{code}", ms, 0, msg)
        raise ApiError(msg)
    _log("Phyllo", label or path, "성공", ms)
    return payload


def phyllo_platforms():
    data = _phyllo("GET", "/v1/work-platforms?limit=100", label="GET /v1/work-platforms")
    return [{"id": p.get("id"), "name": p.get("name"), "category": p.get("category")} for p in data.get("data") or []]


def phyllo_test():
    plats = phyllo_platforms()
    names = ", ".join(sorted({p["name"] for p in plats if p.get("name")})[:12])
    env = (_env("PHYLLO_ENV", "sandbox") or "sandbox").lower()
    return {"ok": True, "message": f"연결됐어요 ({env}). 지원 플랫폼 {len(plats)}개: {names}"}


def _find_number(obj, keys, depth=0):
    """응답 구조가 요금제·버전마다 조금씩 달라서, 이름으로 숫자 필드를 찾아냅니다."""
    if depth > 5:
        return None
    if isinstance(obj, dict):
        for k in keys:
            v = obj.get(k)
            if isinstance(v, dict) and isinstance(v.get("value"), (int, float)) and not isinstance(v.get("value"), bool):
                v = v["value"]  # {"value": 123} 형태
            if isinstance(v, (int, float)) and not isinstance(v, bool):
                return v
        for v in obj.values():
            found = _find_number(v, keys, depth + 1)
            if found is not None:
                return found
    elif isinstance(obj, list):
        for v in obj[:5]:
            found = _find_number(v, keys, depth + 1)
            if found is not None:
                return found
    return None


def _handle_from(text, platform):
    s = (text or "").strip()
    pats = {"tt": r"tiktok\.com/@([^/?#\s]+)", "ig": r"instagram\.com/([^/?#\s]+)", "yt": r"youtube\.com/@([^/?#\s]+)",
            "fb": r"facebook\.com/([^/?#\s]+)"}
    m = re.search(pats.get(platform, r"$^"), s)
    if m:
        return m.group(1).strip("@")
    return s.lstrip("@")


def phyllo_profile(platform, ref):
    """공개 프로필 분석 (동의 없이 공개 데이터). 요금제에 따라 403이 나올 수 있어요."""
    if platform not in PHYLLO_PLATFORM_NAMES:
        raise ApiError("지원하지 않는 플랫폼이에요")
    handle = _handle_from(ref, platform)
    if not handle:
        raise ApiError("채널 주소나 @핸들을 입력하세요")
    want = PHYLLO_PLATFORM_NAMES[platform].lower()
    plats = phyllo_platforms()
    wp = next((p for p in plats if (p.get("name") or "").lower() == want), None)
    if not wp:
        raise ApiError(f"이 환경에서는 {PHYLLO_PLATFORM_NAMES[platform]}를 지원하지 않아요")
    data = _phyllo("POST", "/v1/social/creator-profile/analytics", {"identifier": handle, "work_platform_id": wp["id"]},
                   label=f"POST 공개 프로필 분석 {PHYLLO_PLATFORM_NAMES[platform]} @{handle}")
    profile = data.get("profile") if isinstance(data.get("profile"), dict) else data
    followers = _find_number(profile, ["follower_count", "followers_count", "subscriber_count"])
    median = _find_number(profile, ["median_views"])
    avg = _find_number(profile, ["average_views", "avg_views", "average_reels_views"])
    er = _find_number(profile, ["engagement_rate"])
    return {"platform": platform, "handle": handle, "followers": int(followers) if followers is not None else None,
            "median_views": int(median) if median is not None else None,  # 중앙값을 준 경우에만 채움
            "avg_views": int(avg) if avg is not None else None, "engagement_rate": er,
            "fields": sorted(profile.keys())[:30] if isinstance(profile, dict) else [],
            "note": "Phyllo가 준 값은 평균 조회수예요. 중앙값 칸에는 넣지 않고 '평균 조회수'로 따로 저장해요" if median is None and avg is not None else ""}



# ---------------------------------------------------------------- Modash (Discovery API)
def _modash(method, path, body=None, label=None, params=None):
    key = _env("MODASH_API_KEY")
    if not key:
        raise ApiError("MODASH_API_KEY가 설정되지 않았어요")
    url = MODASH_BASE + path + ("?" + urllib.parse.urlencode(params) if params else "")
    t0 = time.time()
    code, payload = _request(method, url, {"Authorization": "Bearer " + key}, body)
    ms = int((time.time() - t0) * 1000)
    if code >= 400 or (isinstance(payload, dict) and payload.get("error") is True):
        text = ""
        if isinstance(payload, dict):
            text = str(payload.get("message") or payload.get("code") or "")[:120]
        if code == 401:
            msg = "Modash API 키가 올바르지 않아요. Developer Portal에서 키를 다시 복사하세요"
        elif code == 403:
            msg = "이 Modash 계정의 요금제·권한으로는 이 API를 쓸 수 없어요 (Discovery API 별도 계약 필요)"
        elif code == 402 or "credit" in text.lower():
            msg = "Modash 크레딧이 부족해요. 남은 크레딧은 [연결 여부 확인] 탭에서 확인하세요"
        elif code == 429:
            msg = "짧은 시간에 요청이 너무 많아요. 잠시 후 다시 시도하세요"
        elif code == 404:
            msg = "대상을 찾지 못했어요"
        else:
            msg = f"Modash 오류 {code}"
        if text:
            msg += f" (서버 메시지: {text})"
        _log("Modash", label or path, f"오류{code}", ms, 0, msg)
        raise ApiError(msg)
    _log("Modash", label or path, "성공", ms)
    return payload


def modash_account():
    """남은 크레딧 확인 (GET /account). 응답 구조가 문서에 자세히 없어 숫자 필드를 찾아 보여 줍니다."""
    data = _modash("GET", "/account", label="GET /account (남은 크레딧)")
    credits = _find_number(data, ["credits", "remainingCredits", "discoveryCredits", "credits_left"])
    SERVICE_STATE["modash"]["credits"] = credits
    return {"credits": credits, "fields": sorted(data.keys())[:20] if isinstance(data, dict) else []}


def modash_test():
    acc = modash_account()
    c = f"남은 크레딧 {acc['credits']:,}" if isinstance(acc["credits"], (int, float)) else "크레딧 값은 응답에서 찾지 못했어요"
    return {"ok": True, "message": f"연결됐어요. {c}"}


_MODASH_LOC = {}


def _modash_location_id(mplat, country):
    key = (mplat, country.lower())
    if key not in _MODASH_LOC:
        data = _modash("GET", f"/{mplat}/locations", params={"query": country, "limit": 5}, label=f"GET /{mplat}/locations {country}")
        items = data.get("locations") if isinstance(data, dict) else None
        items = items if isinstance(items, list) else (data if isinstance(data, list) else [])
        _MODASH_LOC[key] = next((it.get("id") for it in items if isinstance(it, dict) and it.get("id") is not None), None)
    return _MODASH_LOC[key]


def modash_search(platform, f, page=0):
    """f: 표준 필터 dict. 응답의 InfluencerResponse 구조는 공개 문서에 상세하지 않아 이름으로 값을 찾습니다."""
    mplat = MODASH_PLATFORM.get(platform)
    if not mplat:
        raise ApiError("Modash는 TikTok·Instagram·YouTube만 지원해요")
    influencer = {}
    if f.get("min_followers") or f.get("max_followers"):
        influencer["followers"] = {k: v for k, v in (("min", f.get("min_followers")), ("max", f.get("max_followers"))) if v}
    if f.get("min_er"):
        influencer["engagementRate"] = float(f["min_er"]) / 100
    if f.get("min_views"):
        influencer["views"] = {"min": int(f["min_views"])}
    if f.get("language"):
        influencer["language"] = f["language"]
    loc_id = _modash_location_id(mplat, f.get("country") or "Vietnam") if f.get("country") else None
    audience = {}
    if loc_id is not None:
        influencer["location"] = [loc_id]
        if f.get("min_vn_audience"):
            audience["location"] = [{"id": loc_id, "weight": float(f["min_vn_audience"]) / 100}]
    body = {"page": int(page or 0), "calculationMethod": "median", "sort": {"field": "followers", "direction": "desc"},
            "filter": {"influencer": influencer, **({"audience": audience} if audience else {})}}
    data = _modash("POST", f"/{mplat}/search", body, label=f"POST /{mplat}/search")
    rows = []
    for it in (data.get("directs") or []) + (data.get("lookalikes") or []):
        prof = it.get("profile") if isinstance(it.get("profile"), dict) else it
        rows.append({
            "provider": "Modash", "source_type": "saas", "platform": platform,
            "handle": prof.get("username") or prof.get("handle") or "", "name": prof.get("fullname") or prof.get("username") or "",
            "url": prof.get("url") or "", "followers": _find_number(prof, ["followers"]),
            "median_views": _find_number(prof, ["averageViews", "avgViews", "views"]),  # calculationMethod=median 으로 요청
            "views_basis": "median (Modash calculationMethod=median)",
            "avg_views": None, "er": _pct(_find_number(prof, ["engagementRate"])),
            "vn_audience": None, "country": "", "language": "", "provider_id": str(it.get("userId") or prof.get("userId") or ""),
        })
    return rows, {"total": data.get("total"), "audience_filter_applied": bool(audience)}


# ---------------------------------------------------------------- HypeAuditor
def _hype_sandbox():
    return _env("HYPEAUDITOR_SANDBOX", "0").lower() in ("1", "true", "yes", "sandbox")


def _hype(method, endpoint, body=None, params=None, label=None):
    cid, tok = _env("HYPEAUDITOR_CLIENT_ID"), _env("HYPEAUDITOR_API_TOKEN")
    if not (cid and tok):
        raise ApiError("HYPEAUDITOR_CLIENT_ID 또는 HYPEAUDITOR_API_TOKEN이 설정되지 않았어요")
    url = HYPE_BASE + endpoint + "/" + ("?" + urllib.parse.urlencode(params) if params else "")
    t0 = time.time()
    code, payload = _request(method, url, {"X-Auth-Id": cid, "X-Auth-Token": tok}, body)
    ms = int((time.time() - t0) * 1000)
    left = _find_number(payload, ["queries_left", "restTokens"]) if isinstance(payload, (dict, list)) else None
    if left is not None:
        SERVICE_STATE["hypeauditor"]["credits"] = left
    if code == 202:
        msg = "HypeAuditor가 보고서를 만드는 중이에요. 잠시 후 다시 시도하세요"
        _log("HypeAuditor", label or endpoint, "대기202", ms, 0, msg)
        raise ApiError(msg)
    if code >= 400:
        err = payload.get("error") if isinstance(payload, dict) else None
        text = (err.get("description") or err.get("message") or "") if isinstance(err, dict) else str(err or "")
        msg = {402: "HypeAuditor 크레딧이 없거나 API 이용 기간이 끝났어요",
               403: "HypeAuditor 인증 실패 또는 권한 없음이에요. Client ID·토큰을 확인하세요 (비공개·게시물 없는 계정도 403)",
               404: "계정을 찾지 못했어요", 429: "짧은 시간에 요청이 너무 많아요. 잠시 후 다시 시도하세요",
               500: "HypeAuditor 서버가 일시적으로 응답하지 않아요. 잠시 후 다시 시도하세요"}.get(code, f"HypeAuditor 오류 {code}")
        if text:
            msg += f" (서버 메시지: {str(text)[:120]})"
        _log("HypeAuditor", label or endpoint, f"오류{code}", ms, 0, msg)
        raise ApiError(msg)
    _log("HypeAuditor", label or endpoint, "성공", ms)
    return payload


def _hype_search_body(platform, f, page=1):
    body = {"social_network": HYPE_PLATFORM[platform], "page": page}
    if f.get("country"):
        body["account_geo"] = {"country": [f.get("country_code") or "vn"]}
    if f.get("min_followers") or f.get("max_followers"):
        body["subscribers_count"] = {k: int(v) for k, v in (("from", f.get("min_followers")), ("to", f.get("max_followers"))) if v}
    if f.get("min_er"):
        body["er"] = {"from": float(f["min_er"])}
    if f.get("min_views"):
        body["views_avg"] = {"from": int(f["min_views"])}
    if f.get("language"):
        body["account_languages"] = [f["language"]]
    if f.get("min_vn_audience"):
        body["audience_geo"] = {"countries": [{"id": f.get("country_code") or "vn", "prc": int(f["min_vn_audience"])}]}
    return body


def hypeauditor_test():
    """연결 확인: 샌드박스 검색 1페이지 (문서상 샌드박스 경로). 크레딧 차감 여부는 공식 문서에 명시되지 않음."""
    data = _hype("POST", "auditor.searchSandbox", {"social_network": "instagram", "page": 1}, label="연결 확인: auditor.searchSandbox")
    left = SERVICE_STATE["hypeauditor"]["credits"]
    return {"ok": True, "message": "연결됐어요 (샌드박스 검색 응답 확인)" + (f". 남은 조회 {left:,}" if isinstance(left, (int, float)) else "")}


def hypeauditor_search(platform, f, page=1):
    if platform not in HYPE_PLATFORM:
        raise ApiError("HypeAuditor는 TikTok·Instagram·YouTube만 지원해요")
    endpoint = "auditor.searchSandbox" if _hype_sandbox() else "auditor.search"
    data = _hype("POST", endpoint, _hype_search_body(platform, f, page=page), label=f"POST {endpoint} {HYPE_PLATFORM[platform]}")
    result = data.get("result") if isinstance(data, dict) and isinstance(data.get("result"), dict) else data
    items = []
    for k in ("search_results", "items", "results", "data"):
        if isinstance(result, dict) and isinstance(result.get(k), list):
            items = result[k]
            break
    rows = []
    for it in items:
        basic = it.get("basic") if isinstance(it.get("basic"), dict) else it
        metrics = it.get("metrics") if isinstance(it.get("metrics"), dict) else it
        handle = basic.get("username") or basic.get("channel") or basic.get("title") or ""
        rows.append({
            "provider": "HypeAuditor" + (" (샌드박스)" if _hype_sandbox() else ""),
            "source_type": "demo" if _hype_sandbox() else "saas", "platform": platform, "handle": handle,
            "name": basic.get("title") or basic.get("full_name") or handle, "url": basic.get("url") or "",
            "followers": _find_number(metrics, ["subscribers_count", "followers_count", "followers"]),
            "median_views": None, "views_basis": "average (HypeAuditor views_avg)",
            "avg_views": _find_number(metrics, ["views_avg", "avg_views"]),
            "er": _find_number(metrics, ["er", "engagement_rate"]), "vn_audience": None, "country": "", "language": "",
            "provider_id": str(basic.get("id") or ""),
        })
    return rows, {"total": result.get("total") if isinstance(result, dict) else None, "sandbox": _hype_sandbox(),
                  "queries_left": SERVICE_STATE["hypeauditor"]["credits"]}


def _pct(v):
    """0~1 비율로 온 참여율을 % 숫자로. 이미 1보다 크면 %로 간주."""
    if v is None:
        return None
    return round(v * 100, 2) if v <= 1 else round(v, 2)
