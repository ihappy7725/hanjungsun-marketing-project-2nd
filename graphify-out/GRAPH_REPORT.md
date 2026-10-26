# Graph Report - Hanjeongseon  (2026-10-26)

## Corpus Check
- 212 files · ~907,380 words
- Verdict: corpus is large enough that graph structure adds value.
- Unclassified: 26 file(s) not represented in the graph (top: .css 11, (none) 7, .csv 7)

## Summary
- 2035 nodes · 4458 edges · 101 communities (84 shown, 17 thin omitted)
- Extraction: 95% EXTRACTED · 5% INFERRED · 0% AMBIGUOUS · INFERRED: 211 edges (avg confidence: 0.9)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `33260c82`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- sns_editor.js
- initialize
- sns.js
- external_api.py
- routes_sns.py
- videos.py
- kpi_main.js
- market_analysis_main.js
- influencer_main.js
- trends.js
- event_import.py
- kpi/routes.py
- 국가·문화 탭 — 베트남
- designs.py
- 콘텐츠 스튜디오
- influencer_marketing/routes.py
- discovery.py
- list_influencers
- routes_media.py
- TrendRepository
- trend_service.py
- influencer_marketing/models.py
- higgsfield.py
- datetime
- candidate_service.py
- news_search.py
- home/README.md — 한정선 다낭 마케팅 HOME
- flask
- serpapi_trends_collector.py
- cli.py
- today_str
- _lines
- SnsDesign
- _WorkInputError
- build_competitors.py
- CalculationTests
- 현지 시장 분석 (market_analysis) 기능 설계안
- TrendCollectionService
- trend_period
- home/routes.py
- post_message
- get_events
- get
- market_analysis/routes.py
- insight_service.py
- HOME 탭 사용 설명
- 로컬 Flask HOME 구현 메모 (2026-10-23)
- 인플루언서 마케팅 — 한정선 베트남 크리에이터 협업 관리
- 한정선 베트남 마케팅 대시보드
- json
- code.js
- 2. 5대 핵심 구성요소 상세 정의 및 적용 수식
- TrendService
- holiday_feed.py
- _call_ai
- design_assistant
- manifest.json
- translate.py
- Checker
- AI 작업 규칙
- home/models.py
- 다음 작업 (2026-10-26 기준)
- decision_cards.py
- 10. Git 협업 규칙
- 5. 폴더 구조와 파일별 수정 권한
- get_content_guidelines
- api_insight
- CandidateSuggestionService
- 3. 탭별 기능
- 한정선 베트남 마케팅 대시보드 AI 작업 규칙
- 6. 디자인 규격
- permissions
- csv
- signals
- InsightRuleTests
- build_cardnews_prompt
- _Article
- 10. 랜딩페이지·브랜드 이미지·모션
- 1순위 — 업무·이벤트 DB 저장 (화면 연결까지 구현 완료)
- 3. 트렌드 분석
- weekly_window
- CompetitorAnalysisTests
- 6. 디데이 업무 관리
- segment
- AdTrendCollector
- 11. 개발 순서와 실행 방법
- 7. 다른 탭에서 가져오는 핵심 신호
- DecisionCardTests
- 4. 6인 역할 분담
- 14. 현재 소스·경로·실행 방법
- 4. 통합 캘린더
- 7. URL·파일·환경변수
- classify
- _NoRedirect
- base.js
- CLAUDE.md
- influencer_marketing/README.md

## God Nodes (most connected - your core abstractions)
1. `initialize()` - 54 edges
2. `renderDesign()` - 41 edges
3. `TrendRepository` - 37 edges
4. `CalculationTests` - 34 edges
5. `mount()` - 28 edges
6. `ReviewError` - 25 edges
7. `renderVideo()` - 24 edges
8. `update()` - 23 edges
9. `home/README.md — 한정선 다낭 마케팅 HOME` - 23 edges
10. `post_message()` - 22 edges

## Surprising Connections (you probably didn't know these)
- `4. 코드 규칙 요약 (README 7·8장)` --references--> `button()`  [INFERRED]
  AGENTS.md → content_studio/static/js/sns_editor.js
- `템플릿과 디자인 이름 충돌 방지` --references--> `button()`  [INFERRED]
  README.md → content_studio/static/js/sns_editor.js
- `공통 키 규칙` --references--> `status()`  [INFERRED]
  README.md → influencer_marketing/external_api.py
