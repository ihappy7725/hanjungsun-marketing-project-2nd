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
const newsPreview = value => {
  const text = String(value ?? '').trim();
  return text.match(/^[\s\S]*?[.!?](?=\s|$)/u)?.[0] || text;
};
const id = () => `vn_home_${crypto.randomUUID()}_${new Date().getUTCFullYear()}`;
const kstToday = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const shortDate = value => value ? value.slice(5).replace('-', '/') : '날짜 없음';
const empty = text => `<p class="home-empty">${esc(text)}</p>`;
const badge = (text, warning = false) => `<span class="home-badge${warning ? ' warning' : ''}">${esc(text)}</span>`;
function safeUrl(value, fallback = '') {
  try { const url = new URL(value, location.origin); return ['https:', 'http:'].includes(url.protocol) ? url.href : fallback; } catch { return fallback; }
}
function tabLink(tab) { return Object.hasOwn(TABS, tab) ? `/${tab}/` : '/home/'; }

function demoStore(today) {
  const campaign = { id: id(), name: '스승의 날 선물 이벤트', target_date: addDays(today, 28), template: 'launch', status: 'active', product: '과일찹쌀떡 선물세트', audience: '다낭 선물 구매 고객', channel: 'Instagram · TikTok', event_id: 'demo_gift_day', review: '' };
  const tasks = TEMPLATE.map(([key, offset, title, related_tab], i) => ({ id: id(), campaign_id: campaign.id, key, offset, title, related_tab, due_date: addDays(campaign.target_date, offset), start_date: '', fixed: false, status: i < 2 ? 'done' : i === 4 ? 'blocked' : 'todo', importance: 'normal', memo: '', completed_at: '' }));
  const extras = [[-1, '소재 A 문구 확인'], [3, '게시물 링크 점검'], [3, '협업 피드백 정리'], [7, '선물 포장 사진 준비']];
  extras.forEach(([days, title]) => tasks.push({ id: id(), campaign_id: campaign.id, key: '', offset: days - 28, title, related_tab: 'content_studio', due_date: addDays(today, days), start_date: '', fixed: false, status: 'todo', importance: 'normal', memo: '', completed_at: '' }));
  return { version: 1, campaigns: [campaign], tasks, schedules: [], links: [], preferences: { selected: campaign.id, preset: '45' }, demo_anchor: today };
}
function blankStore() { return { version: 1, campaigns: [], tasks: [], schedules: [], links: [], preferences: { selected: '', preset: '45' } }; }
export async function migrationRequest(url, payload, fetcher = fetch) {
  let response;
  try {
    response = await fetcher(url, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin', cache: 'no-store', body: JSON.stringify(payload) });
  } catch {
    throw new Error('서버 응답을 확인하지 못했습니다. 저장 요청을 보낸 뒤라면 먼저 파일을 다시 검사해주세요. 같은 기록은 중복으로 추가되지 않습니다.');
  }
  let result;
  try { result = await response.json(); }
  catch { throw new Error('서버 응답을 읽지 못했습니다. 옮기기 성공 여부를 확인하려면 파일을 다시 검사해주세요.'); }
  if (!response.ok) throw new Error(result.error || '서버에서 처리하지 못했습니다. 파일을 다시 검사해주세요.');
  return result;
}
function validStore(s) {
  return s && s.version === 1 && Array.isArray(s.campaigns) && Array.isArray(s.tasks) && Array.isArray(s.schedules) && Array.isArray(s.links) && s.preferences &&
    s.campaigns.every(c => typeof c.id === 'string' && typeof c.name === 'string' && validDate(c.target_date)) &&
    s.tasks.every(t => typeof t.id === 'string' && typeof t.title === 'string' && Object.hasOwn(TASK_STATES, t.status) && (t.category === undefined || (typeof t.category === 'string' && Object.hasOwn(TASK_CATEGORIES, t.category))) && (!t.due_date || validDate(t.due_date)) && (!t.start_date || validDate(t.start_date))) &&
    new Set(s.tasks.map(t => t.id)).size === s.tasks.length && new Set(s.campaigns.map(c => c.id)).size === s.campaigns.length;
}

if (typeof document !== 'undefined') initialize();
function setupPanelResize(root) {
  const side = root.querySelector('.home-side-panels');
  const reset = root.querySelector('#reset-panel-sizes');
  if (!side || !reset) return;
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
  reset.onclick = () => {
    root.querySelectorAll('.home-resizable').forEach(panel => {
      panel.style.removeProperty('width');
      panel.style.removeProperty('height');
    });
    updateRows();
  };
}
async function initialize() {
  const root = document.querySelector('.home-page');
  if (!root) return;
  setupPanelResize(root);
  const $ = selector => root.querySelector(selector);
  let today = kstToday(), selectedDate = today, cursor = today, scope = 'all', panel = 'calendar';
  const TIMELINE_FROM = 7, TIMELINE_TO = 21, TIMEZONE_LABEL = 'KST';
  let view = matchMedia('(max-width: 540px)').matches ? 'list' : 'month';
  let mode = 'work', store = blankStore(), loadedRaw, locked = false, signals = null, requestNumber = 0, toastTimer;
  let renderedNewsMarkup = null;
  let serverToken = null, serverBaseline = null, storageBusy = false;
  let taskCategoriesAvailable = false;
  const categoriesEnabled = () => mode === 'demo' || taskCategoriesAvailable;
  const taskCategoryText = task => categoriesEnabled() ? ` · 종류: ${esc(TASK_CATEGORIES[task.category || ''])}` : '';
  const preferencesKey = 'hjs-home-server-work-preferences-v1';
  const key = () => `hjs-home-browser-v1-${mode}`;
  const showError = message => { $('#storage-error').hidden = !message; $('#storage-error').textContent = message; };
  function toast(message) { clearTimeout(toastTimer); $('#home-toast').textContent = message; $('#home-toast').hidden = false; toastTimer = setTimeout(() => { $('#home-toast').hidden = true; }, 2800); }
  try {
    const preference = localStorage.getItem('hjs-home-browser-mode');
    mode = ['demo', 'work'].includes(preference) ? preference : 'work';
  } catch { /* 저장소 접근 실패는 load에서 사용자에게 알립니다. */ }
  const workData = value => ({ version: 1, campaigns: value.campaigns, tasks: value.tasks, schedules: value.schedules, links: value.links });
  function storageControls(busy) {
    storageBusy = busy;
    for (const selector of ['#data-mode', '#record-action', '#export-store', '#import-store', '#migrate-store', '#new-campaign', '#clone-campaign', '#replan-campaign', '#delete-campaign']) {
      const control = $(selector); if (control) control.disabled = busy || (selector === '#record-action' && migrationBusy);
    }
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
    serverToken = null; serverBaseline = null; store = blankStore();
    taskCategoriesAvailable = false;
    try {
      if (mode === 'work') {
        let preferences = blankStore().preferences;
        try {
          const saved = localStorage.getItem(preferencesKey);
          const previous = saved === null ? JSON.parse(localStorage.getItem('hjs-home-browser-v1-work') || 'null')?.preferences : JSON.parse(saved);
          if (previous && typeof previous === 'object' && !Array.isArray(previous)) preferences = { ...preferences, ...previous };
        } catch { /* 업무 원본은 서버에서만 읽습니다. 화면 설정을 못 읽어도 업무 조회는 계속합니다. */ }
        const result = await workRequest('GET');
        store = { ...result.data, preferences }; serverToken = result.token;
        taskCategoriesAvailable = result.task_categories_enabled === true;
        serverBaseline = JSON.stringify(workData(store));
      } else {
        loadedRaw = localStorage.getItem(key());
        store = loadedRaw === null ? demoStore(today) : JSON.parse(loadedRaw);
        if (loadedRaw === null) { localStorage.setItem(key(), JSON.stringify(store)); loadedRaw = localStorage.getItem(key()); }
      }
      if (!validStore(store)) throw new Error('invalid');
      locked = false;
    } catch (error) {
      locked = true; store = blankStore();
      showError(mode === 'work' ? `서버 기록을 불러오지 못해 편집을 멈췄습니다. ${error.message}` : '예시 브라우저 기록을 읽지 못해 편집을 멈췄습니다. 저장소 설정을 확인해주세요.');
    } finally { storageControls(false); }
    $('#data-mode').value = mode;
    const notice = $('#storage-notice');
    if (notice) notice.textContent = mode === 'work' ? '내 업무는 서버에 저장됩니다. 화면 선택·조회 기간만 이 브라우저에 보관합니다.' : '예시 데이터 (DEMO)는 이 브라우저에만 저장됩니다.';
  }
  async function save(next, deleteCampaignIds = []) {
    if (locked) { toast('저장소를 확인한 뒤 새로고침해주세요.'); return false; }
    if (storageBusy || migrationBusy) { toast('저장이 끝난 뒤 다시 눌러주세요.'); return false; }
    if (!validStore(next)) { showError('저장할 기록의 형식이 올바르지 않습니다. 기존 기록은 유지됩니다.'); return false; }
    if (mode === 'work') {
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
        locked = true; showError(`저장 성공 여부를 확인하지 못했습니다. ${error.message} 새로고침 전까지 편집을 멈춥니다.`);
        return false;
      } finally { storageControls(false); }
    }
    try {
      if (localStorage.getItem(key()) !== loadedRaw) { locked = true; showError('다른 창에서 기록이 변경되었습니다. 덮어쓰지 않도록 저장을 멈췄습니다. 새로고침해주세요.'); return false; }
      const serialized = JSON.stringify(next); localStorage.setItem(key(), serialized); loadedRaw = serialized; store = next; return true;
    } catch { showError('저장하지 못했습니다. 저장 공간과 브라우저 설정을 확인해주세요. 기존 기록은 유지됩니다.'); return false; }
  }
  const selected = () => store.campaigns.find(c => c.id === store.preferences.selected) || store.campaigns[0];
  const inScope = () => store.tasks.filter(t => scope === 'all' || t.campaign_id === selected()?.id);
  const campaignName = campaignId => store.campaigns.find(c => c.id === campaignId)?.name || '이벤트 없음';
  function range() { return { start: $('#range-start').value, end: $('#range-end').value }; }
  function updateRange() {
    const preset = store.preferences.preset || '45'; $('#range-preset').value = preset;
    $('#range-custom').open = preset === 'custom';
    $('#range-start').value = preset === 'custom' ? store.preferences.range_start || today : today;
    $('#range-end').value = preset === 'custom' ? store.preferences.range_end || today : addDays(today, Number(preset));
  }
  function demoSignals() {
    const anchor = store.demo_anchor || today;
    return {
      events: { state: 'ok', items: [
        { event_id: 'demo_gift_day', name: '선물 이벤트 기념일', date: addDays(anchor, 28), type: 'anniversary', region: '다낭', source_name: '가상 기념일 · 운영 일정 아님', is_demo: true },
        { event_id: 'demo_fruit_season', name: '열대과일 시즌 기획', start_date: addDays(anchor, 7), end_date: addDays(anchor, 18), type: 'fruit_season', region: '다낭', source_name: '가상 시즌 · 실제 제철 정보 아님', is_demo: true },
        { event_id: 'demo_local_holiday', name: '지역 행사 준비', date: addDays(anchor, 42), type: 'anniversary', region: '다낭', source_name: '가상 행사', is_demo: true },
      ] },
      collaborations: { state: 'ok', items: [
        { collaboration_id: 'demo_creator_a', influencer: '예시 크리에이터 A', main_platform: 'Instagram', status: 'confirmed', status_label: '계약 확정', shoot_date: addDays(anchor, 1), post_date: addDays(anchor, 6), requires_attention: true, next_action: '촬영 장소와 제품 전달 시간을 최종 확인합니다.', event_id: 'demo_gift_day', is_demo: true },
        { collaboration_id: 'demo_creator_b', influencer: '예시 크리에이터 B', main_platform: 'TikTok', status: 'shot', status_label: '촬영 완료', post_date: addDays(anchor, 2), next_action: '게시 예약과 최종 영상 링크를 확인합니다.', event_id: 'demo_gift_day', is_demo: true },
        { collaboration_id: 'demo_creator_c', influencer: '예시 크리에이터 C', main_platform: 'YouTube', status: 'sent', status_label: '제안 발송', post_date: addDays(anchor, 5), requires_attention: true, next_action: '제안 회신을 요청하고 촬영 가능일을 확인합니다.', event_id: 'demo_gift_day', is_demo: true },
      ] }, attention: { state: 'ok', items: [] },
      news: { state: 'ok', items: [
        ['선물 구매 고객을 위한 제품 소개', '선물 목적과 구매 상황을 나누어 고객 반응을 정리하는 가상 조사 자료입니다.', '선물세트 포장과 구성품을 보여주는 카드뉴스를 준비합니다.'],
        ['과일 단면을 활용한 콘텐츠 방향', '제품 단면·크기·포장을 서로 다른 소재로 비교하는 가상 기획 자료입니다.', '과일 단면을 강조하는 영상의 첫 장면을 구상합니다.'],
        ['고객 문의에서 확인할 구매 정보', '가격·보관·선물 포장 관련 질문을 분류한 가상 예시입니다.', '반복되는 질문을 제품 안내 콘텐츠에 반영합니다.'],
      ].map(([title, summary, suggestion], i) => ({ news_id: `demo_news_${i}`, title, summary, suggestion, published_at: addDays(anchor, -i), source: 'DEMO · 예시 조사 자료', region: '다낭', is_demo: true })) },
    };
  }
  function localEvents() {
    return (signals?.events.items || []).filter(e => (mode === 'demo' || e.is_demo !== true)).map(e => ({ ...e, start: e.start_date || e.date, end: e.end_date || e.start_date || e.date })).filter(e => validDate(e.start) && validDate(e.end) && e.end >= e.start);
  }
  function overlaps(t) { return t.due_date ? localEvents().filter(e => e.start <= t.due_date && e.end >= t.due_date) : []; }
  function creators() {
    return (signals?.collaborations.items || []).filter(c => (mode === 'demo' || c.is_demo !== true) && c.status !== 'declined' && (scope === 'all' || store.links.some(l => l.campaign_id === selected()?.id && l.collaboration_id === c.collaboration_id) || (selected()?.event_id && c.event_id === selected().event_id) || !c.event_id));
  }
  function calendarEvents() {
    const events = inScope().filter(t => t.due_date && t.status !== 'cancelled').map(t => ({ date: t.due_date, end: t.due_date, title: t.title, kind: 'task', id: t.id, done: t.status === 'done', time: validTime(t.due_time) ? t.due_time : '' }));
    const locals = localEvents();
    locals.forEach(e => events.push({ date: e.start, end: e.end, title: e.name, kind: 'local', id: e.event_id, provisional: e.provisional === true }));
    // 현지 일정에서 만든 이벤트는 같은 날 같은 이름으로 두 줄이 됩니다. 현지 일정 쪽만 남기고 디데이 표시만 붙입니다.
    store.campaigns.filter(c => scope === 'all' || c.id === selected()?.id).forEach(c => {
      const anchor = locals.find(e => e.event_id && e.event_id === c.event_id && e.start <= c.target_date && e.end >= c.target_date);
      if (anchor) { const row = events.find(e => e.kind === 'local' && e.id === anchor.event_id); if (row) row.campaignId = c.id; return; }
      events.push({ date: c.target_date, end: c.target_date, title: c.name, kind: 'campaign', id: c.id });
    });
    store.schedules.filter(s => validDate(s.date) && (scope === 'all' || s.campaign_id === selected()?.id)).forEach(s => events.push({ date: s.date, end: s.date, title: s.title || s.name, kind: 'schedule', id: s.id }));
    creators().filter(c => scope === 'all' || store.links.some(l => l.campaign_id === selected()?.id && l.collaboration_id === c.collaboration_id) || (selected()?.event_id && c.event_id === selected().event_id)).forEach(c => ['shoot_date', 'post_date'].forEach(field => {
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
    return `<p class="home-signal-meta">${eventPeriod(e)}${e.verified_at ? ` · 확인 ${esc(e.verified_at)}` : ''}</p>${monthly(e) ? badge('월 단위 · 일 단위 미확인') : ''}${e.applies_to ? `<p>${esc(e.applies_to)}</p>` : ''}<p class="home-signal-meta">${eventSources(e)}</p>`;
  }
  function showLocalEvent(eventId) {
    const e = localEvents().find(item => item.event_id === eventId);
    if (!e) { toast('일정 정보를 찾지 못했습니다. 다시 조회해주세요.'); return; }
    openDialog(e.name, `${e.is_demo ? '' : badge(e.provisional ? '미확정 · 정부 공문 전' : '출처 확인 자료', e.provisional === true)}<p>${esc(e.official_name || e.name)}</p>${eventSummary(e)}<p>${esc(e.description || '')}</p>${e.original_period ? `<p class="home-muted">원문 기간: ${esc(e.original_period)}</p>` : ''}${e.schedule_nature ? `<p class="home-muted">일정 성격: ${esc(e.schedule_nature)}</p>` : ''}${e.verification_notes ? `<p class="home-muted">검증 범위: ${esc(e.verification_notes)}</p>` : ''}<div class="home-form-actions"><button class="btn dark" data-create="${esc(e.event_id)}">+ 이벤트 기획</button></div>`);
  }
  function eventAction(e) {
    if (e.kind === 'task') return `<button class="btn" data-task="${esc(e.id)}">열기</button>`;
    if (e.kind === 'creator') return `<a class="btn" href="${esc(safeUrl(e.link || `/influencer_marketing/?collaboration_id=${encodeURIComponent(e.id)}`))}">협업 보기 ↗</a>`;
    if (e.kind === 'local') return `<button class="btn" data-local="${esc(e.id)}">일정 상세</button>`;
    if (e.kind === 'campaign') return `<button class="btn" data-select="${esc(e.id)}">이벤트 보기</button>`;
    return '';
  }
  function renderCalendar() {
    const events = calendarEvents(), at = date => events.filter(e => e.date <= date && e.end >= date);
    root.querySelectorAll('[data-view]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.view === view)));
    let start, end;
    if (view === 'month') {
      const first = `${cursor.slice(0, 7)}-01`, weekday = (new Date(first).getUTCDay() + 6) % 7;
      start = addDays(first, -weekday); const nextMonth = new Date(first); nextMonth.setUTCMonth(nextMonth.getUTCMonth() + 1);
      const weeks = Math.ceil((dayDiff(nextMonth.toISOString().slice(0, 10), first) + weekday) / 7); end = addDays(start, weeks * 7 - 1);
    } else if (view === 'week') { start = addDays(cursor, -((new Date(cursor).getUTCDay() + 6) % 7)); end = addDays(start, 6); }
    else { start = `${cursor.slice(0, 7)}-01`; const next = new Date(start); next.setUTCMonth(next.getUTCMonth() + 1); end = addDays(next.toISOString().slice(0, 10), -1); }
    $('#calendar-period').textContent = view === 'week' ? `${shortDate(start)} – ${shortDate(end)}` : `${cursor.slice(0, 4)}. ${cursor.slice(5, 7)}`;
    if (view === 'week') {
      // 구글 캘린더처럼 요일 7칸 x 시간대 행으로 그립니다. 시간이 없는 항목은 위쪽 종일 칸에 둡니다.
      const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
      const header = days.map(day => `<button class="home-tl-head${day === today ? ' is-today' : ''}" data-date="${day}" aria-pressed="${day === selectedDate}"><span class="home-tl-weekday">${['월', '화', '수', '목', '금', '토', '일'][(new Date(day).getUTCDay() + 6) % 7]}</span><span class="home-tl-daynum">${Number(day.slice(8))}</span></button>`).join('');
      const allDay = days.map(day => `<div class="home-tl-allday-cell">${at(day).filter(e => !e.time).map(e => `<button class="home-event ${e.kind}${e.done ? ' done' : ''}" data-open="${esc(e.kind)}:${esc(e.id)}">${esc(e.title)}</button>`).join('')}</div>`).join('');
      let grid = '';
      for (let hour = TIMELINE_FROM; hour <= TIMELINE_TO; hour++) {
        const label = `${String(hour).padStart(2, '0')}:00`;
        grid += `<div class="home-tl-hour">${label}</div>`;
        grid += days.map(day => {
          const slot = at(day).filter(e => e.time && Number(e.time.slice(0, 2)) === hour);
          return `<button class="home-tl-cell${day === today ? ' is-today' : ''}" data-slot="${day} ${label}" aria-label="${day} ${label} 업무 추가">${slot.map(e => `<span class="home-event ${e.kind}${e.done ? ' done' : ''}" title="${esc(e.time)} ${esc(e.title)}">${esc(e.time)} ${esc(e.title)}</span>`).join('')}</button>`;
        }).join('');
      }
      $('#calendar-body').innerHTML = `<div class="home-timeline"><div class="home-tl-corner">${TIMEZONE_LABEL}</div>${header}<div class="home-tl-corner home-tl-allday-label">종일</div>${allDay}<div class="home-tl-scroll"><div class="home-tl-grid">${grid}</div></div></div>`;
      return;
    }
    if (view === 'list') {
      const rows = events.filter(e => e.date <= end && e.end >= start).sort((a, b) => a.date.localeCompare(b.date));
      $('#calendar-body').innerHTML = rows.length ? rows.map(e => `<div class="home-agenda-row"><div><span class="home-muted">${esc(e.date)}${e.end !== e.date ? ` ~ ${esc(e.end)}` : ''}</span><br>${esc(e.title)} ${e.done ? badge('완료') : ''}</div>${eventAction(e)}</div>`).join('') : empty('이달에 등록된 일정이 없습니다.');
    } else {
      let html = '<div class="home-month"><div class="home-weekdays">' + ['월', '화', '수', '목', '금', '토', '일'].map(d => `<div class="home-weekday">${d}</div>`).join('') + '</div>';
      for (let weekStart = start; weekStart <= end; weekStart = addDays(weekStart, 7)) {
        const segments = periodSegments(events, weekStart);
        const laneCount = segments.reduce((n, segment) => Math.max(n, segment.lane + 1), 0);
        html += `<div class="home-week" style="--period-lanes:${laneCount};grid-template-rows:var(--home-day-head) ${laneCount ? `repeat(${laneCount}, calc(var(--home-chip-h) + 2px)) ` : ''}1fr">`;
        for (let column = 1; column <= 7; column++) {
          const day = addDays(weekStart, column - 1), allDayEvents = at(day);
          // 이어지는 일정은 기간 막대로만 보여 주고 날짜 칩에서는 뺍니다. 같은 일정이 두 번 나오지 않게 합니다.
          // 공휴일·축제 같은 현지 일정을 맨 위에 둡니다. 그날의 성격을 먼저 읽게 하기 위함입니다.
          const dayEvents = allDayEvents.filter(e => !(e.kind === 'local' && e.date < e.end))
            .sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind));
          // 하루에 보이는 것은 기간 막대까지 더해 DAY_SLOTS개까지입니다. 업무가 많아도 달력 높이가 변하지 않습니다.
          const room = Math.max(0, DAY_SLOTS - segments.filter(s => s.start <= day && s.end >= day).length);
          let shown = Math.min(dayEvents.length, room);
          if (dayEvents.length > shown && shown > 0) shown -= 1; // 더 보기 줄도 한 칸을 차지합니다
          const rest = dayEvents.length - shown;
          const chips = dayEvents.slice(0, shown).map(e => `<span class="home-event ${e.kind}${e.done ? ' done' : ''}${e.provisional ? ' is-provisional' : ''}" title="${esc(e.title)}${e.provisional ? ' · 법정일 기준, 연휴 기간 미확정' : ''}${e.campaignId ? ' · 이벤트 기준일' : ''}">${esc(e.title)}</span>`).join('') + (rest > 0 && room > 0 ? `<span class="home-more">+${rest}</span>` : '');
          html += `<button class="home-day${day === today ? ' is-today' : ''}${view === 'month' && day.slice(0, 7) !== cursor.slice(0, 7) ? ' home-outside' : ''}" style="grid-column:${column};grid-row:1 / -1" data-date="${day}" aria-pressed="${day === selectedDate}" aria-label="${day}, 일정 ${allDayEvents.length}건"><span class="home-day-number">${Number(day.slice(8))}</span></button>`;
          // 칩은 기간 막대보다 아래 행에 따로 배치해 겹치지 않게 합니다. 클릭은 아래 날짜 칸이 받습니다.
          if (chips) html += `<span class="home-day-events" style="grid-column:${column};grid-row:${laneCount + 2}">${chips}</span>`;
        }
        html += segments.map(segment => {
          const e = segment.event;
          return `<button class="home-period-bar${e.provisional ? ' is-provisional' : ''}${segment.continuesBefore ? ' continues-before' : ''}${segment.continuesAfter ? ' continues-after' : ''}" style="grid-column:${segment.column} / span ${segment.span};grid-row:${segment.lane + 2}" data-local="${esc(e.id)}" data-period-start="${segment.start}" data-period-end="${segment.end}" aria-label="${esc(e.title)}, ${e.date}부터 ${e.end}까지${segment.continuesBefore ? ', 앞 주에서 이어짐' : ''}${segment.continuesAfter ? ', 다음 주에 이어짐' : ''}">${segment.continuesBefore ? '<span aria-hidden="true">← </span>' : ''}${esc(e.title)}${segment.continuesAfter ? '<span aria-hidden="true"> →</span>' : ''}</button>`;
        }).join('') + '</div>';
      }
      $('#calendar-body').innerHTML = html + '</div>';
    }
  }
  function renderTasks() {
    // 진척도는 현재 선택한 이벤트의 업무만 기준으로 합니다. 표시 범위 선택은 아래 목록에만 적용합니다.
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
    $('#tasks-title').textContent = isToday ? '오늘의 해야 할 일' : `${selectedDate} 해야 할 일`;
    $('#today-reset').hidden = isToday;
    // 완료한 업무도 목록에 남겨 그날 무엇을 했는지 볼 수 있게 합니다. 취소 업무는 제외합니다.
    // 기준일에는 지난 미완료 업무도 함께 보여 놓치지 않게 합니다. 다른 날짜를 고르면 그날 업무만 봅니다.
    const rows = ordered(inScope().filter(t => t.status !== 'cancelled' && (
      t.due_date === selectedDate || (isToday && unfinished(t) && t.due_date && t.due_date < today))), today);
    $('#task-list').innerHTML = rows.map(t => {
      const done = t.status === 'done', late = unfinished(t) && t.due_date && t.due_date < today;
      return `<div class="home-task${done ? ' is-done' : ''}"><input type="checkbox" data-check="${esc(t.id)}" ${done ? 'checked' : ''} aria-label="${esc(t.title)} 완료"><div><div class="home-task-top"><button class="home-task-open" data-task="${esc(t.id)}">${esc(t.title)}</button><span class="home-task-actions">${badge(done ? '완료' : late ? '기한 초과' : TASK_STATES[t.status], late && !done)}<button class="home-text-btn" data-move="${esc(t.id)}" aria-label="${esc(t.title)} 다른 날로 이월" title="다른 날로 이월">-&gt;</button></span></div><div class="home-task-meta">${t.due_date !== selectedDate ? `${esc(t.due_date)} 마감 · ` : ''}${esc(campaignName(t.campaign_id))}${taskCategoryText(t)}</div>${t.related_tab === 'kpi' && t.due_date && t.due_date <= today ? '<a class="home-muted" href="/kpi/">KPI 확인 ↗</a>' : ''}</div></div>`;
    }).join('') || empty(isToday ? '오늘 마감인 업무가 없습니다. 캘린더에서 다른 날짜를 선택할 수 있습니다.' : '이 날짜에 마감인 업무가 없습니다.');
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
    $('#campaign-select').innerHTML = store.campaigns.length ? store.campaigns.map(item => `<option value="${esc(item.id)}" ${item.id === c?.id ? 'selected' : ''}>${esc(item.name)}</option>`).join('') : '<option value="">이벤트 없음</option>';
    $('#campaign-title').textContent = c?.name || '이벤트를 준비해보세요';
    $('#campaign-dday').hidden = !c; $('#campaign-dday').textContent = c ? dday(c.target_date, today) : '';
    ['#clone-campaign', '#replan-campaign', '#campaign-select', '#delete-campaign'].forEach(sel => { $(sel).disabled = !c; });
    // 보고서는 선택한 이벤트가 있을 때만 엽니다. 새 창에서 인쇄용 화면을 보여 줍니다.
    const report = $('#open-report');
    report.href = c ? `/home/report/${encodeURIComponent(c.id)}` : '#';
    report.setAttribute('aria-disabled', String(!c));
    report.hidden = !c;
    $('#retrospective').hidden = !c;
    if (!c) { $('#campaign-summary').innerHTML = empty('이벤트 이름과 날짜를 입력해 준비 일정을 만드세요.'); $('#gantt').innerHTML = ''; return; }
    $('#campaign-summary').innerHTML = `<span class="home-campaign-chip">${badge(CAMPAIGN_STATES[c.status] || c.status)}</span><span class="home-campaign-date">${esc(c.target_date)}</span><span class="home-dday">${esc(dday(c.target_date, today))}</span>${[c.product, c.audience, c.channel].filter(Boolean).length ? `<span class="home-muted home-campaign-detail">${esc([c.product, c.audience, c.channel].filter(Boolean).join(' · '))}</span>` : ''}`;
    const tasks = store.tasks.filter(t => t.campaign_id === c.id);
    const dated = [...tasks].filter(t => t.due_date && t.status !== 'cancelled').sort((a, b) => a.due_date.localeCompare(b.due_date));
    if (dated.length) {
      const starts = dated.map((t, i) => t.start_date || (i ? dated[i - 1].due_date : addDays(t.due_date, -3)));
      const left = [addDays(dated[0].due_date, -3), ...starts].sort()[0], right = addDays(dated[dated.length - 1].due_date, 3), span = Math.max(1, dayDiff(right, left));
      const position = date => Math.max(0, Math.min(100, dayDiff(date, left) / span * 100));
      const todayLine = today >= left && today <= right ? `<span class="home-gantt-today" style="left:${position(today)}%" title="업무 기준일 ${today}"></span>` : '';
      $('#gantt').innerHTML = `<div class="home-gantt"><div class="home-gantt-row"><span class="home-gantt-label">마케팅 업무</span><div class="home-gantt-axis">${[0, .5, 1].map(n => `<span>${shortDate(addDays(left, Math.round(span * n)))}</span>`).join('')}</div><span class="home-gantt-label">마감·상태</span></div>${dated.map((t, i) => `<div class="home-gantt-row"><button class="home-task-open" data-task="${esc(t.id)}">${esc(t.title)}</button><div class="home-gantt-track">${todayLine}<span class="home-gantt-bar ${t.status === 'done' ? 'done' : t.due_date < today ? 'late' : ''}" style="left:${position(starts[i])}%;width:${Math.max(.8, position(t.due_date) - position(starts[i]))}%" title="${esc(starts[i])} ~ ${esc(t.due_date)}"></span></div><span class="home-gantt-label">${shortDate(t.due_date)}<br>${TASK_STATES[t.status]}</span></div>`).join('')}</div>`;
    } else $('#gantt').innerHTML = empty('날짜가 있는 업무를 등록하면 일정이 표시됩니다.');
    $('#review-form [name="status"]').value = c.status;
    $('#review-form [name="review"]').value = c.review || '';
  }
  function signalMessage(name, text) { return !signals ? '자료를 불러오는 중입니다.' : signals[name].state === 'error' ? '정보를 불러오지 못했습니다. 잠시 후 조회를 다시 시도해주세요.' : text; }
  function renderSignals() {
    const r = range(), opportunities = localEvents().filter(e => e.start >= r.start && e.start <= r.end).sort((a, b) => a.start.localeCompare(b.start));
    $('#opportunity-list').innerHTML = opportunities.map(e => `<article class="home-opportunity"><div class="home-signal-meta">${dday(e.start, today)} · ${esc({ holiday: '공휴일', anniversary: '기념일', regional_event: '지역행사', fruit_season: '과일 시즌' }[e.type] || '현지 일정')}${e.region ? ` · ${esc(e.region)}` : ''}</div><h3>${esc(e.name)}</h3>${eventSummary(e)}<br><button class="btn" data-local="${esc(e.event_id)}">일정 상세</button> <button class="btn" data-create="${esc(e.event_id)}">+ 이벤트 기획</button></article>`).join('') || empty(signalMessage('events', '조회 기간에 시작하는 HOME 등록 일정이 없습니다. 기간을 바꾸거나 검증된 일정 자료를 준비해주세요.'));
    const attention = signals?.attention.items || [], attentionIds = new Set(attention.map(t => t.collaboration_id));
    const scopedCreators = creators();
    const rows = scopedCreators.filter(c => c.status !== 'posted' && (c.requires_attention || attentionIds.has(c.collaboration_id) || (validDate(c.post_date) && c.post_date <= addDays(today, 7)) || (validDate(c.shoot_date) && c.shoot_date < today && c.status !== 'shot'))).sort((a, b) => Number(Boolean(b.requires_attention || attentionIds.has(b.collaboration_id))) - Number(Boolean(a.requires_attention || attentionIds.has(a.collaboration_id))) || (a.post_date || '9999').localeCompare(b.post_date || '9999')).slice(0, 3);
    const collaborationSummary = signals?.collaborations.state === 'ok' ? `<div class="home-collab-summary">${mode === 'demo' ? badge('예시 데이터 (DEMO)') : ''}<span>촬영 예정 <strong>${scopedCreators.filter(c => !['shot', 'posted'].includes(c.status) && validDate(c.shoot_date) && c.shoot_date >= today).length}</strong></span><span>게시 예정 <strong>${scopedCreators.filter(c => c.status !== 'posted' && validDate(c.post_date) && c.post_date >= today).length}</strong></span><span>확인 필요 <strong>${scopedCreators.filter(c => c.status !== 'posted' && (c.requires_attention || attentionIds.has(c.collaboration_id))).length}</strong></span></div>` : '';
    $('#collaboration-list').innerHTML = collaborationSummary + (rows.map(c => {
      const task = attention.find(t => t.collaboration_id === c.collaboration_id), needs = c.requires_attention || task;
      // 촬영일만 지났는데 게시일이 지난 것처럼 알리지 않습니다. 날짜가 없으면 경과로 보지 않습니다.
      const postLate = validDate(c.post_date) && c.post_date < today;
      const shootLate = validDate(c.shoot_date) && c.shoot_date < today && !['shot', 'posted'].includes(c.status);
      const state = needs ? '확인 필요' : postLate ? '게시일 경과' : shootLate ? '촬영일 경과' : validDate(c.post_date) ? '게시 임박' : '일정 미정';
      return `<article class="home-collaboration"><div class="home-task-top"><div><h3>${esc(c.influencer)}</h3><span class="home-signal-meta">${esc(c.main_platform || '채널 미정')} · ${esc(c.status_label || c.status || '상태 미제공')}</span></div>${badge(state, Boolean(needs) || postLate || shootLate)}</div><dl class="home-collab-dates"><div><dt>촬영</dt><dd>${esc(c.shoot_date || '미정')}</dd></div><div><dt>게시</dt><dd>${esc(c.post_date || '미정')}</dd></div></dl><p class="home-collab-action"><strong>다음 할 일</strong> ${esc(c.next_action || task?.detail || task?.title || '원본 탭에서 진행 내용을 확인해주세요.')}</p><a href="${esc(safeUrl(c.link || `/influencer_marketing/?collaboration_id=${encodeURIComponent(c.collaboration_id)}`))}">협업 확인 ↗</a></article>`;
    }).join('') || empty(signalMessage('collaborations', '확인할 협업이 없거나 인플루언서 자료를 불러오지 못했습니다. 원본 탭에서 확인해주세요.')));
    if (signals?.attention.state === 'error') $('#collaboration-list').insertAdjacentHTML('beforeend', '<p class="home-error">협업 할 일을 불러오지 못해 확인 필요 목록이 일부 누락될 수 있습니다.</p>');
    const news = (signals?.news.items || []).filter(n => mode === 'demo' || (n.is_demo === false && n.verification_status === 'verified' && n.registration_status === 'approved')).sort((a, b) => String(b.published_at || '').localeCompare(String(a.published_at || ''))).slice(0, 3);
    $('#news-list').style.setProperty('--home-news-columns', String(Math.max(1, news.length)));
    const newsMarkup = news.map(n => {
      // 등록된 출처·대조 내용·확인 범위를 표시합니다. 이 화면이 원문을 새로 검증하는 것은 아닙니다.
      const sources = Array.isArray(n.sources) ? n.sources : [];
      const link = safeUrl(n.url) || safeUrl(sources[0]?.url);
      const evidence = link ? `<a href="${esc(link)}" target="_blank" rel="noopener noreferrer">출처 ↗</a>` : esc(n.source || '출처 미제공');
      const sourceDetails = sources.map(source => {
        const address = safeUrl(source.url);
        const label = source.role === 'primary' ? '원문' : source.role === 'independent_corrob' ? '교차 출처' : '참고 출처';
        return `<li><strong>${label} · ${esc(source.publisher)}</strong>${source.title ? `<span>${esc(source.title)}</span>` : ''}${source.supports ? `<p>${esc(source.supports)}</p>` : ''}${address ? `<a href="${esc(address)}" target="_blank" rel="noopener noreferrer">자료 열기 ↗</a>` : ''}</li>`;
      }).join('');
      return `<article class="home-news-item home-resizable">
        <div class="home-signal-meta">${esc(n.region || '지역 미제공')} · 발행 ${esc(n.published_at || '미제공')}</div>
        <h3>${esc(n.title)}</h3>
        ${n.is_demo ? badge('예시 데이터 (DEMO)') : `<p class="home-news-brief">${esc(newsPreview(n.summary))}</p>`}
        ${n.suggestion ? `<div class="home-suggestion"><strong class="home-suggestion-label">적용 제안 · 운영 아이디어</strong><p>${esc(newsPreview(n.suggestion))}</p><span class="home-news-caution">참여·제품 적용 여부는 별도 확인이 필요합니다.</span></div>` : ''}
        <details class="home-news-details"><summary>자세히 보기 · 출처와 확인 범위</summary>
          ${n.is_demo ? '' : `<h4>사실 요약 · 전체 내용</h4><p>${esc(n.summary)}</p>`}
          ${n.suggestion ? `<h4>적용 제안 · 전체 내용</h4><p>${esc(n.suggestion)}</p>` : ''}
          ${n.verified_at ? `<p class="home-signal-meta">담당자 확인 ${esc(n.verified_at)}</p>` : ''}
          ${sourceDetails ? `<h4>어디서 확인했나요?</h4><ul class="home-news-sources">${sourceDetails}</ul>` : ''}
          ${n.verification_notes ? `<h4>등록 당시 확인한 내용과 한계</h4><p>${esc(n.verification_notes)}</p>` : ''}
        </details>
        <div class="home-news-links">${n.is_demo ? '' : evidence}${n.suggestion ? '<a href="/content_studio/?tab=cardnews">콘텐츠 스튜디오 ↗</a>' : ''}</div>
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
    if (mode === 'demo') { signals = demoSignals(); render(); return; }
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
    openDialog('업무 수정', `<form id="task-form"><label class="home-field">업무명<input name="title" required maxlength="160" value="${esc(t.title)}"></label><div class="home-form-grid"><label class="home-field">시작일<input name="start_date" type="date" value="${esc(t.start_date)}"></label><label class="home-field">마감일<input name="due_date" type="date" value="${esc(t.due_date)}"></label><label class="home-field">시간 (비우면 종일)<input name="due_time" type="time" value="${esc(t.due_time)}"></label><label class="home-field">이벤트<select name="campaign_id">${store.campaigns.map(c => `<option value="${esc(c.id)}" ${c.id === t.campaign_id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></label><label class="home-field">상태<select name="status">${options(TASK_STATES, t.status)}</select></label><label class="home-field">중요도<select name="importance">${options({ normal: '보통', high: '높음' }, t.importance)}</select></label><label class="home-field">관련 탭<select name="related_tab">${options({ '': '없음', ...TABS }, t.related_tab)}</select></label></div><label><input type="checkbox" name="fixed" ${t.fixed ? 'checked' : ''}> 이벤트 날짜가 바뀌어도 이 업무 날짜 유지</label><label class="home-field">메모<textarea name="memo" rows="3" maxlength="3000">${esc(t.memo)}</textarea></label><p id="task-error" class="home-error" hidden role="alert"></p><div class="home-form-actions"><a class="btn" href="${tabLink(t.related_tab)}">관련 탭 ↗</a><button class="btn dark" type="submit">저장</button></div></form>`);
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
    let rows = original ? structuredClone(store.tasks.filter(t => t.campaign_id === original.id)) : templateRows(initialTemplate);
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
      if ([...form.querySelectorAll('[data-row-date]:not(:disabled)')].some(input => !validDate(input.value))) { error('업무 날짜를 확인하세요.'); return; }
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
    const button = event.target.closest('button'); if (!button) return;
    if (button.hasAttribute('data-cancel-delete')) { pendingImport = null; dialog.close(); }
    if (button.hasAttribute('data-confirm-import') && pendingImport) {
      const incoming = pendingImport; pendingImport = null;
      if (await save(structuredClone(incoming))) { dialog.close(); render(); toast('기록을 가져왔습니다.'); }
    }
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
    if (button.dataset.date) { selectedDate = button.dataset.date; renderCalendar(); renderTasks(); }
    if (button.dataset.view) { view = button.dataset.view; renderCalendar(); }
    if (button.dataset.move) moveTask(button.dataset.move);
    if (button.dataset.slot) { const [day] = button.dataset.slot.split(' '); selectedDate = day; renderCalendar(); renderTasks(); }
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
  function showPanel(name) {
    panel = name;
    $('#calendar-panel').hidden = name !== 'calendar';
    $('#campaign-panel').hidden = name !== 'campaign';
    // 탭은 지금 보고 있는 화면을 표시합니다. 다음에 들어올 때 같은 화면으로 엽니다.
    $('#tab-calendar').setAttribute('aria-selected', String(name === 'calendar'));
    $('#tab-campaign').setAttribute('aria-selected', String(name === 'campaign'));
    $('#tab-calendar').tabIndex = name === 'calendar' ? 0 : -1;
    $('#tab-campaign').tabIndex = name === 'campaign' ? 0 : -1;
    try { localStorage.setItem(PANEL_KEY, name); } catch { /* 저장 못 해도 동작합니다 */ }
  }
  function removeCampaign() {
    const c = selected();
    if (!c) return;
    const count = store.tasks.filter(t => t.campaign_id === c.id).length;
    openDialog('이벤트 삭제', `<p>"${esc(c.name)}" 이벤트와 그 준비 업무 ${count}건을 지웁니다.</p><p class="home-muted">되돌릴 수 없습니다. 현지 일정 자료와 뉴스는 지워지지 않습니다.</p><div class="home-form-actions"><button class="btn" data-cancel-delete type="button">취소</button><button class="btn dark" data-confirm-delete="${esc(c.id)}" type="button">삭제</button></div>`);
  }
  // 현재 모드에서 읽은 기록을 백업합니다. 내 업무는 서버에서 읽은 기록입니다.
  function exportStore() {
    if (locked || storageBusy) { toast('기록을 정상적으로 불러온 뒤 내보내기를 해주세요.'); return; }
    try {
      const payload = { app: 'hanjeongseon-home', format: 1, exported_at: new Date().toISOString(),
        mode, counts: { campaigns: store.campaigns.length, tasks: store.tasks.length }, data: store };
      const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = `home-backup-${mode}-${today}.json`;
      document.body.appendChild(link); link.click(); link.remove();
      URL.revokeObjectURL(url);
      toast(`이벤트 ${store.campaigns.length}개, 업무 ${store.tasks.length}건을 파일로 내려받았습니다.`);
    } catch { toast('내려받지 못했습니다. 브라우저 다운로드 설정을 확인해주세요.'); }
  }
  let pendingImport = null;
  let migrationBusy = false;
  let lastMigrationReceipt = null;
  function migrationControls(busy) {
    migrationBusy = busy;
    $('#migrate-store').disabled = busy;
    $('#data-mode').disabled = busy;
    $('#record-action').disabled = busy || storageBusy;
  }
  function downloadMigrationReceipt() {
    if (!lastMigrationReceipt) return;
    try {
      const url = URL.createObjectURL(new Blob([JSON.stringify(lastMigrationReceipt, null, 2)], { type: 'application/json' }));
      const link = document.createElement('a');
      link.href = url; link.download = `home-migration-result-${today}.json`;
      document.body.appendChild(link); link.click(); link.remove(); URL.revokeObjectURL(url);
    } catch { toast('결과 파일을 내려받지 못했습니다. 이 창을 닫지 말고 다시 눌러주세요.'); }
  }
  async function readMigration(file) {
    if (!file || migrationBusy || storageBusy) return;
    if (mode !== 'work') { toast('내 업무로 바꾼 뒤 내 업무 백업 파일을 선택해주세요.'); return; }
    migrationControls(true);
    try {
      if (file.size > 2 * 1024 * 1024) throw new Error('백업 파일은 2 MiB 이하만 선택할 수 있습니다.');
      let backup;
      try { backup = JSON.parse(await file.text()); }
      catch { throw new Error('백업 파일을 읽지 못했습니다. HOME에서 내보낸 JSON 파일을 선택해주세요.'); }
      if (backup?.mode !== 'work') throw new Error('예시 데이터 (DEMO)는 옮기지 않습니다. 내 업무 백업 파일을 선택해주세요.');
      const preview = await migrationRequest(root.dataset.migrationPreviewUrl, backup);
      const labels = { campaigns: '이벤트', tasks: '업무', schedules: '직접 일정', links: '협업 연결' };
      const rows = Object.entries(labels).map(([kind, label]) => {
        const counts = preview.counts[kind];
        return `<div class="home-preview-row"><span>${label}</span><span>새 기록 ${esc(counts.new)} · 같은 기록 ${esc(counts.same)} · 충돌 ${esc(counts.conflict)}</span></div>`;
      }).join('');
      const totalNew = Object.values(preview.counts).reduce((sum, counts) => sum + counts.new, 0);
      openDialog('서버로 옮기기 전 확인', `<p>선택한 백업: <strong>${esc(file.name)}</strong></p><p>백업 시각: ${esc(backup.exported_at)}. 이 파일을 만든 뒤 수정한 내용은 포함되지 않습니다.</p><div class="home-preview">${rows}</div><p>새 기록만 추가하고 같은 기록은 건너뜁니다. 브라우저 원본과 백업 파일은 그대로 남깁니다.</p><p class="home-muted">옮긴 뒤 서버 기록을 다시 불러옵니다. 이후 내 업무 편집은 서버에 저장됩니다.</p><p id="migration-error" class="home-error" role="alert" hidden></p><div class="home-form-actions"><button class="btn" id="migration-cancel" type="button">닫기</button>${preview.can_import && totalNew ? '<button class="btn dark" id="migration-confirm" type="button">확인한 새 기록 옮기기</button>' : ''}</div><p>${preview.can_import ? totalNew ? '검사 결과는 30분 동안 유효합니다.' : '옮길 새 기록이 없습니다. 이미 같은 기록이 저장되어 있습니다.' : '내용이 다른 기록이 있어 옮기기를 멈췄습니다. 기존 기록은 바꾸지 않았습니다.'}</p>`);
      $('#migration-cancel').onclick = () => dialog.close();
      const confirm = $('#migration-confirm');
      if (confirm) confirm.onclick = async () => {
        if (migrationBusy) return;
        migrationControls(true); confirm.disabled = true;
        try {
          const result = await migrationRequest(root.dataset.migrationCommitUrl, { backup, token: preview.token, confirmed: true });
          lastMigrationReceipt = result.receipt;
          await load(); updateRange(); refreshSignals();
          openDialog('서버로 옮기기 완료', `<p>${esc(result.notice)}</p><p>옮긴 결과 파일을 내려받아 원래 백업 파일과 함께 보관해주세요. 되돌리기가 필요할 때 어떤 기록을 추가했는지 확인할 수 있습니다.</p><p class="home-muted">파일 다운로드가 끝났는지는 브라우저 다운로드 목록에서 확인해주세요.</p><div class="home-form-actions"><button class="btn" id="migration-receipt" type="button">옮긴 결과 파일 받기</button><button class="btn" id="migration-done" type="button">닫기</button></div>`);
          $('#migration-receipt').onclick = downloadMigrationReceipt;
          $('#migration-done').onclick = () => dialog.close();
          toast('서버로 옮겼습니다. 브라우저 원본은 그대로입니다.');
        } catch (error) {
          // 재시도 전 새 미리보기를 받도록 합니다. 실패했다고 단정해 재전송하지 않습니다.
          const message = $('#migration-error');
          if (message) { message.hidden = false; message.textContent = error.message; }
          else toast(error.message);
        } finally { migrationControls(false); }
      };
    } catch (error) { toast(error.message); }
    finally { migrationControls(false); }
  }
  function startMigration() {
    if (migrationBusy || storageBusy) return;
    if (mode !== 'work') { toast('먼저 데이터 선택을 ‘내 업무’로 바꿔주세요. 예시 데이터 (DEMO)는 옮기지 않습니다.'); return; }
    openDialog('내 업무 백업 파일 선택', '<p>먼저 상단 ‘내보내기’로 내 업무 백업 파일을 받아두세요. 그 파일을 선택하면 서버 기록과 비교합니다. 파일을 선택하는 것만으로 저장되지는 않습니다.</p><p>브라우저 원본은 그대로 두며, 내용을 덮어쓰지 않습니다.</p><div class="home-form-actions"><button class="btn" id="migration-choose" type="button">백업 파일 선택</button><button class="btn" id="migration-dismiss" type="button">닫기</button></div>');
    $('#migration-choose').onclick = () => $('#migration-file').click();
    $('#migration-dismiss').onclick = () => dialog.close();
  }
  async function readImport(file) {
    if (!file) return;
    if (mode === 'work') { await readMigration(file); return; }
    try {
      const payload = JSON.parse(await file.text());
      // 다른 프로그램의 파일이나 손상된 파일을 덮어쓰지 않도록 형식을 먼저 확인합니다.
      if (!payload || payload.app !== 'hanjeongseon-home' || !validStore(payload.data)) throw new Error('format');
      // 예시 데이터를 실제 업무 기록 위에 덮어쓰지 않습니다.
      if (payload.mode !== mode) throw new Error(payload.mode === 'demo' ? 'demo' : 'work');
      pendingImport = payload.data;
      const now = { campaigns: store.campaigns.length, tasks: store.tasks.length };
      const next = { campaigns: payload.data.campaigns.length, tasks: payload.data.tasks.length };
      openDialog('기록 가져오기', `<p>지금 기록을 <strong>파일 내용으로 완전히 바꿉니다.</strong></p><div class="home-preview"><div class="home-preview-row"><span>지금</span><span>이벤트 ${now.campaigns}개 · 업무 ${now.tasks}건</span></div><div class="home-preview-row"><span>파일</span><span>이벤트 ${next.campaigns}개 · 업무 ${next.tasks}건</span></div></div><p class="home-muted">되돌릴 수 없습니다. 지금 기록이 필요하면 먼저 내보내기를 해주세요.${payload.exported_at ? ` 이 파일은 ${esc(String(payload.exported_at).slice(0, 10))}에 내려받은 것입니다.` : ''}</p><div class="home-form-actions"><button class="btn" data-cancel-delete type="button">취소</button><button class="btn dark" data-confirm-import type="button">가져오기</button></div>`);
    } catch (error) {
      pendingImport = null;
      const reason = { demo: '예시 데이터 파일은 내 업무로 가져올 수 없습니다.', work: '내 업무 파일은 예시 데이터로 가져올 수 없습니다.' };
      toast(reason[error.message] || '이 파일은 HOME 기록 파일이 아니거나 손상되었습니다. 기존 기록은 그대로 둡니다.');
    }
  }
  async function changeCampaign(campaignId) { const next = structuredClone(store); next.preferences.selected = campaignId; if (await save(next)) render(); }
  $('#campaign-select').onchange = event => changeCampaign(event.target.value);
  $('#delete-campaign').onclick = removeCampaign;
  $('#export-store').onclick = exportStore;
  $('#import-store').onclick = () => mode === 'work' ? startMigration() : $('#import-file').click();
  $('#import-file').onchange = event => { readImport(event.target.files[0]); event.target.value = ''; };
  $('#migrate-store').onclick = startMigration;
  $('#record-action').onchange = event => {
    const action = event.currentTarget.value;
    event.currentTarget.value = '';
    if (!['export-store', 'import-store', 'migrate-store'].includes(action) || storageBusy || migrationBusy) return;
    const button = $(`#${action}`);
    if (!button.disabled) button.click();
  };
  $('#migration-file').onchange = event => { readMigration(event.target.files[0]); event.target.value = ''; };
  $('#tab-campaign').onclick = () => showPanel('campaign');
  $('#tab-calendar').onclick = () => showPanel('calendar');
  $('.home-paneltabs').addEventListener('keydown', event => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    const tabs = [$('#tab-calendar'), $('#tab-campaign')];
    const current = tabs.indexOf(event.target);
    if (current < 0) return;
    event.preventDefault();
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (current + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
    showPanel(next === 0 ? 'calendar' : 'campaign');
    tabs[next].focus();
  });
  try {
    const saved = localStorage.getItem(PANEL_KEY);
    if (saved === 'campaign' || saved === 'calendar') showPanel(saved);
  } catch { /* 기본 화면을 그대로 씁니다 */ }
  $('#today-reset').onclick = () => { selectedDate = today; renderCalendar(); renderTasks(); };
  $('#scope').onchange = event => { scope = event.target.value; render(); };
  $('#new-campaign').onclick = () => planner('create');
  $('#clone-campaign').onclick = () => planner('clone');
  $('#replan-campaign').onclick = () => planner('replan');
  $('#data-mode').onchange = async event => {
    if (storageBusy || migrationBusy) { event.target.value = mode; return; }
    pendingImport = null;
    if (dialog.open) dialog.close();
    mode = event.target.value; await load(); updateRange();
    try { localStorage.setItem('hjs-home-browser-mode', mode); } catch { /* load에 저장소 오류 안내가 있습니다. */ }
    refreshSignals();
  };
  function changeDate(value) { if (!validDate(value)) return; today = value; selectedDate = value; cursor = value; updateRange(); refreshSignals(); }
  function tickClocks() {
    // 두 도시의 현재 시각을 함께 보여 줍니다. 업무 기준일은 한국 시간 기준입니다.
    const fmt = zone => new Intl.DateTimeFormat('ko-KR', { timeZone: zone, hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date());
    const kst = $('#clock-kst'), ict = $('#clock-ict');
    if (kst) kst.textContent = fmt('Asia/Seoul');
    if (ict) ict.textContent = fmt('Asia/Ho_Chi_Minh');
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
  $('#calendar-today').onclick = () => { cursor = today; selectedDate = today; refreshSignals(); };
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
  $('#review-form').onsubmit = async event => {
    event.preventDefault(); const c = selected(); if (!c) return;
    const next = structuredClone(store), campaign = next.campaigns.find(item => item.id === c.id), f = new FormData(event.currentTarget);
    campaign.review = f.get('review'); campaign.status = f.get('status');
    if (await save(next)) { render(); toast('회고와 이벤트 상태를 저장했습니다.'); }
  };
  addEventListener('storage', event => { if (mode === 'demo' && (event.key === key() || event.key === null)) { locked = true; showError('다른 창에서 예시 기록이 변경되었습니다. 새로고침 후 계속해주세요.'); } });
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
    $('#news-search-list').innerHTML = empty('검색 중입니다.');
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
        return `<article class="home-news-result">${title}${origin}<p class="home-signal-meta">${esc(n.publisher || '언론사 미표기')}${n.published_at ? ` · ${esc(n.published_at)}` : ''}${via}</p></article>`;
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
    $('#news-search-list').innerHTML = empty('검색 항목을 고르거나 검색어를 입력하면 현지 기사를 찾아봅니다.');
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
