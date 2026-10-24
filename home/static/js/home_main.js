// HOME 화면 스크립트 [주연]
// type="module"로 불러오므로 전역 변수·함수가 생기지 않습니다. (README 7장)

const DAY = 86400000;
export const TASK_STATES = { todo: '예정', doing: '진행 중', blocked: '보류', done: '완료', cancelled: '취소' };
const CAMPAIGN_STATES = { preparing: '준비', active: '진행', done: '완료', blocked: '보류', cancelled: '취소', archived: '보관' };
const TABS = { market_analysis: '현지 시장 분석', content_studio: '콘텐츠 스튜디오', influencer_marketing: '인플루언서 마케팅', kpi: 'KPI' };
const TEMPLATE = [
  ['research', -35, '다낭 현지조사·타깃 가설 정리', 'market_analysis'],
  ['strategy', -28, '목적·제품·타깃 확정', 'market_analysis'],
  ['proposal', -21, '인플루언서 협업 제안', 'influencer_marketing'],
  ['draft', -14, '홍보 소재 초안 준비', 'content_studio'],
  ['review', -7, '광고 문구·소재 최종 검토', 'content_studio'],
  ['schedule', -3, '협업·채널 게시 일정 확정', 'influencer_marketing'],
  ['launch', 0, '캠페인 공개·링크 확인', 'content_studio'],
  ['reaction', 3, '초기 반응 확인', 'kpi'],
  ['retrospective', 7, '캠페인 회고·개선점 기록', 'kpi'],
];
export function validDate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
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
  const campaign = { id: id(), name: '스승의 날 선물 캠페인', target_date: addDays(today, 28), template: 'launch', status: 'active', product: '과일찹쌀떡 선물세트', audience: '다낭 선물 구매 고객', channel: 'Instagram · TikTok', event_id: 'demo_gift_day', review: '' };
  const tasks = TEMPLATE.map(([key, offset, title, related_tab], i) => ({ id: id(), campaign_id: campaign.id, key, offset, title, related_tab, due_date: addDays(campaign.target_date, offset), start_date: '', fixed: false, status: i < 2 ? 'done' : i === 4 ? 'blocked' : 'todo', importance: 'normal', memo: '', completed_at: '' }));
  const extras = [[-1, '소재 A 문구 확인'], [3, '게시물 링크 점검'], [3, '협업 피드백 정리'], [7, '선물 포장 사진 준비']];
  extras.forEach(([days, title]) => tasks.push({ id: id(), campaign_id: campaign.id, key: '', offset: days - 28, title, related_tab: 'content_studio', due_date: addDays(today, days), start_date: '', fixed: false, status: 'todo', importance: 'normal', memo: '', completed_at: '' }));
  return { version: 1, campaigns: [campaign], tasks, schedules: [], links: [], preferences: { selected: campaign.id, preset: '45' }, demo_anchor: today };
}
function blankStore() { return { version: 1, campaigns: [], tasks: [], schedules: [], links: [], preferences: { selected: '', preset: '45' } }; }
function validStore(s) {
  return s && s.version === 1 && Array.isArray(s.campaigns) && Array.isArray(s.tasks) && Array.isArray(s.schedules) && Array.isArray(s.links) && s.preferences &&
    s.campaigns.every(c => typeof c.id === 'string' && typeof c.name === 'string' && validDate(c.target_date)) &&
    s.tasks.every(t => typeof t.id === 'string' && typeof t.title === 'string' && Object.hasOwn(TASK_STATES, t.status) && (!t.due_date || validDate(t.due_date)) && (!t.start_date || validDate(t.start_date))) &&
    new Set(s.tasks.map(t => t.id)).size === s.tasks.length && new Set(s.campaigns.map(c => c.id)).size === s.campaigns.length;
}