- `② `ad_performance_daily` (일별 광고비 및 매출 내역)` --references--> `Influencer`  [INFERRED]
  kpi/README.md → influencer_marketing/models.py
- `① 마케팅 예산 트래킹 (Budget Tracking)` --references--> `get_quote_summary()`  [INFERRED]
  kpi/README.md → influencer_marketing/public.py

## Import Cycles
- 3-file cycle: `influencer_marketing/__init__.py -> influencer_marketing/routes.py -> influencer_marketing/discovery.py -> influencer_marketing/__init__.py`

## Communities (101 total, 17 thin omitted)

### Community 0 - "sns_editor.js"
Cohesion: 0.06
Nodes (80): button(), clamp(), contrastOf(), drawPage(), el(), EMOJIS, exportImage(), field() (+72 more)

### Community 1 - "initialize"
Cohesion: 0.08
Nodes (75): addDays(), badge(), blankStore(), CAMPAIGN_STATES, cloneTasks(), dayDiff(), dday(), demoStore() (+67 more)

### Community 2 - "sns.js"
Cohesion: 0.07
Nodes (70): addRef(), api(), applyState(), bindWork(), changeRefs(), changeSetting(), currentRefs(), daysUntil() (+62 more)

### Community 3 - "external_api.py"
Cohesion: 0.06
Nodes (42): apply_filters(), build_ranking(), collected_at(), is_food_video(), search(), _youtube_rows(), ApiError, call_log() (+34 more)

### Community 4 - "routes_sns.py"
Cohesion: 0.08
Nodes (42): SnsChat, 6. 영상 탭 (유진), 광고 표현 검수·숏폼 콘티 (희주, 📝), _chat_info(), _check_design(), _clean_ref_video(), create_chat(), _cuts() (+34 more)

### Community 5 - "videos.py"
Cohesion: 0.07
Nodes (30): add_scene(), _ai_text(), apply_ai(), _apply_ends(), build_prompt(), build_prompt_ko(), _duration(), _ends_of() (+22 more)

### Community 6 - "kpi_main.js"
Cohesion: 0.13
Nodes (47): addSimItem(), analyzeVoc(), API, badge(), chartNotice(), charts, cssVar(), doughnut() (+39 more)

### Community 7 - "market_analysis_main.js"
Cohesion: 0.11
Nodes (47): bars(), bindInsightForm(), categoryBody(), COLOR_SWATCH, CULTURE_IMG(), data, empty(), esc() (+39 more)

### Community 8 - "influencer_main.js"
Cohesion: 0.16
Nodes (45): api(), applySegment(), armButton(), bindKw(), buildTabs(), chart(), closeDrawer(), copyText() (+37 more)

### Community 9 - "trends.js"
Cohesion: 0.13
Nodes (42): adResearch(), badge(), barRows(), chips(), day(), emptyState(), esc(), expanded (+34 more)

### Community 10 - "event_import.py"
Cohesion: 0.13
Nodes (21): _atomic_write(), _candidate_document(), collect(), _confirm(), _government_host(), main(), _no_secrets(), _print() (+13 more)

### Community 11 - "kpi/routes.py"
Cohesion: 0.09
Nodes (26): api_simulator(), api_summary(), api_voc(), api_voc_analyze(), _build_ga4(), _build_summary(), _call_openai(), _ecos_rows() (+18 more)

### Community 12 - "국가·문화 탭 — 베트남"
Cohesion: 0.05
Nodes (37): 가격·구성, 경쟁제품 비교, 과일·얼음·토핑, 광고 운영 주의사항, 광고 표현 검수, 구현·검수 기준, 국가·문화 탭 — 베트남, 국가 상징·차별 표현 (+29 more)

### Community 13 - "designs.py"
Cohesion: 0.11
Nodes (24): _apply_palette(), _box(), _build_pages(), _cardnews_elements(), _checks_text(), _cover_content(), _doc_palette(), _find_color() (+16 more)

### Community 14 - "콘텐츠 스튜디오"
Cohesion: 0.05
Nodes (36): 10. 확정이 필요한 것, 11. 완료 기준, 1. 이 탭에서 하는 일, 2. 공통 기능 (유진), 3-1. 목적, 3-2. 흐름, 3-4. Figma 연동 방식, 3-5. 글꼴 (+28 more)

