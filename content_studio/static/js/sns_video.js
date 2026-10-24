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

// root 안에 영상 문서(README 8장 형식)를 그립니다.
// onSave(newDoc): 직접 고친 결과 저장 (Promise) · onCommand(text): 입력줄과 같은 명령 보내기
export function renderVideo(root, doc, { onSave, onCommand }) {
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

    const remove = el("button", "studio-video-remove", "×");
    remove.type = "button";
    remove.title = doc.scenes.length > 1 ? `${index + 1}번 컷 삭제 (시간은 앞 컷이 이어받음)` : "마지막 1컷은 지울 수 없어요";
    remove.disabled = doc.scenes.length <= 1;
    remove.setAttribute("aria-label", `${index + 1}번 컷 삭제`);
    remove.addEventListener("click", (event) => { event.stopPropagation(); removeScene(index); });

    li.append(time, el("span", "", scene.ko), input, remove);
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
  prompt.rows = 8;
  prompt.lang = "en";
  prompt.value = doc.custom || doc.prompt;
  prompt.addEventListener("input", () => { markDirty(); showKorean(); });

  // 한국어 번역 칸: 지금은 읽기 전용. 직접 고친 영어는 AI 연결 후 번역합니다.
  const promptKo = el("textarea", "studio-video-prompt is-readonly");
  promptKo.rows = 8;
  promptKo.readOnly = true;
  promptKo.setAttribute("aria-label", "프롬프트 한국어 번역 (읽기 전용)");
  const koNote = el("p", "studio-hint");
  function showKorean() {
    const edited = prompt.value.trim() !== doc.prompt.trim() || Boolean(doc.custom);
    if (edited) {
      promptKo.value = "";
      promptKo.placeholder = "직접 고친 영어 문장은 아직 번역하지 않아요. (AI 연결 후 번역)";
    } else {
      promptKo.value = doc.prompt_ko || "";
      promptKo.placeholder = "이전에 만든 작업이라 번역이 없어요. 입력줄로 한 번 고치면 생깁니다.";
    }
    koNote.textContent = "읽기 전용 · 고치려면 아래 입력줄에 말하거나 왼쪽 영어를 직접 고치세요.";
  }

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

  // 컷 추가: 서버 규칙(videos.py add_scene)으로 마지막 컷 앞에 넣습니다. 고치던 내용은 먼저 저장합니다.
  const maxScenes = Math.min(doc.duration, 12);
  const addScene = el("button", "btn studio-video-add", `+ 컷 추가 (${doc.scenes.length}/${maxScenes})`);
  addScene.type = "button";
  addScene.disabled = doc.scenes.length >= maxScenes;
  addScene.title = addScene.disabled ? "컷마다 1초 이상이라 더 넣을 수 없어요" : "마지막 컷 앞에 새 컷을 넣어요";
  addScene.addEventListener("click", async () => {
    if (!save.disabled) await saveDoc();
    onCommand("컷 하나 추가");
  });

  // 위: 미리보기 | ① 장면 구성   아래: ② 영어 프롬프트 | 한국어 번역   맨 아래: ③ 만들기
  const scenesBlock = el("div", "studio-video-scenes-block");
  scenesBlock.append(
    status,
    el("h3", "", "① 장면 구성"),
    el("p", "studio-hint", "시간을 누르면 끝나는 초를 고칠 수 있어요. 자막은 영상 위에 얹는 베트남어 문구입니다."),
    sceneList,
    addScene,
  );

  const englishBlock = el("div");
  englishBlock.append(
    el("h3", "", "② 프롬프트 검토 (영어 · Higgsfield용)"),
    el("p", "studio-hint", "글자는 영상에 그리지 않고 장면 자막을 얹습니다."),
    prompt,
    actions(save, reset),
  );
  const koreanBlock = el("div");
  koreanBlock.append(el("h3", "", "한국어 번역"), koNote, promptKo);
  const prompts = el("div", "studio-video-prompts");
  prompts.append(englishBlock, koreanBlock);

  const generateBlock = el("div", "studio-video-generate");
  generateBlock.append(
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

  // 화면에서 고친 자막·시간·프롬프트를 담은 새 문서
  function collect() {
    const next = structuredClone(doc);
    next.scenes.forEach((scene, i) => {
      scene.caption = captionInputs[i].value.trim();
      scene.time = `${startOf(i)}-${ends[i]}s`;
    });
    // 자동 프롬프트와 같으면 직접 고친 것이 아닙니다.
    const text = prompt.value.trim();
    next.custom = text && text !== doc.prompt ? text : "";
    return next;
  }

  async function saveDoc(next = collect()) {
    save.disabled = true;
    try {
      await onSave(next);
    } catch {
      save.disabled = false;
    }
  }
  save.addEventListener("click", () => saveDoc());

  // 컷 삭제: 지운 컷의 시간은 앞 컷이 이어받고(첫 컷이면 다음 컷이 0초부터), 바로 새 버전으로 저장합니다. (↶로 되돌리기)
  function removeScene(index) {
    if (doc.scenes.length <= 1) return;
    const next = collect();
    const nextEnds = [...ends];
    nextEnds.splice(index > 0 ? index - 1 : 0, 1);
    next.scenes.splice(index, 1);
    let start = 0;
    next.scenes.forEach((scene, i) => { scene.time = `${start}-${nextEnds[i]}s`; start = nextEnds[i]; });
    saveDoc(next);
  }

  const top = el("div", "studio-video-top");
  top.append(preview, scenesBlock);
  const wrap = el("div", "studio-video");
  wrap.append(top, prompts, generateBlock);
  root.replaceChildren(wrap);
  updateTimes();
  showKorean();
  select(0, false);
}
