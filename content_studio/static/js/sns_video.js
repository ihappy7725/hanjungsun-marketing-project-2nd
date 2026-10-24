// 영상 초안·프롬프트 검토·결과 [유진]
// sns.js가 import합니다. 가운데 영역만 그리고, 저장은 sns.js가 넘겨준 onSave로 합니다.

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

// "3-6s" → 6
function endOf(time) {
  const match = /(\d+)\s*-\s*(\d+)/.exec(time || "");
  return match ? Number(match[2]) : 0;
}

// root 안에 영상 문서(README 8장 형식)를 그립니다. onSave(newDoc)는 Promise를 돌려줍니다.
export function renderVideo(root, doc, { onSave }) {
  let selected = 0;
  const ends = doc.scenes.map((scene) => endOf(scene.time));
  const startOf = (i) => (i === 0 ? 0 : ends[i - 1]);

  // ---------- 미리보기 (크게): 완성 영상이 있으면 재생하고, 없으면 자리표시. 자막은 위에 얹습니다 ----------
  const [w, h] = doc.ratio.split(":").map(Number);
  const frame = el("div", "studio-video-frame");
  frame.style.setProperty("--ar", w / h);
  const caption = el("p", "studio-video-caption");
  caption.lang = "vi";
  const sceneLabel = el("small", "studio-video-scene");
  let video = null;
  if (doc.job?.video_url) {
    video = el("video", "studio-video-player");
    video.src = doc.job.video_url;
    video.controls = true;
    video.playsInline = true;
    // 재생 시간에 맞춰 장면 자막을 바꿉니다.
    video.addEventListener("timeupdate", () => {
      const index = ends.findIndex((end) => video.currentTime < end);
      if (index >= 0 && index !== selected) select(index, false);
    });
    frame.append(video);
  } else {
    frame.classList.add("is-placeholder");
    frame.append(el("span", "badge", "미리보기 · 영상 생성 전"), sceneLabel);
  }
  frame.append(caption);

  const dots = el("div", "studio-video-dots");
  const preview = el("div", "studio-video-preview");
  preview.append(frame, dots);

  // ---------- ① 장면 구성 ----------
  const status = el("div", "studio-video-status");
  if (doc.demo) status.append(el("span", "demo", "시연 · 자막 원어민 검수 전"));
  status.append(el("span", doc.reviewed ? "badge season" : "badge dday", doc.reviewed ? "검토 완료" : "검토 필요"));
  status.append(el("span", "studio-hint", doc.summary));

  const sceneList = el("ol", "studio-video-scenes");
  const timeButtons = [];
  const captionInputs = doc.scenes.map((scene, index) => {
    const li = el("li");
    const time = el("button", "studio-video-time");
    time.type = "button";
    const isLast = index === doc.scenes.length - 1;
    time.title = isLast ? "마지막 장면은 영상 길이에서 끝납니다" : "눌러서 끝나는 초 고치기";
    time.disabled = isLast;
    time.addEventListener("click", (event) => { event.stopPropagation(); editTime(index, li, time); });
    timeButtons.push(time);

    const input = el("input", "studio-video-input");
    input.lang = "vi";
    input.value = scene.caption || "";
    input.placeholder = "자막 없음";
    input.setAttribute("aria-label", `${index + 1}번 장면 자막 (베트남어)`);
    input.addEventListener("focus", () => select(index));
    input.addEventListener("input", () => { markDirty(); if (index === selected) caption.textContent = input.value; });

    li.append(time, el("span", "", scene.ko), input);
    li.addEventListener("click", () => select(index));
    sceneList.append(li);

    const dot = el("button", "studio-video-dot", String(index + 1));
    dot.type = "button";
    dot.addEventListener("click", () => select(index));
    dots.append(dot);
    return input;
  });

  // 장면 시간: 끝나는 초를 고치면 다음 장면 시작이 따라 움직입니다. (1초 단위)
  function editTime(index, li, button) {
    const input = el("input", "studio-video-time-input");
    input.type = "number";
    input.min = startOf(index) + 1;
    input.max = ends[index + 1] - 1;
    input.value = ends[index];
    input.setAttribute("aria-label", `${index + 1}번 장면 끝나는 초 (${input.min}~${input.max})`);
    button.replaceWith(input);
    input.focus();
    input.select();

    let done = false;
    const finish = (apply) => {
      if (done) return;
      done = true;
      if (apply) {
        const value = Math.min(Number(input.max), Math.max(Number(input.min), Math.round(Number(input.value))));
        if (value && value !== ends[index]) {
          ends[index] = value;
          markDirty();
        }
      }
      input.replaceWith(button);
      updateTimes();
    };
    input.addEventListener("click", (event) => event.stopPropagation());
    input.addEventListener("blur", () => finish(true));
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") { event.preventDefault(); finish(true); }
      if (event.key === "Escape") finish(false);
    });
  }

  function updateTimes() {
    timeButtons.forEach((button, i) => { button.textContent = `${startOf(i)}-${ends[i]}s`; });
    select(selected, false);
  }

  // ---------- ② 프롬프트 검토 ----------
  const prompt = el("textarea", "studio-video-prompt");
  prompt.rows = 6;
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

  const detail = el("div", "studio-video-detail");
  detail.append(
    status,
    el("h3", "", "① 장면 구성"),
    el("p", "studio-hint", "시간을 누르면 끝나는 초를 고칠 수 있어요. 자막은 영상 위에 얹는 베트남어 문구입니다."),
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

  // seek=true면 완성 영상도 그 장면 시작으로 옮깁니다.
  function select(index, seek = true) {
    selected = index;
    sceneLabel.textContent = `${startOf(index)}-${ends[index]}s · ${doc.scenes[index].ko}`;
    caption.textContent = captionInputs[index].value;
    [...dots.children].forEach((dot, i) => dot.classList.toggle("dark", i === index));
    [...sceneList.children].forEach((li, i) => li.classList.toggle("is-selected", i === index));
    if (video && seek) video.currentTime = startOf(index);
  }

  function markDirty() {
    save.disabled = false;
  }

  async function saveDoc() {
    const next = structuredClone(doc);
    next.scenes.forEach((scene, i) => {
      scene.caption = captionInputs[i].value.trim();
      scene.time = `${startOf(i)}-${ends[i]}s`;
    });
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

  const wrap = el("div", "studio-video");
  wrap.append(preview, detail);
  root.replaceChildren(wrap);
  updateTimes();
  select(0, false);
}
