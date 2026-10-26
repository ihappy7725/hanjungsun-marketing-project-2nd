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
// onUploadRef(file): 레퍼런스 이미지·영상 올리기 → {file_id, url} (Promise)
// notice: ③ 아래에 보여 줄 안내(크레딧 사용·남은 크레딧). cut: 처음 고를 컷. 생성 결과로 다시 그릴 때 이어서 씁니다.
export function renderVideo(root, doc, options) {
  const { onSave, onCommand, onUploadRef, notice, cut = 0 } = options;
  let selected = 0;
  // 컷마다 미리보기 이미지(서버가 장면 글로 맞춰 줌, 없으면 null)
  if (!doc.cuts) doc.cuts = doc.scenes.map(() => null);
  const ends = doc.scenes.map((scene) => endOf(scene.time));
  const startOf = (i) => (i === 0 ? 0 : ends[i - 1]);

  // ---------- 미리보기 (크게): 완성 영상이 있으면 재생하고, 없으면 자리표시. 자막은 위에 얹습니다 ----------
  const [w, h] = doc.ratio.split(":").map(Number);
  const frame = el("div", "studio-video-frame");
  frame.style.setProperty("--ar", w / h);
  const caption = el("p", "studio-video-caption");
  caption.lang = "vi";
  const sceneLabel = el("small", "studio-video-scene");
  const frameBadge = el("span", "badge");
  let video = null, still = null;
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
    // 영상 전에는 고른 컷의 미리보기 이미지를 보여 주고, 그림이 없는 컷은 자리표시입니다(select → showCut).
    still = el("img", "studio-video-player");
    still.alt = "컷 미리보기 이미지";
    frame.append(still, frameBadge, sceneLabel);
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
    dot.classList.toggle("has-image", doc.cuts[index]?.status === "completed");
    if (dot.classList.contains("has-image")) dot.title = "미리보기 이미지 있음";
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
  // 영어는 줄마다 나눠 그린 읽기 전용 상자입니다(textarea는 글자 일부를 강조할 수 없어서).
  const enLines = (doc.prompt || "").split("\n");
  const prompt = el("div", "studio-video-prompt studio-video-prompt-view is-readonly");
  prompt.lang = "en";
  prompt.setAttribute("role", "textbox");
  prompt.setAttribute("aria-readonly", "true");
  prompt.setAttribute("aria-label", "Higgsfield로 보낼 영어 프롬프트 (읽기 전용)");
  const enRows = enLines.map((line) => el("div", "studio-video-prompt-line", line));
  prompt.append(...enRows);

  const copy = el("button", "btn studio-video-copy", "복사");
  copy.type = "button";
  copy.title = "영어 프롬프트 복사";
  copy.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(doc.prompt);
    } catch {
      // http 주소 등에서 clipboard API가 막힐 때: 잠깐 만든 칸으로 복사합니다.
      const temp = el("textarea");
      temp.value = doc.prompt;
      document.body.append(temp);
      temp.select();
      document.execCommand("copy");
      temp.remove();
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

  // 한국어 칸에서 누르거나 고른 줄·표현을 영어 칸에서 강조합니다.
  // 줄: 한국어·영어는 한 줄씩 짝이라 같은 번호 줄(줄 수가 다르면 줄 강조는 안 함) / 표현: 서버가 준 대응표(phrase_pairs)
  const pairs = doc.phrase_pairs || [];
  function phraseAt(line, start, end) {
    const picked = line.slice(start, end).trim();
    if (picked) {
      // 이 줄에 있는 표현 중 고른 글자를 담은 가장 짧은 것, 없으면 고른 글자 안에 든 가장 긴 표현
      const here = pairs.filter(([ko]) => line.includes(ko));
      const inside = here.filter(([ko]) => ko.includes(picked)).sort((a, b) => a[0].length - b[0].length)[0];
      return inside || here.filter(([ko]) => picked.includes(ko)).sort((a, b) => b[0].length - a[0].length)[0];
    }
    // 커서를 덮는 표현 중 가장 짧은 것 (단어 단위에 가깝게)
    let best = null;
    for (const pair of pairs) {
      for (let at = line.indexOf(pair[0]); at >= 0; at = line.indexOf(pair[0], at + 1)) {
        if (at <= start && start <= at + pair[0].length && (!best || pair[0].length < best[0].length)) best = pair;
      }
    }
    return best;
  }

  function showPhrase(row, phrase) {
    const text = row.textContent;
    const at = text.indexOf(phrase);
    if (at < 0) return false;
    row.replaceChildren(text.slice(0, at), el("mark", "studio-video-mark", phrase), text.slice(at + phrase.length));
    return true;
  }

  function highlight() {
    enRows.forEach((row, i) => { row.classList.remove("is-line"); row.textContent = enLines[i]; });
    const value = promptKo.value;
    const { selectionStart: start, selectionEnd: end } = promptKo;
    const index = value.slice(0, start).split("\n").length - 1;
    const lineStart = value.lastIndexOf("\n", start - 1) + 1;
    const koLines = value.split("\n");
    const line = koLines[index] || "";
    const pair = phraseAt(line, start - lineStart, Math.min(end, lineStart + line.length) - lineStart);
    const aligned = koLines.length === enLines.length;
    const row = aligned ? enRows[index] : null;
    row?.classList.add("is-line");
    // 표현은 짝 줄에서 먼저 찾고, 줄이 어긋났으면 영어 전체에서 처음 나오는 곳을 찾습니다.
    const marked = pair && ((row && showPhrase(row, pair[1])) || (!aligned && enRows.some((r) => showPhrase(r, pair[1]))));
    const target = marked ? prompt.querySelector(".studio-video-mark") : row;
    if (target) prompt.scrollTop = target.offsetTop - prompt.clientHeight / 3;  // 상자가 position: relative라 상자 기준 위치
  }
  for (const type of ["click", "keyup", "select"]) promptKo.addEventListener(type, highlight);

  // 아는 표현으로도, AI 번역으로도(키 없음·한도·실패) 영어에 못 바꾼 줄. 그 줄의 영어는 바뀌지 않았습니다.
  const untranslated = el("div", "studio-video-untranslated");
  untranslated.hidden = !doc.untranslated?.length;
  if (doc.untranslated?.length) {
    const list = el("ul");
    list.append(...doc.untranslated.map((line) => el("li", "", line)));
    untranslated.append(el("p", "", `영어에 반영하지 못한 줄 ${doc.untranslated.length}개 — AI 번역을 쓰지 못해(키 없음·한도·실패) 아는 표현만 바꿨어요. 이 줄들의 영어는 그대로예요.`), list);
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
  // 미리보기 이미지는 컷마다 1장. [모두 만들기]는 모든 컷, [N번 컷 이미지]는 지금 고른 컷만 다시 만듭니다.
  const makeImage = el("button", "btn", `${doc.cuts.some(Boolean) ? "미리보기 이미지 모두 다시 만들기" : "미리보기 이미지 만들기"}`
    + ` (컷 ${doc.scenes.length}장)`);
  makeImage.type = "button";
  const makeCut = el("button", "btn");
  makeCut.type = "button";
  const generate = el("button", "btn dark", doc.job?.request_id ? "영상 다시 만들기" : "이 프롬프트로 영상 만들기");
  generate.type = "button";
  const genStatus = el("p", "studio-hint");
  const genButtons = [makeImage, makeCut, generate];
  makeImage.addEventListener("click", () => askGenerate("image"));
  makeCut.addEventListener("click", () => askGenerate("image", selected));
  generate.addEventListener("click", () => askGenerate("video"));
  // 만들 수 있는 때: 고친 내용이 저장됐고 제품 사진이 있을 때 (제품을 고르면 서버가 자동으로 넣음)
  const canGenerate = () => save.disabled && Boolean(doc.image);
  let locked = false;  // 요청이 들어갔는지 모를 때 다시 누르지 못하게
  genButtons.forEach((button) => { button.disabled = !canGenerate(); });

  // 제품 사진은 칸 없이 서버가 고른 제품·컷 종류로 자동으로 보냅니다(routes_sns.py _photo_set).
  // 레퍼런스 (선택): 분위기·구도·색감 참고 이미지 4장·참고 영상 1개. ① 장면 구성과 ② 프롬프트 사이에 둡니다.
  // [+ 추가]·×로 고른 것은 모아 두었다가 [프롬프트에 반영](= 저장)을 누르면 새 버전으로 저장되고 프롬프트에 레퍼런스 줄이 들어갑니다.
  const REFS_MAX = 4;
  const refs = { user_refs: [...(doc.user_refs || [])], ref_video: doc.ref_video || null };  // 반영 전 고른 레퍼런스
  const refsChanged = () => JSON.stringify(refs) !== JSON.stringify({ user_refs: doc.user_refs || [], ref_video: doc.ref_video || null });
  const refBox = el("div", "studio-video-photo");
  const refNote = el("span", "studio-hint");
  const refInput = el("input");
  refInput.type = "file";
  refInput.accept = "image/jpeg,image/png,image/webp,video/mp4,video/quicktime,video/webm";
  refInput.hidden = true;
  const refButton = el("button", "btn", "+ 추가");
  refButton.type = "button";
  refButton.title = `이미지 ${REFS_MAX}장·영상 1개까지 (영상을 다시 올리면 바뀜)`;
  refButton.addEventListener("click", () => refInput.click());
  const refApply = el("button", "btn dark", "프롬프트에 반영");
  refApply.type = "button";
  refApply.addEventListener("click", () => saveDoc());
  const refItem = (node, label, remove) => {
    const box = el("span", "studio-ref");
    const x = el("button", "studio-ref-remove", "×");
    x.type = "button";
    x.title = `${label} 빼기`;
    x.setAttribute("aria-label", `${label} 빼기`);
    x.addEventListener("click", () => { remove(); refsEdited(); });
    box.append(node, x);
    return box;
  };
  function drawRefs() {
    const items = refs.user_refs.map((ref, index) => {
      const thumb = el("img", "studio-video-photo-thumb");
      thumb.src = ref.url;
      thumb.alt = "레퍼런스 이미지";
      return refItem(thumb, "레퍼런스 이미지", () => refs.user_refs.splice(index, 1));
    });
    if (refs.ref_video) {
      const clip = el("video", "studio-video-photo-thumb");
      clip.src = refs.ref_video.url;
      clip.muted = true;
      clip.preload = "metadata";
      items.push(refItem(clip, "참고 영상", () => { refs.ref_video = null; }));
    }
    refApply.disabled = !refsChanged();
    refBox.replaceChildren(...items, refButton, refInput, refApply, refNote);
  }
  // 고른 레퍼런스가 바뀌면 저장 전 상태(만들기 버튼 꺼짐)로 두고, 반영 버튼으로 저장하게 합니다.
  function refsEdited() {
    drawRefs();
    if (refsChanged()) {
      markDirty();
      refNote.textContent = "[프롬프트에 반영]을 누르면 저장되고 프롬프트에 들어가요.";
    } else {
      refNote.textContent = "";
    }
  }
  refInput.addEventListener("change", async () => {
    const file = refInput.files[0];
    refInput.value = "";
    if (!file) return;
    const isVideo = file.type.startsWith("video/");
    if (!isVideo && refs.user_refs.length >= REFS_MAX) {
      refNote.textContent = `레퍼런스 이미지는 ${REFS_MAX}장까지 넣을 수 있어요.`;
      return;
    }
    refButton.disabled = true;
    refNote.textContent = isVideo ? "참고 영상을 올리는 중…" : "레퍼런스 이미지를 올리는 중…";
    try {
      const ref = await onUploadRef(file);
      if (isVideo) refs.ref_video = ref;
      else refs.user_refs.push(ref);
      refsEdited();
    } catch (error) {
      refNote.textContent = `올리지 못했어요. (${error.message})`;
    } finally {
      refButton.disabled = false;
    }
  });
  drawRefs();
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
    sceneList,
    addScene,
  );

  // 영어·한국어 제목 줄은 같은 높이(sns.css .studio-video-prompt-head), 두 상자도 같은 높이입니다.
  const englishTitle = el("h3", "", "② 프롬프트 검토 (영어 · Higgsfield용) ");
  englishTitle.append(el("span", "studio-hint", "읽기 전용"));
  const englishHead = el("div", "studio-video-prompt-head");
  englishHead.append(englishTitle, copy);
  const englishBlock = el("div");
  englishBlock.append(englishHead, prompt);
  const koreanHead = el("div", "studio-video-prompt-head");
  koreanHead.append(el("h3", "", "한국어 (고치기)"));
  const koreanBlock = el("div");
  koreanBlock.append(
    koreanHead,
    promptKo,
    untranslated,
    actions(save, reset),
  );
  const prompts = el("div", "studio-video-prompts");
  prompts.append(englishBlock, koreanBlock);

  const generateBlock = el("div", "studio-video-generate");
  generateBlock.append(
    el("h3", "", "③ 영상 만들기"),
    actions(makeImage, makeCut, generate),
    genStatus,
  );

  // ---------- ③ 만들기: 확인 창 · 요청 · 상태 확인 ----------
  const STATUS_LABELS = { queued: "대기 중", in_progress: "만드는 중", processing: "만드는 중", completed: "완료",
    failed: "실패", nsfw: "거절됨(부적절 판정)", canceled: "취소됨", cancelled: "취소됨" };
  const RUNNING = ["queued", "in_progress", "processing"];
  const TARGET = { image: { label: "미리보기 이미지" }, video: { label: "영상" } };
  const isRunning = { image: (d) => (d.cuts || []).some((c) => RUNNING.includes(c?.status)), video: (d) => RUNNING.includes(d.job?.status) };
  const chatId = new URL(location.href).searchParams.get("chat");
  const apiBase = root.closest(".studio-page")?.dataset.api;

  async function call(path, options = {}) {
    const response = await fetch(`${apiBase}/chats/${chatId}${path}`, {
      ...options,
      headers: { "Content-Type": "application/json" },
      body: options.body && JSON.stringify(options.body),
    });
    const data = await response.json().catch(() => null);
    if (!data) throw Object.assign(new Error("서버 응답을 읽지 못했습니다."), { unreadable: true });
    if (!data.ok) throw Object.assign(new Error(data.error || "요청에 실패했습니다."), { data });
    return data;
  }

  const fmt = (n) => Number(n).toLocaleString("ko-KR", { maximumFractionDigits: 2 });

  // "미리보기 이미지: 완료 3/5 · 만드는 중 2" (만든 적 없으면 "")
  function cutSummary(d = doc) {
    const made = (d.cuts || []).filter(Boolean);
    if (!made.length) return "";
    const done = made.filter((c) => c.status === "completed").length;
    const running = made.filter((c) => RUNNING.includes(c.status)).length;
    const failed = made.length - done - running;
    return `미리보기 이미지: 완료 ${done}/${d.cuts.length}${running ? ` · 만드는 중 ${running}` : ""}${failed ? ` · 실패 ${failed}` : ""}`;
  }

  function showStatus() {
    const parts = [cutSummary(), doc.job?.status ? `영상: ${STATUS_LABELS[doc.job.status] || doc.job.status}` : ""].filter(Boolean);
    genStatus.textContent = parts.join(" · ") || (doc.image ? "" : "제품 사진을 먼저 올려 주세요.");
  }

  // 비용 확인 창 (base.css dialog). 실행할 수 없으면 이유를 보여 주고 [실행]을 끕니다.
  function confirmDialog(target, quote) {
    return new Promise((resolve) => {
      const dialog = el("dialog");
      // 영상: 첫 컷 그림으로 시작, 마지막 컷 그림으로 끝(서버 _gen_args와 같은 규칙)
      const done = doc.cuts.map((c) => c?.status === "completed");
      const frames = done[0] && done.length > 1 && done.at(-1) ? "1번 컷 그림으로 시작해 마지막 컷 그림으로 끝"
        : done[0] ? "1번 컷 그림으로 시작" : done.length > 1 && done.at(-1) ? "마지막 컷 그림 참고" : "제품 사진 참고";
      const lines = el("ul");
      lines.append(
        el("li", "", `이번에 쓰일 크레딧: ${fmt(quote.credits)}`),
        el("li", "", `계정 남은 크레딧: ${fmt(quote.balance)} → 실행 후 약 ${fmt(quote.balance - quote.credits)}`),
        el("li", "", `오늘 대시보드 사용: ${fmt(quote.today_used)} / ${fmt(quote.daily_limit)}`),
        el("li", "", "제품 사진: 자동 (컷에 맞춰 겉모습·단면·선물세트)"),
      );
      const run = el("button", "btn dark", "실행");
      run.type = "button";
      run.disabled = !quote.allowed;
      const cancel = el("button", "btn", "취소");
      cancel.type = "button";
      dialog.append(
        el("h2", "", `${TARGET[target].label} 만들기`),
        el("p", "studio-hint", target === "video" ? `Kling 4.0 · 720p · ${doc.duration}초 · ${frames}`
          : quote.scene === null || quote.scene === undefined
            ? `Nano Banana 2 · 컷마다 1장씩 ${quote.count}장 (장당 ${fmt(quote.unit)})`
            : `Nano Banana 2 · ${quote.scene + 1}번 컷 1장`),
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

  // scene: 미리보기 이미지를 만들 컷(0부터). 없으면 모든 컷.
  async function askGenerate(target, scene = null) {
    genButtons.forEach((button) => { button.disabled = true; });
    genStatus.textContent = "비용과 남은 크레딧을 확인하는 중… (무료)";
    try {
      let { quote } = await call("/generate/quote", { method: "POST", body: { target, scene } });
      while (await confirmDialog(target, quote)) {
        genStatus.textContent = `${TARGET[target].label} 요청을 보내는 중…`;
        try {
          const data = await call("/generate", { method: "POST", body: { target, scene, credits: quote.credits } });
          // 보낸 뒤 "✓ …" 안내 없이 바로 진행 상태를 보여 줍니다(2026-10-27 유진 요청). 일부만 보냈을 때의 경고만 남깁니다.
          applyResult(data.design, data.warning || "");
          return;
        } catch (error) {
          // 비용이 바뀌었거나 한도를 넘으면 새 숫자로 다시 묻습니다.
          if (error.data?.quote) { quote = error.data.quote; continue; }
          // 요청이 들어갔을 수 있으면(서버가 알려 주거나, 응답을 읽지 못함) 다시 누르지 못하게 막습니다(이중 결제 방지).
          if (error.data?.submitted || error.unreadable) {
            locked = true;
            genStatus.textContent = error.data?.submitted ? error.message
              : "요청 결과를 확인하지 못했어요. 크레딧이 나갔을 수 있으니 다시 누르지 말고, 새로고침 후 상태를 확인해 주세요.";
            return;
          }
          throw error;
        }
      }
      showStatus();
    } catch (error) {
      genStatus.textContent = `요청하지 못했습니다. (${error.message})`;
    } finally {
      genButtons.forEach((button) => { button.disabled = locked || !canGenerate(); });
    }
  }

  // 작업 상태는 지금 문서에 바로 적습니다(sns.js가 들고 있는 문서와 같은 객체). 고치던 내용이 없을 때만 다시 그립니다(보던 컷 유지).
  // 다시 그렸으면 true (새 화면이 상태 확인을 이어 갑니다).
  function applyResult(next, message) {
    doc.keyframes = next.keyframes;
    doc.keyframe = next.keyframe;
    doc.cuts = next.cuts;
    doc.job = next.job;
    if (save.disabled) {
      renderVideo(root, doc, { ...options, notice: message, cut: selected });
      return true;
    }
    genStatus.textContent = message || "";
    if (!message) showStatus();
    return false;
  }

  // 만드는 중이면 8초마다 상태만 확인합니다(무료, 다시 만들지 않음). 화면을 떠나면 멈춥니다.
  // 미리보기 이미지는 컷마다 끝나는 대로 보여 주고(바뀐 컷이 있을 때만 다시 그림), 모두 끝나면 남은 크레딧을 알려 줍니다.
  function poll() {
    const target = Object.keys(TARGET).find((name) => isRunning[name](doc));
    if (!target || !chatId) return;
    setTimeout(async () => {
      if (!wrap.isConnected) return;
      try {
        const data = await call(`/generate/status?target=${target}`);
        const running = isRunning[target](data.design);
        if (running) {
          const changed = target === "image" && JSON.stringify(data.design.cuts) !== JSON.stringify(doc.cuts);
          if (!changed || !applyResult(data.design, cutSummary(data.design))) poll();
          return;
        }
        const balance = data.balance === null ? "" : ` · 계정 남은 크레딧 ${fmt(data.balance)}`;
        const status = data.design.job?.status;
        const result = target === "image" ? cutSummary(data.design) : `${TARGET[target].label} ${STATUS_LABELS[status] || status}`;
        applyResult(data.design, `${result}${balance} · `
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

  // 고른 컷의 미리보기 이미지 (영상이 없을 때)
  function showCut(index) {
    const c = doc.cuts[index];
    makeCut.textContent = `${index + 1}번 컷 이미지 ${c ? "다시 " : ""}만들기`;
    if (!still) return;
    const url = c?.status === "completed" ? c.image_url : "";
    still.hidden = !url;
    if (url) still.src = url;
    sceneLabel.hidden = Boolean(url);
    frame.classList.toggle("is-placeholder", !url);
    frameBadge.textContent = url ? `${index + 1}번 컷 미리보기 이미지 · 영상 생성 전`
      : RUNNING.includes(c?.status) ? `${index + 1}번 컷 이미지 만드는 중…` : "미리보기 · 영상 생성 전";
  }

  // seek=true면 완성 영상도 그 장면 시작으로 옮깁니다.
  function select(index, seek = true) {
    selected = index;
    showCut(index);
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
    next.user_refs = [...refs.user_refs];
    next.ref_video = refs.ref_video;
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
  // 위: 미리보기 | ① 장면 구성 → 레퍼런스(프롬프트에 반영) → ② 프롬프트 검토 → ③ 만들기
  const refsBlock = el("div", "studio-video-refs");
  refsBlock.append(el("h3", "", "레퍼런스 (선택)"), refBox);
  wrap.append(top, refsBlock, prompts, generateBlock);
  root.replaceChildren(wrap);
  updateTimes();
  select(Math.min(cut, doc.scenes.length - 1), false);
  if (notice) genStatus.textContent = notice;
  else showStatus();
  poll();
}