### Community 15 - "influencer_marketing/routes.py"
Cohesion: 0.12
Nodes (25): get_influencer(), save_influencer(), api_delete_reply(), api_discovery_fill(), api_discovery_ranking(), api_discovery_register(), api_discovery_search(), api_hypeauditor_test() (+17 more)

### Community 16 - "discovery.py"
Cohesion: 0.10
Nodes (20): account_key(), _channel_row(), cleanse_file(), confidence_of(), decode_upload(), detect_platform(), existing_keys(), _guess_field() (+12 more)

### Community 17 - "list_influencers"
Cohesion: 0.12
Nodes (23): 4. 이 프로젝트에서 재사용할 기존 기능, 12. 팀원 역할과 원본 책임, 7.1 인플루언서 → 협업 요약, list_influencers(), list_quotes(), get_collaborations(), get_quote_summary(), get_today_tasks() (+15 more)

### Community 18 - "routes_media.py"
Cohesion: 0.17
Nodes (21): _api_json(), cardnews_prompt(), _error(), _export_dir(), figma_design(), figma_design_link(), figma_designs(), figma_image() (+13 more)

### Community 19 - "TrendRepository"
Cohesion: 0.10
Nodes (4): TrendRepository, SeasonalityLocaleTests, fetch(), IntegrationTests

### Community 20 - "trend_service.py"
Cohesion: 0.09
Nodes (10): combine_regions(), duration_bucket(), monthly_seasonality(), parse_regions(), parse_related(), parse_related_topics(), peak_months(), round1() (+2 more)

### Community 21 - "influencer_marketing/models.py"
Cohesion: 0.09
Nodes (16): add_snapshot(), clear_demo(), delete_influencer(), delete_quote(), Influencer, list_snapshots(), MetricSnapshot, _now() (+8 more)

### Community 22 - "higgsfield.py"
Cohesion: 0.12
Nodes (11): balance(), _binary(), cost(), create(), get_job(), HiggsfieldError, _job(), _latest_job() (+3 more)

### Community 24 - "candidate_service.py"
Cohesion: 0.11
Nodes (9): exclusion_reason(), plain(), related_candidates(), reason(), related_value(), food_related(), queries(), rising_products() (+1 more)

### Community 25 - "news_search.py"
Cohesion: 0.13
Nodes (12): _feed(), _google(), _item(), _merge(), _preset(), _published(), _safe_url(), search() (+4 more)

### Community 26 - "home/README.md — 한정선 다낭 마케팅 HOME"
Cohesion: 0.08
Nodes (25): 11.1 예시와 실제 업무의 분리, 11.2 날짜와 마감, 11.3 저장 위치와 연결의 실제 범위, 11.4 기존 기록 처리, 11. 데이터 모드·시간·저장 규칙, 1. HOME을 한 문장으로 설명하면, 1분 설명, 2. 처음 아이디어에서 무엇이 구체화되었나 (+17 more)

### Community 27 - "flask"
Cohesion: 0.09
Nodes (4): KpiAdPerformanceDaily, KpiMarketingBudget, KpiVocReview, inject_nav_menus()

### Community 28 - "serpapi_trends_collector.py"
Cohesion: 0.13
Nodes (10): expected_calls(), main(), load_api_key(), SerpApiError, SerpApiTrendsCollector, main(), print_bundle_check(), print_related_check() (+2 more)

### Community 29 - "cli.py"
Cohesion: 0.16
Nodes (10): event_collect(), event_register(), event_stage(), holidays_sync(), run(), news_fetch(), news_register(), news_stage() (+2 more)

### Community 30 - "today_str"
Cohesion: 0.15
Nodes (16): segment_name(), source_type_of(), api_discovery_import_csv(), api_save_quote(), api_save_settings(), api_youtube_refresh_all(), _clean_channel_extra(), clean_influencer() (+8 more)

### Community 31 - "_lines"
Cohesion: 0.11
Nodes (12): image_args(), image_prompt(), _action(), _extra(), _filling(), _ko_phrases(), _lines(), _lineup() (+4 more)

### Community 32 - "SnsDesign"
Cohesion: 0.09
Nodes (5): SnsCreditLog, SnsDesign, SnsMessage, _log_credits(), _submitted()