if (typeof document !== 'undefined') initialize();
function initialize() {
  const root = document.querySelector('.home-page');
  if (!root) return;
  const $ = selector => root.querySelector(selector);
  let today = kstToday(), selectedDate = today, cursor = today, scope = 'all', filter = 'open';
  let view = matchMedia('(max-width: 540px)').matches ? 'list' : 'month';
  let mode = 'demo', store, loadedRaw, locked = false, signals = null, requestNumber = 0, toastTimer;
  const key = () => `hjs-home-browser-v1-${mode}`;
  const showError = message => { $('#storage-error').hidden = !message; $('#storage-error').textContent = message; };
  function toast(message) { clearTimeout(toastTimer); $('#home-toast').textContent = message; $('#home-toast').hidden = false; toastTimer = setTimeout(() => { $('#home-toast').hidden = true; }, 2800); }
  try {
    const preference = localStorage.getItem('hjs-home-browser-mode');
    const work = localStorage.getItem('hjs-home-browser-v1-work');
    mode = ['demo', 'work'].includes(preference) ? preference : work && JSON.parse(work).campaigns?.length ? 'work' : 'demo';
  } catch { /* 저장소 접근 실패는 load에서 사용자에게 알립니다. */ }
  function load() {
    locked = false; showError('');
    try {
      loadedRaw = localStorage.getItem(key());
      store = loadedRaw === null ? (mode === 'demo' ? demoStore(today) : blankStore()) : JSON.parse(loadedRaw);
      if (!validStore(store)) throw new Error('invalid');
      if (loadedRaw === null) { localStorage.setItem(key(), JSON.stringify(store)); loadedRaw = localStorage.getItem(key()); }
    } catch {
      locked = true; store = blankStore();
      showError('브라우저 저장소를 읽거나 초기화하지 못했습니다. 기존 기록 보호를 위해 편집을 중지했습니다. 저장소 설정과 다른 창을 확인해주세요.');
    }
    $('#data-mode').value = mode;
  }
  // 저장 경계: DB 적용 시 이 함수와 load를 HOME API 호출로 교체합니다.
  function save(next) {
    if (locked) { toast('저장소를 확인한 뒤 새로고침해주세요.'); return false; }
    try {
      if (localStorage.getItem(key()) !== loadedRaw) { locked = true; showError('다른 창에서 기록이 변경되었습니다. 덮어쓰지 않도록 저장을 멈췄습니다. 새로고침해주세요.'); return false; }
      if (!validStore(next)) throw new Error('invalid');
      const serialized = JSON.stringify(next); localStorage.setItem(key(), serialized); loadedRaw = serialized; store = next; return true;
    } catch { showError('저장하지 못했습니다. 저장 공간과 브라우저 설정을 확인해주세요. 기존 기록은 유지됩니다.'); return false; }
  }
  const selected = () => store.campaigns.find(c => c.id === store.preferences.selected) || store.campaigns[0];
  const inScope = () => store.tasks.filter(t => scope === 'all' || t.campaign_id === selected()?.id);
  const campaignName = campaignId => store.campaigns.find(c => c.id === campaignId)?.name || '캠페인 없음';
  function range() { return { start: $('#range-start').value, end: $('#range-end').value }; }
  function updateRange() {
    const preset = store.preferences.preset || '45'; $('#range-preset').value = preset;
    $('#range-start').value = preset === 'custom' ? store.preferences.range_start || today : today;
    $('#range-end').value = preset === 'custom' ? store.preferences.range_end || today : addDays(today, Number(preset));
  }
  function demoSignals() {
    const anchor = store.demo_anchor || today;
    return {
      events: { state: 'ok', items: [
        { event_id: 'demo_gift_day', name: '선물 캠페인 기념일', date: addDays(anchor, 28), type: 'anniversary', region: '다낭', source_name: '가상 기념일 · 운영 일정 아님', is_demo: true },
        { event_id: 'demo_fruit_season', name: '열대과일 시즌 기획', start_date: addDays(anchor, 7), end_date: addDays(anchor, 18), type: 'fruit_season', region: '다낭', source_name: '가상 시즌 · 실제 제철 정보 아님', is_demo: true },
        { event_id: 'demo_local_holiday', name: '지역 행사 준비', date: addDays(anchor, 42), type: 'anniversary', region: '다낭', source_name: '가상 행사', is_demo: true },
      ] },
      collaborations: { state: 'ok', items: [
        { collaboration_id: 'demo_creator_a', influencer: '크리에이터 A', status: 'negotiating', status_label: '협상 중', shoot_date: addDays(anchor, 3), post_date: addDays(anchor, 6), requires_attention: true, next_action: '촬영 가능일과 제안 내용을 확인해주세요.', event_id: 'demo_gift_day', is_demo: true },
        { collaboration_id: 'demo_creator_b', influencer: '크리에이터 B', status: 'shot', status_label: '촬영 완료', post_date: addDays(anchor, 5), next_action: '게시 일정과 링크를 확인해주세요.', event_id: 'demo_gift_day', is_demo: true },
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
    const events = inScope().filter(t => t.due_date && t.status !== 'cancelled').map(t => ({ date: t.due_date, end: t.due_date, title: t.title, kind: 'task', id: t.id, done: t.status === 'done' }));
    store.campaigns.filter(c => scope === 'all' || c.id === selected()?.id).forEach(c => events.push({ date: c.target_date, end: c.target_date, title: c.name, kind: 'campaign', id: c.id }));
    localEvents().forEach(e => events.push({ date: e.start, end: e.end, title: e.name, kind: 'local', id: e.event_id }));
    store.schedules.filter(s => validDate(s.date) && (scope === 'all' || s.campaign_id === selected()?.id)).forEach(s => events.push({ date: s.date, end: s.date, title: s.title || s.name, kind: 'schedule', id: s.id }));
    creators().filter(c => scope === 'all' || store.links.some(l => l.campaign_id === selected()?.id && l.collaboration_id === c.collaboration_id) || (selected()?.event_id && c.event_id === selected().event_id)).forEach(c => ['shoot_date', 'post_date'].forEach(field => {
      if (validDate(c[field])) events.push({ date: c[field], end: c[field], title: `${c.influencer} · ${field === 'post_date' ? '게시' : '촬영'}`, kind: 'creator', id: c.collaboration_id, link: c.link });
    }));
    return events;
  }
  function eventSources(e) {
    const sources = Array.isArray(e.sources) ? e.sources : [];
    if (sources.length) return sources.map((source, i) => {
      const url = safeUrl(source.url);
      return url ? `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">출처 ${i + 1} · ${esc(source.publisher)} ↗</a>` : esc(source.publisher);
    }).join('<br>');
    return `${esc(e.source_name || '출처 정보 미제공')}${safeUrl(e.source_url) ? ` <a href="${esc(safeUrl(e.source_url))}" target="_blank" rel="noopener noreferrer">출처 ↗</a>` : ''}`;
  }
  function eventSummary(e) {
    return `<p class="home-signal-meta">${esc(e.start)}${e.end !== e.start ? ` ~ ${esc(e.end)}` : ''}${e.verified_at ? ` · 확인 ${esc(e.verified_at)}` : ''}</p>${e.applies_to ? `<p>${esc(e.applies_to)}</p>` : ''}<p class="home-signal-meta">${eventSources(e)}</p>`;
  }
  function showLocalEvent(eventId) {
    const e = localEvents().find(item => item.event_id === eventId);
    if (!e) { toast('일정 정보를 찾지 못했습니다. 다시 조회해주세요.'); return; }
    openDialog(e.name, `${e.is_demo ? badge('DEMO · 예시 데이터') : badge('출처 확인 자료')}<p>${esc(e.official_name || e.name)}</p>${eventSummary(e)}<p>${esc(e.description || '')}</p>${e.original_period ? `<p class="home-muted">원문 기간: ${esc(e.original_period)}</p>` : ''}${e.schedule_nature ? `<p class="home-muted">일정 성격: ${esc(e.schedule_nature)}</p>` : ''}${e.verification_notes ? `<p class="home-muted">검증 범위: ${esc(e.verification_notes)}</p>` : ''}<div class="home-form-actions"><button class="btn dark" data-create="${esc(e.event_id)}">+ 역산 캠페인 생성</button></div>`);
  }
  function eventAction(e) {
    if (e.kind === 'task') return `<button class="btn" data-task="${esc(e.id)}">열기</button>`;
    if (e.kind === 'creator') return `<a class="btn" href="${esc(safeUrl(e.link || `/influencer_marketing/?collaboration_id=${encodeURIComponent(e.id)}`))}">협업 보기 ↗</a>`;
    if (e.kind === 'local') return `<button class="btn" data-local="${esc(e.id)}">일정 상세</button>`;
    if (e.kind === 'campaign') return `<button class="btn" data-select="${esc(e.id)}">캠페인 보기</button>`;
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
    if (view === 'list') {
      const rows = events.filter(e => e.date <= end && e.end >= start).sort((a, b) => a.date.localeCompare(b.date));
      $('#calendar-body').innerHTML = rows.length ? rows.map(e => `<div class="home-agenda-row"><div><span class="home-muted">${esc(e.date)}${e.end !== e.date ? ` ~ ${esc(e.end)}` : ''}</span><br>${esc(e.title)} ${e.done ? badge('완료') : ''}</div>${eventAction(e)}</div>`).join('') : empty('이달에 등록된 일정이 없습니다.');
    } else {
      let html = '<div class="home-month"><div class="home-weekdays">' + ['월', '화', '수', '목', '금', '토', '일'].map(d => `<div class="home-weekday">${d}</div>`).join('') + '</div>';
      for (let weekStart = start; weekStart <= end; weekStart = addDays(weekStart, 7)) {
        const segments = periodSegments(events, weekStart);
        const laneCount = segments.reduce((n, segment) => Math.max(n, segment.lane + 1), 0);
        html += `<div class="home-week" style="--period-lanes:${laneCount};grid-template-rows:28px ${laneCount ? `repeat(${laneCount}, minmax(26px, auto)) ` : ''}minmax(48px, 1fr)">`;
        for (let column = 1; column <= 7; column++) {
          const day = addDays(weekStart, column - 1), allDayEvents = at(day);
          const dayEvents = allDayEvents.filter(e => !(e.kind === 'local' && e.date < e.end));
          html += `<button class="home-day${day === today ? ' is-today' : ''}${view === 'month' && day.slice(0, 7) !== cursor.slice(0, 7) ? ' home-outside' : ''}" style="grid-column:${column};grid-row:1 / -1" data-date="${day}" aria-pressed="${day === selectedDate}" aria-label="${day}, 일정 ${allDayEvents.length}건"><span class="home-day-number">${Number(day.slice(8))}</span><span class="home-day-events">${dayEvents.slice(0, 2).map(e => `<span class="home-event ${e.kind}${e.done ? ' done' : ''}">${esc(e.title)}</span>`).join('')}${dayEvents.length > 2 ? `<span class="home-more">+${dayEvents.length - 2}</span>` : ''}</span></button>`;
        }
        html += segments.map(segment => {
          const e = segment.event;
          return `<button class="home-period-bar${segment.continuesBefore ? ' continues-before' : ''}${segment.continuesAfter ? ' continues-after' : ''}" style="grid-column:${segment.column} / span ${segment.span};grid-row:${segment.lane + 2}" data-local="${esc(e.id)}" data-period-start="${segment.start}" data-period-end="${segment.end}" aria-label="${esc(e.title)}, ${e.date}부터 ${e.end}까지${segment.continuesBefore ? ', 앞 주에서 이어짐' : ''}${segment.continuesAfter ? ', 다음 주에 이어짐' : ''}">${segment.continuesBefore ? '<span aria-hidden="true">← </span>' : ''}${esc(e.title)}${segment.continuesAfter ? '<span aria-hidden="true"> →</span>' : ''}</button>`;
        }).join('') + '</div>';
      }
      $('#calendar-body').innerHTML = html + '</div>';
    }
    $('#selected-date').textContent = selectedDate;
    $('#day-events').innerHTML = at(selectedDate).map(e => `<div class="home-agenda-row"><div>${esc(e.title)} ${e.done ? badge('완료') : ''}</div>${eventAction(e)}</div>`).join('') || empty('등록된 일정이 없습니다.');
  }
  function renderTasks() {
    const tasks = inScope(), p = progress(tasks), open = tasks.filter(unfinished);
    const predicates = { open: unfinished, late: t => unfinished(t) && t.due_date && t.due_date < today, blocked: t => t.status === 'blocked', overlap: t => unfinished(t) && overlaps(t).length, done: t => t.status === 'done' };
    $('#task-progress').innerHTML = `<div class="home-progress-line"><div><strong class="home-progress-number">${p.percent}%</strong> <span class="home-muted">완료</span></div><span class="home-muted">${p.done}/${p.total} 업무 완료</span></div><div class="home-progress-track" role="progressbar" aria-label="업무 완료율" aria-valuenow="${p.percent}" aria-valuemin="0" aria-valuemax="100"><span style="width:${p.percent}%"></span></div>`;
    $('#task-filters').innerHTML = [['open', '미완료'], ['late', '지연'], ['blocked', '보류'], ['overlap', '일정겹침']].map(([value, label]) => `<button data-filter="${value}" aria-pressed="${filter === value}">${label} ${tasks.filter(predicates[value]).length}</button>`).join('');
    $('#completed-toggle').textContent = filter === 'done' ? '미완료 보기' : '완료 보기';
    const rows = ordered(tasks.filter(predicates[filter]), today);
    $('#task-list').innerHTML = rows.map(t => {
      const late = unfinished(t) && t.due_date && t.due_date < today;
      return `<div class="home-task"><input type="checkbox" data-check="${esc(t.id)}" ${t.status === 'done' ? 'checked' : ''} aria-label="${esc(t.title)} 완료"><div><div class="home-task-top"><button class="home-task-open" data-task="${esc(t.id)}">${esc(t.title)}</button>${badge(late ? '기한 초과' : t.due_date === today && unfinished(t) ? '오늘 마감' : TASK_STATES[t.status], late)}</div><div class="home-task-meta">${esc(t.due_date || '날짜 없음')} · ${esc(campaignName(t.campaign_id))}</div>${filter === 'overlap' ? `<div class="home-overlap">확인할 겹침: ${esc(overlaps(t).map(e => e.name).join(', '))}</div>` : ''}${t.related_tab === 'kpi' && t.due_date && t.due_date <= today ? '<a class="home-muted" href="/kpi/">KPI 확인 ↗</a>' : ''}</div></div>`;
    }).join('') || empty(filter === 'open' && tasks.length && !open.length ? '등록한 업무를 모두 마쳤습니다.' : '이 조건에 해당하는 업무가 없습니다.');
  }
  function renderCampaign() {
    const c = selected();
    $('#campaign-select').innerHTML = store.campaigns.length ? store.campaigns.map(item => `<option value="${esc(item.id)}" ${item.id === c?.id ? 'selected' : ''}>${esc(item.name)}</option>`).join('') : '<option value="">캠페인 없음</option>';
    $('#campaign-title').textContent = c?.name || '캠페인을 준비해보세요';
    $('#campaign-dday').hidden = !c; $('#campaign-dday').textContent = c ? dday(c.target_date, today) : '';
    ['#clone-campaign', '#replan-campaign', '#campaign-select'].forEach(sel => { $(sel).disabled = !c; });
    $('#retrospective').hidden = !c;
    if (!c) { $('#campaign-summary').innerHTML = empty('새 캠페인에서 이름과 목표일을 직접 입력하거나, 현지 기회의 일정을 골라 역산 캠페인을 만들 수 있습니다.'); $('#next-task').innerHTML = ''; $('#gantt').innerHTML = ''; return; }
    $('#campaign-summary').innerHTML = `<div class="home-campaign-meta">${badge(CAMPAIGN_STATES[c.status] || c.status)} &nbsp; ${esc(c.target_date)} · ${dday(c.target_date, today)}<p>${esc([c.product, c.audience, c.channel].filter(Boolean).join(' · '))}</p></div>`;
    const tasks = store.tasks.filter(t => t.campaign_id === c.id), next = ordered(tasks.filter(unfinished), today)[0];
    $('#next-task').innerHTML = next ? `<button class="home-next" data-task="${esc(next.id)}"><span><span class="home-muted">다음 할 일</span> &nbsp; ${esc(next.title)} →</span><span class="home-muted">${esc(next.due_date || '날짜 없음')}</span></button>` : empty('남은 업무가 없습니다.');
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
    $('#opportunity-list').innerHTML = opportunities.map(e => `<article class="home-opportunity"><div class="home-signal-meta">${dday(e.start, today)} · ${esc({ holiday: '공휴일', anniversary: '기념일', regional_event: '지역행사', fruit_season: '과일 시즌' }[e.type] || '현지 일정')}${e.region ? ` · ${esc(e.region)}` : ''}</div><h3>${esc(e.name)}</h3>${eventSummary(e)}${e.is_demo ? badge('DEMO · 예시 데이터') : ''}<br><button class="btn" data-local="${esc(e.event_id)}">일정 상세</button> <button class="btn" data-create="${esc(e.event_id)}">+ 역산 캠페인 생성</button></article>`).join('') || empty(signalMessage('events', '조회 기간에 시작하는 HOME 등록 일정이 없습니다. 기간을 바꾸거나 검증된 일정 자료를 준비해주세요.'));
    const attention = signals?.attention.items || [], attentionIds = new Set(attention.map(t => t.collaboration_id));
    const rows = creators().filter(c => c.status !== 'posted' && (c.requires_attention || attentionIds.has(c.collaboration_id) || (validDate(c.post_date) && c.post_date <= addDays(today, 7)) || (validDate(c.shoot_date) && c.shoot_date < today && c.status !== 'shot'))).sort((a, b) => Number(Boolean(b.requires_attention || attentionIds.has(b.collaboration_id))) - Number(Boolean(a.requires_attention || attentionIds.has(a.collaboration_id))) || (a.post_date || '9999').localeCompare(b.post_date || '9999')).slice(0, 3);
    $('#collaboration-list').innerHTML = rows.map(c => {
      const task = attention.find(t => t.collaboration_id === c.collaboration_id), needs = c.requires_attention || task;
      return `<article class="home-collaboration"><div class="home-task-top"><h3>${esc(c.influencer)}</h3>${badge(needs ? '확인 필요' : c.post_date < today ? '게시일 경과' : '게시 임박', Boolean(needs))}</div>${c.is_demo ? badge('DEMO · 예시 데이터') : ''}<p class="home-creator-status">${esc(c.status_label || c.status || '상태 미제공')}</p><p class="home-signal-meta">촬영 ${esc(c.shoot_date || '미정')} · 게시 ${esc(c.post_date || '미정')}</p><p>${esc(c.next_action || task?.title || '원본 탭에서 진행 내용을 확인해주세요.')}</p><a href="${esc(safeUrl(c.link || `/influencer_marketing/?collaboration_id=${encodeURIComponent(c.collaboration_id)}`))}">협업 확인 ↗</a></article>`;
    }).join('') || empty(signalMessage('collaborations', '확인할 협업이 없거나 인플루언서 자료를 불러오지 못했습니다. 원본 탭에서 확인해주세요.'));
    if (signals?.attention.state === 'error') $('#collaboration-list').insertAdjacentHTML('beforeend', '<p class="home-error">협업 할 일을 불러오지 못해 확인 필요 목록이 일부 누락될 수 있습니다.</p>');
    const news = (signals?.news.items || []).filter(n => mode === 'demo' || (n.is_demo === false && n.verification_status === 'verified' && n.registration_status === 'approved')).sort((a, b) => String(b.published_at || '').localeCompare(String(a.published_at || ''))).slice(0, 3);
    $('#news-list').style.setProperty('--home-news-columns', String(Math.max(1, news.length)));
    $('#news-list').innerHTML = news.map(n => {
      const sources = Array.isArray(n.sources) ? n.sources : [];
      const evidence = sources.length ? sources.map((source, i) => {
        const url = safeUrl(source.url);
        return url ? `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">출처 ${i + 1} · ${esc(source.publisher)} ↗</a>` : esc(source.publisher);
      }).join('<br>') : `${esc(n.source || '출처 미제공')}${safeUrl(n.url) ? ` <a href="${esc(safeUrl(n.url))}" target="_blank" rel="noopener noreferrer">원문 ↗</a>` : ''}`;
      return `<article class="home-news-item"><div class="home-signal-meta">${esc(n.region || '지역 미제공')} · 발행 ${esc(n.published_at || '미제공')}${n.verified_at ? ` · 확인 ${esc(n.verified_at)}` : ''}</div><h3>${esc(n.title)}</h3><span class="home-muted">사실 요약</span><p>${esc(n.summary)}</p>${n.suggestion ? `<div class="home-suggestion"><span class="home-muted">적용 제안 · 운영 아이디어</span><p>${esc(n.suggestion)}</p><a href="/content_studio/?tab=cardnews">콘텐츠 스튜디오 ↗</a></div>` : ''}<p class="home-signal-meta">${evidence}</p>${n.verification_notes ? `<p class="home-signal-meta">확인 범위: ${esc(n.verification_notes)}</p>` : ''}</article>`;
    }).join('') || empty(signalMessage('news', '검증 후 등록한 뉴스·트렌드가 없습니다. 확인된 자료가 준비되면 표시합니다.'));
  }
  function render() {
    $('#reference-date').value = today;
    $('#mode-note').textContent = mode === 'demo' ? 'DEMO · 예시 데이터 — 가상 캠페인·현지 일정·협업·뉴스입니다. 예시 변경은 내 업무에 영향을 주지 않습니다.' : '내 업무 — 이 브라우저에 저장합니다. 다른 기기·팀원과 공유되지 않습니다. 원본 자료가 없는 항목은 빈 상태로 표시합니다.';
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
    openDialog('업무 수정', `<form id="task-form"><label class="home-field">업무명<input name="title" required maxlength="160" value="${esc(t.title)}"></label><div class="home-form-grid"><label class="home-field">시작일<input name="start_date" type="date" value="${esc(t.start_date)}"></label><label class="home-field">마감일<input name="due_date" type="date" value="${esc(t.due_date)}"></label><label class="home-field">캠페인<select name="campaign_id">${store.campaigns.map(c => `<option value="${esc(c.id)}" ${c.id === t.campaign_id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></label><label class="home-field">상태<select name="status">${options(TASK_STATES, t.status)}</select></label><label class="home-field">중요도<select name="importance">${options({ normal: '보통', high: '높음' }, t.importance)}</select></label><label class="home-field">관련 탭<select name="related_tab">${options({ '': '없음', ...TABS }, t.related_tab)}</select></label></div><label><input type="checkbox" name="fixed" ${t.fixed ? 'checked' : ''}> 목표일을 바꿔도 이 업무 날짜 고정</label><label class="home-field">메모<textarea name="memo" rows="3" maxlength="3000">${esc(t.memo)}</textarea></label><p id="task-error" class="home-error" hidden role="alert"></p><div class="home-form-actions"><a class="btn" href="${tabLink(t.related_tab)}">관련 탭 ↗</a><button class="btn dark" type="submit">저장</button></div></form>`);
    $('#task-form').onsubmit = event => {
      event.preventDefault(); const f = new FormData(event.currentTarget), title = f.get('title').trim(), start = f.get('start_date'), due = f.get('due_date');
      if (!title || (start && !due) || (start && start > due)) { $('#task-error').hidden = false; $('#task-error').textContent = '업무명을 입력하고, 마감일이 시작일보다 빠르지 않은지 확인해주세요.'; return; }
      const next = structuredClone(store), target = next.tasks.find(item => item.id === taskId), campaign = next.campaigns.find(c => c.id === f.get('campaign_id'));
      Object.assign(target, { title, start_date: start, due_date: due, campaign_id: campaign.id, status: f.get('status'), importance: f.get('importance'), related_tab: f.get('related_tab'), memo: f.get('memo'), fixed: f.has('fixed') || !due, offset: due ? dayDiff(due, campaign.target_date) : 0, completed_at: f.get('status') === 'done' ? t.completed_at || new Date().toISOString() : '' });
      if (save(next)) { dialog.close(); render(); toast('업무를 저장했습니다.'); }
    };
  }
  function planner(kind, opportunity) {
    const original = kind === 'create' ? null : selected(); if (kind !== 'create' && !original) return;
    let rows = original ? store.tasks.filter(t => t.campaign_id === original.id) : TEMPLATE.map(([key, offset, title, related_tab]) => ({ key, offset, title, related_tab }));
    const target = original?.target_date || opportunity?.start || '', initialName = original ? `${original.name}${kind === 'clone' ? ' 복사' : ''}` : opportunity?.name || '';
    openDialog(kind === 'create' ? '역산 캠페인 생성' : kind === 'clone' ? '캠페인 복제' : '설정·재계획', `<form id="plan-form"><label class="home-field">캠페인명<input name="name" required maxlength="160" value="${esc(initialName)}"></label><div class="home-form-grid"><label class="home-field">목표일<input type="date" name="target_date" required value="${target}"></label><label class="home-field">템플릿<select name="template" ${original ? 'disabled' : ''}>${options({ launch: '첫 진출 · 9개 업무', anniversary: '기념일 · 8개 업무' }, original?.template || 'launch')}</select></label><label class="home-field">제품<input name="product" maxlength="160" value="${esc(original?.product)}"></label><label class="home-field">타깃<input name="audience" maxlength="160" value="${esc(original?.audience)}"></label><label class="home-field">채널<input name="channel" maxlength="160" value="${esc(original?.channel)}"></label></div><p class="home-muted">목표일 전은 음수, 이후는 양수입니다. 주말을 포함한 달력일로 계산합니다.${kind === 'replan' ? ' 완료·취소·날짜 고정 업무는 보존합니다.' : ''}</p><div id="template-rows"></div><p id="plan-error" class="home-error" role="alert" hidden></p><div class="home-form-actions"><button type="submit" class="btn">일정 미리보기</button></div><div id="plan-preview"></div></form>`);
    const renderRows = () => { $('#template-rows').innerHTML = rows.map((t, i) => `<div class="home-template-row"><input aria-label="업무 ${i + 1} 이름" data-row-title="${i}" value="${esc(t.title)}" maxlength="160" required ${kind === 'replan' && (!unfinished(t) || t.fixed) ? 'disabled' : ''}><input aria-label="업무 ${i + 1} 상대 일수" data-row-offset="${i}" type="number" min="-3650" max="3650" value="${Number(t.offset) || 0}" required ${kind === 'replan' && (!unfinished(t) || t.fixed) ? 'disabled' : ''}></div>`).join(''); };
    renderRows();
    const form = $('#plan-form');
    form.elements.template.onchange = () => { rows = TEMPLATE.filter((_, i) => form.elements.template.value === 'launch' || i > 0).map(([key, offset, title, related_tab]) => ({ key, offset, title, related_tab })); renderRows(); };
    form.addEventListener('input', () => { $('#plan-preview').innerHTML = ''; });
    form.addEventListener('change', () => { $('#plan-preview').innerHTML = ''; });
    form.onsubmit = event => {
      event.preventDefault(); const f = new FormData(form), newTarget = f.get('target_date'), name = f.get('name').trim();
      const edits = rows.map((t, i) => ({ ...t, title: form.querySelector(`[data-row-title="${i}"]`).value.trim(), offset: Number(form.querySelector(`[data-row-offset="${i}"]`).value) }));
      if (!validDate(newTarget) || !name || edits.some(t => !t.title || !Number.isInteger(t.offset))) return;
      const projected = kind === 'replan' ? replanTasks(rows, newTarget, edits) : kind === 'clone' ? cloneTasks(edits, 'preview', newTarget, original.target_date, id) : edits.map(t => ({ ...t, due_date: addDays(newTarget, t.offset), status: 'todo' }));
      if (projected.some(t => t.due_date && !validDate(t.due_date))) { $('#plan-error').hidden = false; $('#plan-error').textContent = '계산 날짜가 지원 범위를 벗어났습니다.'; return; }
      $('#plan-error').hidden = true;
      $('#plan-preview').innerHTML = `<div class="home-preview"><p>아직 저장되지 않았습니다. ${projected.length}개 업무</p>${projected.map(t => `<div class="home-preview-row"><span>${esc(t.title)}${kind === 'replan' && (!unfinished(t) || t.fixed) ? ' · 보존' : ''}</span><span>${esc(t.due_date || '날짜 없음')} ${t.due_date && t.due_date < today && unfinished(t) ? badge('지난 마감', true) : ''}</span></div>`).join('')}<div class="home-form-actions"><button class="btn dark" type="button" id="confirm-plan">확정하고 캘린더에 반영</button></div></div>`;
      $('#confirm-plan').onclick = event => {
        event.currentTarget.disabled = true;
        const next = structuredClone(store);
        if (kind === 'replan') {
          Object.assign(next.campaigns.find(c => c.id === original.id), { name, target_date: newTarget, product: f.get('product'), audience: f.get('audience'), channel: f.get('channel') });
          const changed = replanTasks(next.tasks.filter(t => t.campaign_id === original.id), newTarget, edits);
          next.tasks = next.tasks.map(t => changed.find(item => item.id === t.id) || t);
        } else {
          const campaignId = id();
          next.campaigns.push({ id: campaignId, name, target_date: newTarget, template: original?.template || f.get('template'), product: f.get('product'), audience: f.get('audience'), channel: f.get('channel'), event_id: kind === 'clone' ? '' : opportunity?.event_id || '', status: 'preparing', review: '' });
          const tasks = kind === 'clone' ? cloneTasks(edits, campaignId, newTarget, original.target_date, id) : edits.map(t => ({ ...t, id: id(), campaign_id: campaignId, due_date: addDays(newTarget, t.offset), start_date: '', fixed: false, status: 'todo', importance: 'normal', memo: '', completed_at: '' }));
          next.tasks.push(...tasks); next.preferences.selected = campaignId;
        }
        if (save(next)) { dialog.close(); render(); toast(kind === 'replan' ? '일정을 반영했습니다.' : '새 캠페인을 저장했습니다.'); }
        else event.currentTarget.disabled = false;
      };
    };
  }
  root.addEventListener('click', event => {
    const button = event.target.closest('button'); if (!button) return;
    if (button.dataset.date) { selectedDate = button.dataset.date; renderCalendar(); }
    if (button.dataset.view) { view = button.dataset.view; renderCalendar(); }
    if (button.dataset.filter) { filter = button.dataset.filter; renderTasks(); }
    if (button.dataset.task) editTask(button.dataset.task);
    if (button.dataset.local) showLocalEvent(button.dataset.local);
    if (button.dataset.create) { const e = localEvents().find(item => item.event_id === button.dataset.create); if (e) { if (dialog.open) dialog.close(); planner('create', e); } }
    if (button.dataset.select) changeCampaign(button.dataset.select);
  });
  root.addEventListener('change', event => {
    if (!event.target.dataset.check) return;
    const next = structuredClone(store), task = next.tasks.find(t => t.id === event.target.dataset.check);
    task.status = event.target.checked ? 'done' : 'todo'; task.completed_at = event.target.checked ? new Date().toISOString() : '';
    if (save(next)) toast(event.target.checked ? '완료했습니다. 일정과 진척에 반영했습니다.' : '예정 상태로 되돌렸습니다.');
    render();
  });
  function changeCampaign(campaignId) { const next = structuredClone(store); next.preferences.selected = campaignId; if (save(next)) render(); }
  $('#campaign-select').onchange = event => changeCampaign(event.target.value);
  $('#completed-toggle').onclick = () => { filter = filter === 'done' ? 'open' : 'done'; renderTasks(); };
  $('#scope').onchange = event => { scope = event.target.value; render(); };
  $('#new-campaign').onclick = () => planner('create');
  $('#clone-campaign').onclick = () => planner('clone');
  $('#replan-campaign').onclick = () => planner('replan');
  $('#data-mode').onchange = event => {
    mode = event.target.value; filter = 'open'; load(); updateRange();
    try { localStorage.setItem('hjs-home-browser-mode', mode); } catch { /* load에 저장소 오류 안내가 있습니다. */ }
    refreshSignals();
  };
  function changeDate(value) { if (!validDate(value)) return; today = value; selectedDate = value; cursor = value; updateRange(); refreshSignals(); }
  $('#reference-date').onchange = event => changeDate(event.target.value);
  $('#reset-date').onclick = () => changeDate(kstToday());
  function moveCalendar(direction) {
    if (view === 'week') cursor = addDays(cursor, direction * 7);
    else { const d = new Date(`${cursor.slice(0, 7)}-01`); d.setUTCMonth(d.getUTCMonth() + direction); cursor = d.toISOString().slice(0, 10); }
    refreshSignals();
  }
  $('#calendar-prev').onclick = () => moveCalendar(-1);
  $('#calendar-next').onclick = () => moveCalendar(1);
  $('#calendar-today').onclick = () => { cursor = today; selectedDate = today; refreshSignals(); };
  $('#range-preset').onchange = event => {
    if (event.target.value !== 'custom') { $('#range-start').value = today; $('#range-end').value = addDays(today, Number(event.target.value)); }
  };
  ['#range-start', '#range-end'].forEach(sel => { $(sel).onchange = () => { $('#range-preset').value = 'custom'; }; });
  $('#range-form').onsubmit = event => {
    event.preventDefault(); const r = range();
    const invalid = !validDate(r.start) || !validDate(r.end) || r.end < r.start || Number(r.end.slice(0, 4)) - Number(r.start.slice(0, 4)) > 5;
    $('#range-error').hidden = !invalid;
    if (invalid) { $('#range-error').textContent = '종료일을 시작일 이후로 지정해주세요. 조회 범위는 최대 5년입니다.'; return; }
    const next = structuredClone(store); Object.assign(next.preferences, { preset: $('#range-preset').value, range_start: r.start, range_end: r.end });
    if (save(next)) refreshSignals();
  };
  $('#review-form').onsubmit = event => {
    event.preventDefault(); const c = selected(); if (!c) return;
    const next = structuredClone(store), campaign = next.campaigns.find(item => item.id === c.id), f = new FormData(event.currentTarget);
    campaign.review = f.get('review'); campaign.status = f.get('status');
    if (save(next)) { render(); toast('회고와 캠페인 상태를 저장했습니다.'); }
  };
  addEventListener('storage', event => { if (event.key === key() || event.key === null) { locked = true; showError('다른 창에서 기록이 변경되었습니다. 새로고침 후 계속해주세요.'); } });
  load(); updateRange(); refreshSignals();
}
