# reference_data — [발굴] '조회할 곳'에 나오는 참고 자료 CSV

담당: 진혁 · 이 폴더의 파일은 진혁만 수정합니다.

## 이 폴더가 하는 일
- 여기에 넣은 CSV가 대시보드 **[발굴] → 조회할 곳**에 선택지로 나타납니다.
- [후보 검색]을 누르면 외부 사이트에 접속하지 않고 **이 파일만 읽어** 결과 표에 보여 줍니다.
- 주소를 모르는 계정도 등록할 수 있고 '주소 직접 확인 필요'로 표시됩니다. 결과마다 TikTok·Instagram·YouTube·Facebook·Google '직접 찾기' 링크가 붙습니다.
- `kind: "demo"`로 넣은 파일에서 등록한 계정은 **시연 데이터**로 저장됩니다.

## 지금 들어 있는 파일
| 파일 | 화면 이름 | 내용 |
| --- | --- | --- |
| `creator_list_vn.csv` | 베트남 크리에이터 목록(26/10/26 기준) · [발굴] 조회할 곳 | 456행 = NoxInfluencer 원본 287 + AI 조사(Claude 64 · Gemini 78 · GPT 27, 중복 21행 통합). 51열은 Ver_003과 같음. 대시보드 사용 기준과 출처는 아래 '베트남 크리에이터 목록' 절 |
| `Ver_003_real_verified.csv` | NoxInfluencer(26/10/24 기준 · 순위 갱신일, Ver_023에서 표기 통일) | 실존 계정 287개. 수치는 확인된 것만(대부분 공란). 분류·식품 관련성·순위 계정 동일 여부 포함 |

자세한 설명: Ver_003 데이터 패키지의 `README-DEMO-DATA.md`.

## 새 CSV를 넣는 방법
1. CSV를 이 폴더에 복사합니다 (UTF-8, 5MB 이하).
   - Ver_003 형식(`레코드 ID`·`분류` 열이 있는 파일) 또는 대시보드 '발굴 후보 CSV 양식'·SaaS 내보내기 파일 모두 읽습니다.
2. `sources.json`의 `sources` 목록에 한 덩어리를 추가합니다.
   ```json
   { "file": "새파일.csv", "label": "화면에 보일 이름", "note": "", "as_of": "2026-11-01", "detail": "", "kind": "real" }
   ```
   - `as_of`: 화면에 "(2026/11/01 기준)"으로 표시되는 기준일
   - `kind`: 실제 자료는 `real`, 발표용 가상 자료는 `demo`
   - 추가하지 않아도 파일 이름으로 나타나지만, 기준일이 '미기재'로 보입니다.
3. 대시보드를 새로고침(Ctrl+F5)합니다. 서버 재시작은 필요 없습니다.

## 주의
- NoxInfluencer 등 외부 서비스 자료는 **팀 내부 참고용**입니다. 저장소를 공개(Public)로 바꾸거나 이 파일을 팀 밖에 공유하지 마세요(약관상 재배포 금지).
- 실존 계정 CSV에 수치를 지어내 넣지 마세요. 모르는 값은 비워 둡니다.
- 사이트를 자동으로 긁어 와 이 폴더를 채우는 프로그램(크롤링)은 만들지 않습니다.

## 베트남 크리에이터 목록 (`creator_list_vn.csv`, 2026-10-26)

### 구성
- NoxInfluencer 원본 287행(`Ver_003_real_verified.csv`와 같은 내용, 레코드 ID `R3-`) + AI 웹 검색 조사 6개 파일(Claude TikTok 34·YouTube 36 / GPT TikTok 30 / Gemini TikTok 30·Instagram 30·Facebook 30).
- 레코드 ID 접두어로 조사 주체 구분: `R3-` NoxInfluencer 원본 · `C-` Claude · `G-` GPT · `M-` Gemini.
- **중복 통합**: 같은 플랫폼에서 프로필 핸들 또는 계정 이름(성조·대소문자·기호 무시)이 같으면 한 계정으로 보고 한 줄만 남김(15묶음, 21행 감소). 원본 계정과 겹치면 원본 줄을 남기고 비어 있던 팔로워·주소만 채움. AI끼리 겹치면 팔로워·주소·구체적 출처 URL이 있는 줄, 같으면 여러 AI가 같은 주소를 댄 줄을 남김. 합친 레코드 ID는 '동일성 메모'에 기록, 출처마다 핸들이 다른 4건은 '직접 확인 필요' 표시.
- 정리: Gemini 파일의 열 밀림(쉼표 따옴표 누락·'팔로워 메모' 칸 누락) 35행 수정, 색 표기 통일('A=초록'→'초록'), AI 행의 규모 등급·공개 참고가 구간은 팔로워 수로 다시 계산.

