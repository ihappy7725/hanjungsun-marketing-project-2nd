@AGENTS.md
@AI_RULES.md

## Claude Code 전용

- 이 저장소의 `.claude/settings.json`은 **계획 모드(plan)로 시작**하고, 파일 수정·커밋·푸시 전에 항상 승인을 묻도록 되어 있습니다. 승인 창과 별개로 위 [수정 계획]을 먼저 채팅으로 보고합니다.
- `.claude/hooks/guard_ownership.py`가 담당 구역 밖 파일 수정을 막습니다. 막히면 Bash 등으로 우회하지 말고, 담당자에게 보낼 요청문을 작성합니다.
- 개인 설정은 `.claude/settings.local.json`, 개인 메모는 `CLAUDE.local.md`에 둡니다(둘 다 Git 제외).