### Community 33 - "_WorkInputError"
Cohesion: 0.15
Nodes (11): index(), _migration_records(), _store_signer(), update_work_record(), _work_api(), _work_body(), _work_model(), work_records() (+3 more)

### Community 34 - "build_competitors.py"
Cohesion: 0.16
Nodes (15): build_legacy(), build_records(), download_images(), existing_image_metadata(), first_value(), int_text(), local_image_metadata(), main() (+7 more)

### Community 35 - "CalculationTests"
Cohesion: 0.19
Nodes (7): change_rate(), parse_timeseries(), trend_stats(), CalculationTests, fetch(), fetch(), timeline()

### Community 36 - "현지 시장 분석 (market_analysis) 기능 설계안"
Cohesion: 0.10
Nodes (20): 10. 미정 · 확인 필요, 11. 이번 범위에서 뺀 것, 1. 개요, 2. 공통: 국가 선택 바, 4. 경쟁사 분석, 6. AI 인사이트, 7. 데이터 출처 · 수집 주기 요약, 8. 다른 탭과의 연결 (`public.py`) (+12 more)

### Community 37 - "TrendCollectionService"
Cohesion: 0.10
Nodes (3): now_vn(), TrendCollectionService, get_keywords()

### Community 38 - "trend_period"
Cohesion: 0.13
Nodes (4): anchor_batches(), anchor_scale(), trend_period(), trends_url()

### Community 39 - "home/routes.py"
Cohesion: 0.17
Nodes (9): migration_commit(), _migration_comparison(), _migration_digest(), _migration_json(), migration_preview(), _migration_signer(), _store_snapshot(), _work_fields() (+1 more)

### Community 40 - "post_message"
Cohesion: 0.10
Nodes (10): revise_design(), get_product(), 3-3. 기능별 상태, _clean_photo(), _clean_title(), _clean_upload(), _find_products(), post_message() (+2 more)

### Community 41 - "get_events"
Cohesion: 0.12
Nodes (18): 15. 남은 작업과 팀에서 결정할 것, 9. 지금까지 논의한 아이디어 전체 목록과 처리 방향, C.1 이 문서에서 고친 것, C.2 팀 전체 README에 반영을 요청할 것 (PM2 유진에게), C.3 팀 README와 맞춰 두되 HOME 결정이 유지되는 것, HOME 날짜·뉴스 담당 변경 및 실제 일정 연결 (2026-10-24), 부록 C. 팀 전체 README 대조 결과 (2026-10-23), 사람이 해야 하는 것 (도구가 대신하지 못함) (+10 more)

### Community 42 - "get"
Cohesion: 0.13
Nodes (15): providers(), ranking_kinds(), get_setting(), api_campaign_presets(), api_discovery_providers(), api_discovery_ranking_get(), api_integrations_status(), calendar_events() (+7 more)

### Community 43 - "market_analysis/routes.py"
Cohesion: 0.19
Nodes (14): _file_date(), _load_fruit(), _load_geo(), _load_rising(), _load_seasonality(), _load_timeline(), _load_trend(), item() (+6 more)

### Community 44 - "insight_service.py"
Cohesion: 0.16
Nodes (10): build_evidence(), call_openai(), generate(), InsightError, _months_ahead(), months_steps(), _pct(), pick_fruits() (+2 more)

### Community 45 - "HOME 탭 사용 설명"
Cohesion: 0.11
Nodes (16): 10. 시연 순서 (5분), 1. 화면 구성, 2. 가장 많이 쓰는 흐름 — 이벤트 만들기, 3. 날마다 하는 일, 4. 캘린더 보는 법, 5. 현지 뉴스, 6. 보고서 뽑기, 7. 기록은 어디에 저장되나 (+8 more)

### Community 46 - "로컬 Flask HOME 구현 메모 (2026-10-23)"
Cohesion: 0.11
Nodes (17): 검증된 HOME 뉴스 연결 (2026-10-24), 과일 시즌의 월 단위 달력 표시 (2026-10-24), 기간 막대와 일일 업무 겹침 수정 (2026-10-25), 기간 막대와 일일 업무 겹침 재수정 (2026-10-25), 기간형 일정의 달력 표시 (2026-10-24), 뉴스 소유권 이관 요청 (2026-10-24, 미반영), 뉴스 처리 방식 재설계 (2026-10-25), 대시보드 화면 재구성 · 오늘의 해야 할 일 (2026-10-24) (+9 more)