### 대시보드([발굴] 결과)에 쓰는 기준
CSV에는 456행을 모두 두고, 아래를 **모두** 만족하는 139행만 화면에 나옴(TikTok 74 · YouTube 30 · Instagram 18 · Facebook 17).
1. 팔로워 수(TikTok·Instagram·Facebook) 또는 구독자 수(YouTube)가 있음
2. 그 수가 1,000 이상(Nano 이상)
3. 분야(타깃 그룹 제안)가 대시보드 5개 분야 중 하나: 베트남(인) · 식품(맛집·먹방) / 간식·디저트 / K-푸드·K-컬처 / 라이프스타일, 한국(인) · 다낭 여행 유튜버
4. 분류가 'D 제외'가 아님
- 출처 열은 CSV에만 두고 화면에는 표시하지 않음.

### 자료 출처 (팔로워·구독자 수 출처, 통합 시점 149행 기준 — 아래 10행은 이후 화면에서 제외)
- 모두 제3자 자료(팔로워 상태 `THIRD_PARTY_ESTIMATE`)이며 프로필에서 직접 확인한 수치는 없음. 기준일은 출처마다 다름(행의 '팔로워 기준일'·'팔로워 메모' 참고).
- 인플루언서 분석 서비스: Heepsy 24 · NoxInfluencer 18 · Hive Influence 6 · TKMetrics 5 · Social Blade 3 · speakrj 2 · NetWorthSpot 2 · Modash 2 · vidIQ 1 · SocialCounts 1 · Favikon 1 · StarNgage 1
- 마케팅 블로그·리포트: REVU Vietnam/REVU Blog 28 · Feedspot 8 · MarketingAI 5 · Brands Vietnam(REVU 기사) 5 · iPOS Blog 4 · NCKH MI Report 3 · Advertising Vietnam 4 · IZEA 1 · Dinos VN 1 · Nishi Vietnam Blog 1 · Scribd Booking List 1
- 언론 기사·백과: CafeF 4 · Mytour 3 · Znews 2 · 35express 2 · Báo Pháp Luật 2 · fptshop 1 · Thanh Niên 1 · Tuổi Trẻ News 1 · Việt Nam News 1 · 인사이트 1 · 위키백과/Wikipedia 2 · Famous Birthdays 2
- 각 행의 출처 이름·URL은 '팔로워 출처'·'팔로워 출처 URL', 근거는 '근거 URL 1·2' 열.

### 쓰기 전 확인할 점
- AI 조사 자료는 사람이 프로필을 직접 열어 확인하지 않음. 협업 제안 전에 프로필 주소·팔로워 수를 직접 확인할 것.
- **출처가 약한 10행은 화면에서 제외**(모두 Gemini, 분류를 'D 제외'로 바꾸고 '협업 적합성 근거'에 사유 기록): 팔로워 출처 URL이 사이트 첫 화면뿐(vn.noxinfluencer.com/)이거나 다른 사람 페이지(StarNgage `donnacrous`, Famous Birthdays `bao-bao`)를 가리킴. 해당 레코드: M-IG-013, M-IG-018, M-FB-010, M-FB-012, M-FB-017, M-FB-019, M-FB-021, M-FB-022, M-FB-023, M-FB-025. 프로필에서 수치를 직접 확인하면 분류를 되돌려 다시 쓸 수 있음.
- 오래된 기사(2019~2021) 기준 수치가 섞여 있음('팔로워 메모'에 '구 자료' 표시).
