# AI 작업 규칙

> Claude Code · Cursor · Codex · Copilot 등 **이 저장소에서 쓰는 모든 AI 도구**가 따르는 규칙입니다.
> 팀 규칙 전체는 [README.md](README.md)에 있고, 이 문서는 AI가 반드시 지킬 부분만 뽑았습니다. 둘이 다르면 README가 우선입니다.
> [PM2 유진만 수정]

**핵심: AI는 먼저 보고하고, 사람이 승인한 범위만 수정합니다.**

## 0. 작업 전에 사용자 확인

- `.claude/whoami.local` 파일(각자 로컬, Git 제외)에 적힌 ID로 지금 누구의 작업인지 확인합니다.
- 파일이 없으면 사용자에게 누구인지 묻고, 사용자가 원하면 이 파일을 만들어 줍니다(ID 한 줄).
- 담당 파일의 기준은 [.claude/ownership.json](.claude/ownership.json)입니다.

| ID | 이름 | 담당 |
| --- | --- | --- |
| `juyeon` | 주연 | `home/` |
| `sangjun` | 상준 (PM1) | `market_analysis/` + 공용 파일(`app.py`, `requirements.txt`, `.gitignore`, `.env.example`, `platform_core/`, `.claude/`) |
| `yujin` | 유진 (PM2) | `content_studio/` 중 유진 파일 + `README.md`, `docs/`, `AGENTS.md`, `CLAUDE.md`, `.github/` |
| `heeju` | 희주 | `content_studio/` 중 희주 파일 |
| `minji` | 민지 | `kpi/` |
| `jinhyuk` | 진혁 | `influencer_marketing/` |

## 1. 보고 → 승인 → 수정 (가장 중요)

1. 파일을 바꾸기 전에 아래 **[수정 계획]**을 먼저 보고하고 멈춥니다.
2. 사용자가 "진행", "OK", "해줘"처럼 **분명히 승인한 범위만** 수정합니다. 침묵이나 애매한 대답은 승인이 아닙니다.
3. 수정 중 계획과 달라지면(파일이 늘거나 방법이 바뀌면) 다시 멈추고 보고합니다.
4. 질문·설명·리뷰·"어떻게 생각해?" 요청에는 답만 하고 파일을 바꾸지 않습니다.
5. 수정이 끝나면 **[수정 결과]**를 보고합니다.

```
[수정 계획]
- 목적:
- 수정할 파일: (파일마다 담당자 표시)
- 파일별 바꿀 내용: (1~3줄)
- 담당 구역 밖 파일: 없음 / 있음 → 직접 고치지 않고 담당자 요청문 작성
- DB 테이블 · public.py 변경: 없음 / 있음 (영향받는 사람: )
- 새 라이브러리 · 환경변수: 없음 / 있음 → PM1(상준) 요청 필요
- 확인 방법:
진행할까요?
```

```
[수정 결과]
- 바꾼 파일:
- 확인한 것: (실행한 명령과 결과)
- 확인하지 못한 것:
- 알려야 할 사람: (PM1 · PM2 · public.py 사용자)
```

## 2. 하지 말 것

- 담당 구역 밖 파일 수정 → 대신 담당자에게 보낼 **요청문 초안**을 써 줍니다. (README 5장 "이럴 땐 이렇게")
- 요청받지 않은 리팩터링 · 포맷 정리 · 이름 바꾸기 · 파일 이동 · 파일 삭제
- 공용 파일 수정: `app.py`, `requirements.txt`, `.gitignore`, `.env.example`, `platform_core/`, `.claude/` (PM1만)
- 전체 문서 수정: `README.md`, `docs/`, `AGENTS.md`, `CLAUDE.md`, `.github/` (PM2만). 탭 README는 그 탭 담당자만.
- 다른 기능의 `models.py` · `routes.py` import, 다른 탭 테이블 직접 조회, 다른 탭 데이터를 내 테이블에 복사 저장
- `public.py` 반환 필드 삭제·이름 변경 (추가만 가능, 사용하는 사람에게 먼저 알림)
- 색·글꼴 값 직접 쓰기 → `platform_core/static/css/base.css` 변수(`var(--gold)` 등)만 사용
- `.env` 읽기·출력, API 키를 코드·로그·커밋에 넣기
- 시연 데이터를 실제 데이터처럼 표시 (`DEMO · 예시 데이터` 표시)
- README 8장 "연결 전 합의할 형식"·6.8 "디자인에서 확정할 것"의 **미정 사항을 임의로 결정** → 선택지와 장단점을 보고하고 사용자에게 묻습니다.

## 3. Git

- 커밋 · 푸시 · 머지 · 리베이스 · 브랜치 전환은 **사용자가 요청할 때만**, 실행할 명령을 먼저 보여 주고 승인받습니다.
- `main` · `premain`에 직접 커밋·푸시하지 않습니다. `push --force`, `reset --hard`, `clean -f`는 쓰지 않습니다.
- 작업은 개인 브랜치에서 합니다. 작업 시작 전 `git pull origin premain`을 안내합니다.
- 커밋 메시지: `태그: 한 줄 요약` (태그: `feat` `fix` `docs` `style` `refactor` `chore`), 한국어, 본문에 상세 설명.
- 충돌 해결: 한쪽을 통째로 덮어쓰지 않습니다. 무엇을 남기고 무엇을 지울지 보고하고 승인받습니다.
- PR 본문은 [.github/pull_request_template.md](.github/pull_request_template.md) 양식을 씁니다.

## 4. 코드 규칙 요약 (README 7·8장)

- 파일명: 영어 소문자 + `_`, 한글 금지 (예외: `README.md`, `docs/design/`).
- 화면: `templates/<모듈명>/<모듈명>_index.html`, `{% extends "platform_core/base.html" %}`.
- 정적 파일: `url_for("<모듈명>.static", filename=...)`.
- CSS 선택자는 `.<모듈>-page` 등 기능 최상위 영역 아래로 제한. `body` · `button` · `table` 전체 스타일 변경 금지.
- JS는 `type="module"`, 전역 변수·함수 금지.
- API는 자기 URL 아래에만: `/home/api/...`, `/kpi/api/...` 등.
- DB는 `from platform_core.extensions import db`, 테이블 이름에 모듈 접두어(`home_`, `market_analysis_`, `content_studio_sns_`, `content_studio_media_`, `kpi_`, `influencer_marketing_`).
- 다른 탭 데이터는 그 탭 `public.py`로만 읽고, `try/except`로 감싸 실패해도 내 화면이 멈추지 않게 합니다.
- 다른 탭 ID는 외래키 없이 문자열 칸으로 저장합니다.
- AI·이미지·영상 API 키는 서버(Python)에서만 씁니다.