### Community 47 - "인플루언서 마케팅 — 한정선 베트남 크리에이터 협업 관리"
Cohesion: 0.11
Nodes (17): 10. 확장 제안, 11. 시험 결과 (Ver_012, 2026-10-25), 12. 발표 시연 순서 (2026-10-28), 13. 버전 기록, 1. 기능 한눈에 보기, 2.1 기본 흐름, 2.2 API 키가 없을 때, 2.3 기념일 캠페인과 연결 (+9 more)

### Community 48 - "한정선 베트남 마케팅 대시보드"
Cohesion: 0.11
Nodes (18): 12. 기능 완료 기준, 1. 프로젝트 목표와 사용자, 2. 기술 선택: Flask + Blueprint, 3. 기능 범위, 7. Flask 연결 규칙, 9. 데이터 출처와 기준, URL과 Blueprint 이름, 공통 기준 (+10 more)

### Community 49 - "json"
Cohesion: 0.17
Nodes (5): create_app(), init_db_command(), deny(), main(), matches()

### Community 50 - "code.js"
Cohesion: 0.28
Nodes (15): FAMILY, familyOf(), fontFor(), frameLink(), importDesign(), loadedFonts, makeImage(), makePage() (+7 more)

### Community 51 - "2. 5대 핵심 구성요소 상세 정의 및 적용 수식"
Cohesion: 0.12
Nodes (15): ① `marketing_budget` (예산 및 환율 기준 테이블), ① 마케팅 예산 트래킹 (Budget Tracking), 1. 화면 레이아웃 아키텍처 (Wireframe), 2. 5대 핵심 구성요소 상세 정의 및 적용 수식, ② `ad_performance_daily` (일별 광고비 및 매출 내역), ② ROAS (광고비 대비 매출액, 알오에이에스 / 로아스), ③ VND - KRW 실시간 환율 및 환차손익 트래킹, ③ `voc_reviews` (현지 고객 반응 데이터) — 실제 테이블 이름 `kpi_voc_reviews` (+7 more)

### Community 53 - "holiday_feed.py"
Cohesion: 0.19
Nodes (7): _cache(), _culture_day(), _events(), _fetch(), _key(), provisional(), sync()

### Community 54 - "_call_ai"
Cohesion: 0.15
Nodes (7): _ai_take_turn(), _ai_translate(), _call_ai(), _openai_json(), ai_messages(), apply_translation(), translate_messages()

### Community 55 - "design_assistant"
Cohesion: 0.18
Nodes (8): build_design_brief(), design_proposal_schema(), _option_product(), validate_proposals(), design_assistant(), design_brief(), _design_request(), _media_body()

### Community 56 - "manifest.json"
Cohesion: 0.15
Nodes (12): api, documentAccess, editorType, enablePrivatePluginApi, id, main, name, networkAccess (+4 more)

### Community 57 - "translate.py"
Cohesion: 0.19
Nodes (6): preset_labels(), news_presets(), available(), _key(), _request(), translate_titles()

### Community 58 - "Checker"
Cohesion: 0.21
Nodes (7): 13.1 HOME이 읽는 공개 함수, 13.2 HOME 소유 모델, 13.3 파일·경로 (팀 README 5·7장 확정), 13. 최종 팀 개발용 인터페이스·모델 제안, Checker, _numbers(), validate()

### Community 59 - "AI 작업 규칙"
Cohesion: 0.18
Nodes (8): 0. 작업 전에 사용자 확인, 1. 보고 → 승인 → 수정 (가장 중요), 2. 하지 말 것, 3. Git, 4. 코드 규칙 요약 (README 7·8장), AI 작업 규칙, 체크 (README 12장), README

### Community 60 - "home/models.py"
Cohesion: 0.20
Nodes (5): HomeCampaign, HomeCampaignCollaborationLink, HomeSchedule, HomeTask, campaign_report()

### Community 61 - "다음 작업 (2026-10-26 기준)"
Cohesion: 0.17
Nodes (12): 2순위 — 다른 탭에 HOME 자료를 여는 `home/public.py`, 3순위 — 업무 범주 직접 지정, 4순위 — 외부 연동 보완, UI 정리 (2026-10-26), 기능 동결 (2026-10-26), 다음 작업 (2026-10-26 기준), 마무리 순서 — 기능·자료·연결을 끝낸 뒤 디자인, 문화의 날의 미래 달력 누락 보완 (+4 more)

