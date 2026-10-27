// HOME 화면 스크립트 [주연]
// type="module"로 불러오므로 전역 변수·함수가 생기지 않습니다. (README 7장)

const DAY = 86400000;
const DAY_SLOTS = 4; // 달력 한 칸에 보여 주는 최대 개수(기간 막대 포함)
const KIND_ORDER = ['local', 'campaign', 'schedule', 'creator', 'task']; // 날짜 칸 표시 순서
export const TASK_STATES = { todo: '예정', doing: '진행 중', blocked: '보류', done: '완료', cancelled: '취소' };
export const TASK_CATEGORIES = { '': '미지정', research: '조사', content: '콘텐츠', collaboration: '협업', meeting: '회의', other: '기타' };
const CAMPAIGN_STATES = { preparing: '준비', active: '진행', done: '완료', blocked: '보류', cancelled: '취소', archived: '보관' };
const TABS = { market_analysis: '현지 시장 분석', content_studio: '콘텐츠 스튜디오', influencer_marketing: '인플루언서 마케팅', kpi: 'KPI' };
const TEMPLATE = [
  ['research', -35, '다낭 현지조사·타깃 가설 정리', 'market_analysis'],
  ['strategy', -28, '목적·제품·타깃 확정', 'market_analysis'],
  ['proposal', -21, '인플루언서 협업 제안', 'influencer_marketing'],
  ['draft', -14, '홍보 소재 초안 준비', 'content_studio'],
  ['review', -7, '광고 문구·소재 최종 검토', 'content_studio'],
  ['schedule', -3, '협업·채널 게시 일정 확정', 'influencer_marketing'],
  ['launch', 0, '이벤트 공개·링크 확인', 'content_studio'],
  ['reaction', 3, '초기 반응 확인', 'kpi'],
  ['retrospective', 7, '이벤트 회고·개선점 기록', 'kpi'],
];
export function validDate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
}
export function validTime(value) {
  return typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}
export function addDays(value, offset) { return new Date(Date.parse(value) + Number(offset) * DAY).toISOString().slice(0, 10); }
export function dayDiff(a, b) { return Math.round((Date.parse(a) - Date.parse(b)) / DAY); }
export function dday(target, today) { const n = dayDiff(target, today); return n === 0 ? 'D-Day' : n > 0 ? `D-${n}` : `D+${-n}`; }
export function periodSegments(events, weekStart) {
  const weekEnd = addDays(weekStart, 6), lanes = [];
  return events.filter(e => e.kind === 'local' && e.date < e.end && e.date <= weekEnd && e.end >= weekStart)
    .sort((a, b) => a.date.localeCompare(b.date) || b.end.localeCompare(a.end) || a.id.localeCompare(b.id))
    .map(event => {
      const start = event.date < weekStart ? weekStart : event.date;
      const end = event.end > weekEnd ? weekEnd : event.end;
      let lane = lanes.findIndex(last => last < start);
      if (lane < 0) lane = lanes.length;
      lanes[lane] = end;
      return { event, start, end, lane, column: dayDiff(start, weekStart) + 1,
        span: dayDiff(end, start) + 1, continuesBefore: event.date < start, continuesAfter: event.end > end };
    });
}
export function progress(tasks) {
  const included = tasks.filter(t => t.status !== 'cancelled');
  const done = included.filter(t => t.status === 'done').length;
  return { total: included.length, done, percent: included.length ? Math.round(done / included.length * 100) : 0 };
}
export function ordered(tasks, today) {
  const group = t => !t.due_date ? 4 : t.due_date < today ? 0 : t.due_date === today ? 1 : t.due_date <= addDays(today, 7) ? 2 : 3;
  return [...tasks].sort((a, b) => group(a) - group(b) || (a.due_date || '9999').localeCompare(b.due_date || '9999') || a.title.localeCompare(b.title, 'ko'));
}
export function unfinished(t) { return !['done', 'cancelled'].includes(t.status); }
export function calendarMonthSlots(height, weeks, width = 0) {
  const limit = width > 0 && width < 560 ? 3 : DAY_SLOTS;
  return Math.min(limit, Math.max(2, Math.floor((((height || 440) - 28) / weeks - 28) / 24)));
}
export function weekPointLayout(events, hourHeight = 32) {
  // 종료 시각이 없는 마감 표시의 겹침만 나눕니다. 실제 소요 시간이 아닙니다.
  const visualMinutes = 36 / hourHeight * 60;
  const points = events.filter(e => validTime(e.time)).map(event => {
    const minute = Number(event.time.slice(0, 2)) * 60 + Number(event.time.slice(3));
    const displayStart = Math.max(0, Math.min(minute, 1440 - visualMinutes));
    return { event, minute, displayStart, displayEnd: displayStart + visualMinutes };
  }).sort((a, b) => a.displayStart - b.displayStart || a.event.id.localeCompare(b.event.id));
  const output = []; let group = [], groupEnd = -1;
  const flush = () => {
    const lanes = [];
    group.forEach(point => {
      let lane = lanes.findIndex(end => end <= point.displayStart);
      if (lane < 0) lane = lanes.length;
      lanes[lane] = point.displayEnd; point.lane = lane;
    });
    output.push(...group.map(point => ({ ...point, columns: lanes.length })));
    group = []; groupEnd = -1;
  };
  points.forEach(point => {
    if (group.length && point.displayStart >= groupEnd) flush();
    group.push(point); groupEnd = Math.max(groupEnd, point.displayEnd);
  });
  flush(); return output;
}
export function ganttTone(task, start, today) {
  if (task.status === 'done' || task.due_date < today) return 'past';
  if (task.status === 'blocked') return 'blocked';
  if (dayDiff(task.due_date, today) <= 3) return 'urgent';
  if (task.status === 'doing' || (start <= today && today <= task.due_date)) return 'active';
  if (dayDiff(start, today) <= 3) return 'soon';
  return 'upcoming';
}
export function ganttTaskRows(tasks) {
  // 기존 비취소 업무의 자동 시작 기준을 유지합니다. 이 값은 저장하지 않습니다.
  const dated = tasks.filter(t => t.status !== 'cancelled' && validDate(t.due_date)).sort((a, b) => a.due_date.localeCompare(b.due_date));
  const starts = new Map(dated.map((t, i) => [t.id, t.start_date || (i ? dated[i - 1].due_date : addDays(t.due_date, -3))]));
  return [...tasks].sort((a, b) => (validDate(a.due_date) ? a.due_date : '9999').localeCompare(validDate(b.due_date) ? b.due_date : '9999')).map(task => {
    const due = validDate(task.due_date) ? task.due_date : '';
    const candidate = task.start_date || starts.get(task.id) || '';
    const start = validDate(candidate) ? candidate : '';
    const invalid = Boolean((task.start_date && !validDate(task.start_date)) || (task.due_date && !due) || (start && due && start > due));
    return { task, start, due, invalid, estimated: Boolean(start && !task.start_date), point: Boolean(due && !start && !invalid) };
  });
}
export function replanTasks(tasks, target, edits) {
  return tasks.map(t => {
    const edit = edits.find(e => e.id === t.id);
    if (!edit || !unfinished(t) || t.fixed) return { ...t };
    const due = addDays(target, edit.offset);
    const shift = t.due_date ? dayDiff(due, t.due_date) : 0;
    return { ...t, title: edit.title, offset: edit.offset, due_date: due, start_date: t.start_date ? addDays(t.start_date, shift) : '' };
  });
}
export function cloneTasks(tasks, campaignId, target, oldTarget, makeId) {
  return tasks.filter(t => t.status !== 'cancelled').map(t => {
    const due = t.fixed ? (t.due_date ? addDays(t.due_date, dayDiff(target, oldTarget)) : '') : addDays(target, t.offset);
    return { ...t, id: makeId(), campaign_id: campaignId, status: 'todo', completed_at: '', due_date: due,
      start_date: t.start_date && t.due_date ? addDays(t.start_date, dayDiff(due, t.due_date)) : '' };
  });
}
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// 첫 문장만 미리 보여 주며, 전체 내용은 카드의 펼침 영역에 그대로 남깁니다.
const newsPreview = (value, limit = 80) => {
  const text = String(value ?? '').trim();
  const sentence = text.match(/^[\s\S]*?[.!?](?=\s|$)/u)?.[0] || text;
  return sentence.length > limit ? sentence.slice(0, limit).trimEnd() + '…' : sentence;
};
const id = () => `vn_home_${crypto.randomUUID()}_${new Date().getUTCFullYear()}`;
const kstToday = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const shortDate = value => value ? value.slice(5).replace('-', '/') : '날짜 없음';
const empty = text => `<p class="home-empty">${esc(text)}</p>`;
const badge = (text, warning = false, state = '') => `<span class="home-badge${warning ? ' warning' : ''}${state ? ` is-${esc(state)}` : ''}">${esc(text)}</span>`;
function safeUrl(value, fallback = '') {
  try { const url = new URL(value, location.origin); return ['https:', 'http:'].includes(url.protocol) ? url.href : fallback; } catch { return fallback; }
}
function tabLink(tab) { return Object.hasOwn(TABS, tab) ? `/${tab}/` : '/home/'; }

function blankStore() { return { version: 1, campaigns: [], tasks: [], schedules: [], links: [], preferences: { selected: '', preset: '45' } }; }
function validStore(s) {
  return s && s.version === 1 && Array.isArray(s.campaigns) && Array.isArray(s.tasks) && Array.isArray(s.schedules) && Array.isArray(s.links) && s.preferences &&
    s.campaigns.every(c => typeof c.id === 'string' && typeof c.name === 'string' && validDate(c.target_date)) &&
    s.tasks.every(t => typeof t.id === 'string' && typeof t.title === 'string' && Object.hasOwn(TASK_STATES, t.status) && (t.category === undefined || (typeof t.category === 'string' && Object.hasOwn(TASK_CATEGORIES, t.category))) && (!t.due_date || validDate(t.due_date)) && (!t.start_date || validDate(t.start_date))) &&
    new Set(s.tasks.map(t => t.id)).size === s.tasks.length && new Set(s.campaigns.map(c => c.id)).size === s.campaigns.length;
}

