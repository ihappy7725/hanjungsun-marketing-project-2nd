// 사진 편집 창 (자르기·보정·배경 제거) [희주]
// 위쪽 [✂️ 배경 제거] 버튼(data-role="remove-bg")에 팝업을 붙입니다. README 5장
const API = "/content_studio/media/api/remove-bg";
const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp"];
const MAX_SIDE = 4096;
const FAIL_MESSAGE = "배경을 제거하지 못했습니다. 다른 사진으로 다시 시도해 주세요.";

function buildDialog() {
  const dialog = document.createElement("dialog");
  dialog.className = "img-editor";
  dialog.innerHTML = `
    <button type="button" class="close" data-act="close" aria-label="닫기">×</button>
    <h2>✂️ 배경 제거</h2>
    <p class="img-editor-hint">제품이 또렷하게 다 보이는 사진일수록 결과가 깔끔합니다. (JPEG·PNG·WEBP, 가로·세로 4096px 이하)</p>
    <div class="img-editor-controls">
      <input type="file" accept="image/jpeg,image/png,image/webp" data-act="pick">
      <label><input type="checkbox" data-act="matting"> 가장자리 다듬기</label>
      <button type="button" class="btn dark" data-act="run">배경 제거</button>
    </div>
    <p class="img-editor-msg" data-act="msg" aria-live="polite"></p>
    <div class="img-editor-row">
      <figure><figcaption>원본</figcaption><img data-act="before" alt=""></figure>
      <figure><figcaption>결과</figcaption><img data-act="after" class="img-editor-checker" alt=""></figure>
    </div>
    <a class="btn" data-act="down" hidden>⬇ PNG 받기</a>`;
  document.body.append(dialog);
  return dialog;
}

function readSize(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { resolve({ url, width: img.naturalWidth, height: img.naturalHeight }); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("bad image")); };
    img.src = url;
  });
}

function setup(button) {
  const dialog = buildDialog();
  const $ = (name) => dialog.querySelector(`[data-act="${name}"]`);
  const pick = $("pick"), matting = $("matting"), run = $("run"), msg = $("msg");
  const before = $("before"), after = $("after"), down = $("down");
  let fileId = null;  // 서버에 올린 원본. 다듬기만 바꿔 다시 처리할 때 씁니다.
  let busy = false;

  const show = (text, isError = false) => {
    msg.textContent = text;
    msg.classList.toggle("is-error", isError);
  };

  const resetResult = () => {
    after.removeAttribute("src");
    down.hidden = true;
  };

  pick.addEventListener("change", async () => {
    fileId = null;
    resetResult();
    show("");
    const file = pick.files[0];
    if (!file) { before.removeAttribute("src"); return; }
    if (!ALLOWED_TYPES.includes(file.type)) {
      pick.value = "";
      before.removeAttribute("src");
      show("JPEG·PNG·WEBP 이미지만 올릴 수 있습니다.", true);
      return;
    }
    try {
      const { url, width, height } = await readSize(file);
      if (width > MAX_SIDE || height > MAX_SIDE) {
        URL.revokeObjectURL(url);
        pick.value = "";
        before.removeAttribute("src");
        show(`가로·세로가 각각 ${MAX_SIDE}px 이하인 사진만 올릴 수 있습니다. (지금 ${width}×${height})`, true);
        return;
      }
      before.src = url;
    } catch {
      pick.value = "";
      show("사진을 열 수 없습니다. 다른 사진을 골라 주세요.", true);
    }
  });

  run.addEventListener("click", async () => {
    if (busy) return;
    const file = pick.files[0];
    if (!file && !fileId) { show("사진을 먼저 골라 주세요.", true); return; }

    const form = new FormData();
    if (fileId) form.append("file_id", fileId);
    else form.append("image", file);
    form.append("alpha_matting", matting.checked ? "1" : "0");

    // 기다리는 동안 몇 초째인지 보여줍니다 (멈춘 게 아니라는 표시)
    busy = true;
    run.disabled = pick.disabled = matting.disabled = true;
    let sec = 0;
    const tick = () => show(`처리 중... ${sec}초 ⏳ (1~2분 걸릴 수 있어요. 처음 한 번은 모델을 내려받아 더 오래 걸려요)`);
    tick();
    const timer = setInterval(() => { sec += 1; tick(); }, 1000);

    try {
      const res = await fetch(API, { method: "POST", body: form });
      const data = await res.json().catch(() => ({ ok: false }));
      if (!data.ok) { show(data.error || FAIL_MESSAGE, true); return; }
      fileId = data.file_id;
      const url = `${data.result_url}?t=${Date.now()}`;  // 다시 처리하면 같은 주소라 새로 불러오게 함
      after.src = url;
      down.href = url;
      down.download = `nobg_${data.file_id.slice(0, 8)}.png`;
      down.hidden = false;
      show(`완료! 🎉 (${sec}초 걸림) 경계가 거칠면 "가장자리 다듬기"를 켜고 다시 눌러 보세요.`);
    } catch {
      show(FAIL_MESSAGE, true);
    } finally {
      clearInterval(timer);
      busy = false;
      run.disabled = pick.disabled = matting.disabled = false;
    }
  });

  $("close").addEventListener("click", () => dialog.close());
  dialog.addEventListener("cancel", (event) => { if (busy) event.preventDefault(); });
  button.addEventListener("click", () => dialog.showModal());
}

const removeBgButton = document.querySelector('[data-role="remove-bg"]');
if (removeBgButton) setup(removeBgButton);