### Community 62 - "decision_cards.py"
Cohesion: 0.26
Nodes (8): build_cards(), card_evidence(), channel_card(), flavor_card(), flavor_supply(), price_card(), _tokens(), _won()

### Community 63 - "10. Git 협업 규칙"
Cohesion: 0.17
Nodes (12): 10. Git 협업 규칙, PR과 머지, 개인 브랜치 규칙, 꿀팁: GitDiagram, 문서 수정 순서 (충돌 방지), 브랜치 구조, 연동 기능을 머지할 때, 충돌이 났을 때 (+4 more)

### Community 64 - "5. 폴더 구조와 파일별 수정 권한"
Cohesion: 0.17
Nodes (12): 5. 폴더 구조와 파일별 수정 권한, HOME (`home/`, 주연), KPI (`kpi/`, 민지), 각 기능 폴더의 내부 구조, 기능별로 만드는 파일, 이럴 땐 이렇게, 인플루언서 마케팅 (`influencer_marketing/`, 진혁), 전체 폴더 구조 (+4 more)

### Community 65 - "get_content_guidelines"
Cohesion: 0.25
Nodes (5): design_texts(), review_copy(), check_ad_copy(), get_content_guidelines(), _normalize()

### Community 66 - "api_insight"
Cohesion: 0.25
Nodes (8): api_dashboard(), api_insight(), build_dashboard(), _country_arg(), index(), _load_culture(), _readiness(), options()

### Community 67 - "CandidateSuggestionService"
Cohesion: 0.20
Nodes (3): CandidateSuggestionService, CheckTermsTests, fetch()

### Community 68 - "3. 탭별 기능"
Cohesion: 0.20
Nodes (10): 3.1 요약, 3.2 인플루언서, 3.3 발굴, 3.4 제안 메일, 3.5 회신 정리, 3.6 일정, 3.7 광고 단가, 3.8 내보내기 (+2 more)

### Community 69 - "한정선 베트남 마케팅 대시보드 AI 작업 규칙"
Cohesion: 0.22
Nodes (9): 1. 파일을 읽는 것과 바꾸는 것, 2. 기존 기능을 먼저 찾아 재사용, 3. 현재 폴더와 담당 범위, 5. 데이터·비밀 정보·설정, 6. Git 작업 경계, 7. 작업 시작·완료 보고, 쓰기 전 보고, 작업 후 보고 (+1 more)

### Community 70 - "6. 디자인 규격"
Cohesion: 0.22
Nodes (9): 6.1 브랜드 콘셉트·분위기, 6.2 레퍼런스, 6.3 색, 6.4 글꼴, 6.5 레이아웃·컴포넌트, 6.6 문구 톤, 6.7 적용 순서, 6.8 디자인에서 확정할 것 (+1 more)

### Community 71 - "permissions"
Cohesion: 0.25
Nodes (7): hooks, PreToolUse, permissions, ask, defaultMode, deny, $schema

### Community 72 - "csv"
Cohesion: 0.39
Nodes (4): _load_competitor_catalog(), _load_competitors(), _number(), _read_text()

### Community 73 - "signals"
Cohesion: 0.25
Nodes (5): _load_events(), signals(), collaborations(), events(), tasks()

### Community 75 - "build_cardnews_prompt"
Cohesion: 0.29
Nodes (4): build_cardnews_prompt(), _draft_lines(), _guideline_rules(), _page_content()

### Community 77 - "10. 랜딩페이지·브랜드 이미지·모션"
Cohesion: 0.29
Nodes (7): 10.1 디자인 기준과 현재 구성, 10.2 사진과 콘셉트 구분, 10.3 사진 모션, 10.4 베트남 → 다낭 지도 확대, 10.5 구매 안내의 한계, 10.6 팀 최종 버전에서 정할 것, 10. 랜딩페이지·브랜드 이미지·모션

### Community 78 - "1순위 — 업무·이벤트 DB 저장 (화면 연결까지 구현 완료)"
Cohesion: 0.29
Nodes (7): 1단계에서 정의한 저장 항목, 1순위 — 업무·이벤트 DB 저장 (화면 연결까지 구현 완료), 2단계: 서버 저장·조회 사용 방법, 3단계: 백업 파일에서 서버로 옮기기 (실제 이관 완료), 4단계: 내 업무 화면의 서버 저장 연결 (2026-10-26), 승인한 이관 원칙, product()

