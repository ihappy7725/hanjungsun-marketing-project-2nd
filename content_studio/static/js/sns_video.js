// 영상 초안·프롬프트 검토·결과 [유진]
// sns.js가 import합니다. 가운데 영역만 그리고, 저장은 sns.js가 넘겨준 onSave로 합니다.

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

// videos.py STYLES의 이름과 같아야 합니다. 바꾸려면 입력줄에 "브이로그 느낌으로"처럼 말합니다.
const STYLE_LABELS = {
  premium: "프리미엄 광고",
  warm: "따뜻한 감성",
  vlog: "브이로그·리뷰",
  energetic: "역동적 숏폼",
  retro: "레트로",
  fantasy: "판타지 변신",
  miniature: "미니어처 월드",
  asmr: "ASMR 클로즈업",
};

// "3-6s" → 6
function endOf(time) {
  const match = /(\d+)\s*-\s*(\d+)/.exec(time || "");
  return match ? Number(match[2]) : 0;
}

// root 안에 영상 문서(README 8장 형식)를 그립니다.
// onSave(newDoc): 직접 고친 결과 저장 (Promise) · onCommand(text): 입력줄과 같은 명령 보내기
// notice: ③ 아래에 보여 줄 안내(크레딧 사용·남은 크레딧). 생성 결과로 다시 그릴 때 이어서 보여 줍니다.
export function renderVideo(root, doc, { onSave, onCommand, notice }) {
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
  } else if (doc.keyframe?.image_url) {
    // 영상 전에는 미리보기 이미지(첫 장면)를 보여 줍니다.
    const image = el("img", "studio-video-player");
    image.src = doc.keyframe.image_url;
    image.alt = "미리보기 이미지 (영상 첫 장면)";
    frame.append(image, el("span", "badge", "미리보기 이미지 · 영상 생성 전"));
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
  status.append(el("span", doc.reviewed ? "badge season" : "badge dday", doc.reviewed ? "검토 완료" : "검토 필요"));
  status.append(el("span", "badge", `분위기 · ${STYLE_LABELS[doc.style] || STYLE_LABELS.premium}`));
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
  // 영어(Higgsfield로 보내는 문장)는 읽기 전용이고, 한국어를 고쳐 저장하면 서버가 영어에 반영합니다(videos.py korean_to_english).
  const prompt = el("textarea", "studio-video-prompt is-readonly");
  prompt.rows = 16;
  prompt.lang = "en";
  prompt.readOnly = true;
  prompt.value = doc.prompt;
  prompt.setAttribute("aria-label", "Higgsfield로 보낼 영어 프롬프트 (읽기 전용)");

  const copy = el("button", "btn studio-video-copy", "복사");
  copy.type = "button";
  copy.title = "영어 프롬프트 복사";
  copy.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(prompt.value);
    } catch {
      prompt.select();
      document.execCommand("copy");  // http 주소 등에서 clipboard API가 막힐 때
    }
    copy.textContent = "복사됨";
    setTimeout(() => { copy.textContent = "복사"; }, 1500);
  });

  const promptKo = el("textarea", "studio-video-prompt");
  promptKo.rows = 16;
  promptKo.value = doc.prompt_ko || "";
  promptKo.placeholder = "예전에 영어를 직접 고친 작업이라 한국어가 없어요. [자동 프롬프트로]를 누르면 새로 만들어요.";
  promptKo.setAttribute("aria-label", "프롬프트 한국어 (고치면 저장할 때 영어에 반영)");
  promptKo.addEventListener("input", markDirty);

  // 단어 규칙으로 영어에 못 바꾼 줄 (AI 연결 전). 그 줄의 영어는 바뀌지 않았습니다.
  const untranslated = el("div", "studio-video-untranslated");
  untranslated.hidden = !doc.untranslated?.length;
  if (doc.untranslated?.length) {
    const list = el("ul");
    list.append(...doc.untranslated.map((line) => el("li", "", line)));
    untranslated.append(el("p", "", `영어에 반영하지 못한 줄 ${doc.untranslated.length}개 — 아직 아는 표현만 바꿀 수 있어요. 이 줄들의 영어는 그대로예요.`), list);
  }

  const save = el("button", "btn dark", "저장");
  save.type = "button";
  save.disabled = true;
  const reset = el("button", "btn", "자동 프롬프트로");
  reset.type = "button";
  reset.hidden = !doc.custom && !doc.custom_ko;
  reset.addEventListener("click", () => { promptKo.value = ""; markDirty(); saveDoc(); });

  // ---------- ③ 만들기 (Higgsfield · 유진 Ultra 계정 크레딧) ----------
  // 누르면 먼저 무료로 비용·계정 남은 크레딧·오늘 사용량을 받아 확인 창을 띄우고, [실행]을 눌러야만 요청합니다.
  const makeImage = el("button", "btn", doc.keyframe?.request_id ? "미리보기 이미지 다시 만들기" : "미리보기 이미지 만들기");
  makeImage.type = "button";
  const generate = el("button", "btn dark", doc.job?.request_id ? "영상 다시 만들기" : "이 프롬프트로 영상 만들기");
  generate.type = "button";
  const genStatus = el("p", "studio-hint");
  const genButtons = [makeImage, generate];
  makeImage.addEventListener("click", () => askGenerate("image"));
  generate.addEventListener("click", () => askGenerate("video"));

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

  const englishHead = el("div", "studio-video-prompt-head");
  englishHead.append(el("h3", "", "② 프롬프트 검토 (영어 · Higgsfield용)"), copy);
  const englishBlock = el("div");
  englishBlock.append(
    englishHead,
    el("p", "studio-hint", "읽기 전용 · 오른쪽 한국어를 고쳐 저장하면 여기에 반영돼요. 글자는 영상에 그리지 않고 장면 자막을 얹습니다."),
    prompt,
  );
  const koreanBlock = el("div");
  koreanBlock.append(
    el("h3", "", "한국어 (고치기)"),
    el("p", "studio-hint", "고친 줄은 [저장]할 때 영어로 바꿔요. 지운 줄은 영어에서도 빠져요."),
    promptKo,
    untranslated,
    actions(save, reset),
  );
  const prompts = el("div", "studio-video-prompts");
  prompts.append(englishBlock, koreanBlock);

  const generateBlock = el("div", "studio-video-generate");
  generateBlock.append(
    el("h3", "", "③ 영상 만들기"),
    el("p", "studio-hint", "Kling 4.0 · 720p. 미리보기 이미지를 먼저 만들면 그 그림을 첫 장면으로 영상을 만듭니다. "
      + "누를 때마다 쓰일 크레딧·남은 크레딧을 먼저 보여 드리고, [실행]을 눌러야만 요청합니다."),
    actions(makeImage, generate),
    genStatus,
  );

  // ---------- ③ 만들기: 확인 창 · 요청 · 상태 확인 ----------
  const STATUS_LABELS = { queued: "대기 중", in_progress: "만드는 중", processing: "만드는 중", completed: "완료",
    failed: "실패", nsfw: "거절됨(부적절 판정)", canceled: "취소됨", cancelled: "취소됨" };
  const RUNNING = ["queued", "in_progress", "processing"];
  const TARGET = { image: { key: "keyframe", label: "미리보기 이미지" }, video: { key: "job", label: "영상" } };
  const chatId = new URL(location.href).searchParams.get("chat");
  const apiBase = root.closest(".studio-page")?.dataset.api;

  async function call(path, options = {}) {
    const response = await fetch(`${apiBase}/chats/${chatId}${path}`, {
      ...options,
      headers: { "Content-Type": "application/json" },
      body: options.body && JSON.stringify(options.body),
    });
    const data = await response.json().catch(() => ({ ok: false, error: "서버 응답을 읽지 못했습니다." }));
    if (!data.ok) throw Object.assign(new Error(data.error || "요청에 실패했습니다."), { data });
    return data;
  }

  const fmt = (n) => Number(n).toLocaleString("ko-KR", { maximumFractionDigits: 2 });

  function showStatus() {
    const parts = Object.entries(TARGET).map(([, { key, label }]) => {
      const status = doc[key]?.status;
      return status ? `${label}: ${STATUS_LABELS[status] || status}` : "";
    }).filter(Boolean);
    genStatus.textContent = parts.join(" · ");
  }

  // 비용 확인 창 (base.css dialog). 실행할 수 없으면 이유를 보여 주고 [실행]을 끕니다.
  function confirmDialog(target, quote) {
    return new Promise((resolve) => {
      const dialog = el("dialog");
      const usingImage = target === "video" && doc.keyframe?.status === "completed";
      const lines = el("ul");
      lines.append(
        el("li", "", `이번에 쓰일 크레딧: ${fmt(quote.credits)}`),
        el("li", "", `계정 남은 크레딧: ${fmt(quote.balance)} → 실행 후 약 ${fmt(quote.balance - quote.credits)}`),
        el("li", "", `오늘 대시보드 사용: ${fmt(quote.today_used)} / ${fmt(quote.daily_limit)}`),
      );
      const run = el("button", "btn dark", "실행");
      run.type = "button";
      run.disabled = !quote.allowed;
      const cancel = el("button", "btn", "취소");
      cancel.type = "button";
      dialog.append(
        el("h2", "", `${TARGET[target].label} 만들기`),
        el("p", "studio-hint", target === "image" ? "Nano Banana 2 · 영상 첫 장면 그림"
          : `Kling 4.0 · 720p · ${doc.duration}초 · ${usingImage ? "미리보기 이미지를 첫 장면으로" : `글 설명만으로 (${doc.ratio})`}`),
        lines,
      );
      if (!quote.allowed) dialog.append(el("p", "badge dday", quote.reason));
      dialog.append(actions(run, cancel));
      const close = (answer) => { dialog.close(); dialog.remove(); resolve(answer); };
      run.addEventListener("click", () => close(true));
      cancel.addEventListener("click", () => close(false));
      dialog.addEventListener("cancel", (event) => { event.preventDefault(); close(false); });
      root.append(dialog);
      dialog.showModal();
    });
  }

  async function askGenerate(target) {
    genButtons.forEach((button) => { button.disabled = true; });
    genStatus.textContent = "비용과 남은 크레딧을 확인하는 중… (무료)";
    try {
      let { quote } = await call("/generate/quote", { method: "POST", body: { target } });
      while (await confirmDialog(target, quote)) {
        genStatus.textContent = `${TARGET[target].label} 요청을 보내는 중…`;
        try {
          const data = await call("/generate", { method: "POST", body: { target, credits: quote.credits } });
          applyResult(data.design, `✓ ${fmt(data.spent)} 크레딧으로 ${TARGET[target].label} 요청을 보냈어요 · `
            + `오늘 대시보드 사용 ${fmt(data.today_used)} / ${fmt(data.daily_limit)} · 만드는 동안 상태를 확인합니다`);
          return;
        } catch (error) {
          // 비용이 바뀌었거나 한도를 넘으면 새 숫자로 다시 묻습니다.
          if (!error.data?.quote) throw error;
          quote = error.data.quote;
        }
      }
      showStatus();
    } catch (error) {
      genStatus.textContent = `요청하지 못했습니다. (${error.message})`;
    } finally {
      genButtons.forEach((button) => { button.disabled = !save.disabled; });
    }
  }

  // 작업 상태는 지금 문서에 바로 적습니다(sns.js가 들고 있는 문서와 같은 객체). 고치던 내용이 없을 때만 다시 그립니다.
  function applyResult(next, message) {
    doc.keyframe = next.keyframe;
    doc.job = next.job;
    if (save.disabled) return renderVideo(root, doc, { onSave, onCommand, notice: message });
    genStatus.textContent = message || "";
    if (!message) showStatus();
  }

  // 만드는 중이면 8초마다 상태만 확인합니다(무료, 다시 만들지 않음). 화면을 떠나면 멈춥니다.
  function poll() {
    const target = Object.keys(TARGET).find((name) => RUNNING.includes(doc[TARGET[name].key]?.status));
    if (!target || !chatId) return;
    setTimeout(async () => {
      if (!wrap.isConnected) return;
      try {
        const data = await call(`/generate/status?target=${target}`);
        const status = data.design[TARGET[target].key]?.status;
        if (RUNNING.includes(status)) return poll();
        const balance = data.balance === null ? "" : ` · 계정 남은 크레딧 ${fmt(data.balance)}`;
        applyResult(data.design, `${TARGET[target].label} ${STATUS_LABELS[status] || status}${balance} · `
          + `오늘 대시보드 사용 ${fmt(data.today_used)} / ${fmt(data.daily_limit)}`);
      } catch (error) {
        genStatus.textContent = `상태를 확인하지 못했습니다. (${error.message}) 잠시 후 다시 확인합니다.`;
        poll();
      }
    }, 8000);
  }

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

  // 고친 내용이 저장되지 않았으면 만들기를 막습니다(저장된 프롬프트로 만들기 때문).
  function markDirty() {
    save.disabled = false;
    genButtons.forEach((button) => { button.disabled = true; button.title = "먼저 [저장]해 주세요"; });
  }

  // 화면에서 고친 자막·시간·프롬프트를 담은 새 문서
  function collect() {
    const next = structuredClone(doc);
    next.scenes.forEach((scene, i) => {
      scene.caption = captionInputs[i].value.trim();
      scene.time = `${startOf(i)}-${ends[i]}s`;
    });
    // 한국어를 고쳤으면 그 글을 보내고 영어는 서버가 다시 만듭니다. 비우면 자동 프롬프트로 돌아갑니다.
    // 고치지 않았으면 그대로 둡니다(예전에 영어만 고친 작업의 custom 유지).
    const ko = promptKo.value.trim();
    if (ko !== (doc.prompt_ko || "").trim()) {
      next.custom_ko = ko;
      next.custom = "";
    }
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
  select(0, false);
  if (notice) genStatus.textContent = notice;
  else showStatus();
  poll();
}
