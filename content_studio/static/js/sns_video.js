// 영상 초안·프롬프트 검토·결과 [유진]
// sns.js가 import합니다. 가운데 영역만 그리고, 저장은 sns.js가 넘겨준 onSave로 합니다.

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

// root 안에 영상 문서(README 8장 형식)를 그립니다. onSave(newDoc)는 Promise를 돌려줍니다.
export function renderVideo(root, doc, { onSave }) {
  let selected = 0;

  // ---------- 미리보기: 비율에 맞춘 자리표시 위에 장면 자막을 얹습니다 ----------
  const preview = el("div", "studio-video-preview");
  const frame = el("div", "studio-thumb tone-hero studio-video-frame");
  frame.dataset.ratio = doc.ratio;
  const frameScene = el("small", "studio-video-scene");
  const frameCaption = el("p", "studio-video-caption");
  frameCaption.lang = "vi";
  frame.append(el("span", "badge", doc.job?.video_url ? "완성 영상" : "미리보기 · 영상 생성 전"), frameScene, frameCaption);
  const dots = el("div", "studio-video-dots");
  preview.append(frame, dots);

  // ---------- ① 장면 구성 ----------
  const detail = el("div", "studio-video-detail");
  const status = el("div", "studio-video-status");
  if (doc.demo) status.append(el("span", "demo", "시연 · 자막 원어민 검수 전"));
  status.append(el("span", doc.reviewed ? "badge season" : "badge dday", doc.reviewed ? "검토 완료" : "검토 필요"));
  status.append(el("span", "studio-hint", doc.summary));

  const sceneList = el("ol", "studio-video-scenes");
  const captionInputs = doc.scenes.map((scene, index) => {
    const li = el("li");
    li.append(el("b", "", scene.time), el("span", "", scene.ko));
    const input = el("input", "studio-video-input");
    input.lang = "vi";
    input.value = scene.caption || "";
    input.placeholder = "자막 없음";
    input.setAttribute("aria-label", `${index + 1}번 장면 자막 (베트남어)`);
    input.addEventListener("focus", () => select(index));
    input.addEventListener("input", () => { markDirty(); if (index === selected) frameCaption.textContent = input.value; });
    li.append(input);
    li.addEventListener("click", () => select(index));
    sceneList.append(li);

    const dot = el("button", "studio-video-dot", String(index + 1));
    dot.type = "button";
    dot.addEventListener("click", () => select(index));
    dots.append(dot);
    return input;
  });

  // ---------- ② 프롬프트 검토 ----------
  const prompt = el("textarea", "studio-video-prompt");
  prompt.rows = 7;
  prompt.lang = "en";
  prompt.value = doc.custom || doc.prompt;
  prompt.addEventListener("input", markDirty);

  const save = el("button", "btn dark", "저장");
  save.type = "button";
  save.disabled = true;
  const reset = el("button", "btn", "자동 프롬프트로");
  reset.type = "button";
  reset.hidden = !doc.custom;
  reset.addEventListener("click", () => { prompt.value = ""; markDirty(); saveDoc(); });

  // ---------- ③ 영상 만들기 (5단계 Higgsfield 연결 전) ----------
  const generate = el("button", "btn dark", "이 프롬프트로 영상 만들기");
  generate.type = "button";
  generate.disabled = true;

  detail.append(
    status,
    el("h3", "", "① 장면 구성"),
    sceneList,
    el("h3", "", "② 프롬프트 검토"),
    el("p", "studio-hint", "Higgsfield로 보낼 영어 프롬프트입니다. 글자는 영상에 그리지 않고 위 자막을 얹습니다."),
    prompt,
    actions(save, reset),
    el("h3", "", "③ 영상 만들기"),
    generate,
    el("p", "studio-hint", "Higgsfield 연결 전이라 요청을 보내지 않습니다. (5단계) 버튼을 눌러야만 생성을 요청합니다."),
  );

  function actions(...buttons) {
    const box = el("div", "actions");
    box.append(...buttons);
    return box;
  }

  function select(index) {
    selected = index;
    frameScene.textContent = `${doc.scenes[index].time} · ${doc.scenes[index].ko}`;
    frameCaption.textContent = captionInputs[index].value;
    [...dots.children].forEach((dot, i) => dot.classList.toggle("dark", i === index));
    [...sceneList.children].forEach((li, i) => li.classList.toggle("is-selected", i === index));
  }

  function markDirty() {
    save.disabled = false;
  }

  async function saveDoc() {
    const next = structuredClone(doc);
    next.scenes.forEach((scene, i) => { scene.caption = captionInputs[i].value.trim(); });
    // 자동 프롬프트와 같으면 직접 고친 것이 아닙니다.
    const text = prompt.value.trim();
    next.custom = text && text !== doc.prompt ? text : "";
    save.disabled = true;
    try {
      await onSave(next);
    } catch {
      save.disabled = false;
    }
  }
  save.addEventListener("click", saveDoc);

  root.replaceChildren(el("div", "studio-video"));
  root.firstChild.append(preview, detail);
  select(0);
}