### Community 79 - "3. 트렌드 분석"
Cohesion: 0.29
Nodes (7): 3. 트렌드 분석, 구현 규칙, 데이터 출처, 제외한 항목, 카드 구성 (6개), 카드별 세부, 필터

### Community 82 - "6. 디데이 업무 관리"
Cohesion: 0.33
Nodes (6): 6.1 제목과 역할, 6.2 기본 마케팅 템플릿, 6.3 새 캠페인 만들기, 6.4 목표일 변경·복제·회고, 6.5 간트 차트 읽기, 6. 디데이 업무 관리

### Community 83 - "segment"
Cohesion: 0.33
Nodes (5): 3.3-1 타깃 그룹으로 찾기 (Ver_011), 6. 데이터 설계, 9. 팀원에게 요청할 사항, segment(), value()

### Community 85 - "11. 개발 순서와 실행 방법"
Cohesion: 0.33
Nodes (6): 11. 개발 순서와 실행 방법, 1단계 — 기반 준비, 2단계 — 독립 기능 개발, 3단계 — 연결 및 검증, 4단계 — 디자인 통일, 실행 명령 — Windows PowerShell

### Community 86 - "7. 다른 탭에서 가져오는 핵심 신호"
Cohesion: 0.40
Nodes (5): 7.2 현지조사 → 현지 기회, 7.3 현지조사 → 뉴스·트렌드, 7.4 KPI → 캠페인 한 줄 스냅샷, 7.5 시장점유율은 어디에 남아 있는가, 7. 다른 탭에서 가져오는 핵심 신호

### Community 88 - "4. 6인 역할 분담"
Cohesion: 0.40
Nodes (5): 4. 6인 역할 분담, PM1 — 코드 관리 담당 (상준), PM2 — 진행·Git 관리 담당 (유진), PM끼리의 규칙, 이름·브랜치 등록

### Community 89 - "14. 현재 소스·경로·실행 방법"
Cohesion: 0.50
Nodes (4): 14.1 실제 화면 경로, 14.2 주요 파일, 14.3 검사, 14. 현재 소스·경로·실행 방법

### Community 90 - "4. 통합 캘린더"
Cohesion: 0.50
Nodes (4): 4.1 무엇을 표시하는가, 4.2 사용 방법, 4.3 현재 없는 버튼, 4. 통합 캘린더

### Community 91 - "7. URL·파일·환경변수"
Cohesion: 0.50
Nodes (4): 7.1 요청 경로 (모두 `/influencer_marketing/` 아래), 7.2 파일, 7.3 환경변수 (`.env`, Git에 올리지 않음), 7. URL·파일·환경변수

## Knowledge Gaps
- **329 isolated node(s):** `$schema`, `defaultMode`, `ask`, `deny`, `PreToolUse` (+324 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 779 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **17 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `get_events()` connect `get_events` to `get_content_guidelines`, `콘텐츠 스튜디오`, `influencer_marketing/routes.py`, `list_influencers`, `segment`?**
  _High betweenness centrality (0.109) - this node is a cross-community bridge._
- **Are the 4 inferred relationships involving `renderDesign()` (e.g. with `7. 폴더 구조와 파일 주인` and `endAction()`) actually correct?**
  _`renderDesign()` has 4 INFERRED edges - model-reasoned connections that need verification._
- **What connects `$schema`, `defaultMode`, `ask` to the rest of the system?**
  _329 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `sns_editor.js` be split into smaller, more focused modules?**
  _Cohesion score 0.06183310533515732 - nodes in this community are weakly interconnected._
- **Why does `로컬 Flask HOME 구현 메모 (2026-10-23)` connect `로컬 Flask HOME 구현 메모 (2026-10-23)` to `get_events`, `home/README.md — 한정선 다낭 마케팅 HOME`, `classify`?**
  _High betweenness centrality (0.099) - this node is a cross-community bridge._
- **Are the 18 inferred relationships involving `TrendRepository` (e.g. with `main()` and `api_insight()`) actually correct?**
  _`TrendRepository` has 18 INFERRED edges - model-reasoned connections that need verification._
- **Should `initialize` be split into smaller, more focused modules?**
  _Cohesion score 0.07757221681272314 - nodes in this community are weakly interconnected._