if (typeof document !== 'undefined') initialize();
function setupPanelResize(root) {
  const side = root.querySelector('.home-side-panels');
  if (!side) return;
  const panels = [...side.children];
  // 브라우저의 크기 조절 손잡이는 inline 높이를 바꿉니다. 해당 행만 고정하고 나머지 공간을 나눕니다.
  const updateRows = () => {
    if (panels.every(panel => !panel.style.height)) {
      side.style.removeProperty('grid-template-rows');
      return;
    }
    side.style.gridTemplateRows = panels.map(panel => /^\d+(?:\.\d+)?px$/.test(panel.style.height)
      ? `minmax(240px, ${panel.style.height})` : 'minmax(240px, 1fr)').join(' ');
  };
  const observer = new MutationObserver(updateRows);
  panels.forEach(panel => observer.observe(panel, { attributes: true, attributeFilter: ['style'] }));
}
async function initialize() {
  const root = document.querySelector('.home-page');
  if (!root) return;
  setupPanelResize(root);
  const $ = selector => root.querySelector(selector);
  let today = kstToday(), selectedDate = today, cursor = today, panel = 'month';
  const TIMEZONE_LABEL = 'KST', WEEK_MODE_KEY = 'hjs-home-week-view-v1';
  let weekMode = null, weekScroll = { start: '', top: null, left: 0 };
  try { const saved = localStorage.getItem(WEEK_MODE_KEY); if (['timeline', 'list'].includes(saved)) weekMode = saved; } catch { /* 보기 설정만 보관합니다. */ }
  let view = 'month';
  let store = blankStore(), locked = false, signals = null, requestNumber = 0, toastTimer;
  let renderedNewsMarkup = null;
  let serverToken = null, serverBaseline = null, storageBusy = false;
  let taskCategoriesAvailable = false;
  const categoriesEnabled = () => taskCategoriesAvailable;
  const taskCategoryText = task => categoriesEnabled() ? ` · 종류: ${esc(TASK_CATEGORIES[task.category || ''])}` : '';
  const preferencesKey = 'hjs-home-server-work-preferences-v1';
  const showError = message => { $('#storage-error').hidden = !message; $('#storage-error').textContent = message; };
  function toast(message) { clearTimeout(toastTimer); $('#home-toast').textContent = message; $('#home-toast').hidden = false; toastTimer = setTimeout(() => { $('#home-toast').hidden = true; }, 2800); }
  const workData = value => ({ version: 1, campaigns: value.campaigns, tasks: value.tasks, schedules: value.schedules, links: value.links });
  function storageControls(busy) {
    storageBusy = busy;
    const readOnly = busy || locked || serverToken === null;
    for (const selector of ['#new-campaign', '#clone-campaign', '#replan-campaign', '#delete-campaign', '#open-review', '#campaign-select']) {
      const control = $(selector); if (control) control.disabled = readOnly || (selector !== '#new-campaign' && !selected());
    }
    root.querySelectorAll('[data-check]').forEach(control => { control.disabled = readOnly; });
    root.setAttribute('aria-busy', String(busy));
  }
  async function workRequest(method, payload) {
    let response;
    try {
      response = await fetch(root.dataset.workStoreUrl, { method, credentials: 'same-origin', cache: 'no-store',
        ...(payload ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) } : {}) });
    } catch { throw new Error('서버 응답을 확인하지 못했습니다. 저장 요청을 보냈다면 새로고침해 저장 여부를 확인해주세요.'); }
    let result;
    try { result = await response.json(); }
    catch { throw new Error('서버 응답을 읽지 못했습니다. 새로고침해 기록을 확인해주세요.'); }
    if (!response.ok) throw new Error(result.error || '서버에서 처리하지 못했습니다. 새로고침해주세요.');
    if (typeof result.token !== 'string' || !validStore({ ...result.data, preferences: {} })) throw new Error('서버 기록의 형식을 확인하지 못했습니다. 편집을 멈췄습니다.');
    return result;
  }
  function rememberPreferences(value) {
    try { localStorage.setItem(preferencesKey, JSON.stringify(value)); }
    catch { toast('업무 저장과 별개로 화면 선택 설정을 브라우저에 보관하지 못했습니다.'); }
  }
  async function load() {
    locked = true; showError(''); storageControls(true);
    serverToken = null; serverBaseline = null; store = blankStore(); taskCategoriesAvailable = false;
    try {
      let preferences = blankStore().preferences;
      try {
        const previous = JSON.parse(localStorage.getItem(preferencesKey) || 'null');
        if (previous && typeof previous === 'object' && !Array.isArray(previous)) preferences = { ...preferences, ...previous };
      } catch { /* Screen preferences are independent of server records. */ }
      const result = await workRequest('GET');
      store = { ...result.data, preferences }; serverToken = result.token;
      taskCategoriesAvailable = result.task_categories_enabled === true;
      serverBaseline = JSON.stringify(workData(store));
      if (!validStore(store)) throw new Error('invalid');
      locked = false;
    } catch (error) {
      locked = true; store = blankStore();
      showError('서버 기록을 불러오지 못해 편집을 멈췄습니다. ' + error.message);
    } finally { storageControls(false); }
  }
  async function save(next, deleteCampaignIds = []) {
    if (locked) { toast('저장소를 확인한 뒤 새로고침해주세요.'); return false; }
    if (storageBusy) { toast('저장이 끝난 뒤 다시 눌러주세요.'); return false; }
    if (!validStore(next)) { showError('저장할 기록의 형식이 올바르지 않습니다. 기존 기록은 유지됩니다.'); return false; }
    const data = workData(next);
    if (JSON.stringify(data) === serverBaseline && !deleteCampaignIds.length) {
      store = next; rememberPreferences(next.preferences); return true;
    }
    storageControls(true);
    try {
      const result = await workRequest('POST', { token: serverToken, data, delete_campaign_ids: deleteCampaignIds });
      store = { ...result.data, preferences: next.preferences }; serverToken = result.token;
      taskCategoriesAvailable = result.task_categories_enabled === true;
      serverBaseline = JSON.stringify(workData(store)); rememberPreferences(next.preferences); showError('');
      return true;
    } catch (error) {
      locked = true; showError('저장 성공 여부를 확인하지 못했습니다. ' + error.message + ' 새로고침 전까지 편집을 멈춥니다.');
      return false;
    } finally { storageControls(false); }
  }
  const selected = () => store.campaigns.find(c => c.id === store.preferences.selected) || store.campaigns[0];
  const inScope = () => store.tasks;
  const campaignName = campaignId => store.campaigns.find(c => c.id === campaignId)?.name || '이벤트 없음';
  function range() { return { start: $('#range-start').value, end: $('#range-end').value }; }
  function updateRange() {
    const preset = store.preferences.preset || '45'; $('#range-preset').value = preset;
    $('#range-custom').open = preset === 'custom';
    $('#range-start').value = preset === 'custom' ? store.preferences.range_start || today : today;
    $('#range-end').value = preset === 'custom' ? store.preferences.range_end || today : addDays(today, Number(preset));
  }
  function localEvents() {
    return (signals?.events.items || []).filter(e => e.is_demo !== true).map(e => ({ ...e, start: e.start_date || e.date, end: e.end_date || e.start_date || e.date })).filter(e => validDate(e.start) && validDate(e.end) && e.end >= e.start);
  }
  function overlaps(t) { return t.due_date ? localEvents().filter(e => e.start <= t.due_date && e.end >= t.due_date) : []; }
  function creators() {
    return (signals?.collaborations.items || []).filter(c => c.is_demo !== true && c.status !== 'declined');
  }
  function calendarEvents() {
    const events = inScope().filter(t => t.due_date && t.status !== 'cancelled').map(t => ({ date: t.due_date, end: t.due_date, title: t.title, kind: 'task', id: t.id, done: t.status === 'done', time: validTime(t.due_time) ? t.due_time : '' }));
    const locals = localEvents();
    locals.forEach(e => events.push({ date: e.start, end: e.end, title: e.name, kind: 'local', id: e.event_id, provisional: e.provisional === true }));
    // 현지 일정에서 만든 이벤트는 같은 날 같은 이름으로 두 줄이 됩니다. 현지 일정 쪽만 남기고 디데이 표시만 붙입니다.
    store.campaigns.forEach(c => {
      const anchor = locals.find(e => e.event_id && e.event_id === c.event_id && e.start <= c.target_date && e.end >= c.target_date);
      if (anchor) { const row = events.find(e => e.kind === 'local' && e.id === anchor.event_id); if (row) row.campaignId = c.id; return; }
      events.push({ date: c.target_date, end: c.target_date, title: c.name, kind: 'campaign', id: c.id });
    });
    store.schedules.filter(s => validDate(s.date)).forEach(s => events.push({ date: s.date, end: s.date, title: s.title || s.name, kind: 'schedule', id: s.id }));
    creators().forEach(c => ['shoot_date', 'post_date'].forEach(field => {
      if (validDate(c[field])) events.push({ date: c[field], end: c[field], title: `${c.influencer} · ${field === 'post_date' ? '게시' : '촬영'}`, kind: 'creator', id: c.collaboration_id, link: c.link });
    }));
    return events;
  }
  function eventSources(e) {
    if (e.is_demo) return "";
    const sources = Array.isArray(e.sources) ? e.sources : [];
    if (sources.length) return sources.map((source, i) => {
      const url = safeUrl(source.url);
      return url ? `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">출처 ${i + 1} · ${esc(source.publisher)} ↗</a>` : esc(source.publisher);
    }).join('<br>');
    return `${esc(e.source_name || '출처 정보 미제공')}${safeUrl(e.source_url) ? ` <a href="${esc(safeUrl(e.source_url))}" target="_blank" rel="noopener noreferrer">출처 ↗</a>` : ''}`;
  }
  function monthly(e) { return e?.date_precision === 'month'; }
  function eventPeriod(e) {
    // 월 단위 자료는 달까지만 보여 주어 확인되지 않은 일 단위 기간으로 읽히지 않게 합니다.
    const from = monthly(e) ? String(e.start).slice(0, 7) : e.start, to = monthly(e) ? String(e.end).slice(0, 7) : e.end;
    return `${esc(from)}${to !== from ? ` ~ ${esc(to)}` : ''}`;
  }
  function eventSummary(e) {
    return `<p class="home-signal-meta">${eventPeriod(e)}</p>${monthly(e) ? badge('월 단위 · 일 단위 미확인') : ''}${e.applies_to ? `<p>${esc(e.applies_to)}</p>` : ''}`;
  }
  function showLocalEvent(eventId) {
    const e = localEvents().find(item => item.event_id === eventId);
    if (!e) { toast('일정 정보를 찾지 못했습니다. 다시 조회해주세요.'); return; }
    // 저장된 문장을 나눠 읽기 쉽게 표시합니다. 사실을 새로 요약하거나 검증하지 않습니다.
    const points = text => String(text || '').split(/(?<=[.!?。])\s+|\r?\n+/).filter(s => s.trim()).map(s => `<li>${esc(s.trim())}</li>`).join('');
    openDialog(e.name, `<div class="home-local-detail">
      <div class="home-local-lead">${e.is_demo ? badge('예시 데이터 (DEMO)') : badge(e.provisional ? '미확정 · 정부 공문 전' : '출처 확인 자료', e.provisional === true)}${monthly(e) ? badge('월 단위 · 일 단위 미확인') : ''}<p class="home-local-original">${esc(e.official_name || e.name)}</p></div>
      <dl class="home-local-facts"><div><dt>기간</dt><dd>${eventPeriod(e)}</dd></div>${e.region ? `<div><dt>지역</dt><dd>${esc(e.region)}</dd></div>` : ''}${e.applies_to ? `<div><dt>적용 대상</dt><dd>${esc(e.applies_to)}</dd></div>` : ''}${e.schedule_nature ? `<div><dt>일정 성격</dt><dd>${esc(e.schedule_nature)}</dd></div>` : ''}</dl>
      ${e.description ? `<section><h3>일정 안내</h3><ul class="home-local-points">${points(e.description)}</ul></section>` : ''}
      ${!e.is_demo ? `<section><h3>근거 자료</h3><div class="home-local-sources">${eventSources(e)}</div></section>` : ''}
      ${e.original_period || e.verification_notes || e.verified_at ? `<details class="home-local-verification"><summary>원문 기간 · 확인 범위</summary>${e.original_period ? `<p><strong>원문 기간</strong> ${esc(e.original_period)}</p>` : ''}${e.verified_at ? `<p class="home-muted">자료 확인일: ${esc(e.verified_at)}</p>` : ''}${e.verification_notes ? `<ul class="home-local-points">${points(e.verification_notes)}</ul>` : ''}</details>` : ''}
      <div class="home-form-actions"><button class="btn dark" data-create="${esc(e.event_id)}">+ 이벤트 기획</button></div>
    </div>`);
  }
  function eventAction(e) {
    if (e.kind === 'task') return `<button class="btn" data-task="${esc(e.id)}">열기</button>`;
    if (e.kind === 'creator') return `<a class="btn" href="${esc(safeUrl(e.link || `/influencer_marketing/?collaboration_id=${encodeURIComponent(e.id)}`))}">협업 보기 ↗</a>`;
    if (e.kind === 'local') return `<button class="btn" data-local="${esc(e.id)}">일정 상세</button>`;
    if (e.kind === 'campaign') return `<button class="btn" data-select="${esc(e.id)}">이벤트 보기</button>`;
    return '';
  }
  function monthEventState(e) {
    // 월간 표시만 꾸밉니다. 다른 보기에서 사용하는 일정 객체나 저장 상태는 바꾸지 않습니다.
    if (e.kind === 'task') {
      const task = store.tasks.find(t => t.id === e.id);
      if (!task) return { label: '', tone: '' };
      const late = unfinished(task) && task.due_date && task.due_date < today;
      return { label: late ? `기한 초과 · ${TASK_STATES[task.status]}` : TASK_STATES[task.status],
        short: late ? '지연' : task.status === 'done' ? '✓' : task.status === 'doing' ? '진행' : TASK_STATES[task.status],
        tone: late ? 'overdue' : task.status };
    }
    if (e.kind === 'campaign') {
      const c = store.campaigns.find(item => item.id === e.id);
      return { label: c ? CAMPAIGN_STATES[c.status] || '' : '',
        tone: c ? ({ preparing: 'todo', active: 'doing', done: 'done', blocked: 'blocked', cancelled: 'cancelled', archived: 'archived' }[c.status] || '') : '' };
    }
    if (e.kind === 'creator') return { label: creators().find(c => c.collaboration_id === e.id)?.status_label || '', tone: '' };
    return { label: '', tone: '' };
  }
  function monthEventDescription(e, state = monthEventState(e)) {
    return `${e.title}${state.label ? ` · ${state.label}` : ''}${e.provisional ? ' · 법정일 기준, 연휴 기간 미확정' : ''}${e.campaignId ? ' · 이벤트 기준일' : ''}`;
  }
  function showMonthDay(day) {
    const rows = calendarEvents().filter(e => e.date <= day && e.end >= day)
      .sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind));
    selectedDate = day; renderCalendar(); renderTasks();
    root.querySelector(`[data-month-more="${day}"]`)?.focus();
    openDialog(`${day} · 전체 일정 ${rows.length}건`, rows.map(e => {
      const state = monthEventState(e);
      return `<div class="home-agenda-row"><div><strong>${esc(e.title)}</strong><p class="home-signal-meta">${esc(e.date)}${e.end !== e.date ? ` ~ ${esc(e.end)}` : ''}${state.label ? ` · ${esc(state.label)}` : ''}${e.provisional ? ' · 연휴 기간 미확정' : ''}</p></div><button class="btn" type="button" data-month-kind="${esc(e.kind)}" data-month-id="${esc(e.id)}" data-month-date="${e.date}" data-month-title="${esc(e.title)}">상세 보기</button></div>`;
    }).join(''));
  }
  async function openMonthEvent(kind, eventId, date = '', title = '') {
    const e = calendarEvents().find(item => item.kind === kind && item.id === eventId && (!date || item.date === date) && (!title || item.title === title));
    if (!e) { toast('일정 정보를 찾지 못했습니다. 다시 조회해주세요.'); return; }
    if (dialog.open) dialog.close();
    if (kind === 'task') editTask(eventId);
    else if (kind === 'local') showLocalEvent(eventId);
    else if (kind === 'campaign') { await changeCampaign(eventId); if (selected()?.id === eventId) showPanel('campaign'); }
    else openDialog(e.title, `<p>${esc(e.date)}${e.end !== e.date ? ` ~ ${esc(e.end)}` : ''}</p>${monthEventState(e).label ? `<p>${esc(monthEventState(e).label)}</p>` : ''}${eventAction(e)}`);
  }
  function weekChip(e, variant, attributes = '') {
    const state = monthEventState(e), label = state.label || ({ local: '현지 일정', campaign: '이벤트', schedule: '직접 일정', creator: '협업', task: '업무' }[e.kind]);
    const description = `${monthEventDescription(e, state)} · ${e.date}${e.end !== e.date ? ` ~ ${e.end}` : ''}${e.time ? ` · ${e.time} 마감 · 종료 시각 미등록` : ' · 종일'}`;
    const title = `<span class="home-week-chip-title">${esc(e.title)}</span>`;
    const details = variant === 'timed' || variant === 'list'
      ? `${title}<span class="home-week-chip-meta">${e.time ? `${esc(e.time)} 마감` : '종일'} · ${esc(label)}${variant === 'list' && e.date !== e.end ? ` · ${esc(e.date)} ~ ${esc(e.end)}` : ''}</span>`
      : `${state.label ? `<span class="home-week-chip-state" aria-hidden="true">${esc(state.short || state.label)}</span>` : ''}${title}`;
    return `<button type="button" class="home-week-chip ${esc(e.kind)} is-${variant}${state.tone ? ` is-${state.tone}` : ''}${e.provisional ? ' is-provisional' : ''}" data-week-kind="${esc(e.kind)}" data-week-id="${esc(e.id)}" data-week-date="${e.date}" data-week-title="${esc(e.title)}" title="${esc(description)}" aria-label="${esc(description)}" ${attributes}>${details}</button>`;
  }
  function updateWeekNow() {
    const week = $('.home-week-view'); if (!week || view !== 'week') return;
    const day = kstToday(), now = new Date();
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(now).map(p => [p.type, p.value]));
    const minute = Number(parts.hour) * 60 + Number(parts.minute) + Number(parts.second) / 60;
    week.querySelectorAll('[data-week-day]').forEach(column => {
      const current = column.dataset.weekDay === day;
      column.classList.toggle('is-today', current);
      if (column.classList.contains('home-week-date')) {
        if (current) column.setAttribute('aria-current', 'date'); else column.removeAttribute('aria-current');
      }
      const line = column.querySelector('.home-week-now');
      if (line) {
        line.hidden = !current; line.style.top = `${minute / 1440 * 100}%`;
        line.setAttribute('aria-label', `현재 시각 ${parts.hour}:${parts.minute} KST`);
        line.querySelector('span').textContent = `${parts.hour}:${parts.minute}`;
      }
    });
  }
  function renderWeek(events, start, end) {
    const previous = $('.home-week-scroll');
    if (previous) weekScroll = { start: previous.dataset.weekStart, top: previous.scrollTop, left: previous.scrollLeft };
    const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
    const rows = events.filter(e => e.date <= end && e.end >= start);
    if (!weekMode && serverToken) weekMode = rows.some(e => validTime(e.time)) ? 'timeline' : 'list';
    const mode = weekMode || 'list', weekToday = kstToday();
    const dateButton = (day, index, list = false) => `<button type="button" class="home-week-date${day === weekToday ? ' is-today' : ''}${list ? ' is-list-date' : ''}" data-date="${day}" data-week-day="${day}" aria-pressed="${day === selectedDate}" aria-label="${day}, 날짜 선택"${day === weekToday ? ' aria-current="date"' : ''}><span>${['월', '화', '수', '목', '금', '토', '일'][index]}</span><strong>${Number(day.slice(8))}</strong>${list && (index === 0 || day.slice(8) === '01') ? `<small>${day.slice(0, 7).replace('-', '. ')}</small>` : ''}</button>`;
    const toolbar = `<div class="home-week-toolbar"><span class="home-week-zone">한국 시간 · ${TIMEZONE_LABEL}</span><div class="home-week-modes" role="group" aria-label="주간 일정 표시 방식"><button type="button" data-week-mode="timeline" aria-pressed="${mode === 'timeline'}">시간표</button><button type="button" data-week-mode="list" aria-pressed="${mode === 'list'}">목록</button></div></div>`;
    const unavailable = [['events', '현지'], ['collaborations', '협업']].filter(([key]) => signals?.[key]?.state === 'error').map(([, label]) => label);
    const notice = !signals ? '<p class="home-week-notice" role="status">현지·협업 일정을 불러오는 중입니다.</p>' : unavailable.length ? `<p class="home-week-notice" role="status">${unavailable.join('·')} 일정을 불러오지 못했습니다. 확인된 업무와 일정만 표시합니다.</p>` : '';
    if (mode === 'list') {
      $('#calendar-body').innerHTML = `<div class="home-week-view is-list">${toolbar}${notice}<div class="home-week-list">${days.map((day, index) => {
        const items = rows.filter(e => e.date <= day && e.end >= day).sort((a, b) => Number(Boolean(a.time)) - Number(Boolean(b.time)) || (a.time || '').localeCompare(b.time || '') || KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind));
        return `<section class="home-week-list-day">${dateButton(day, index, true)}<div class="home-week-list-items">${items.length ? items.map(e => weekChip(e, 'list')).join('') : '<span class="home-week-empty">일정 없음</span>'}</div></section>`;
      }).join('')}</div></div>`;
      updateWeekNow(); return;
    }
    const allDay = rows.filter(e => !e.time), periods = periodSegments(allDay, start).filter(s => s.lane < 3);
    const cells = days.map(day => {
      const daily = allDay.filter(e => e.date <= day && e.end >= day);
      const singles = daily.filter(e => !(e.kind === 'local' && e.date < e.end));
      const hidden = daily.filter(e => e.kind === 'local' && e.date < e.end && !periods.some(s => s.event.id === e.id)).length;
      const occupied = periods.filter(s => s.start <= day && s.end >= day).reduce((n, s) => Math.max(n, s.lane + 1), 0);
      let shown = Math.min(singles.length, 4 - occupied);
      if (singles.length + hidden > shown && shown > 0) shown--;
      return { day, occupied, singles: singles.slice(0, shown), rest: singles.length - shown + hidden };
    });
    const allRows = Math.max(1, ...periods.map(s => s.lane + 1), ...cells.map(c => c.occupied + c.singles.length + Number(c.rest > 0)));
    const available = $('#calendar-body').clientHeight || 480;
    const hourHeight = Math.max(24, Math.floor((available - 44 - 22 - 56 - (allRows * 24 + 8)) / 12));
    const allMarkup = `<div class="home-week-allday${allDay.length ? '' : ' is-empty'}"><div class="home-week-allday-grid" style="grid-template-rows:repeat(${allRows}, 24px)"><span class="home-week-all-label" style="grid-row:1 / -1">종일</span>${periods.map(s => weekChip(s.event, 'period', `style="grid-column:${s.column + 1} / span ${s.span};grid-row:${s.lane + 1}" data-period-start="${s.start}" data-period-end="${s.end}" data-continues-before="${s.continuesBefore}" data-continues-after="${s.continuesAfter}"`)).join('')}${cells.map((c, index) => c.singles.length || c.rest ? `<div class="home-week-all-cell" style="grid-column:${index + 2};grid-row:${c.occupied + 1} / -1">${c.singles.map(e => weekChip(e, 'all')).join('')}${c.rest ? `<button type="button" class="home-week-more" data-week-more="${c.day}" aria-label="${c.day}, 숨겨진 종일 일정 ${c.rest}건 · 전체 일정 보기">+${c.rest}개 더보기</button>` : ''}</div>` : '').join('')}</div></div>`;
    const hours = Array.from({ length: 24 }, (_, hour) => `${String(hour).padStart(2, '0')}:00`);
    const timeGrid = `<div class="home-week-time-grid"><div class="home-week-hours">${hours.map(label => `<div>${label}</div>`).join('')}</div>${days.map(day => {
      const points = weekPointLayout(rows.filter(e => e.date <= day && e.end >= day && e.time), hourHeight);
      return `<div class="home-week-time-day${day === weekToday ? ' is-today' : ''}" data-week-day="${day}">${hours.map(label => `<button type="button" class="home-week-slot" data-slot="${day} ${label}" aria-label="${day} ${label}, 날짜 선택"></button>`).join('')}${points.map(p => weekChip(p.event, 'timed', `style="top:${p.displayStart / 1440 * 100}%;left:calc(${p.lane / p.columns * 100}% + var(--space-1));width:calc(${100 / p.columns}% - var(--space-2));--week-point-offset:${(p.minute - p.displayStart) * hourHeight / 60}px"`)).join('')}<div class="home-week-now" hidden role="img"><span></span></div></div>`;
    }).join('')}</div>`;
    $('#calendar-body').innerHTML = `<div class="home-week-view is-timeline" style="--home-week-hour:${hourHeight}px">${toolbar}${notice}<p class="home-week-time-note">08–20시 기준 · 하루 전체 스크롤 · 업무는 마감 시각 기준</p><div class="home-week-scroll" data-week-start="${start}"><div class="home-week-table"><div class="home-week-head"><span class="home-week-head-zone">${TIMEZONE_LABEL}</span>${days.map((day, index) => dateButton(day, index)).join('')}</div>${allMarkup}${timeGrid}</div></div></div>`;
    const scroller = $('.home-week-scroll');
    scroller.scrollTop = weekScroll.start === start && weekScroll.top !== null ? weekScroll.top : 8 * hourHeight;
    scroller.scrollLeft = weekScroll.start === start ? weekScroll.left : 0;
    updateWeekNow();
  }
  function renderCalendar() {
    const events = calendarEvents(), at = date => events.filter(e => e.date <= date && e.end >= date);
    let start, end, weekCount = 5;
    if (view === 'month') {
      const first = `${cursor.slice(0, 7)}-01`, weekday = (new Date(first).getUTCDay() + 6) % 7;
      start = addDays(first, -weekday); const nextMonth = new Date(first); nextMonth.setUTCMonth(nextMonth.getUTCMonth() + 1);
      const weeks = Math.max(4, Math.ceil((dayDiff(nextMonth.toISOString().slice(0, 10), first) + weekday) / 7)); weekCount = weeks; end = addDays(start, weeks * 7 - 1);
    } else if (view === 'week') { start = addDays(cursor, -((new Date(cursor).getUTCDay() + 6) % 7)); end = addDays(start, 6); }
    else { start = `${cursor.slice(0, 7)}-01`; const next = new Date(start); next.setUTCMonth(next.getUTCMonth() + 1); end = addDays(next.toISOString().slice(0, 10), -1); }
    $('#calendar-period').textContent = view === 'week'
      ? `${start.slice(0, 4)}. ${shortDate(start).replace('/', '. ')} – ${start.slice(0, 4) === end.slice(0, 4) ? '' : `${end.slice(0, 4)}. `}${shortDate(end).replace('/', '. ')}`
      : `${cursor.slice(0, 4)}. ${cursor.slice(5, 7)}`;
    if (view === 'week') {
      renderWeek(events, start, end); return;
    }
    {
      const monthSlots = calendarMonthSlots($('#calendar-body').clientHeight, weekCount, $('#calendar-body').clientWidth);
      let html = `<div class="home-month" data-week-count="${weekCount}" data-slots="${monthSlots}" style="--home-week-count:${weekCount};--home-month-slots:${monthSlots}"><div class="home-weekdays">` + ['월', '화', '수', '목', '금', '토', '일'].map(d => `<div class="home-weekday">${d}</div>`).join('') + '</div>';
      for (let weekStart = start; weekStart <= end; weekStart = addDays(weekStart, 7)) {
        const segments = periodSegments(events, weekStart).filter(segment => segment.lane < Math.max(1, monthSlots - 1));
        const laneCount = segments.reduce((n, segment) => Math.max(n, segment.lane + 1), 0);
        html += `<div class="home-week" style="--period-lanes:${laneCount};grid-template-rows:var(--home-day-head) ${laneCount ? `repeat(${laneCount}, calc(var(--home-chip-h) + 2px)) ` : ''}1fr">`;
        for (let column = 1; column <= 7; column++) {
          const day = addDays(weekStart, column - 1), allDayEvents = at(day);
          // 이어지는 일정은 기간 막대로만 보여 주고 날짜 칩에서는 뺍니다. 같은 일정이 두 번 나오지 않게 합니다.
          // 공휴일·축제 같은 현지 일정을 맨 위에 둡니다. 그날의 성격을 먼저 읽게 하기 위함입니다.
          const dayEvents = allDayEvents.filter(e => !(e.kind === 'local' && e.date < e.end))
            .sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind));
          const hiddenPeriods = allDayEvents.filter(e => e.kind === 'local' && e.date < e.end && !segments.some(segment => segment.event.id === e.id)).length;
          const occupiedLanes = segments.filter(segment => segment.start <= day && segment.end >= day)
            .reduce((count, segment) => Math.max(count, segment.lane + 1), 0);
          // 하루에 보이는 것은 기간 막대까지 더해 DAY_SLOTS개까지입니다. 업무가 많아도 달력 높이가 변하지 않습니다.
          const room = Math.max(0, monthSlots - occupiedLanes);
          let shown = Math.min(dayEvents.length, room);
          if (dayEvents.length + hiddenPeriods > shown && shown > 0) shown -= 1; // 더 보기 줄도 한 칸을 차지합니다
          const rest = dayEvents.length - shown + hiddenPeriods;
          const chips = dayEvents.slice(0, shown).map(e => {
            const state = monthEventState(e), description = monthEventDescription(e, state);
            return `<button type="button" class="home-event ${e.kind}${state.tone ? ` is-${state.tone}` : ''}${e.provisional ? ' is-provisional' : ''}" data-month-kind="${esc(e.kind)}" data-month-id="${esc(e.id)}" data-month-date="${e.date}" data-month-title="${esc(e.title)}" title="${esc(description)}" aria-label="${esc(description)}">${state.label ? `<span class="home-month-status" aria-hidden="true">${esc(state.short || state.label)}</span>` : ''}<span class="home-month-event-title">${esc(e.title)}</span></button>`;
          }).join('') + (rest > 0 && room > 0 ? `<button type="button" class="home-more" data-month-more="${day}" aria-label="${day}, 숨겨진 일정 ${rest}건 · 전체 일정 보기">+${rest}개 더보기</button>` : '');
          html += `<button class="home-day${day === today ? ' is-today' : ''}${day.slice(0, 7) !== cursor.slice(0, 7) ? ' home-outside' : ''}" style="grid-column:${column};grid-row:1 / -1" data-date="${day}" aria-pressed="${day === selectedDate}"${day === today ? ' aria-current="date"' : ''} aria-label="${day}${day === today ? ', 오늘' : ''}, 일정 ${allDayEvents.length}건"><span class="home-day-number">${Number(day.slice(8))}</span></button>`;
          // 날짜 선택 버튼과 일정 버튼은 형제 요소로 배치해 중첩 버튼을 만들지 않습니다.
          if (chips) html += `<span class="home-day-events" style="grid-column:${column};grid-row:${occupiedLanes + 2} / -1">${chips}</span>`;
        }
        html += segments.map(segment => {
          const e = segment.event;
          return `<button type="button" class="home-period-bar${e.provisional ? ' is-provisional' : ''}${segment.continuesBefore ? ' continues-before' : ''}${segment.continuesAfter ? ' continues-after' : ''}" style="grid-column:${segment.column} / span ${segment.span};grid-row:${segment.lane + 2}" data-local="${esc(e.id)}" data-period-start="${segment.start}" data-period-end="${segment.end}" title="${esc(monthEventDescription(e))} · ${e.date} ~ ${e.end}" aria-label="${esc(e.title)}, ${e.date}부터 ${e.end}까지${segment.continuesBefore ? ', 앞 주에서 이어짐' : ''}${segment.continuesAfter ? ', 다음 주에 이어짐' : ''}${e.provisional ? ', 연휴 기간 미확정' : ''}">${segment.continuesBefore ? '<span aria-hidden="true">← </span>' : ''}${esc(e.title)}${segment.continuesAfter ? '<span aria-hidden="true"> →</span>' : ''}</button>`;
        }).join('') + '</div>';
      }
      $('#calendar-body').innerHTML = html + '</div>';
    }
  }
  function renderTasks() {
    // 진척도는 선택 이벤트 기준이며, 오늘의 업무 목록은 전체 이벤트의 업무를 보여 줍니다.
    const campaign = selected(), campaignTasks = campaign ? store.tasks.filter(t => t.campaign_id === campaign.id) : [];
    const p = progress(campaignTasks);
    // 지연된 업무가 있을 때만 빨간 배지를 띄웁니다. 평소에는 조용하고 문제가 있을 때만 눈에 띄게 합니다.
    const overdue = campaignTasks.filter(t => unfinished(t) && t.due_date && t.due_date < today).length;
    $('#progress-campaign').innerHTML = overdue
      ? `${badge(`지연 ${overdue}건`, true)} <span class="home-muted">${esc(campaign.name)}</span>`
      : `<span class="home-muted">${campaign ? esc(campaign.name) : ''}</span>`;
    $('#task-progress').innerHTML = campaign
      ? `<div class="home-progress-line"><div><strong class="home-progress-number">${p.percent}%</strong> <span class="home-muted">완료</span></div><span class="home-muted">${p.done}/${p.total} 업무 완료</span></div><div class="home-progress-track" role="progressbar" aria-label="이벤트 업무 완료율" aria-valuenow="${p.percent}" aria-valuemin="0" aria-valuemax="100"><span style="width:${p.percent}%"></span></div>`
      : empty('이벤트를 만들면 업무 진척이 표시됩니다.');

    const isToday = selectedDate === today;
    $('#tasks-title').textContent = isToday ? '오늘의 업무' : `${selectedDate} 업무`;
    $('#today-reset').hidden = isToday;
    // 완료한 업무도 목록에 남겨 그날 무엇을 했는지 볼 수 있게 합니다. 취소 업무는 제외합니다.
    // 기준일에는 지난 미완료 업무도 함께 보여 놓치지 않게 합니다. 다른 날짜를 고르면 그날 업무만 봅니다.
    const rows = ordered(inScope().filter(t => t.status !== 'cancelled' && (
      t.due_date === selectedDate || (isToday && unfinished(t) && t.due_date && t.due_date < today))), today);
    $('#task-list').innerHTML = rows.map(t => {
      const done = t.status === 'done', late = unfinished(t) && t.due_date && t.due_date < today;
      return `<div class="home-task${done ? ' is-done' : ''}"><input type="checkbox" data-check="${esc(t.id)}" ${done ? 'checked' : ''} ${storageBusy || locked || serverToken === null ? 'disabled' : ''} aria-label="${esc(t.title)} 완료"><div><div class="home-task-top"><button class="home-task-open" data-task="${esc(t.id)}">${esc(t.title)}</button><span class="home-task-actions">${badge(done ? '완료' : late ? '기한 초과' : TASK_STATES[t.status], late && !done, late ? 'overdue' : t.status)}<button class="home-text-btn" data-move="${esc(t.id)}" aria-label="${esc(t.title)} 다른 날로 이월" title="다른 날로 이월">-&gt;</button></span></div><div class="home-task-meta">${t.due_date !== selectedDate ? `${esc(t.due_date)} 마감 · ` : ''}${esc(campaignName(t.campaign_id))}${taskCategoryText(t)}</div>${t.related_tab === 'kpi' && t.due_date && t.due_date <= today ? '<a class="home-muted" href="/kpi/">KPI 확인 ↗</a>' : ''}</div></div>`;
    }).join('') || empty(isToday ? '오늘 마감인 업무가 없습니다. 캘린더에서 다른 날짜를 선택할 수 있습니다.' : '이 날짜에 마감인 업무가 없습니다.');
    const tomorrow = addDays(today, 1);
    const upcoming = ordered(inScope().filter(t => t.due_date === tomorrow && unfinished(t)), today);
    const preview = $('#tomorrow-tasks'); preview.hidden = !isToday;
    preview.classList.toggle('is-prominent', rows.length === 0);
    $('.home-today-card').classList.toggle('has-no-today', rows.length === 0);
    preview.innerHTML = '<div class="home-tomorrow-head"><strong>내일의 업무</strong><span>' + upcoming.length + '건</span></div>' + (upcoming.length ? upcoming.slice(0, 3).map(t => '<button class="home-task-open" data-task="' + esc(t.id) + '">' + esc(t.title) + '</button>').join('') + (upcoming.length > 3 ? '<button class="home-text-btn" data-date="' + tomorrow + '">내일 전체 보기</button>' : '') : '<p class="home-muted">내일 마감인 미완료 업무가 없습니다.</p>');
    renderUndated();
  }
  // 마감일 없는 업무는 달력 어디에도 나오지 않아 잊히기 쉽습니다. 매일 보는 자리에 개수만 남겨 둡니다.
  function renderUndated() {
    const rows = inScope().filter(t => t.status !== 'cancelled' && !t.due_date && unfinished(t));
    const box = $('#undated-box');
    box.hidden = rows.length === 0;
    if (!rows.length) return;
    $('#undated-count').textContent = `날짜 미정 ${rows.length}건`;
    $('#undated-list').innerHTML = rows.map(t => `<div class="home-undated-row"><button class="home-task-open" data-task="${esc(t.id)}">${esc(t.title)}</button><span class="home-task-actions"><span class="home-muted">${esc(campaignName(t.campaign_id))}${taskCategoryText(t)}</span><button class="home-text-btn" data-today="${esc(t.id)}" title="오늘 날짜로 가져오기">오늘로</button></span></div>`).join('');
  }
  function moveTask(taskId) {
    const t = store.tasks.find(item => item.id === taskId);
    if (!t) { toast('업무를 찾지 못했습니다.'); return; }
    openDialog('업무 이월', `<form id="move-form"><p class="home-muted">${esc(t.title)}</p><label class="home-field">옮길 날짜<input name="due_date" type="date" required value="${esc(t.due_date || today)}"></label><p class="home-muted">마감일만 바뀝니다. 이벤트 날짜과 다른 업무는 그대로입니다.</p><p id="move-error" class="home-error" role="alert" hidden></p><div class="home-form-actions"><button class="btn dark" type="submit">이월</button></div></form>`);
    $('#move-form').onsubmit = async event => {
      event.preventDefault();
      const value = new FormData(event.currentTarget).get('due_date');
      if (!validDate(value)) { $('#move-error').hidden = false; $('#move-error').textContent = '옮길 날짜를 올바르게 입력해주세요.'; return; }
      const next = structuredClone(store), target = next.tasks.find(item => item.id === taskId);
      target.due_date = value;
      if (target.start_date && validDate(target.start_date)) target.start_date = '';
      target.fixed = true;   // 재계획에서 되돌아가지 않도록 날짜 고정으로 표시합니다.
      if (await save(next)) { dialog.close(); render(); toast(`${value}로 이월했습니다.`); }
    };
  }
  function renderCampaign() {
    const c = selected();
    const ongoing = store.campaigns.filter(item => !['done', 'cancelled', 'archived'].includes(item.status));
    const previous = store.campaigns.filter(item => ['done', 'cancelled', 'archived'].includes(item.status));
    const choices = items => items.map(item => `<option value="${esc(item.id)}" ${item.id === c?.id ? 'selected' : ''}>${esc(item.name)} · ${esc(CAMPAIGN_STATES[item.status] || item.status)}</option>`).join('');
    $('#campaign-select').innerHTML = store.campaigns.length ? `${ongoing.length ? `<optgroup label="진행 중인 이벤트">${choices(ongoing)}</optgroup>` : ''}${previous.length ? `<optgroup label="지난 이벤트">${choices(previous)}</optgroup>` : ''}` : '<option value="">이벤트 없음</option>';
    $('#planner-title').textContent = c?.name || '이벤트를 선택하세요';
    $('#planner-title').title = c?.name || '';
    storageControls(storageBusy);
    // 보고서는 선택한 이벤트가 있을 때만 엽니다. 새 창에서 인쇄용 화면을 보여 줍니다.
    const report = $('#open-report');
    const canReport = Boolean(c);
    report.href = canReport ? `/home/report/${encodeURIComponent(c.id)}` : '#';
    report.setAttribute('aria-disabled', String(!canReport));
    report.onclick = event => {
      if (!canReport) { event.preventDefault(); toast('이벤트를 선택한 뒤 보고서를 열어주세요.'); }
    };
    report.hidden = !c;
    $('#campaign-progress').hidden = !c;
    $('#gantt-note').hidden = true;
    if (!c) {
      $('#campaign-summary').innerHTML = ''; $('#campaign-progress').innerHTML = '';
      $('#gantt').innerHTML = '<div class="home-dday-empty"><strong>이벤트 준비를 시작하세요</strong><p>새 이벤트에서 이름과 기준일을 정하면 준비 업무를 만듭니다.</p></div>'; return;
    }
    $('#campaign-summary').innerHTML = `<span class="home-campaign-chip">${badge(CAMPAIGN_STATES[c.status] || c.status)}</span><time class="home-campaign-date" datetime="${esc(c.target_date)}">행사일 ${esc(c.target_date.replaceAll('-', '.'))}</time><span class="home-dday" title="한국 날짜 기준">${esc(dday(c.target_date, today))}</span>`;
    const tasks = store.tasks.filter(t => t.campaign_id === c.id), p = progress(tasks), cancelled = tasks.filter(t => t.status === 'cancelled').length;
    $('#campaign-progress').innerHTML = `<strong>${p.percent}%</strong><span>${p.done} / ${p.total}개 완료</span><div class="home-dday-progress-track" role="progressbar" aria-label="이벤트 준비 업무 완료율" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${p.percent}"><span style="width:${p.percent}%"></span></div>${cancelled ? `<small>취소 ${cancelled}개 제외</small>` : ''}`;
    if (!tasks.length) { $('#gantt').innerHTML = '<div class="home-dday-empty"><strong>등록된 준비 업무가 없습니다</strong><p>수정에서 준비 업무와 날짜를 확인해주세요.</p></div>'; return; }
    const rows = ganttTaskRows(tasks);
    const dates = rows.filter(r => !r.invalid).flatMap(r => [r.start, r.due].filter(Boolean)).sort();
    let left = '', right = '', span = 0, axisWidth = 440, tickDays = 1, axis = '<span class="home-dday-axis-empty">날짜를 지정하면 기간이 표시됩니다</span>', todayPosition = null;
    if (dates.length) {
      const before = addDays(dates[0], -3), after = addDays(dates.at(-1), 3);
      left = validDate(before) ? before : dates[0]; right = validDate(after) ? after : dates.at(-1); span = dayDiff(right, left) + 1;
      axisWidth = Math.max(440, Math.min(2400, span * (span <= 120 ? 18 : 8)));
      const maxTicks = Math.max(8, Math.floor(axisWidth / 38));
      tickDays = span <= maxTicks ? 1 : span <= maxTicks * 7 ? 7 : span <= maxTicks * 14 ? 14 : Math.ceil(span / maxTicks);
      const ticks = [];
      for (let offset = 0; offset < span; offset += tickDays) {
        const date = addDays(left, offset), count = Math.min(tickDays, span - offset);
        ticks.push(`<time datetime="${date}" title="${date}" style="width:${count / span * 100}%">${tickDays === 1 ? Number(date.slice(8)) : `${Number(date.slice(5, 7))}/${Number(date.slice(8))}`}</time>`);
      }
      const months = [];
      for (let offset = 0; offset < span;) {
        const date = addDays(left, offset);
        const year = Number(date.slice(0, 4)), month = Number(date.slice(5, 7));
        const nextMonth = new Date(date); nextMonth.setUTCMonth(nextMonth.getUTCMonth() + 1, 1);
        const count = Math.min(span - offset, dayDiff(nextMonth.toISOString(), date));
        months.push(`<span title="${date} ~ ${addDays(date, count - 1)}" style="width:${count / span * 100}%">${year}. ${String(month).padStart(2, '0')}</span>`); offset += count;
      }
      if (today >= left && today <= right) todayPosition = (dayDiff(today, left) + .5) / span * 100;
      axis = `<div class="home-dday-months">${months.join('')}</div><div class="home-dday-dates">${ticks.join('')}</div><div class="home-dday-today-band">${todayPosition === null ? '' : `<span style="left:${todayPosition}%" title="${today} · 한국 날짜 기준">오늘</span>`}</div>`;
    }
    const todayLine = todayPosition === null ? '' : `<span class="home-dday-today" style="left:${todayPosition}%" aria-hidden="true"></span>`;
    const dateCell = (value, estimated = false) => value ? `<time datetime="${value}">${shortDate(value)}</time>${estimated ? '<sup title="실제 시작일 미입력 · 기존 자동 기준일">*</sup>' : ''}` : '<span class="home-dday-muted">미정</span>';
    const content = rows.map(r => {
      const t = r.task, late = unfinished(t) && r.due && r.due < today;
      const tone = late ? 'overdue' : Object.hasOwn(TASK_STATES, t.status) ? t.status : 'unknown';
      const status = `${late ? '지연 · ' : ''}${TASK_STATES[t.status] || '상태 확인'}`;
      const description = `${t.title} · 시작 ${r.start || '미입력'}${r.estimated ? ' (기존 자동 기준일)' : ''} · 마감 ${r.due || '미정'} · ${status}${r.invalid ? ' · 날짜 확인 필요' : ''}${t.memo ? ` · 메모: ${t.memo}` : ''}`;
      let bar = `<span class="home-dday-track-message">${r.invalid ? '날짜 확인 필요' : !r.due ? '마감일 미정' : '기간 미정'}</span>`;
      if (span && r.due && !r.invalid) {
        const barStart = r.start || r.due, position = dayDiff(barStart, left) / span * 100;
        const width = r.point ? 0 : (dayDiff(r.due, barStart) + 1) / span * 100;
        const center = r.point ? (dayDiff(r.due, left) + .5) / span * 100 : position + width / 2;
        bar = `<span class="home-dday-bar is-${tone}${r.estimated ? ' is-estimated' : ''}${r.point ? ' is-point' : ''}" style="left:${r.point ? center : position}%;width:${r.point ? '6px' : `${width}%`}" aria-hidden="true"></span><button type="button" class="home-dday-bar-hit" data-task="${esc(t.id)}" title="${esc(description)}" aria-label="${esc(description)}" style="left:clamp(12px, ${center}%, calc(100% - 12px));width:max(24px, ${width}%)"></button>`;
      }
      return `<div class="home-dday-row" role="row" data-dday-task="${esc(t.id)}"><div class="home-dday-name" role="cell"><button type="button" data-task="${esc(t.id)}" title="${esc(description)}"><span>${esc(t.title)}</span><small>${r.due ? `${shortDate(r.due)} 마감` : '날짜 미정'} · ${esc(status)}</small></button></div><div class="home-dday-date" role="cell" title="${esc(r.start || '시작일 미입력')}${r.estimated ? ' · 기존 자동 기준일' : ''}">${dateCell(r.start, r.estimated)}</div><div class="home-dday-date" role="cell" title="${esc(r.due || '마감일 미정')}">${dateCell(r.due)}</div><div class="home-dday-state-cell" role="cell"><span class="home-dday-state is-${tone}">${esc(status)}</span></div><div class="home-dday-track" role="cell">${todayLine}${bar}</div></div>`;
    }).join('');
    const previousGrid = $('.home-dday-grid'), previousCampaign = previousGrid?.dataset.campaignId;
    const scrollLeft = $('#gantt').scrollLeft, scrollTop = $('#gantt').scrollTop;
    $('#gantt').innerHTML = `<div class="home-dday-grid" role="table" aria-label="이벤트 준비 업무와 일정" aria-rowcount="${rows.length + 1}" aria-colcount="5" data-campaign-id="${esc(c.id)}" data-range-start="${left}" data-range-end="${right}" style="--home-dday-axis-width:${axisWidth}px;--home-dday-grid-step:${span ? (span <= 120 ? 1 : tickDays) / span * 100 : 100}%"><div class="home-dday-row home-dday-table-head" role="row"><div class="home-dday-name" role="columnheader">마케팅 업무</div><div class="home-dday-date" role="columnheader">시작일</div><div class="home-dday-date" role="columnheader">마감일</div><div class="home-dday-state-cell" role="columnheader">상태</div><div class="home-dday-axis" role="columnheader">${axis}</div></div>${content}</div>`;
    $('#gantt').querySelectorAll('.home-dday-row').forEach((row, index) => {
      row.setAttribute('aria-rowindex', String(index + 1));
      [...row.children].forEach((cell, column) => cell.setAttribute('aria-colindex', String(column + 1)));
    });
    $('#gantt').scrollLeft = previousCampaign === c.id ? scrollLeft : 0; $('#gantt').scrollTop = previousCampaign === c.id ? scrollTop : 0;
    const notes = [];
    if (rows.some(r => r.estimated)) notes.push('* 시작일 미입력 업무는 기존 자동 기준일을 표시합니다.');
    if (rows.some(r => r.invalid)) notes.push('날짜가 맞지 않는 업무는 막대 대신 확인 안내를 표시합니다.');
    $('#gantt-note').textContent = notes.join(' '); $('#gantt-note').hidden = !notes.length;
  }
  function signalMessage(name, text) { return !signals ? '자료를 불러오는 중입니다.' : signals[name].state === 'error' ? '정보를 불러오지 못했습니다. 잠시 후 조회를 다시 시도해주세요.' : text; }
  function renderSignals() {
    const r = range(), opportunities = localEvents().filter(e => e.start >= r.start && e.start <= r.end).sort((a, b) => a.start.localeCompare(b.start));
    $('#opportunity-list').innerHTML = opportunities.map(e => `<article class="home-opportunity"><div class="home-signal-meta">${dday(e.start, today)} · ${esc({ holiday: '공휴일', anniversary: '기념일', regional_event: '지역행사', fruit_season: '과일 시즌' }[e.type] || '현지 일정')}${e.region ? ` · ${esc(e.region)}` : ''}</div><h3>${esc(e.name)}</h3>${eventSummary(e)}<button class="btn" data-local="${esc(e.event_id)}">일정 상세</button> <button class="btn" data-create="${esc(e.event_id)}">+ 이벤트 기획</button></article>`).join('') || empty(signalMessage('events', '조회 기간에 시작하는 HOME 등록 일정이 없습니다. 기간을 바꾸거나 검증된 일정 자료를 준비해주세요.'));
    const attention = signals?.attention.items || [], attentionIds = new Set(attention.map(t => t.collaboration_id));
    const scopedCreators = creators();
    const rows = scopedCreators.filter(c => c.status !== 'posted' && (c.requires_attention || attentionIds.has(c.collaboration_id) || (validDate(c.post_date) && c.post_date <= addDays(today, 7)) || (validDate(c.shoot_date) && c.shoot_date < today && c.status !== 'shot'))).sort((a, b) => Number(Boolean(b.requires_attention || attentionIds.has(b.collaboration_id))) - Number(Boolean(a.requires_attention || attentionIds.has(a.collaboration_id))) || (a.post_date || '9999').localeCompare(b.post_date || '9999')).slice(0, 3);
    const collaborationSummary = signals?.collaborations.state === 'ok' ? `<div class="home-collab-summary"><span>촬영 예정 <strong>${scopedCreators.filter(c => !['shot', 'posted'].includes(c.status) && validDate(c.shoot_date) && c.shoot_date >= today).length}</strong></span><span>게시 예정 <strong>${scopedCreators.filter(c => c.status !== 'posted' && validDate(c.post_date) && c.post_date >= today).length}</strong></span><span>확인 필요 <strong>${scopedCreators.filter(c => c.status !== 'posted' && (c.requires_attention || attentionIds.has(c.collaboration_id))).length}</strong></span></div>` : '';
    $('#collaboration-list').innerHTML = collaborationSummary + (rows.map(c => {
      const task = attention.find(t => t.collaboration_id === c.collaboration_id), needs = c.requires_attention || task;
      // 촬영일만 지났는데 게시일이 지난 것처럼 알리지 않습니다. 날짜가 없으면 경과로 보지 않습니다.
      const postLate = validDate(c.post_date) && c.post_date < today;
      const shootLate = validDate(c.shoot_date) && c.shoot_date < today && !['shot', 'posted'].includes(c.status);
      const state = needs ? '확인 필요' : postLate ? '게시일 경과' : shootLate ? '촬영일 경과' : validDate(c.post_date) ? '게시 임박' : '일정 미정';
      return `<article class="home-collaboration"><div class="home-task-top"><div><h3>${esc(c.influencer)}</h3><span class="home-signal-meta">${esc(c.main_platform || '채널 미정')} · ${esc(c.status_label || c.status || '상태 미제공')}</span></div>${badge(state, Boolean(needs) || postLate || shootLate)}</div><dl class="home-collab-dates"><div><dt>촬영</dt><dd>${esc(c.shoot_date || '미정')}</dd></div><div><dt>게시</dt><dd>${esc(c.post_date || '미정')}</dd></div></dl><p class="home-collab-action"><strong>다음 할 일</strong> ${esc(c.next_action || task?.detail || task?.title || '원본 탭에서 진행 내용을 확인해주세요.')}</p><a href="${esc(safeUrl(c.link || `/influencer_marketing/?collaboration_id=${encodeURIComponent(c.collaboration_id)}`))}">협업 확인 ↗</a></article>`;
    }).join('') || empty(signalMessage('collaborations', '확인할 협업이 없거나 인플루언서 자료를 불러오지 못했습니다. 원본 탭에서 확인해주세요.')));
    if (signals?.attention.state === 'error') $('#collaboration-list').insertAdjacentHTML('beforeend', '<p class="home-error">협업 할 일을 불러오지 못해 확인 필요 목록이 일부 누락될 수 있습니다.</p>');
    const news = (signals?.news.items || []).filter(n => n.is_demo === false && n.verification_status === 'verified' && n.registration_status === 'approved').sort((a, b) => String(b.published_at || '').localeCompare(String(a.published_at || ''))).slice(0, 3);
    $('#news-list').style.setProperty('--home-news-columns', String(Math.max(1, news.length)));
    const newsMarkup = news.map(n => {
      // 등록된 출처·대조 내용·확인 범위를 표시합니다. 이 화면이 원문을 새로 검증하는 것은 아닙니다.
      const sources = Array.isArray(n.sources) ? n.sources : [];
      const link = safeUrl(n.url) || safeUrl(sources[0]?.url);
      const sourceDetails = sources.map(source => {
        const address = safeUrl(source.url);
        const label = source.role === 'primary' ? '원문' : source.role === 'independent_corrob' ? '교차 출처' : '참고 출처';
        return `<li><strong>${label} · ${esc(source.publisher)}</strong>${source.title ? `<span>${esc(source.title)}</span>` : ''}${source.supports ? `<p>${esc(source.supports)}</p>` : ''}${address ? `<a href="${esc(address)}" target="_blank" rel="noopener noreferrer">자료 열기 ↗</a>` : ''}</li>`;
      }).join('');
      return `<article class="home-news-item">
        <h3>${link ? `<a href="${esc(link)}" target="_blank" rel="noopener noreferrer">${esc(n.title)}</a>` : esc(n.title)}</h3>
        <div class="home-signal-meta">${esc(n.region || '지역 미제공')} · 발행 ${esc(n.published_at || '미제공')}</div>
        <p class="home-news-brief">${esc(newsPreview(n.summary, 70))}</p>
        ${n.suggestion ? `<div class="home-suggestion"><strong class="home-suggestion-label">적용 제안 · 운영 아이디어</strong><p>${esc(newsPreview(n.suggestion, 60))}</p></div>` : '<div class="home-suggestion" aria-hidden="true"></div>'}
        <details class="home-news-details"><summary>자세히 보기 · 출처와 확인 범위</summary>
          <h4>사실 요약 · 전체 내용</h4><p>${esc(n.summary)}</p>
          ${n.suggestion ? `<h4>적용 제안 · 전체 내용</h4><p>${esc(n.suggestion)}</p>` : ''}
          ${n.verified_at ? `<p class="home-signal-meta">담당자 확인 ${esc(n.verified_at)}</p>` : ''}
          ${sourceDetails ? `<h4>어디서 확인했나요?</h4><ul class="home-news-sources">${sourceDetails}</ul>` : ''}
          ${n.verification_notes ? `<h4>등록 당시 확인한 내용과 한계</h4><p>${esc(n.verification_notes)}</p>` : ''}
        </details>
      </article>`;
    }).join('') || empty(signalMessage('news', '검증 후 등록한 뉴스·트렌드가 없습니다. 확인된 자료가 준비되면 표시합니다.'));
    // 업무 체크처럼 뉴스 내용이 바뀌지 않은 갱신에서는 사용자가 조절한 크기와 펼침 상태를 유지합니다.
    if (newsMarkup !== renderedNewsMarkup) {
      $('#news-list').innerHTML = newsMarkup;
      renderedNewsMarkup = newsMarkup;
    }
  }
  function render() {
    $('#reference-date').value = today;
    renderCampaign(); renderCalendar(); renderTasks(); renderSignals();
  }
  async function refreshSignals() {
    const token = ++requestNumber;
    signals = null; render();
    const r = range(), start = [r.start, `${cursor.slice(0, 4)}-01-01`].sort()[0], end = [r.end, `${cursor.slice(0, 4)}-12-31`].sort().at(-1);
    const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 12000);
    try {
      const response = await fetch(`${root.dataset.signalsUrl}?${new URLSearchParams({ start, end })}`, { signal: controller.signal });
      if (!response.ok) throw new Error('request');
      const data = await response.json();
      if (token !== requestNumber) return;
      for (const name of ['events', 'news', 'collaborations', 'attention']) if (!data[name] || !Array.isArray(data[name].items)) throw new Error('format');
      signals = data;
    } catch { if (token !== requestNumber) return; signals = Object.fromEntries(['events', 'news', 'collaborations', 'attention'].map(n => [n, { state: 'error', items: [] }])); }
    finally { clearTimeout(timeout); }
    render();
  }
  const dialog = $('#home-dialog');
  let dialogOrigin;
  function openDialog(title, html) { dialogOrigin = document.activeElement; $('#dialog-title').textContent = title; $('#dialog-content').innerHTML = html; dialog.showModal(); }
  $('#close-dialog').onclick = () => dialog.close();
  dialog.addEventListener('close', () => dialogOrigin?.isConnected && dialogOrigin.focus());
  function options(values, selectedValue) { return Object.entries(values).map(([value, label]) => `<option value="${esc(value)}" ${value === selectedValue ? 'selected' : ''}>${esc(label)}</option>`).join(''); }
  function editTask(taskId) {
    const t = store.tasks.find(item => item.id === taskId); if (!t) return;
    openDialog('업무 수정', `<form id="task-form"><label class="home-field">업무명<input name="title" required maxlength="160" value="${esc(t.title)}"></label><div class="home-form-grid"><label class="home-field">시작일<input name="start_date" type="date" value="${esc(t.start_date)}"></label><label class="home-field">마감일<input name="due_date" type="date" value="${esc(t.due_date)}"></label><label class="home-field">시간 (비우면 종일)<input name="due_time" type="time" value="${esc(t.due_time)}"></label><label class="home-field">이벤트<select name="campaign_id">${store.campaigns.map(c => `<option value="${esc(c.id)}" ${c.id === t.campaign_id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></label><label class="home-field">상태<select name="status">${options(TASK_STATES, t.status)}</select></label><label class="home-field">중요도<select name="importance">${options({ normal: '보통', high: '높음' }, t.importance)}</select></label><label class="home-field">관련 탭<select name="related_tab">${options({ '': '없음', ...TABS }, t.related_tab)}</select></label></div><label class="home-check-field"><input type="checkbox" name="fixed" ${t.fixed ? 'checked' : ''}><span>이벤트 날짜가 바뀌어도 이 업무 날짜 유지</span></label><label class="home-field">메모<textarea name="memo" rows="3" maxlength="3000">${esc(t.memo)}</textarea></label><p id="task-error" class="home-error" hidden role="alert"></p><div class="home-form-actions"><a class="btn" href="${tabLink(t.related_tab)}">관련 탭 ↗</a><button class="btn dark" type="submit">저장</button></div></form>`);
    if (categoriesEnabled()) $('#task-form .home-form-grid').insertAdjacentHTML('beforeend', `<label class="home-field">업무 종류<select name="category">${options(TASK_CATEGORIES, t.category || '')}</select></label>`);
    $('#task-form').onsubmit = async event => {
      event.preventDefault(); const f = new FormData(event.currentTarget), title = f.get('title').trim(), start = f.get('start_date'), due = f.get('due_date');
      if (!title || (start && !due) || (start && start > due)) { $('#task-error').hidden = false; $('#task-error').textContent = '업무명을 입력하고, 마감일이 시작일보다 빠르지 않은지 확인해주세요.'; return; }
      const next = structuredClone(store), target = next.tasks.find(item => item.id === taskId), campaign = next.campaigns.find(c => c.id === f.get('campaign_id'));
      const time = f.get('due_time');
      Object.assign(target, { title, start_date: start, due_date: due, due_time: validTime(time) ? time : '', campaign_id: campaign.id, status: f.get('status'), importance: f.get('importance'), related_tab: f.get('related_tab'), memo: f.get('memo'), fixed: f.has('fixed') || !due, offset: due ? dayDiff(due, campaign.target_date) : 0, completed_at: f.get('status') === 'done' ? t.completed_at || new Date().toISOString() : '' });
      if (categoriesEnabled()) target.category = f.get('category') || '';
      if (await save(next)) { dialog.close(); render(); toast('업무를 저장했습니다.'); }
    };
  }
  function planner(kind, opportunity) {
    const original = kind === 'create' ? null : selected();
    if (kind !== 'create' && !original) return;
    const initialTemplate = original?.template || (opportunity ? 'anniversary' : 'launch');
    const templateRows = type => TEMPLATE.filter((_, i) => type === 'launch' || i > 0)
      .map(([key, offset, title, related_tab]) => ({ key, offset, title, related_tab }));
    let rows = original ? structuredClone(store.tasks.filter(t => t.campaign_id === original.id && (kind !== 'clone' || t.status !== 'cancelled'))) : templateRows(initialTemplate);
    const target = original?.target_date || opportunity?.start || '';
    const initialName = original ? `${original.name}${kind === 'clone' ? ' 복사' : ''}` : opportunity?.name || '';
    openDialog(kind === 'create' ? '이벤트 기획' : kind === 'clone' ? '이벤트 복제' : '이벤트 수정', `<form id="plan-form">
      <label class="home-field">이벤트 이름<input name="name" required maxlength="160" placeholder="예: 신메뉴 출시, 스승의 날 선물 행사" value="${esc(initialName)}"></label>
      <div class="home-form-grid">
        <label class="home-field">이벤트 날짜<input type="date" name="target_date" required value="${target}"></label>
        <label class="home-field">이벤트 유형<select name="template" ${original ? 'disabled' : ''}>${options({ launch: '신규 출시', anniversary: '기념일 행사' }, initialTemplate)}</select></label>
      </div>
      <div id="plan-preview" aria-live="polite"></div>
      <details><summary>기획 상세 (선택)</summary><div class="home-form-grid">
        <label class="home-field">제품<input name="product" maxlength="160" value="${esc(original?.product)}"></label>
        <label class="home-field">대상 고객<input name="audience" maxlength="160" value="${esc(original?.audience)}"></label>
        <label class="home-field">채널<input name="channel" maxlength="160" value="${esc(original?.channel)}"></label>
      </div></details>
      <details><summary>업무 조정 (선택)</summary><div id="template-rows"></div></details>
      <p id="plan-error" class="home-error" role="alert" hidden></p>
      <div class="home-form-actions"><button type="submit" class="btn dark" id="confirm-plan">${kind === 'replan' ? '변경사항 저장' : '캘린더에 추가'}</button></div>
    </form>`);
    const form = $('#plan-form');
    const error = message => { $('#plan-error').textContent = message; $('#plan-error').hidden = !message; };
    const project = () => {
      const date = form.elements.target_date.value;
      if (!validDate(date)) return null;
      let result;
      try {
        result = kind === 'replan' ? replanTasks(rows, date, rows)
          : kind === 'clone' ? cloneTasks(rows, 'preview', date, original.target_date, id)
            : rows.map(t => ({ ...t, due_date: addDays(date, t.offset), status: 'todo' }));
      } catch { return null; }
      return result.every(t => !t.due_date || validDate(t.due_date)) ? result : null;
    };
    const preview = () => {
      const tasks = project();
      $('#plan-preview').innerHTML = tasks
        ? `<div class="home-preview"><p>${tasks.length}개 준비 업무</p>${[...tasks].sort((a, b) => (a.due_date || '9999').localeCompare(b.due_date || '9999')).map(t => `<div class="home-preview-row"><span>${esc(t.title)}${kind === 'replan' && (!unfinished(t) || t.fixed) ? ' · 유지' : ''}</span><span>${esc(t.due_date || '날짜 없음')}${t.due_date && t.due_date < today && unfinished(t) ? ` ${badge('지난 일정', true)}` : ''}</span></div>`).join('')}</div>`
        : empty('이벤트 날짜를 선택하세요.');
    };
    const renderRows = () => {
      const tasks = project();
      $('#template-rows').innerHTML = rows.map((t, i) => {
        const locked = kind === 'replan' && (!unfinished(t) || t.fixed);
        return `<div class="home-template-row"><input aria-label="업무 ${i + 1} 이름" data-row-title="${i}" value="${esc(t.title)}" maxlength="160" required ${locked ? 'disabled' : ''}><input aria-label="업무 ${i + 1} 날짜" data-row-date="${i}" type="date" value="${tasks?.[i]?.due_date || ''}" ${locked || !tasks ? 'disabled' : ''}></div>`;
      }).join('');
    };
    renderRows(); preview();
    form.elements.template.onchange = () => { rows = templateRows(form.elements.template.value); renderRows(); preview(); error(''); };
    form.elements.target_date.addEventListener('input', () => { renderRows(); preview(); error(''); });
    form.addEventListener('input', event => {
      if (event.target.hasAttribute('data-row-title')) {
        rows[Number(event.target.dataset.rowTitle)].title = event.target.value;
        preview();
      }
      if (event.target.hasAttribute('data-row-date')) {
        const date = event.target.value, targetDate = form.elements.target_date.value;
        if (validDate(date) && validDate(targetDate)) {
          const task = rows[Number(event.target.dataset.rowDate)];
          task.offset = dayDiff(date, targetDate);
          // A cloned fixed task uses its original date when shifting the plan.
          if (kind === 'clone' && task.fixed) {
            const shifted = addDays(date, dayDiff(original.target_date, targetDate));
            if (task.start_date && task.due_date) task.start_date = addDays(task.start_date, dayDiff(shifted, task.due_date));
            task.due_date = shifted;
          }
          preview(); error('');
        }
      }
    });
    form.onsubmit = async event => {
      event.preventDefault();
      const f = new FormData(form), newTarget = f.get('target_date'), name = f.get('name').trim();
      if (!name || !validDate(newTarget) || rows.some(t => !t.title.trim())) { error('이벤트 이름과 날짜, 업무명을 확인하세요.'); return; }
      if ([...form.querySelectorAll('[data-row-date]:not(:disabled)')].some(input => {
        const row = rows[Number(input.dataset.rowDate)];
        return !validDate(input.value) && !(input.value === '' && row.fixed && !row.due_date);
      })) { error('업무 날짜를 확인하세요.'); return; }
      const projected = project();
      if (!projected) { error('업무 날짜를 계산할 수 없습니다. 이벤트 날짜를 확인하세요.'); return; }
      const button = $('#confirm-plan'); button.disabled = true;
      const next = structuredClone(store);
      if (kind === 'replan') {
        Object.assign(next.campaigns.find(c => c.id === original.id), { name, target_date: newTarget, product: f.get('product'), audience: f.get('audience'), channel: f.get('channel') });
        // Apply edits against the stored dates to preserve duration, completion and fixed tasks.
        const changed = replanTasks(next.tasks.filter(t => t.campaign_id === original.id), newTarget, rows);
        next.tasks = next.tasks.map(t => changed.find(item => item.id === t.id) || t);
      } else {
        const campaignId = id();
        next.campaigns.push({ id: campaignId, name, target_date: newTarget, template: original?.template || f.get('template'), product: f.get('product'), audience: f.get('audience'), channel: f.get('channel'), event_id: kind === 'clone' ? '' : opportunity?.event_id || '', status: 'preparing', review: '' });
        const tasks = kind === 'clone' ? cloneTasks(rows, campaignId, newTarget, original.target_date, id)
          : projected.map(t => ({ ...t, title: t.title.trim(), id: id(), campaign_id: campaignId, start_date: '', fixed: false, importance: 'normal', memo: '', completed_at: '' }));
        next.tasks.push(...tasks); next.preferences.selected = campaignId;
      }
      if (await save(next)) {
        cursor = newTarget; selectedDate = newTarget;
        dialog.close(); render(); toast(kind === 'replan' ? '이벤트 일정을 수정했습니다.' : '준비 업무를 캘린더에 추가했습니다.');
      } else button.disabled = false;
    };
  }
  root.addEventListener('click', async event => {
    const more = $('#campaign-more'); if (more.open && !more.contains(event.target)) more.open = false;
    const button = event.target.closest('button'); if (!button) return;
    if (button.dataset.weekMode) {
      if (!['timeline', 'list'].includes(button.dataset.weekMode)) return;
      weekMode = button.dataset.weekMode;
      try { localStorage.setItem(WEEK_MODE_KEY, weekMode); } catch { /* 업무 저장과는 별개입니다. */ }
      renderCalendar(); root.querySelector(`[data-week-mode="${weekMode}"]`)?.focus({ preventScroll: true }); return;
    }
    if (button.dataset.weekMore) { showMonthDay(button.dataset.weekMore); dialogOrigin = root.querySelector(`[data-week-more="${button.dataset.weekMore}"]`) || dialogOrigin; return; }
    if (button.dataset.weekKind) { await openMonthEvent(button.dataset.weekKind, button.dataset.weekId, button.dataset.weekDate, button.dataset.weekTitle); return; }
    if (button.dataset.monthMore) { showMonthDay(button.dataset.monthMore); return; }
    if (button.dataset.monthKind) { await openMonthEvent(button.dataset.monthKind, button.dataset.monthId, button.dataset.monthDate, button.dataset.monthTitle); return; }
    if (button.hasAttribute('data-cancel-delete')) dialog.close();
    if (button.dataset.confirmDelete) {
      const next = structuredClone(store), target = button.dataset.confirmDelete;
      next.campaigns = next.campaigns.filter(c => c.id !== target);
      next.tasks = next.tasks.filter(t => t.campaign_id !== target);
      next.schedules = (next.schedules || []).filter(s => s.campaign_id !== target);
      next.links = (next.links || []).filter(l => l.campaign_id !== target);
      if (next.preferences.selected === target) next.preferences.selected = next.campaigns[0]?.id || '';
      if (await save(next, [target])) { dialog.close(); render(); toast('이벤트를 삭제했습니다.'); }
    }
    if (button.dataset.today) {
      const next = structuredClone(store), task = next.tasks.find(item => item.id === button.dataset.today);
      if (task) { task.due_date = today; task.fixed = true; if (await save(next)) { render(); toast('오늘 마감으로 옮겼습니다.'); } }
    }
    if (button.dataset.date) {
      const monthDate = Boolean(button.closest('.home-month'));
      const weekDate = Boolean(button.closest('.home-week-view'));
      selectedDate = button.dataset.date; renderCalendar(); renderTasks();
      if (monthDate) root.querySelector(`.home-month [data-date="${selectedDate}"]`)?.focus();
      if (weekDate) root.querySelector(`.home-week-date[data-date="${selectedDate}"]`)?.focus({ preventScroll: true });
    }
    if (button.dataset.move) moveTask(button.dataset.move);
    if (button.dataset.slot) {
      const slot = button.dataset.slot, [day] = slot.split(' '); selectedDate = day; renderCalendar(); renderTasks();
      root.querySelector(`.home-week-slot[data-slot="${slot}"]`)?.focus({ preventScroll: true });
    }
    if (button.dataset.task) editTask(button.dataset.task);
    if (button.dataset.local) showLocalEvent(button.dataset.local);
    if (button.dataset.create) {
      const e = localEvents().find(item => item.event_id === button.dataset.create);
      if (e) {
        // 같은 현지 일정으로 이벤트를 두 번 만들면 준비 업무가 통째로 겹쳐 보입니다.
        const already = store.campaigns.find(c => c.event_id && c.event_id === e.event_id);
        if (already) {
          if (dialog.open) dialog.close();
          changeCampaign(already.id);
          toast(`이미 "${already.name}" 이벤트가 있습니다. 그 이벤트를 열었습니다.`);
          return;
        }
        if (dialog.open) dialog.close();
        planner('create', e);
      }
    }
    if (button.dataset.select) changeCampaign(button.dataset.select);
  });
  root.addEventListener('change', async event => {
    if (!event.target.dataset.check) return;
    if (storageBusy || locked) { render(); toast('저장소를 확인하거나 현재 저장이 끝난 뒤 다시 눌러주세요.'); return; }
    const next = structuredClone(store), task = next.tasks.find(t => t.id === event.target.dataset.check);
    if (!task) return;
    const completed = event.target.checked;
    task.status = completed ? 'done' : 'todo'; task.completed_at = completed ? new Date().toISOString() : '';
    if (await save(next)) toast(completed ? '완료했습니다. 일정과 진척에 반영했습니다.' : '예정 상태로 되돌렸습니다.');
    render();
  });
  const PANEL_KEY = 'hjs-home-panel';
  const panelTabs = [[$('#tab-calendar'), 'month'], [$('#tab-week'), 'week'], [$('#tab-campaign'), 'campaign']];
  function showPanel(name) {
    if (!panelTabs.some(([, key]) => key === name)) return;
    panel = name;
    const calendar = name !== 'campaign';
    if (calendar) view = name;
    $('#calendar-panel').hidden = !calendar;
    $('#campaign-panel').hidden = calendar;
    $('#calendar-actions').hidden = !calendar;
    $('#campaign-actions').hidden = calendar;
    panelTabs.forEach(([tab, key]) => {
      tab.setAttribute('aria-selected', String(key === name));
      tab.tabIndex = key === name ? 0 : -1;
    });
    $('#calendar-panel').setAttribute('aria-labelledby', name === 'week' ? 'tab-week' : 'tab-calendar');
    if (calendar) renderCalendar();
    try { localStorage.setItem(PANEL_KEY, name); } catch { /* Screen preference only. */ }
  }
  function removeCampaign() {
    const c = selected();
    if (!c) return;
    const count = store.tasks.filter(t => t.campaign_id === c.id).length;
    openDialog('이벤트 삭제', `<p>"${esc(c.name)}" 이벤트와 그 준비 업무 ${count}건을 지웁니다.</p><p class="home-muted">되돌릴 수 없습니다. 현지 일정 자료와 뉴스는 지워지지 않습니다.</p><div class="home-form-actions"><button class="btn" data-cancel-delete type="button">취소</button><button class="btn dark" data-confirm-delete="${esc(c.id)}" type="button">삭제</button></div>`);
  }
  async function changeCampaign(campaignId) { const next = structuredClone(store); next.preferences.selected = campaignId; if (await save(next)) render(); }
  function openReview() {
    const c = selected(); if (!c) return;
    const outline = '[잘된 점]\n\n[문제와 원인]\n\n[다음 회차 개선]\n';
    openDialog(c.name + ' · 회고 관리', '<form id="review-form"><label class="home-field">이벤트 상태<select name="status">' + Object.entries(CAMPAIGN_STATES).map(([key, label]) => '<option value="' + key + '"' + (key === c.status ? ' selected' : '') + '>' + label + '</option>').join('') + '</select></label><label class="home-field">회고와 다음 할 일<textarea name="review" rows="9" maxlength="5000">' + esc(c.review || outline) + '</textarea></label><div class="home-form-actions"><button class="btn dark" type="submit">회고 저장</button></div></form>');
    $('#review-form').onsubmit = async event => {
      event.preventDefault(); const f = new FormData(event.currentTarget), next = structuredClone(store);
      const campaign = next.campaigns.find(item => item.id === c.id);
      if (!campaign) return;
      campaign.review = f.get('review'); campaign.status = f.get('status');
      if (await save(next)) { dialog.close(); render(); toast('회고와 이벤트 상태를 저장했습니다.'); }
    };
  }
  $('#open-review').onclick = openReview;
  $('#campaign-select').onchange = event => changeCampaign(event.target.value);
  $('#delete-campaign').onclick = () => { $('#campaign-more').open = false; removeCampaign(); };
  $('#campaign-more').addEventListener('keydown', event => {
    if (event.key === 'Escape') { event.preventDefault(); $('#campaign-more').open = false; $('#campaign-more summary').focus(); }
  });
  panelTabs.forEach(([tab, name]) => { tab.onclick = () => showPanel(name); });
  $('.home-paneltabs').addEventListener('keydown', event => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    const current = panelTabs.findIndex(([tab]) => tab === event.target);
    if (current < 0) return;
    event.preventDefault();
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? panelTabs.length - 1 : (current + (event.key === 'ArrowRight' ? 1 : -1) + panelTabs.length) % panelTabs.length;
    showPanel(panelTabs[next][1]); panelTabs[next][0].focus();
  });
  try {
    const saved = localStorage.getItem(PANEL_KEY);
    if (saved) showPanel(saved === 'calendar' ? 'month' : saved);
  } catch { /* Default monthly view remains available. */ }
  $('#today-reset').onclick = () => { selectedDate = today; renderCalendar(); renderTasks(); };
  $('#new-campaign').onclick = () => planner('create');
  $('#clone-campaign').onclick = () => { $('#campaign-more').open = false; planner('clone'); };
  $('#replan-campaign').onclick = () => planner('replan');
  function tickClocks() {
    // 두 도시의 현재 시각을 함께 보여 줍니다. 업무 기준일은 한국 시간 기준입니다.
    const now = new Date();
    const fmt = zone => new Intl.DateTimeFormat('ko-KR', { timeZone: zone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(now);
    const dateLabel = zone => new Intl.DateTimeFormat('ko-KR', { timeZone: zone, month: '2-digit', day: '2-digit', weekday: 'short' }).format(now);
    const kst = $('#clock-kst'), ict = $('#clock-ict');
    if (kst) kst.textContent = fmt('Asia/Seoul');
    if (ict) ict.textContent = fmt('Asia/Ho_Chi_Minh');
    $('#clock-date-kst').textContent = dateLabel('Asia/Seoul');
    $('#clock-date-ict').textContent = dateLabel('Asia/Ho_Chi_Minh');
    ['#clock-date-kst', '#clock-date-ict'].forEach(sel => { $(sel).dateTime = now.toISOString(); });
    const currentDay = kstToday();
    if (currentDay !== today) {
      const followingToday = selectedDate === today;
      today = currentDay;
      if (followingToday) selectedDate = today;
      if (serverToken !== null) render();
    }
    updateWeekNow();
  }
  tickClocks();
  setInterval(tickClocks, 30000);
  function moveCalendar(direction) {
    if (view === 'week') cursor = addDays(cursor, direction * 7);
    else { const d = new Date(`${cursor.slice(0, 7)}-01`); d.setUTCMonth(d.getUTCMonth() + direction); cursor = d.toISOString().slice(0, 10); }
    refreshSignals();
  }
  $('#calendar-prev').onclick = () => moveCalendar(-1);
  $('#calendar-next').onclick = () => moveCalendar(1);
  if (typeof ResizeObserver !== 'undefined') {
    const monthSizer = new ResizeObserver(() => {
      const month = $('.home-month');
      if ($('#calendar-panel').hidden || view !== 'month' || !month) return;
      if (Number(month.dataset.slots) !== calendarMonthSlots($('#calendar-body').clientHeight, Number(month.dataset.weekCount), $('#calendar-body').clientWidth)) renderCalendar();
    });
    monthSizer.observe($('#calendar-body'));
  }
  $('#range-preset').onchange = event => {
    $('#range-custom').open = event.target.value === 'custom';
    if (event.target.value !== 'custom') { $('#range-start').value = today; $('#range-end').value = addDays(today, Number(event.target.value)); }
  };
  ['#range-start', '#range-end'].forEach(sel => { $(sel).onchange = () => { $('#range-preset').value = 'custom'; }; });
  $('#range-form').onsubmit = async event => {
    event.preventDefault(); const r = range();
    const invalid = !validDate(r.start) || !validDate(r.end) || r.end < r.start || Number(r.end.slice(0, 4)) - Number(r.start.slice(0, 4)) > 5;
    $('#range-error').hidden = !invalid;
    if (invalid) { $('#range-error').textContent = '종료일을 시작일 이후로 지정해주세요. 조회 범위는 최대 5년입니다.'; return; }
    const next = structuredClone(store); Object.assign(next.preferences, { preset: $('#range-preset').value, range_start: r.start, range_end: r.end });
    if (await save(next)) refreshSignals();
  };
  // 현지 뉴스 검색. 결과는 검증하지 않은 외부 목록이라 요약 없이 제목·언론사·발행일·원문 링크만 보여 줍니다.
  const newsForm = $('#news-search-form');
  function newsError(message) {
    const box = $('#news-search-error');
    box.textContent = message || '';
    box.hidden = !message;
  }
  let searchNumber = 0, lastSearch = null, translateOn = false, translateTarget = '';
  const TRANSLATE_KEY = 'hjs-home-news-translate';
  async function searchNews(params) {
    const token = ++searchNumber;
    newsError('');
    const results = $('#news-search-list');
    results.closest('.is-search').classList.remove('is-idle');
    $('#news-search-hint').hidden = true;
    results.setAttribute('aria-busy', 'true');
    results.innerHTML = '<div class="home-news-loading" role="status"><span class="home-spinner" aria-hidden="true"></span><div><strong>뉴스를 불러오고 있습니다</strong><p>' + (translateOn ? '기사 검색과 제목 번역을 진행하고 있습니다.' : '관련 기사 목록을 확인하고 있습니다.') + '</p></div></div>';
    $('#news-search-form button[type="submit"]').disabled = true;
    try {
      lastSearch = params;
      const query = { ...params };
      if (translateOn && translateTarget) query.target = translateTarget;
      const response = await fetch(`${newsForm.dataset.searchUrl}?${new URLSearchParams(query)}`);
      const data = await response.json().catch(() => ({}));
      if (token !== searchNumber) return;
      if (!response.ok || !Array.isArray(data.items)) throw new Error(data.error || '');
      $('#news-search-list').innerHTML = data.items.map(n => {
        const url = safeUrl(n.url);
        const title = url ? `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(n.title)} ↗</a>` : esc(n.title);
        const via = n.source_label && n.source_label !== n.publisher ? ` · ${esc(n.source_label)}` : '';
        const origin = n.translated ? `<p class="home-news-origin">원문: ${esc(n.title_original)}</p>` : '';
        return `<article class="home-news-result"><div class="home-news-result-title${n.translated ? ' is-translated' : ''}">${title}</div>${origin}<p class="home-signal-meta">${esc(n.publisher || '언론사 미표기')}${n.published_at ? ` · ${esc(n.published_at)}` : ''}${via}</p></article>`;
      }).join('') || empty('검색 결과가 없습니다. 다른 검색어로 찾아봐주세요.');
      // 한 출처가 빠졌을 때 조용히 넘어가지 않고 어디가 빠졌는지 알립니다.
      if (Array.isArray(data.unavailable) && data.unavailable.length) {
        newsError(`${data.unavailable.join(' · ')} 출처를 불러오지 못했습니다. 아래 결과에는 빠져 있습니다.`);
      } else if (data.translation_failed) {
        // 번역하지 못했을 때 번역된 것처럼 보이지 않도록 원문임을 알립니다.
        newsError('지금은 번역하지 못해 원문 제목을 그대로 보여줍니다.');
      }
    } catch (error) {
      // 불러오지 못한 경우 빈 목록을 결과처럼 보여 주지 않고 실패를 그대로 알립니다.
      if (token !== searchNumber) return;
      $('#news-search-list').innerHTML = '';
      newsError(error.message || '지금은 뉴스 검색을 불러올 수 없습니다. 잠시 후 다시 시도해주세요.');
    } finally {
      if (token === searchNumber) {
        results.setAttribute('aria-busy', 'false');
        $('#news-search-form button[type="submit"]').disabled = false;
      }
    }
  }
  function setupTranslate(data) {
    // 키가 없는 환경에서는 버튼을 숨기고 원문만 보여 줍니다.
    const button = $('#news-translate'), uiLang = document.documentElement.dataset.uiLang || 'ko';
    const targets = Array.isArray(data.targets) ? data.targets : [];
    translateTarget = targets.includes(uiLang) ? uiLang : '';
    if (!data.translation || !translateTarget) { button.hidden = true; translateOn = false; return; }
    let saved = null;
    try { saved = localStorage.getItem(TRANSLATE_KEY); } catch { saved = null; }
    // 한국어·영어 화면은 번역을 켜 둡니다. 베트남어 화면은 원문을 그대로 봅니다.
    translateOn = saved === null ? true : saved === 'on';
    button.hidden = false;
    button.textContent = translateTarget === 'ko' ? '자동 번역' : 'Auto-translate';

    button.title = translateTarget === 'ko' ? '기사 제목을 한국어로 번역합니다' : 'Translate headlines into English';
    button.setAttribute('aria-pressed', String(translateOn));
    button.onclick = () => {
      translateOn = !translateOn;
      button.setAttribute('aria-pressed', String(translateOn));
      try { localStorage.setItem(TRANSLATE_KEY, translateOn ? 'on' : 'off'); } catch { /* 저장 못 해도 동작합니다 */ }
      if (lastSearch) searchNews(lastSearch);
    };
  }
  // 뉴스 검색 화면이 없으면 이 기능만 건너뜁니다. 한 기능의 실패가 달력·업무까지 멈추지 않게 합니다.
  if (newsForm) {
    $('#news-presets').onclick = event => {
      const button = event.target.closest('[data-preset]');
      if (button) searchNews({ preset: button.dataset.preset });
    };
    newsForm.onsubmit = event => { event.preventDefault(); searchNews({ q: $('#news-query').value }); };
    (async () => {
      try {
        const response = await fetch(newsForm.dataset.presetsUrl);
        const data = await response.json().catch(() => ({}));
        if (!response.ok || !Array.isArray(data.items)) throw new Error('');
        $('#news-presets').innerHTML = data.items.map(p => `<button type="button" class="btn" data-preset="${esc(p.key)}">${esc(p.label)}</button>`).join('');
        setupTranslate(data);
      } catch {
        newsError('검색 항목을 불러오지 못했습니다. 직접 검색은 그대로 쓸 수 있습니다.');
      }
    })();
  }
  await load(); updateRange(); refreshSignals();
}
