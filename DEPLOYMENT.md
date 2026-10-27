# HANJEONGSEON Render 공개 배포 가이드

외부 사용자가 로그인 없이 전체 기능을 사용하는 공개 배포 절차입니다.

> 외부 사용자는 데이터 생성·수정·삭제, 파일 업로드, 유료 AI·검색 API 호출이 가능합니다. 배포 전에 각 API 공급자 콘솔에서 월 예산 상한과 사용량 알림을 설정해야 합니다.

## 1. 배포 구조

- 소스: GitHub `premain`
- 서버: Render Web Service
- 실행: Gunicorn worker 1개
- DB·업로드·내보내기: Render 영구 디스크의 `instance/`
- Health Check: `/healthz`

`render.yaml`은 2GB 메모리 Web Service와 5GB 영구 디스크를 요청합니다. 이미지 배경 제거 모델이 약 1GB를 내려받으므로 512MB 서비스는 전체 기능 실행에 부족할 수 있습니다.

## 2. GitHub 반영

```powershell
git status
git add app.py requirements.txt .env.example render.yaml DEPLOYMENT.md
git commit -m "chore: Render 공개 배포 설정 추가"
git push origin market_analysis_SJ
```

팀 방식에 따라 Pull Request를 만들고 `premain`에 병합합니다. Render는 `premain`을 배포하도록 설정되어 있습니다.

## 3. Render Blueprint 생성

1. <https://dashboard.render.com/> 로그인
2. `New` → `Blueprint` 선택
3. GitHub 저장소 `tb131811-lab/Hanjeongseon` 연결
4. Blueprint 경로가 `render.yaml`인지 확인
5. 브랜치가 `premain`인지 확인
6. 서비스·디스크 예상 비용 확인
7. 환경변수 값 입력
8. `Apply` 실행

## 4. 환경변수

Render가 `SECRET_KEY`를 자동 생성합니다. 실제 사용하는 공급자의 키만 입력합니다.

필수:

```text
PUBLIC_BASE_URL       첫 배포 전 임시값, 배포 후 실제 https 주소로 교체
OPENAI_API_KEY        AI 인사이트·콘텐츠·KPI AI
```

기능별:

```text
SERPAPI_API_KEY
CALENDARIFIC_API_KEY
ECOS_API_KEY
DEEPL_API_KEY
YOUTUBE_API_KEY
PHYLLO_CLIENT_ID
PHYLLO_CLIENT_SECRET
MODASH_API_KEY
HYPEAUDITOR_CLIENT_ID
HYPEAUDITOR_API_TOKEN
HF_API_KEY_ID
HF_API_KEY_SECRET
FIGMA_ACCESS_TOKEN
```

발급받지 않은 선택 API 키에는 임시값을 넣을 수 있지만 해당 기능은 동작하지 않습니다. 실제 키를 GitHub, 문서, 채팅에 저장하지 않습니다.

## 5. 첫 배포

Render가 다음 작업을 자동 실행합니다.

```text
pip install -r requirements.txt
flask --app app:create_app init-db
gunicorn "app:create_app()" --bind 0.0.0.0:$PORT --workers 1 --timeout 120
```

로그에서 `DB 초기화 완료`와 Gunicorn 시작 메시지를 확인합니다. `/healthz`가 HTTP 200을 반환하면 정상입니다.

## 6. 공개 주소 확정

첫 배포 후 Render 공개 주소를 복사합니다.

```text
https://hanjeongseon.onrender.com
```

Render Environment에서 `PUBLIC_BASE_URL`을 실제 주소로 변경하고 `Save and deploy`를 실행합니다.

## 7. 전체 기능 검수

- `/home/`: 캠페인·작업·일정 생성과 저장
- `/market_analysis/`: 국가문화·트렌드·경쟁제품·AI 인사이트
- `/content_studio/`: 대화·이미지·영상 업로드·생성·내보내기
- `/kpi/`: 예산·성과·VOC·환율·AI 요약
- `/influencer_marketing/`: 인플루언서·견적·성과·외부 검색

필수 검수:

1. 새 데이터를 만든 뒤 새로고침해도 유지되는지
2. Manual Deploy 후에도 데이터와 업로드가 유지되는지
3. API 키가 HTML·JavaScript·오류 메시지에 노출되지 않는지
4. 50MB 참고 영상 업로드가 가능한지
5. 경쟁제품 외부 링크가 열리는지
6. 모바일과 PC에서 화면이 깨지지 않는지
7. OpenAI 등 유료 API가 중복 호출되지 않는지

## 8. 배포 운영

자동 배포는 꺼져 있습니다. `premain`에 병합한 뒤 Render에서 `Manual Deploy` → `Deploy latest commit`을 눌러야 공개됩니다.

문제가 발생하면 Render Deploys에서 직전 정상 배포를 다시 배포합니다.

## 9. 데이터 백업

```text
/opt/render/project/src/instance/dashboard.sqlite3
/opt/render/project/src/instance/uploads/
/opt/render/project/src/instance/exports/
```

Render 디스크 스냅샷 외에도 DB와 업로드를 정기적으로 백업합니다. SQLite는 worker 1개에서 사용하며, 동시 사용자가 많아지면 PostgreSQL과 Object Storage로 이전합니다.

## 10. 공개 운영 위험

- 누구나 유료 API를 호출할 수 있음
- 누구나 저장 데이터를 변경·삭제할 수 있음
- 악성 또는 대용량 파일 업로드 가능성
- SQLite는 동시 쓰기가 많을 때 잠금 오류 가능성

최소 운영 조치:

- 외부 API별 월 예산 상한과 사용량 알림
- Render 로그와 디스크 사용량 매일 확인
- SQLite·업로드 정기 백업
- 비정상 사용 시 즉시 서비스 중지 또는 API 키 폐기
- 실제 고객 데이터가 들어오기 전 로그인·권한·요청 제한 도입
