"""담당 구역 밖 파일 수정을 막는 Claude Code 훅 (PreToolUse: Edit | Write | NotebookEdit). [PM1 상준만 수정]

기준: .claude/ownership.json / 사용자: .claude/whoami.local (각자 로컬, Git 제외)
허용이면 아무것도 출력하지 않고, 그 뒤 일반 승인 창이 뜹니다. 막을 때만 deny를 돌려줍니다.
"""
import json
import os
import sys
from fnmatch import fnmatchcase


def deny(reason):
    # ensure_ascii: Windows 콘솔 인코딩과 무관하게 한글을 안전하게 전달
    print(json.dumps({
        "hookSpecificOutput": {
            "hookEventName": "PreToolUse",
            "permissionDecision": "deny",
            "permissionDecisionReason": reason,
        }
    }))
    sys.exit(0)


def matches(rel, patterns):
    rel = rel.lower()
    return any(fnmatchcase(rel, p.lower()) for p in patterns)


def main():
    data = json.loads(sys.stdin.buffer.read().decode("utf-8"))
    tool_input = data.get("tool_input") or {}
    target = tool_input.get("file_path") or tool_input.get("notebook_path")
    if not target:
        return

    root = os.path.realpath(os.environ.get("CLAUDE_PROJECT_DIR") or data.get("cwd") or os.getcwd())
    path = os.path.realpath(os.path.join(root, target))
    try:
        rel = os.path.relpath(path, root)
    except ValueError:  # 다른 드라이브
        return
    if rel == ".." or rel.startswith(".." + os.sep):
        return  # 저장소 밖 파일은 이 훅이 다루지 않음 (일반 승인 창으로 처리)
    rel = rel.replace(os.sep, "/")

    with open(os.path.join(root, ".claude", "ownership.json"), encoding="utf-8") as f:
        rules = json.load(f)
    members = rules["members"]

    if matches(rel, rules.get("anyone", [])):
        return

    try:
        with open(os.path.join(root, ".claude", "whoami.local"), encoding="utf-8-sig") as f:
            me = f.read().strip().lower()
    except FileNotFoundError:
        me = ""
    if me not in members:
        deny(
            "사용자 확인이 필요합니다. .claude/whoami.local 파일에 본인 ID 한 줄을 적어 주세요. "
            f"가능한 ID: {', '.join(members)}"
        )

    if matches(rel, members[me]["paths"]):
        return

    owners = [m["name"] for m in members.values() if matches(rel, m["paths"])]
    owner_text = ", ".join(owners) if owners else "아직 정해지지 않음 (PM2에게 문의)"
    deny(
        f"'{rel}'은(는) {members[me]['name']}님 담당 구역이 아닙니다 (담당: {owner_text}). "
        "직접 고치지 말고 담당자에게 보낼 요청문을 작성하세요. 기준: .claude/ownership.json"
    )


if __name__ == "__main__":
    main()
