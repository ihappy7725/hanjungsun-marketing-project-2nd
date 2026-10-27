/* 인플루언서 마케팅 화면 스크립트 (담당: 진혁)
   README 6장: 이 화면에서만 불러오고, 전역 변수·함수를 만들지 않도록 전체를 즉시 실행 함수로 감쌉니다.
   데이터 저장은 모두 routes.py의 API를 통해서만 합니다. */
(function () {
  'use strict';
  const ROOT = document.getElementById('imRoot');
  const BOOT_EL = document.getElementById('imBoot');
  if (!ROOT || !BOOT_EL) return;
  const BOOT = JSON.parse(BOOT_EL.textContent);
  const API = BOOT.apiBase.replace(/\/?$/, '/');

  /* ---------- 기준값 ---------- */
  const PF = [{ k: 'tt', n: 'TikTok' }, { k: 'fb', n: 'Facebook' }, { k: 'yt', n: 'YouTube' }, { k: 'ig', n: 'Instagram' }];
  const PFN = Object.fromEntries(PF.map(p => [p.k, p.n]));
  const STATUS = [['candidate', '후보'], ['sent', '제안 발송'], ['replied', '회신 받음'], ['negotiating', '협상 중'], ['confirmed', '계약 확정'], ['shot', '촬영 완료'], ['posted', '게시 완료'], ['declined', '불가·보류']];
  const STN = Object.fromEntries(STATUS);
  const ST_COLOR = { candidate: 'var(--im-faint)', sent: 'var(--im-accent)', replied: 'var(--im-warn)', negotiating: 'var(--accent)', confirmed: 'var(--im-bean)', shot: 'var(--im-ok)', posted: 'var(--primary)', declined: 'var(--im-bad)' };
  const C = BOOT.consts;
  const TIERS = C.tiers.map(t => ({ ...t, max: t.max == null ? Infinity : t.max }));
  const LAYERS = { public: '공개 참고가', quote: '견적', contract: '계약가' };
  const EVENTS = BOOT.events || [];

  /* ---------- 상태 ---------- */
  const S = {
    inf: new Map(BOOT.influencers.map(i => [i.id, i])),
    quotes: new Map(BOOT.quotes.map(q => [q.id, q])),
    settings: BOOT.settings,
    tab: BOOT.eventFilter ? 'list' : 'overview',
    flt: { q: '', seg: '', pf: '', tier: '', st: '', ev: BOOT.eventFilter || '', sort: 'updated', dir: -1 },
    mail: { sel: null, lang: 'vi', checked: new Set() },
    resp: { id: '', draft: null }, cal: null, calSel: null,
  };

  /* ---------- 도우미 ---------- */
  const $ = (s, r = ROOT) => r.querySelector(s);
  const $$ = (s, r = ROOT) => [...r.querySelectorAll(s)];
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const pad = n => String(n).padStart(2, '0');
  const iso = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  const today = () => iso(new Date());
  const daysBetween = (a, b) => Math.round((new Date(b + 'T00:00:00') - new Date(a + 'T00:00:00')) / 864e5);
  const fmtD = s => { if (!s) return ''; const [, m, d] = s.split('-'); return `${+m}/${+d}`; };
  const fmtDV = s => { if (!s) return ''; const [y, m, d] = s.split('-'); return `${d}/${m}/${y}`; };
  function short(n) { n = +n; if (!n && n !== 0 || isNaN(n)) return '–'; if (n >= 1e6) return (n / 1e6).toFixed(n >= 1e7 ? 0 : 1).replace(/\.0$/, '') + 'M'; if (n >= 1e3) return (n / 1e3).toFixed(n >= 1e4 ? 0 : 1).replace(/\.0$/, '') + 'K'; return String(Math.round(n)); }
  const grp = n => (n == null || isNaN(n)) ? '–' : Math.round(n).toLocaleString('ko-KR');
  function toast(msg) { const t = $('#imToast'); t.textContent = msg; t.hidden = false; clearTimeout(toast._t); toast._t = setTimeout(() => { t.hidden = true; }, 2800); }
  const statusChip = s => `<span class="im-chip st-${s}">${esc(STN[s] || s)}</span>`;
  function mainPf(inf) { let best = null; for (const p of PF) { const f = +((inf.pf || {})[p.k]?.f || 0); if (f > 0 && (!best || f > best.f)) best = { k: p.k, f, v: +(inf.pf[p.k].v || 0) }; } return best; }
  const maxF = inf => mainPf(inf)?.f || 0;
  const tierOf = f => TIERS.find(t => f >= t.min && f < t.max) || TIERS[0];
  const toUsd = (amt, cur) => { amt = +amt || 0; const s = S.settings; if (cur === 'USD') return amt; if (cur === 'KRW') return amt / (+s.krwPerUsd || 1400); return amt / (+s.vndPerUsd || 26300); };
  const toVnd = (amt, cur) => toUsd(amt, cur) * (+S.settings.vndPerUsd || 26300);
  const infList = () => [...S.inf.values()];
  const ST = C.sourceTypes || {}, CONF = C.confidence || {};
  const confChip = conf => conf ? `<span class="im-chip ${conf === 'high' ? 'st-shot' : conf === 'medium' ? 'st-sent' : conf === 'demo' ? '' : 'st-replied'}" title="데이터 신뢰 수준">${esc(CONF[conf] || conf)}</span>` : '';
  const srcLabel = s => (ST[s] || {}).label || '';
  const pct = v => v == null || v === '' ? '–' : (+v).toFixed(1).replace(/\.0$/, '') + '%';
  const eventName = id => { const e = EVENTS.find(x => x.event_id === id); return e ? `${e.name}${e.date ? ' (' + e.date + ')' : ''}` : id; };
  async function copyText(txt, label, fallbackEl) {
    try { await navigator.clipboard.writeText(txt); toast(label + ' 복사됨'); }
    catch (e) { if (fallbackEl) { const r = document.createRange(); r.selectNodeContents(fallbackEl); const s = getSelection(); s.removeAllRanges(); s.addRange(r); } toast('자동 복사가 안 돼요. 선택된 글자를 Ctrl+C로 복사하세요'); }
  }
  function armButton(btn, label, run) {
    if (!btn.dataset.arm) { btn.dataset.arm = '1'; const old = btn.textContent; btn.textContent = label; btn.classList.add('is-danger'); setTimeout(() => { if (btn.isConnected) { delete btn.dataset.arm; btn.textContent = old; btn.classList.remove('is-danger'); } }, 3000); return; }
    run();
  }

  /* ---------- 서버 통신 ---------- */
  async function api(method, path, body, isForm) {
    const opt = { method, headers: { Accept: 'application/json' } };
    if (body !== undefined) { if (isForm) opt.body = body; else { opt.headers['Content-Type'] = 'application/json'; opt.body = JSON.stringify(body); } }
    let res;
    try { res = await fetch(API + path, opt); } catch (e) { throw new Error('서버에 연결하지 못했어요. Flask가 실행 중인지 확인하세요'); }
    let data = null; try { data = await res.json(); } catch (e) { /* 본문 없음 */ }
    if (!res.ok) throw new Error((data && data.error) || `요청을 처리하지 못했어요 (${res.status})`);
    return data;
  }
  async function saveInf(o) { try { const saved = await api('POST', 'api/influencers', o); S.inf.set(saved.id, saved); refresh(); return saved; } catch (e) { toast(e.message); return null; } }
  async function delInf(id) { try { await api('DELETE', 'api/influencers/' + encodeURIComponent(id)); S.inf.delete(id); refresh(); return true; } catch (e) { toast(e.message); return false; } }
  async function saveReply(id, r) { try { const saved = await api('POST', `api/influencers/${encodeURIComponent(id)}/reply`, r); S.inf.set(saved.id, saved); refresh(); return saved; } catch (e) { toast(e.message); return null; } }
  async function saveQuote(q) { try { const saved = await api('POST', 'api/quotes', q); S.quotes.set(saved.id, saved); refresh(); return saved; } catch (e) { toast(e.message); return null; } }
  async function delQuote(id) { try { await api('DELETE', 'api/quotes/' + encodeURIComponent(id)); S.quotes.delete(id); refresh(); return true; } catch (e) { toast(e.message); return false; } }
  async function saveSettings(o) { try { S.settings = await api('PUT', 'api/settings', o); refresh(); return true; } catch (e) { toast(e.message); return false; } }
  function replaceAll(d) { if (d.influencers) S.inf = new Map(d.influencers.map(i => [i.id, i])); if (d.quotes) S.quotes = new Map(d.quotes.map(q => [q.id, q])); refresh(); }

  /* ---------- 탭 ---------- */
  const TABS = [['overview', '요약'], ['list', '인플루언서'], ['discover', '발굴'], ['rates', '광고 단가']];  // Ver_021: 제안 메일·회신 정리는 편집 창 안으로
  const VIEWS = {};
  function buildTabs() {
    $('#imTabs').innerHTML = TABS.map(([k, n]) => `<button type="button" class="im-tab" role="tab" data-t="${k}" aria-selected="${k === S.tab}">${n}</button>`).join('');
    $$('#imTabs .im-tab').forEach(b => { b.onclick = () => show(b.dataset.t); });
  }
  function show(t, force) {
    const v = $('#imView');
    if (S.tab === t && !force && v.dataset.t === t) return;
    S.tab = t; $$('#imTabs .im-tab').forEach(b => b.setAttribute('aria-selected', b.dataset.t === t));
    v.dataset.t = t; v.innerHTML = ''; VIEWS[t].mount(v); if (VIEWS[t].update) VIEWS[t].update(v);
  }
  let drawerOpen = false;
  function refresh() {
    renderBanners(); const v = $('#imView'); if (v.dataset.t && VIEWS[v.dataset.t].update) VIEWS[v.dataset.t].update(v);
  }
  function renderBanners() {
    const b = [];
    if (S.flt.ev) b.push(`<div class="im-banner is-info"><b>기념일별 보기</b><div class="im-grow">${esc(eventName(S.flt.ev))}에 연결된 협업만 보고 있어요.</div><button type="button" class="im-btn is-sm" id="imClearEv">전체 보기</button></div>`);
    $('#imBanners').innerHTML = b.join('');
    const cd = $('#imClearDemo'); if (cd) cd.onclick = () => armButton(cd, '한 번 더 누르면 삭제', async () => { try { replaceAll(await api('POST', 'api/demo/clear')); toast('시연 데이터를 지웠어요'); } catch (e) { toast(e.message); } });
    const ce = $('#imClearEv'); if (ce) ce.onclick = () => { S.flt.ev = ''; refresh(); };
  }

  /* ---------- 타깃 한 칸 선택 (Ver_023): '베트남(인) · 식품(맛집·먹방)' → 국가 묶음 '베트남' 아래 '식품(맛집·먹방)' ---------- */
  const SEG_LIST = (C.segments || []).map(x => { const [a, b] = x.name.split(' · '); return { name: x.name, country: (b ? a : '기타').replace('(인)', ''), topic: b || a }; });
  const SEG_COUNTRIES = [...new Set(SEG_LIST.map(x => x.country))];
  const segOptions = (cur, none, unassigned) => `<option value="">${none}</option>` + SEG_COUNTRIES.map(c => `<optgroup label="${esc(c)}">${SEG_LIST.filter(x => x.country === c)
    .map(x => `<option value="${esc(x.name)}" ${cur === x.name ? 'selected' : ''}>${esc(x.topic)}</option>`).join('')}</optgroup>`).join('') + (unassigned ? `<option value="__none" ${cur === '__none' ? 'selected' : ''}>${unassigned}</option>` : '');
  /* 할 일·일정 공통 색 태그 (Ver_021): 확인·협의 = 노랑 / 촬영 = 파랑 / 제안 = 청록 / 게시·완료 = 초록 / 지연·오류 = 빨강 / 기타 = 회색 */
  const tag = (kind, text) => `<span class="im-tag t-${kind}">${esc(text)}</span>`;

  /* ---------- 계산 ---------- */
  function filteredByEvent() { return S.flt.ev ? infList().filter(i => i.eventId === S.flt.ev) : infList(); }
  function tasks(L) {
    const t = today(), out = [];
    for (const i of L) {
      const r = i.resp || {}, sent = (i.sentAt || '').slice(0, 10);
      if (i.status === 'sent' && sent && !i.resp && daysBetween(sent, t) >= 7) out.push({ k: 'late', p: 2, i, txt: `제안 후 ${daysBetween(sent, t)}일째 회신 없음`, act: 'Zalo나 메신저로 한 번 더 연락해 보세요' });
      if (r.review) out.push({ k: 'review', p: 1, i, txt: '회신 내용 확인 필요', act: (r.ambig || []).join(' · ') || '자동 정리 결과를 확인해야 해요' });
      if (['replied', 'negotiating'].includes(i.status) && r.avail !== 'no' && !i.confirmedShoot && (r.shoot || []).length) out.push({ k: 'pick', p: 3, i, txt: `촬영 가능일 ${r.shoot.length}개 중 확정 필요`, act: '요약의 [촬영일 확정]에서 날짜를 누르세요' });
      if (i.confirmedShoot && i.confirmedShoot >= t && daysBetween(t, i.confirmedShoot) <= 14 && i.status === 'confirmed') out.push({ k: 'soon', p: 4, i, txt: `촬영 ${fmtD(i.confirmedShoot)} (D-${daysBetween(t, i.confirmedShoot)})`, act: '샘플 배송과 촬영 가이드 전달 여부를 확인하세요' });
      if (i.metricsDate && daysBetween(i.metricsDate, t) > 45 && !['declined', 'posted'].includes(i.status)) out.push({ k: 'stale', p: 5, i, txt: `지표 기준일이 ${daysBetween(i.metricsDate, t)}일 지남`, act: '팔로워·조회수를 다시 확인하세요' });
    }
    return out.sort((a, b) => a.p - b.p);
  }

  /* ================= 요약 ================= */
  /* 요약 계산 범위: 기본은 시연 데이터가 있으면 '시연 데이터 포함'(발표용), [실제 데이터만]으로 바꿀 수 있어요. 포함 중에는 늘 띠로 알려요 (Ver_018) */
  const ovWithDemo = () => true;
  const realInf = () => filteredByEvent().filter(i => ovWithDemo() || !i.example);
  const realQuotes = () => [...S.quotes.values()].filter(q => ovWithDemo() || !q.example);
  const isOutlier = m => { if (!m.tier || !m.usd) return false; const [lo, hi] = m.tier.usd; return m.usd > (hi || lo) * 10 || m.usd < lo / 10; };
  const usd$ = n => '$' + grp(n);
  /* 촬영일 확정 대기 (요약·회신 정리에서 함께 사용) */
  const pickPeople = L => L.filter(i => !i.confirmedShoot && i.resp && i.resp.avail !== 'no' && (i.resp.shoot || []).length);
  function pickHtml(P, max) {
    if (!P.length) return '<p class="im-muted" style="margin:0">확정을 기다리는 사람이 없어요</p>';
    const taken = new Set(infList().map(x => x.confirmedShoot).filter(Boolean));
    return `<ul class="im-todo">${P.slice(0, max).map(i => `<li><div class="im-grow"><b>${esc(i.name)}</b> <span class="im-muted im-small">촬영 가능일 ${i.resp.shoot.length}개 중 선택</span><div class="im-row" style="gap:6px;margin-top:6px">${i.resp.shoot.map(d => `<button type="button" class="im-btn is-sm ${taken.has(d) ? 'is-danger' : ''}" data-cf="${esc(i.id)}|${d}" ${taken.has(d) ? 'title="같은 날 다른 촬영 확정이 있어요"' : ''}>${fmtD(d)}</button>`).join('')}</div></div></li>`).join('')}</ul>${P.length > max ? `<p class="im-muted im-small" style="margin:8px 0 0">외 ${P.length - max}명은 [회신 정리] 탭에서 확정하세요</p>` : ''}`;
  }
  function bindPick(root) {
    $$('[data-cf]', root).forEach(b => { b.onclick = async () => {
      const [id, d] = b.dataset.cf.split('|'), i = S.inf.get(id); if (!i) return;
      const clash = infList().filter(x => x.id !== id && x.confirmedShoot === d);
      if (await saveInf({ id, confirmedShoot: d })) toast(`${i.name} 촬영일을 ${fmtD(d)}로 확정했어요${clash.length ? ' (같은 날 ' + clash.length + '건 겹침)' : ''}`);
    }; });
  }
  VIEWS.overview = {
    mount(v) {
      // Ver_023: 데이터 신뢰도·구성 패널과 패널 제목 옆 설명을 뺐어요. 시연 데이터가 있으면 맨 위에 'DEMO · 예시 데이터' 한 줄
      // Ver_023: 14일 일정을 빼고, 예산 현황은 전체 폭 가로 띠 / 오늘의 할 일·촬영일 확정은 같은 높이 2칸
      v.innerHTML = `<div class="im-funnel" id="ovFun"></div>
      <div class="im-ovgrid">
        <div class="im-panel im-ovbud"><h2>예산 현황</h2><div id="ovBud"></div></div>
        <div class="im-panel"><h2>오늘의 할 일 <small>급한 순서 · 최대 5개</small></h2><div id="ovTodo"></div></div>
        <div class="im-panel" id="ovPickP"><h2>촬영일 확정</h2><div id="ovPick"></div></div></div>`;
    },
    update(v) {
      const L = realInf();
      /* 진행 단계 (Ver_023): 등록 → 제안 보냄 → 회신 받음 → 확정. 단계 이름과 인원만 */
      const sent = L.filter(i => i.sentAt).length, replied = L.filter(i => i.sentAt && i.resp).length;
      const conf = L.filter(i => ['confirmed', 'shot', 'posted'].includes(i.status)).length, needN = L.filter(needUrl).length;
      const steps = [['등록', L.length], ['제안 보냄', sent], ['회신 받음', replied], ['확정', conf]];
      $('#ovFun', v).innerHTML = steps.map(([n, c]) => `<div class="im-fstep"><span>${n}</span><b>${c}<small>명</small></b></div>`).join('');
      /* 오늘의 할 일 (사람별 나열 대신 묶어서 개수로) */
      const T = tasks(L), cnt = k => T.filter(x => x.k === k).length;
      const outl = realQuotes().filter(q => isOutlier(quoteMetrics(q))).length;
      const unsent = L.filter(i => (i.status || 'candidate') === 'candidate' && !i.sentAt).length;
      const first = k => (T.find(x => x.k === k) || {}).i;  // 사람 한 명에게 바로 가는 할 일은 그 사람 편집 창을 열어요
      const todo = [
        [cnt('review'), '확인', 'warn', `회신 확인 필요 ${cnt('review')}건`, '편집 창 [회신]에서 자동 정리 결과 확인', 'open:' + (first('review') || {}).id + ':reply'],
        [cnt('late'), '지연', 'bad', `제안 후 7일 넘게 회신 없음 ${cnt('late')}명`, 'Zalo·메신저로 한 번 더 연락', 'open:' + (first('late') || {}).id + ':mail'],
        [cnt('pick'), '촬영', 'shoot', `촬영일 확정 대기 ${cnt('pick')}명`, '[촬영일 확정]에서 바로 고르기', 'pick'],
        [cnt('soon'), '준비', 'shoot', `14일 안 촬영 ${cnt('soon')}건`, '샘플 배송·촬영 가이드 전달 확인', 'open:' + (first('soon') || {}).id + ':'],
        [outl, '단가', 'bad', `단가 이상값 ${outl}건`, '통화·자릿수 입력 확인', 'rates'],
        [needN, '주소', 'warn', `주소 직접 확인 필요 ${needN}명`, '프로필 주소 직접 확인', 'list'],
        [unsent, '제안', 'send', `제안 미발송 ${unsent}명`, '이름을 눌러 [제안 메일] 복사', 'list:candidate'],
        [cnt('stale'), '지표', 'mute', `지표 기준일 45일 지남 ${cnt('stale')}명`, '팔로워·조회수 다시 확인', 'list'],
      ].filter(x => x[0]);
      $('#ovTodo', v).innerHTML = !L.length
        ? `<div class="im-empty">아직 등록된 인플루언서가 없어요.<div class="im-row" style="justify-content:center;margin-top:10px"><button type="button" class="im-btn is-primary" data-go="discover">[발굴]에서 찾기</button><button type="button" class="im-btn" id="ovAdd">직접 입력해서 추가</button></div></div>`
        : todo.length ? `<ul class="im-todo is-dense">${todo.slice(0, 5).map(([, label, kind, txt, act, go]) => `<li title="${esc(act)}">${tag(kind, label)}<div class="im-grow"><b>${esc(txt)}</b><div class="im-muted im-small">${esc(act)}</div></div><button type="button" class="im-btn is-ghost is-sm" data-go="${esc(go)}">${go.startsWith('open:') ? '열기' : '이동'}</button></li>`).join('')}</ul>${todo.length > 5 ? `<p class="im-muted im-small" style="margin:8px 0 0">외 ${todo.length - 5}개</p>` : ''}` : '<div class="im-empty">지금 처리할 일이 없어요</div>';
      $$('[data-go]', v).forEach(b => { b.onclick = () => { const [a, x, y] = b.dataset.go.split(':');
        if (a === 'open') { openEditor(x, y); return; }
        if (a === 'pick') { $('#ovPickP', v).scrollIntoView({ behavior: 'smooth', block: 'center' }); return; }
        if (a === 'list') { S.flt.st = x === 'candidate' ? 'candidate' : ''; }
        show(a); }; });
      const oa = $('#ovAdd', v); if (oa) oa.onclick = () => openEditor(null);
      const P = pickPeople(L); $('#ovPick', v).innerHTML = pickHtml(P, 3); bindPick($('#ovPick', v));
      this.budget(v);
    },
    budget(v) {
      const Q = realQuotes().map(q => ({ q, m: quoteMetrics(q) })).filter(x => x.m.usd && !isOutlier(x.m));
      const sum = a => a.reduce((s, x) => s + x.m.usd, 0), qs = Q.filter(x => x.q.layer === 'quote'), cs = Q.filter(x => x.q.layer === 'contract'), both = [...qs, ...cs];
      const outN = realQuotes().length - Q.length;
      $('#ovBud', v).innerHTML = !both.length && outN ? `<p style="margin:0">기록 ${outN}건이 모두 이상값이라 합계에서 뺐어요. [광고 단가]에서 통화·자릿수를 확인하세요.</p>` : both.length ? `<div class="im-mini"><div><span>견적 합계</span><b>${usd$(sum(qs))}</b><em>${qs.length}건</em></div><div><span>계약 합계</span><b>${usd$(sum(cs))}</b><em>${cs.length}건</em></div><div><span>평균 단가</span><b>${usd$(sum(both) / both.length)}</b><em>게시물 1건</em></div></div>`
        : '<p class="im-muted" style="margin:0">아직 기록한 견적이 없어요. [광고 단가]에서 받은 견적을 추가하면 합계와 평균이 나와요.</p>';
    },
  };

  /* ================= 인플루언서 목록 ================= */
  // 표 열 비율(%): 인플루언서·분야·TikTok·Facebook·YouTube·Instagram·대표 채널 조회수·규모·상태. 위 필터 칸도 같은 비율(CSS .im-lfilters)
  const LCOLS = [24, 12, 8, 8, 8, 8, 11, 10, 11];
  VIEWS.list = {
    mount(v) {
      const f = S.flt;
      v.innerHTML = `<div class="im-filters im-lfilters">
        <label class="im-field">검색<input type="search" id="fq" placeholder="이름, 핸들, 메모" value="${esc(f.q)}"></label>
        <label class="im-field">분야<select id="fseg">${segOptions(f.seg, '전체', '미분류')}</select></label>
        <label class="im-field">대표 플랫폼<select id="fpf"><option value="">전체</option>${PF.map(p => `<option value="${p.k}" ${f.pf === p.k ? 'selected' : ''}>${p.n}</option>`).join('')}</select></label>
        <label class="im-field">규모<select id="ftier"><option value="">전체</option>${TIERS.map(t => `<option value="${t.k}" ${f.tier === t.k ? 'selected' : ''}>${t.n}</option>`).join('')}</select></label>
        <label class="im-field">상태<select id="fst"><option value="">전체</option>${STATUS.map(([k, n]) => `<option value="${k}" ${f.st === k ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
        </div>
        <div class="im-tblwrap is-scroll"><table class="im-ltable"><colgroup>${LCOLS.map(w => `<col style="width:${w}%">`).join('')}</colgroup><thead><tr id="lhead"></tr></thead><tbody id="lbody"></tbody></table></div>
        <div class="im-row" style="margin-top:8px"><span class="im-muted im-small im-grow" id="lcount"></span><button type="button" class="im-btn is-primary" id="addInf">+ 추가</button></div>`;
      const on = (id, k) => { $('#' + id, v).oninput = e => { S.flt[k] = e.target.value; this.update(v); }; };
      on('fq', 'q'); on('fseg', 'seg'); on('fpf', 'pf'); on('ftier', 'tier'); on('fst', 'st');
      $('#addInf', v).onclick = () => openEditor(null);
    },
    update(v) {
      const f = S.flt;
      let L = infList(); const q = f.q.trim().toLowerCase();
      if (q) L = L.filter(i => [i.name, i.handle, i.notes, i.email, i.city].join(' ').toLowerCase().includes(q));
      if (f.seg === '__none') L = L.filter(i => !i.segment); else if (f.seg) L = L.filter(i => i.segment === f.seg);
      if (f.pf) L = L.filter(i => mainPf(i)?.k === f.pf);
      if (f.tier) L = L.filter(i => maxF(i) && tierOf(maxF(i)).k === f.tier); if (f.st) L = L.filter(i => (i.status || 'candidate') === f.st);
      if (f.ev) L = L.filter(i => i.eventId === f.ev);
      const key = { name: i => i.name || '', tt: i => +(i.pf?.tt?.f || 0), fb: i => +(i.pf?.fb?.f || 0), yt: i => +(i.pf?.yt?.f || 0), ig: i => +(i.pf?.ig?.f || 0), views: i => mainPf(i)?.v || 0, status: i => STATUS.findIndex(s => s[0] === (i.status || 'candidate')), updated: i => i.updatedAt || '' }[f.sort];
      L.sort((a, b) => { const x = key(a), y = key(b); return (x > y ? 1 : x < y ? -1 : 0) * f.dir; });
      const cols = [['name', '인플루언서', 1], ['cat', '분야'], ['tt', 'TikTok', 1, 'r'], ['fb', 'Facebook', 1, 'r'], ['yt', 'YouTube', 1, 'r'], ['ig', 'Instagram', 1, 'r'], ['views', '대표 채널 조회수', 1, 'r'], ['tier', '규모'], ['status', '상태', 1]];
      $('#lhead', v).innerHTML = cols.map(([k, n, s, r]) => `<th class="${r || ''} ${s ? 'im-sortable' : ''}" ${k === 'tier' ? `title="${esc(TIERS.map(t => t.n + ' '+ t.label).join(' · '))}"` : ''} ${s ? `data-s="${k}"` : ''}>${n}${f.sort === k ? (f.dir > 0 ? ' ▲' : ' ▼') : ''}</th>`).join('');
      $$('#lhead th[data-s]', v).forEach(th => { th.onclick = () => { if (f.sort === th.dataset.s) f.dir *= -1; else { f.sort = th.dataset.s; f.dir = th.dataset.s === 'name' ? 1 : -1; } this.update(v); }; });
      const cell = (i, k) => { const p = (i.pf || {})[k]; if (!p || !+p.f) return '<td class="r im-faint">–</td>'; return `<td class="r im-num">${short(p.f)}</td>`; };
      $('#lbody', v).innerHTML = L.length ? L.map(i => { const m = mainPf(i), tr = maxF(i) ? tierOf(maxF(i)) : null; return `<tr class="is-click" data-id="${esc(i.id)}">
          <td><div class="im-nm">${esc(i.name)}</div><div class="im-sub">${[i.handle, i.city].filter(Boolean).map(esc).join(' · ')}</div></td>
          <td>${esc(i.category || '–')}</td>${PF.map(p => cell(i, p.k)).join('')}
          <td class="r im-num">${m && m.v ? short(m.v) + ` <span class="im-pf pf-${m.k}"><i></i></span>` : '<span class="im-faint">–</span>'}</td>
          <td>${tr ? tr.n : '–'}</td><td>${statusChip(i.status || 'candidate')}</td></tr>`; }).join('')
        : `<tr><td colspan="9"><div class="im-empty" style="border:0">${S.inf.size ? '조건에 맞는 인플루언서가 없어요' : '등록된 인플루언서가 없어요. + 추가 또는 [발굴]에서 후보를 등록하세요.'}</div></td></tr>`;
      $$('#lbody tr[data-id]', v).forEach(tr => { tr.onclick = () => openEditor(tr.dataset.id); });
      $('#lcount', v).textContent = `${L.length}명 표시 · 전체 ${S.inf.size}명`;
      const tw = $('.im-tblwrap', v); $('.im-lfilters', v).style.paddingRight = Math.max(0, tw.offsetWidth - tw.clientWidth - 1) + 'px';  // 표 세로 스크롤바만큼
    },
  };

  /* ---------- 편집 창 ---------- */
  function openEditor(id, sec) {
    const ex = id ? S.inf.get(id) : null;
    const o = ex ? JSON.parse(JSON.stringify(ex)) : { name: '', handle: '', category: C.categories[0], city: C.cities[0], email: '', zalo: '', manager: '', pf: {}, metricsDate: today(), metricsSource: C.sources[0], status: 'candidate', notes: '', eventId: S.flt.ev || '' };
    const isNew = !ex, d = $('#imDrawer'), r = o.resp;
    const evIds = [...new Set([...EVENTS.map(e => e.event_id), o.eventId].filter(Boolean))];
    // 연결 기념일: 현지 시장 분석의 기념일이 있을 때만 보여요. 없으면 저장된 값만 그대로 유지 (Ver_023)
    const evField = EVENTS.length
      ? `<label class="im-field is-wide">연결 기념일 (HOME 캘린더 연결)<select id="eEv"><option value="">연결 안 함</option>${evIds.map(x => `<option value="${esc(x)}" ${o.eventId === x ? 'selected' : ''}>${esc(eventName(x))}</option>`).join('')}</select></label>`
      : `<input type="hidden" id="eEv" value="${esc(o.eventId)}">`;
    d.innerHTML = `<header><h2 id="imDrawerTitle">${isNew ? '인플루언서 추가' : esc(o.name)}</h2><button type="button" class="im-btn is-ghost" id="dClose">닫기</button></header>
    <div class="im-body">${isNew ? '' : `<div class="im-dsecs">
        <details class="im-dsec" id="secMail" ${sec === 'mail' ? 'open' : ''}><summary><b>제안 메일</b></summary><div class="im-dsec-body" id="mailBox"></div></details>
        <details class="im-dsec" id="secReply" ${sec === 'reply' || (r && r.review) ? 'open' : ''}><summary><b>회신</b> ${r && r.review ? tag('warn', '확인 필요') : ''}</summary><div class="im-dsec-body" id="replyBox">
          <textarea id="rRaw" rows="4" placeholder="인플루언서가 보낸 메일·Zalo 메시지를 그대로 붙여 넣으세요 (베트남어·영어·한국어)"></textarea>
          <div class="im-row" style="margin-top:6px"><button type="button" class="im-btn is-primary is-sm" id="rAuto">자동 정리</button><span class="im-muted im-small">A/B/C 답변, dd/mm 날짜, "15 triệu" 같은 비용을 찾아요</span></div>
          <div id="rAutoOut" style="margin-top:6px"></div><div class="im-stack" id="rForm" style="margin-top:8px"></div></div></details></div>`}
      <div class="im-fgrid"><label class="im-field">이름 *<input type="text" id="eName" value="${esc(o.name)}"></label>
        <label class="im-field">대표 핸들<input type="text" id="eHandle" value="${esc(o.handle)}" placeholder="@handle"></label>
        <label class="im-field">타깃<select id="eSeg">${segOptions(o.segment, '미분류')}</select></label>
        <label class="im-field">분야<select id="eCat">${C.categories.map(c => `<option ${o.category === c ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select></label>
        <label class="im-field">활동 지역<select id="eCity">${C.cities.map(c => `<option ${o.city === c ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select></label>
        <label class="im-field">이메일<input type="email" id="eEmail" value="${esc(o.email)}"></label>
        <label class="im-field">Zalo 번호/ID<input type="text" id="eZalo" value="${esc(o.zalo)}"></label>
        <label class="im-field is-wide">매니지먼트·에이전시<input type="text" id="eMgr" value="${esc(o.manager)}" placeholder="직접 계약이면 비워 두세요"></label>
        ${evField}</div>
    </div>
    <footer>${isNew ? '' : '<button type="button" class="im-btn is-danger" id="eDel">삭제</button>'}<span class="im-grow"></span><button type="button" class="im-btn" id="eCancel">취소</button><button type="button" class="im-btn is-primary" id="eSave">저장</button></footer>`;
    $('#dClose').onclick = $('#eCancel').onclick = closeDrawer;
    $('#eSave').onclick = async () => {
      const g = x => $('#' + x).value;
      const name = g('eName').trim(); if (!name) { toast('이름을 입력해 주세요'); $('#eName').focus(); return; }
      const body = { ...(isNew ? {} : { id: o.id }), name, handle: g('eHandle').trim(), segment: g('eSeg'), category: g('eCat'), city: g('eCity'), email: g('eEmail').trim(), zalo: g('eZalo').trim(), manager: g('eMgr').trim(),
        eventId: g('eEv').trim() };  // Ver_023: 채널 지표·진행 상태·날짜·메모 칸은 편집 창에서 뺐어요. 보내지 않은 값은 서버가 그대로 둬요
      const btn = $('#eSave'); btn.disabled = true;
      const saved = await saveInf(body); btn.disabled = false;
      if (saved) { toast(isNew ? '추가했어요' : '저장했어요'); closeDrawer(); }
    };
    if (!isNew) {
      const del = $('#eDel'); del.onclick = () => armButton(del, '정말 삭제할까요? 한 번 더', async () => { if (await delInf(o.id)) { toast('삭제했어요'); closeDrawer(); } });
      MAIL.render($('#mailBox'), o.id);
      const box = $('#replyBox'); S.resp.id = o.id; S.resp.draft = null;
      RESP.onSaved = s => { o.status = s.status; };
      $('#rAuto').onclick = async () => {
        const txt = $('#rRaw').value.trim(); if (!txt) { toast('회신 내용을 붙여 넣어 주세요'); return; }
        const b = $('#rAuto'); b.disabled = true; b.textContent = '정리 중…';
        try { const pr = await api('POST', 'api/parse-reply', { text: txt }); S.resp.draft = { ...pr, fee: pr.fee ?? '' };
          $('#rAutoOut').innerHTML = `<div class="im-note"><b>확인할 점</b><br>${pr.ambig.length ? pr.ambig.map(esc).join('<br>') : '특이사항 없음. 아래 내용을 확인한 뒤 [회신 저장]을 누르세요.'}</div>`;
          RESP.form(box); } catch (e) { toast(e.message); } finally { b.disabled = false; b.textContent = '자동 정리'; }
      };
      RESP.form(box);
      if (sec) setTimeout(() => $(sec === 'reply' ? '#secReply' : '#secMail')?.scrollIntoView({ block: 'start' }), 40);
    }
    d.hidden = false; $('#imScrim').hidden = false; $('#imScrim').onclick = closeDrawer; drawerOpen = true;
    if (!sec) setTimeout(() => $('#eName')?.focus(), 30);
  }
  function closeDrawer() { $('#imDrawer').hidden = true; $('#imScrim').hidden = true; drawerOpen = false; }
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && drawerOpen) closeDrawer(); });

  /* ================= 제안 메일 ================= */
  function mailFor(i, lang) {
    const s = S.settings, m = mainPf(i), ch = m ? `${PFN[m.k]}${i.handle ? ' ' + i.handle : ''}` : (i.handle || '');
    const by = [s.sender, s.company].filter(Boolean), contact = [s.senderEmail, s.senderZalo ? 'Zalo: ' + s.senderZalo : ''].filter(Boolean).join(' | ');
    const dl = s.deadline ? fmtDV(s.deadline) : '', brand = s.brandVi || s.brand;
    if (lang === 'vi') return { subj: `[Hợp tác] ${brand} × ${i.name} – Đề xuất quảng bá ${s.productVi} tại Việt Nam`, body: `Chào ${i.name},

Mình là ${s.sender || '[tên người gửi]'}, phụ trách marketing quốc tế của ${s.company || '[tên công ty]'} (Hàn Quốc). Chúng mình rất thích nội dung trên kênh ${ch || 'của bạn'} và muốn mời bạn hợp tác giới thiệu ${s.productVi} của thương hiệu ${brand} tới khán giả Việt Nam.

■ Nội dung hợp tác
- Hình thức: video/bài đăng trên kênh ${m ? PFN[m.k] : 'của bạn'}
- Sản phẩm mẫu: gửi miễn phí trước ngày quay
- Thù lao: ${s.feeVi}
- Thời gian dự kiến: ${s.period}

■ Hướng dẫn quảng cáo (tóm tắt)
${s.guideVi}

■ Bạn vui lòng trả lời email này theo mẫu dưới đây${s.formLink ? ' hoặc chọn nhanh tại: ' + s.formLink : ''}
1) Khả năng hợp tác: A. Có thể / B. Có thể, kèm điều kiện / C. Không thể
2) Ngày có thể trao đổi chi tiết (dd/mm/yyyy):
3) Ngày có thể quay (dd/mm/yyyy):
4) Ngày có thể đăng bài (dd/mm/yyyy):
5) Mức thù lao mong muốn (VND):
6) Ý kiến khác:
${dl ? `\nMong nhận được phản hồi của bạn trước ngày ${dl}.\n` : ''}
Trân trọng,
${by.join('\n') || '[tên người gửi]'}
${contact}`.replace(/\n{3,}/g, '\n\n') };
    if (lang === 'en') return { subj: `[Collaboration] ${brand} × ${i.name} – ${s.productEn} in Vietnam`, body: `Hi ${i.name},

I'm ${s.sender || '[sender name]'}, global marketing at ${s.company || '[company]'} (Korea). We enjoy your content on ${ch || 'your channel'} and would like to invite you to introduce ${s.productEn} from ${brand} to your audience in Vietnam.

■ Collaboration
- Format: video/post on your ${m ? PFN[m.k] : ''} channel
- Product samples: sent free of charge before filming
- Fee: ${s.feeEn}
- Planned period: ${s.period}

■ Ad guidelines (summary)
${s.guideEn}

■ Please reply to this email using the form below${s.formLink ? ' or answer quickly here: ' + s.formLink : ''}
1) Availability: A. Yes / B. Yes, with conditions / C. No
2) Dates you can discuss details (dd/mm/yyyy):
3) Dates you can film (dd/mm/yyyy):
4) Dates you can post (dd/mm/yyyy):
5) Your fee (VND):
6) Other comments:
${dl ? `\nWe'd appreciate your reply by ${dl}.\n` : ''}
Best regards,
${by.join('\n') || '[sender name]'}
${contact}`.replace(/\n{3,}/g, '\n\n') };
    return { subj: `[협업 제안] ${s.brand} × ${i.name} – ${s.product} 베트남 홍보 협업`, body: `${i.name} 님 안녕하세요,

${s.company || '[회사명]'} 해외마케팅 담당 ${s.sender || '[담당자]'}입니다. ${ch || '채널'}의 콘텐츠를 인상 깊게 보고, ${s.brand} ${s.product}를 베트남 시청자에게 소개하는 협업을 제안드립니다.

■ 협업 내용
- 형식: ${m ? PFN[m.k] : ''} 채널 영상·게시물
- 제품 샘플: 촬영 전 무료 발송
- 비용: ${s.feeText}
- 예정 기간: ${s.period}

■ 광고 가이드라인 (요약)
${s.guideKo}

■ 아래 양식으로 회신 부탁드립니다${s.formLink ? ' (빠른 선택: ' + s.formLink + ')' : ''}
1) 협업 가능 여부: A. 가능 / B. 조건부 가능 / C. 불가
2) 세부 협의 가능 날짜 (일/월/연):
3) 촬영 가능 날짜:
4) 게시 가능 날짜:
5) 희망 비용 (VND):
6) 기타 의견:
${dl ? `\n${s.deadline}까지 회신 주시면 감사하겠습니다.\n` : ''}
감사합니다.
${[...by].reverse().join(' ') || '[담당자]'}
${contact}`.replace(/\n{3,}/g, '\n\n') };
  }
  /* 번역 (Ver_022): 파파고처럼 [원문 언어] ⇄ [번역 언어] → 대시보드 안에서 MyMemory 번역(무료·키 없음). 실패하면 Google 번역 새 창 링크 */
  const TR_LANGS = [['ko', '한국어'], ['en', '영어'], ['vi', '베트남어']];
  const trOpts = cur => TR_LANGS.map(([k, n]) => `<option value="${k}" ${k === cur ? 'selected' : ''}>${n}</option>`).join('');
  const trWidget = (id, src, tgt, label) => `<div class="im-tr" data-tr="${id}"><div class="im-row" style="gap:6px">
      <select class="im-tr-s" aria-label="원문 언어" style="width:auto">${trOpts(src)}</select><button type="button" class="im-btn is-sm im-tr-swap" title="언어 바꾸기" aria-label="원문·번역 언어 바꾸기">⇄</button>
      <select class="im-tr-t" aria-label="번역 언어" style="width:auto">${trOpts(tgt)}</select><button type="button" class="im-btn is-sm im-tr-go">${label}</button></div>
    <p class="im-muted im-small" style="margin:4px 0 0">번역할 글은 무료 번역 서비스(MyMemory)로 전송돼요 · 하루 5,000자까지</p><div class="im-tr-out"></div></div>`;
  function bindTr(root, getText) {
    if (!root) return;
    const s = $('.im-tr-s', root), tg = $('.im-tr-t', root), out = $('.im-tr-out', root), go = $('.im-tr-go', root);
    $('.im-tr-swap', root).onclick = () => { const x = s.value; s.value = tg.value; tg.value = x; };
    go.onclick = async () => {
      const txt = String(getText() || '').trim(), sl = s.value, tl = tg.value;
      if (!txt) { toast('번역할 글이 없어요'); return; }
      if (sl === tl) { toast('원문 언어와 번역 언어가 같아요. 다른 언어를 고르세요'); return; }
      const g = `https://translate.google.com/?sl=${sl}&tl=${tl}${txt.length <= 5000 ? '&text=' + encodeURIComponent(txt) : ''}&op=translate`;
      go.disabled = true; out.innerHTML = '<p class="im-muted im-small" style="margin:6px 0 0">번역 중… 긴 글은 나눠 보내서 몇 초 걸려요</p>';
      try {
        const r = await api('POST', 'api/translate', { text: txt, source: sl, target: tl });
        out.innerHTML = `<div class="im-tr-box"><pre>${esc(r.translated)}</pre><div class="im-row" style="gap:6px"><button type="button" class="im-btn is-sm im-tr-cp">번역 복사</button><span class="im-muted im-small">기계 번역 · MyMemory${r.chunks > 1 ? ` · ${r.chunks}번 나눠 번역` : ''}${r.cached ? ' · 앞서 번역한 결과' : ''} · 발송 전 현지 검수 권장</span></div></div>`;
        $('.im-tr-cp', out).onclick = () => copyText(r.translated, '번역', $('pre', out));
      } catch (e) { out.innerHTML = `<div class="im-note" style="margin-top:6px">${esc(e.message)} <a href="${esc(g)}" target="_blank" rel="noopener">Google 번역 새 창으로 열기</a></div>`; }
      finally { go.disabled = false; }
    };
  }
  const SENDER_FIELDS = [['company', '회사명'], ['sender', '보내는 사람'], ['senderEmail', '회신 이메일', 'email'], ['senderZalo', '회사 Zalo'], ['period', '예정 기간'], ['deadline', '회신 기한', 'date']];
  // 화면 시연용 표시값: 이메일 주소가 없는 실제 후보(NoxInfluencer)에만 적용합니다. 연락처로 검증한 값이 아닙니다 (Ver_020 유지).
  const displayContact = i => {
    if (i.email) return { value: i.email, demo: false };
    if (!String(i.notes || '').includes('발굴: NoxInfluencer')) return { value: '', demo: false };
    const n = String(i.name || 'creator').replace(/[Đđ]/g, 'd').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
      .replace(/[^a-z0-9]+/g, '.').replace(/^\.+|\.+$/g, '').slice(0, 32) || 'creator';
    return { value: `${n}@gmaiI.com`, demo: true }; // gmaiI: 마지막 글자는 대문자 I
  };
  /* 편집 창 [제안 메일] (Ver_021: 제안 메일 탭을 없애고 사람마다 여기서) */
  const MAIL = {
    render(box, id) {
      const i = S.inf.get(id); if (!i || !box) return;
      const m = mailFor(i, S.mail.lang), to = displayContact(i), s = S.settings;
      box.innerHTML = `<div class="im-row" style="gap:6px"><select id="mLang" aria-label="메일 언어" style="width:auto">${[['vi', '베트남어'], ['en', '영어'], ['ko', '한국어(검토용)']].map(([k, n]) => `<option value="${k}" ${S.mail.lang === k ? 'selected' : ''}>${n}</option>`).join('')}</select>
          <button type="button" class="im-btn is-primary is-sm" id="mCpB">본문 복사</button>
          ${(i.status || 'candidate') === 'candidate' ? '<button type="button" class="im-btn is-sm" id="mSent">제안 발송으로 표시</button>' : `<span class="im-small">${tag('send', '발송 ' + (fmtD((i.sentAt || '').slice(0, 10)) || ''))}</span>${i.status === 'sent' ? '<button type="button" class="im-btn is-sm is-ghost" id="mUnsend" title="잘못 눌렀을 때 후보로 되돌려요">발송 취소</button>' : ''}`}</div>
        <p class="im-small im-muted" style="margin:6px 0 0">받는 사람: ${to.value ? esc(to.value) : '이메일 없음 · 아래 기본 정보의 이메일 칸에 넣으세요'}</p>
        <details class="im-fold" style="margin-top:8px"><summary>미리보기 열기</summary><div class="im-mail" style="margin-top:6px"><div class="im-subj"><span id="mSubj">${esc(m.subj)}</span></div><pre id="mBody">${esc(m.body)}</pre></div></details>
        <div style="margin-top:8px">${trWidget('mail', S.mail.lang, S.mail.lang === 'ko' ? 'vi' : 'ko', '메일 번역')}</div>
        <details class="im-fold" style="margin-top:8px"><summary>보내는 사람 정보 ${s.company || s.sender ? `<span class="im-muted im-small">${esc([s.company, s.sender].filter(Boolean).join(' · '))}</span>` : ''}</summary>
          <div class="im-fgrid" style="margin-top:6px">${SENDER_FIELDS.map(([k, n, ty]) => `<label class="im-field">${n}<input type="${ty || 'text'}" data-sf="${k}" value="${esc(s[k] || '')}"></label>`).join('')}</div>
          <div class="im-row" style="margin-top:6px"><button type="button" class="im-btn is-sm" id="mSfSave">저장 (모든 메일에 적용)</button><span class="im-muted im-small">브랜드·제품·비용·광고 가이드라인은 메일 본문에 들어가 있어요</span></div></details>`;
      $('#mLang', box).onchange = e => { S.mail.lang = e.target.value; this.render(box, id); };
      $('#mCpB', box).onclick = () => copyText(m.body, '본문', $('#mBody', box));
      const ms = $('#mSent', box); if (ms) ms.onclick = async () => { const sv = await saveInf({ id, status: 'sent', sentAt: i.sentAt || new Date().toISOString().slice(0, 19) });
        if (sv) { toast('제안 발송으로 표시했어요'); this.render(box, id); } };
      bindTr($('[data-tr="mail"]', box), () => `${m.subj}\n\n${m.body}`);
      const un = $('#mUnsend', box); if (un) un.onclick = () => {
        if (S.inf.get(id)?.resp) { toast('회신이 저장돼 있어 발송을 취소할 수 없어요. [회신] 칸에서 회신을 먼저 삭제하세요'); return; }
        armButton(un, '한 번 더 누르면 취소', async () => { const sv = await saveInf({ id, status: 'candidate', sentAt: '' });
          if (sv) { toast('발송을 취소했어요. 다시 후보로 돌아갔어요'); this.render(box, id); } }); };
      $('#mSfSave', box).onclick = async () => { const o = {}; $$('[data-sf]', box).forEach(x => { o[x.dataset.sf] = x.value.trim(); }); if (await saveSettings(o)) { toast('보내는 사람 정보를 저장했어요'); this.render(box, id); } };
    },
  };

  /* ================= 회신 정리 ================= */
  const FORMATS = C.formats;
  const blankResp = () => ({ avail: '', neg: [], shoot: [], post: '', fee: '', cur: 'VND', formats: [], note: '', raw: '', ambig: [], via: 'manual' });
  /* 편집 창 [회신] (Ver_021: 회신 정리 탭을 없애고 사람마다 여기서). v = 편집 창의 회신 칸 */
  const RESP = {
    onSaved: null,
    form(v) {
      this._for = S.resp.id; const i = S.inf.get(S.resp.id), box = $('#rForm', v);
      if (!i) { box.innerHTML = '<div class="im-empty">인플루언서를 먼저 등록하세요</div>'; return; }
      const r = S.resp.draft || { ...blankResp(), ...JSON.parse(JSON.stringify(i.resp || {})) };
      r.neg = r.neg || []; r.shoot = r.shoot || []; r.formats = r.formats || []; if (r.fee == null) r.fee = '';
      const dateBlock = (k, label) => `<div><div class="im-eyebrow">${label}</div><div class="im-dates">${r[k].map(d => `<span class="im-chip">${fmtDV(d)}<button type="button" aria-label="${d} 삭제" data-del="${k}|${d}">×</button></span>`).join('') || '<span class="im-faint im-small">아직 없음</span>'}</div>
        <div class="im-adder"><input type="date" id="a_${k}" aria-label="${label} 추가"><button type="button" class="im-btn is-sm" data-add="${k}">추가</button></div></div>`;
      box.innerHTML = `${S.resp.draft ? '<div class="im-banner is-info" style="margin:0"><b>저장 전</b><div class="im-grow">내용을 확인하고 저장하세요.</div></div>' : ''}
        <div><div class="im-eyebrow">협업 가능 여부</div><div class="im-seg" id="rAv"><button type="button" class="is-yes" data-v="yes" aria-pressed="${r.avail === 'yes'}">가능</button><button type="button" class="is-cond" data-v="cond" aria-pressed="${r.avail === 'cond'}">조건부 가능</button><button type="button" class="is-no" data-v="no" aria-pressed="${r.avail === 'no'}">불가</button></div></div>
        ${dateBlock('neg', '협의 가능 날짜')}${dateBlock('shoot', '촬영 가능 날짜')}
        <div class="im-fgrid"><label class="im-field">게시 가능일<input type="date" id="rPost" value="${esc(r.post)}"></label>
          <label class="im-field">희망 비용<input type="number" min="0" id="rFee" value="${esc(r.fee)}"></label>
          <label class="im-field">통화<select id="rCur">${['VND', 'USD', 'KRW'].map(c => `<option ${r.cur === c ? 'selected' : ''}>${c}</option>`).join('')}</select></label></div>
        <div><div class="im-eyebrow">가능한 콘텐츠 형식</div><div class="im-seg" id="rFm">${FORMATS.map(f => `<button type="button" data-f="${esc(f)}" aria-pressed="${r.formats.includes(f)}">${esc(f)}</button>`).join('')}</div></div>
        <label class="im-field">기타 의견·조건<textarea id="rNote" rows="3">${esc(r.note)}</textarea></label>
        <div><div class="im-eyebrow">${r.raw ? '회신 원문 번역' : '기타 의견 번역'} <span class="im-muted" style="text-transform:none;letter-spacing:0;font-weight:400">· 저장되는 내용은 원문 그대로예요</span></div>${trWidget('reply', 'vi', 'ko', '번역')}</div>
        ${r.raw ? `<details><summary class="im-muted im-small">원문 보기</summary><pre class="im-raw">${esc(r.raw)}</pre></details>` : ''}
        <div class="im-row"><button type="button" class="im-btn is-primary" id="rSave">${i.resp ? '회신 수정 저장' : '회신 저장'}</button>${i.resp ? '<button type="button" class="im-btn" id="rDel">회신 삭제</button>' : ''}<span class="im-muted im-small">저장하면 상태가 '회신 받음'(불가면 '불가·보류')으로 바뀌어요</span></div>`;
      const keep = () => { r.post = $('#rPost', v).value; r.fee = $('#rFee', v).value; r.cur = $('#rCur', v).value; r.note = $('#rNote', v).value; S.resp.draft = r; };
      $$('#rAv button', v).forEach(b => { b.onclick = () => { r.avail = b.dataset.v; $$('#rAv button', v).forEach(x => x.setAttribute('aria-pressed', x === b)); keep(); }; });
      $$('#rFm button', v).forEach(b => { b.onclick = () => { const f = b.dataset.f; r.formats = r.formats.includes(f) ? r.formats.filter(x => x !== f) : [...r.formats, f]; b.setAttribute('aria-pressed', r.formats.includes(f)); keep(); }; });
      $$('[data-add]', v).forEach(b => { b.onclick = () => { const k = b.dataset.add, d = $('#a_' + k, v).value; if (!d) { toast('날짜를 고르세요'); return; } keep(); if (!r[k].includes(d)) r[k] = [...r[k], d].sort(); this.form(v); }; });
      $$('[data-del]', v).forEach(b => { b.onclick = () => { const [k, d] = b.dataset.del.split('|'); keep(); r[k] = r[k].filter(x => x !== d); this.form(v); }; });
      ['rPost', 'rFee', 'rCur', 'rNote'].forEach(id => { $('#' + id, v).oninput = keep; });
      bindTr($('[data-tr="reply"]', v), () => r.raw || $('#rNote', v).value);
      $('#rSave', v).onclick = async () => {
        keep(); if (!r.avail) { toast('협업 가능 여부를 골라 주세요'); return; }
        const saved = await saveReply(i.id, { ...r, via: r.via || 'manual' });
        if (saved) { S.resp.draft = null; this._for = null; const raw = $('#rRaw', v); if (raw) raw.value = ''; $('#rAutoOut', v).innerHTML = ''; if (this.onSaved) this.onSaved(saved); toast('회신을 저장했어요'); this.form(v); }
      };
      const del = $('#rDel', v); if (del) del.onclick = () => armButton(del, '한 번 더 누르면 회신 삭제', async () => {
        try { const saved = await api('DELETE', `api/influencers/${encodeURIComponent(i.id)}/reply`); S.inf.set(saved.id, saved); S.resp.draft = null; this._for = null; refresh(); if (this.onSaved) this.onSaved(saved); this.form(v); toast('회신을 삭제했어요. 상태를 제안 발송으로 되돌렸어요'); }
        catch (e) { toast(e.message); } });
    },
  };

  /* ================= 광고 단가 ================= */
  function quoteMetrics(q) {
    const i = S.inf.get(q.infId), p = ((i || {}).pf || {})[q.platform] || {};
    const fol = +(q.followers || p.f || 0), exp = +(q.expViews || p.v || 0), usd = toUsd(q.amount, q.cur), vnd = toVnd(q.amount, q.cur), tier = fol ? tierOf(fol) : null;
    return { i, fol, exp, usd, vnd, cpm: exp ? vnd / exp * 1000 : null, perK: fol ? vnd / fol * 1000 : null, cpv: q.actualViews ? vnd / q.actualViews : null, tier };
  }
  const RATE_SRC = 'https://bestmartech.vn/pages/pricing';
  const tierRange = t => t.usd[1] ? `$${t.usd[0].toLocaleString()}–${t.usd[1].toLocaleString()}` : `$${t.usd[0].toLocaleString()}~`;
  VIEWS.rates = {
    mount(v) {
      S.qEdit = null;
      // Ver_023: 입력 칸은 [+ 단가 기록]·[수정]을 누를 때만 펼치고, '단가 산출 기준' 카드는 없앴어요 (환율은 표 아래 한 줄)
      v.innerHTML = `<div class="im-panel" style="margin-bottom:var(--space-6)"><h2>단가 기록 <small>1천회당·1천명당·CPV는 VND</small><span class="im-grow"></span><button type="button" class="im-btn is-primary is-sm" id="qNew">+ 단가 기록</button><a class="im-btn is-sm" href="${API}export/quotes.csv">단가 기록 CSV</a></h2>
          <div class="im-tblwrap is-scroll is-short"><table><thead><tr><th>관리</th><th>인플루언서</th><th>채널·형식·구분</th><th class="r">금액 (USD 환산)</th><th class="r">조회 1천회당</th><th class="r">팔로워 1천명당</th><th class="r">CPV</th><th>규모</th></tr></thead><tbody id="qBody"></tbody></table></div>
          <div class="im-row im-small" style="margin-top:8px;gap:6px"><span>환율 1 USD =</span><input type="number" id="xV" value="${esc(S.settings.vndPerUsd)}" aria-label="1달러당 동" style="width:110px"><span>VND ·</span><input type="number" id="xK" value="${esc(S.settings.krwPerUsd)}" aria-label="1달러당 원" style="width:90px"><span>KRW</span><button type="button" class="im-btn is-sm" id="xSave">저장</button><span id="xState"></span></div></div>
      <div class="im-panel" id="qFormP" style="margin-bottom:var(--space-6)" hidden><h2 id="qFormT">단가 기록 추가</h2><div class="im-fgrid">
          <label class="im-field is-wide">인플루언서<select id="qInf"></select></label>
          <label class="im-field">채널<select id="qPf">${PF.map(p => `<option value="${p.k}">${p.n}</option>`).join('')}</select></label>
          <label class="im-field">형식<select id="qFmt">${FORMATS.map(f => `<option>${esc(f)}</option>`).join('')}</select></label>
          <label class="im-field">구분<select id="qLayer">${Object.entries(LAYERS).map(([k, n]) => `<option value="${k}" ${k === 'quote' ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
          <label class="im-field">받은 날짜<input type="date" id="qDate" value="${today()}"></label>
          <label class="im-field">금액<input type="number" min="0" id="qAmt"></label>
          <label class="im-field">통화<select id="qCur"><option>VND</option><option>USD</option><option>KRW</option></select></label>
          <label class="im-field">예상 조회수 (비우면 채널 중앙값)<input type="number" min="0" id="qExp"></label>
          <label class="im-field">실제 조회수 (게시 후)<input type="number" min="0" id="qAct"></label>
          <label class="im-field is-wide">포함 조건<input type="text" id="qCond" placeholder="예: VAT 별도, 2차 활용 3개월, 배송비 별도"></label></div>
          <div class="im-row" style="margin-top:12px"><button type="button" class="im-btn is-primary" id="qAdd">추가</button><button type="button" class="im-btn" id="qCancel">취소</button></div></div>
      <div class="im-panel im-chart"><h2>받은 견적과 공개 참고가</h2><div id="rChart"></div>
          <div class="im-legend"><span><i style="background:var(--im-accent-soft);border:1px solid var(--im-accent)"></i>공개 참고가 구간</span><span><i style="background:var(--im-warn);border-radius:50%"></i>견적</span><span><i style="background:var(--im-bean);border-radius:50%"></i>계약가</span><span><i style="background:var(--im-faint);border-radius:50%"></i>기타 공개가</span></div>
          <p class="im-faint im-small" style="margin:6px 0 0">공개 참고가: <a href="${RATE_SRC}" target="_blank" rel="noopener">Best Martech 2026 가격표</a> (게시물 1건 · USD · VAT 별도, 평균값·계약가 아님)</p></div>`;
      const qi = $('#qInf', v); qi.onchange = () => { const i = S.inf.get(qi.value), m = i && mainPf(i); if (m && !S.qEdit) $('#qPf', v).value = m.k; };
      const body = () => ({ ...(S.qEdit ? { id: S.qEdit } : {}), infId: qi.value, platform: $('#qPf', v).value, format: $('#qFmt', v).value, layer: $('#qLayer', v).value, date: $('#qDate', v).value, amount: $('#qAmt', v).value, cur: $('#qCur', v).value, expViews: $('#qExp', v).value, actualViews: $('#qAct', v).value, cond: $('#qCond', v).value.trim() });
      $('#qAdd', v).onclick = () => {
        const b = body(); if (!b.infId) { toast('인플루언서를 고르세요'); return; } if (!+b.amount) { toast('금액을 입력하세요'); return; }
        const run = async () => { this._okAt = 0; const editing = !!S.qEdit; if (await saveQuote(b)) { toast(editing ? '단가 기록을 고쳤어요' : '단가 기록을 추가했어요'); this.resetForm(v); } };
        // 이상값이면 한 번 더 눌러야 저장 (4초 안에). 버튼 글자는 바꾸지 않아요
        if (isOutlier(quoteMetrics(b)) && !(this._okAt && Date.now() - this._okAt < 4000)) { this._okAt = Date.now(); toast('이상값 같아요. 통화·자릿수를 확인했으면 버튼을 한 번 더 누르세요'); return; }
        run();
      };
      $('#qCancel', v).onclick = () => this.resetForm(v);
      $('#qNew', v).onclick = () => { this.resetForm(v); $('#qFormP', v).hidden = false; $('#qFormP', v).scrollIntoView({ behavior: 'smooth', block: 'nearest' }); $('#qInf', v).focus(); };
      $('#xSave', v).onclick = async () => { const a = +$('#xV', v).value, b = +$('#xK', v).value; if (!a || !b) { toast('환율을 숫자로 입력하세요'); return; } if (await saveSettings({ vndPerUsd: a, krwPerUsd: b, rateConfirm: true })) { toast('환율을 저장했어요'); this.rateState(v); } };
      this.rateState(v);
    },
    resetForm(v) {
      S.qEdit = null; $('#qFormT', v).textContent = '단가 기록 추가'; $('#qAdd', v).textContent = '추가'; $('#qFormP', v).hidden = true;
      ['qAmt', 'qExp', 'qAct', 'qCond'].forEach(id => { $('#' + id, v).value = ''; }); $('#qDate', v).value = today(); this.update(v);
    },
    edit(v, id) {
      const q = S.quotes.get(id); if (!q) return; S.qEdit = id; this.update(v);
      const set = (k, val) => { $('#' + k, v).value = val ?? ''; };
      set('qInf', q.infId); set('qPf', q.platform); set('qFmt', q.format || FORMATS[0]); set('qLayer', q.layer || 'quote'); set('qDate', q.date); set('qAmt', q.amount); set('qCur', q.cur || 'VND');
      set('qExp', q.expViews); set('qAct', q.actualViews); set('qCond', q.cond);
      $('#qFormT', v).textContent = `단가 기록 수정 · ${(S.inf.get(q.infId) || {}).name || q.name || ''}`; $('#qAdd', v).textContent = '수정 저장'; $('#qFormP', v).hidden = false;
      $('#qFormP', v).scrollIntoView({ behavior: 'smooth', block: 'nearest' }); $('#qAmt', v).focus();
    },
    rateState(v) {
      const d = S.settings.rateSavedAt, el = $('#xState', v); if (!el) return;
      el.innerHTML = d ? `<span class="im-muted">입력일 ${esc(d)}</span>` : '';
    },
    update(v) {
      const L = infList().sort((a, b) => a.name.localeCompare(b.name)), qi = $('#qInf', v), cur = qi.value;
      qi.innerHTML = '<option value="">선택</option>' + L.map(i => `<option value="${esc(i.id)}" ${i.id === cur ? 'selected' : ''}>${esc(i.name)}</option>`).join('');
      const Q = [...S.quotes.values()].sort((a, b) => (b.date || '').localeCompare(a.date || ''));
      // Ver_023: '시연'·'입력 확인 필요' 칩과 판정(낮음·적정·높음)을 빼고, 마지막 열은 규모(팔로워 기준, 마우스를 올리면 공개 참고가 구간)
      $('#qBody', v).innerHTML = Q.length ? Q.map(q => { const m = quoteMetrics(q); return `<tr ${S.qEdit === q.id ? 'class="is-editing"' : ''}>
          <td><div class="im-acts"><button type="button" class="im-btn is-sm" data-qe="${esc(q.id)}">수정</button><button type="button" class="im-btn is-sm is-ghost" data-qd="${esc(q.id)}">삭제</button></div></td>
          <td><b>${esc(m.i?.name || q.name || '삭제됨')}</b><div class="im-sub">${esc(q.date || '')}${q.cond ? ' · ' + esc(q.cond) : ''}</div></td>
          <td><span class="im-pf pf-${q.platform}"><i></i>${PFN[q.platform] || ''}</span><div class="im-sub">${esc(q.format || '')} · ${LAYERS[q.layer] || ''}</div></td>
          <td class="r im-num">${grp(q.amount)} <span class="im-faint">${esc(q.cur)}</span><div class="im-sub">$${grp(m.usd)}</div></td>
          <td class="r im-num">${m.cpm != null ? grp(m.cpm) + ' VND' : '–'}</td><td class="r im-num">${m.perK != null ? grp(m.perK) + ' VND' : '–'}</td><td class="r im-num">${m.cpv != null ? grp(m.cpv) + ' VND' : '–'}</td>
          <td>${m.tier ? `<span title="공개 참고가 ${tierRange(m.tier)}">${m.tier.n}</span>` : '<span class="im-faint">–</span>'}</td></tr>`; }).join('')
        : '<tr><td colspan="8"><div class="im-empty" style="border:0">[+ 단가 기록]으로 받은 견적·계약 금액을 추가하세요.</div></td></tr>';
      $$('[data-qd]', v).forEach(b => { b.onclick = () => armButton(b, '확인', async () => { if (await delQuote(b.dataset.qd)) { if (S.qEdit === b.dataset.qd) this.resetForm(v); toast('삭제했어요'); } }); });
      $$('[data-qe]', v).forEach(b => { b.onclick = () => this.edit(v, b.dataset.qe); });
      this.chart(v, Q); this.rateState(v);
    },
    chart(v, Q) {
      const W = 640, H = 300, ml = 70, mr = 14, mt = 12, mb = 34, x0 = 3, x1 = 7, y0 = 1, y1 = 5;
      const X = f => ml + (Math.log10(Math.max(f, 10 ** x0)) - x0) / (x1 - x0) * (W - ml - mr), Y = u => mt + (1 - (Math.log10(Math.min(Math.max(u, 10 ** y0), 10 ** y1)) - y0) / (y1 - y0)) * (H - mt - mb);
      let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="팔로워 대비 게시물 단가 산점도">`;
      for (let e = y0; e <= y1; e++) s += `<line class="im-ax" x1="${ml}" x2="${W - mr}" y1="${Y(10 ** e)}" y2="${Y(10 ** e)}" stroke-width="1"/><text x="${ml - 6}" y="${Y(10 ** e) + 4}" text-anchor="end">$${short(10 ** e)}</text>`;
      for (let e = x0; e <= x1; e++) s += `<line class="im-ax" y1="${mt}" y2="${H - mb}" x1="${X(10 ** e)}" x2="${X(10 ** e)}" stroke-width="1"/><text x="${X(10 ** e)}" y="${H - mb + 16}" text-anchor="middle">${short(10 ** e)}</text>`;
      s += `<text class="im-axl" x="${(ml + W - mr) / 2}" y="${H - 4}" text-anchor="middle">해당 채널 팔로워</text><text class="im-axl" transform="rotate(-90)" x="${-(mt + (H - mt - mb) / 2)}" y="12" text-anchor="middle">게시물 1건 비용(USD)</text>`;
      TIERS.forEach(t => { const xa = X(Math.max(t.min, 1e3)), xb = X(Math.min(t.max, 1e7)), ya = Y(t.usd[1] || 1e5), yb = Y(t.usd[0]);
        s += `<rect x="${xa}" y="${ya}" width="${xb - xa}" height="${yb - ya}" style="fill:var(--im-accent-soft);stroke:var(--im-accent)" stroke-width="1" ${t.usd[1] ? '' : 'stroke-dasharray="3 3"'} opacity=".9"/><text x="${(xa + xb) / 2}" y="${yb - 5}" text-anchor="middle" style="fill:var(--im-accent)">${t.n}</text>`; });
      Q.forEach(q => { const m = quoteMetrics(q); if (!m.fol || !m.usd) return; const c = q.layer === 'contract' ? 'var(--im-bean)' : q.layer === 'quote' ? 'var(--im-warn)' : 'var(--im-faint)';
        s += `<circle cx="${X(m.fol)}" cy="${Y(m.usd)}" r="5.5" style="fill:${c};stroke:var(--im-surface)" stroke-width="1.5"><title>${esc(m.i?.name || q.name)} · ${short(m.fol)} · $${grp(m.usd)}</title></circle>`; });
      $('#rChart', v).innerHTML = s + '</svg>';
    },
  };

  /* ================= 발굴 (외부 후보 → 기존 DB) · 하위 탭 3개 (Ver_017) ================= */
  /* 베트남어 검색어 예시 (한국어 뜻) — 누르면 검색칸에 들어가요 */
  const VI_KEYWORDS = [
    ['bánh mochi Hàn Quốc', '한국 모찌(찹쌀떡)'], ['review bánh Hàn Quốc', '한국 빵·디저트 리뷰'], ['ăn thử đồ Hàn', '한국 음식 먹어 보기'],
    ['review đồ ăn Hàn Quốc', '한국 음식 리뷰'], ['đồ ăn vặt Hàn Quốc', '한국 간식'], ['món tráng miệng', '디저트'],
    ['mukbang', '먹방'], ['review đồ ăn vặt', '간식 리뷰'], ['đập hộp đồ ăn vặt', '간식 언박싱'], ['vlog ăn uống', '먹방 브이로그'],
    ['review quán ăn Sài Gòn', '호치민 맛집 리뷰'], ['review quán ăn Hà Nội', '하노이 맛집 리뷰'], ['quà Tết', '뗏(설) 선물'], ['bánh Trung thu', '중추절 월병·과자'],
  ];
  const kwChips = target => `<div class="im-kw" data-kw-for="${target}"><span class="im-muted im-small">자주 쓰는 베트남어 검색어 — 누르면 검색칸에 들어가요 (여러 개 고르면 | 로 이어져요)</span>
    <div class="im-kw-list">${VI_KEYWORDS.map(([vi, ko]) => `<button type="button" data-kw="${esc(vi)}" title="${esc(ko)}"><b lang="vi">${esc(vi)}</b><span>${esc(ko)}</span></button>`).join('')}</div></div>`;
  function bindKw(root) {
    $$('.im-kw', root).forEach(box => {
      const inp = $('#' + box.dataset.kwFor, root);
      $$('[data-kw]', box).forEach(b => { b.onclick = () => {
        const cur = inp.value.split('|').map(x => x.trim()).filter(Boolean), kw = b.dataset.kw;
        const next = cur.includes(kw) ? cur.filter(x => x !== kw) : [...cur, kw];
        inp.value = next.join(' | '); inp.dispatchEvent(new Event('input')); inp.focus();
        $$('[data-kw]', box).forEach(x => x.setAttribute('aria-pressed', next.includes(x.dataset.kw)));
      }; });
    });
  }
  const needUrl = i => Object.values(i.pf || {}).some(ch => ch && ch.need_url && !ch.url);
  const SL_ORDER = ['TikTok', 'Instagram', 'YouTube', 'Facebook', 'Google'];
  const searchLinks = r => r.search_links && Object.keys(r.search_links).length ? `<div class="im-sub">직접 찾기: ${SL_ORDER.filter(k => r.search_links[k]).map(k => `<a href="${esc(r.search_links[k])}" target="_blank" rel="noopener">${k}</a>`).join(' · ')}</div>` : '';
  /* 화면에 보이는 조회 방법: YouTube Data API + 참고 자료 CSV(NoxInfluencer).
     Modash·HypeAuditor·Phyllo·TikTok One 연결 코드는 discovery.py·external_api.py에 그대로 있고 화면에서만 뺐어요 (Ver_017) */
  const shownProvider = p => p.key === 'youtube' || p.ref;
  const TTO_URL = 'https://ads.tiktok.com/creative';
  const DSUBS = [['find', '후보 탐색'], ['manual', '직접 등록']];  // Ver_023: '파일 자동 정제' 하위 탭은 화면에서 뺌 (/api/discovery/import-csv 경로는 그대로)
  const SORTS = [['base', '기본 순서'], ['fol', '인기순'], ['views', '조회수 순']];
  S.disc = S.disc || { platform: 'tt', provider: '', cats: ['Dessert', 'Korean Food'], rows: [], sel: new Set(), meta: null, source: '', segment: '', sub: 'find', sort: 'base', tier: '', country: 'Vietnam', language: 'vi' };
  const SEGS = C.segments || [];
  const segOf = name => SEGS.find(x => x.name === name);
  VIEWS.discover = {
    mount(v) {
      const D = S.disc;
      v.innerHTML = `<div class="im-subtabs" role="tablist" id="dSubs">${DSUBS.map(([k, n], i) => `<button type="button" role="tab" data-sub="${k}" aria-selected="${D.sub === k}"><b>${i + 1}. ${n}</b></button>`).join('')}</div>
      <div class="im-panel" data-pane="find">
        <div class="im-fgrid"><label class="im-field is-span2">분야<select id="dSeg">${segOptions(D.segment, '선택하지 않음')}</select></label></div>
        <div class="im-fgrid" style="margin-top:12px">
          <label class="im-field">플랫폼<select id="dPf">${[['tt', 'TikTok'], ['ig', 'Instagram'], ['yt', 'YouTube'], ['fb', 'Facebook']].map(([k, n]) => `<option value="${k}" ${D.platform === k ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
          <label class="im-field is-span2">조회할 곳<select id="dProv"></select></label>
          <label class="im-field">규모<select id="dTier"><option value="">전체</option>${TIERS.map(t => `<option value="${t.k}" ${D.tier === t.k ? 'selected' : ''}>${t.n} (${t.label})</option>`).join('')}</select></label>
          <label class="im-field is-span2">정렬<select id="dSort">${SORTS.map(([k, n]) => `<option value="${k}" ${D.sort === k ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
          <label class="im-field is-wide" id="dKwWrap">YouTube 검색어<input type="text" id="dKw" placeholder="비우면 타깃 그룹에 맞는 검색어를 써요"></label></div>
        <details class="im-fold" id="dKwEx"><summary>베트남어 검색어 예시</summary>${kwChips('dKw')}</details>
        <div class="im-row" style="margin-top:12px"><button type="button" class="im-btn is-primary" id="dGo">후보 검색</button><span class="im-muted im-small" id="dGoMsg"></span></div></div>
      <div class="im-panel" data-pane="manual">
        <div class="im-row" style="margin-bottom:10px"><p class="im-small im-grow" style="margin:0">TikTok One 같은 화면에서 확인한 값을 옮겨 적어 등록해요. 주소를 넣고 [중복 확인]을 누르면 이미 있는 계정인지 알려 줘요.</p><a class="im-btn is-sm" href="${TTO_URL}" target="_blank" rel="noopener">TikTok One 열기</a></div>
        <div class="im-fgrid">
          <label class="im-field">플랫폼<select id="mPf"><option value="tt">TikTok</option><option value="ig">Instagram</option><option value="yt">YouTube</option><option value="fb">Facebook</option></select></label>
          <label class="im-field is-span2">분야<select id="mSeg">${segOptions(D.segment, '미분류')}</select></label>
          <label class="im-field">출처<select id="mSrc"><option value="manual|TikTok One (화면 확인)">TikTok One 화면 확인</option><option value="manual|직접 확인">채널에서 직접 확인</option><option value="submitted|인플루언서 제출">인플루언서 제출 자료</option><option value="submitted|에이전시 자료">에이전시 자료</option><option value="official_api|YouTube API">YouTube API (자동 채우기)</option></select></label>
          <label class="im-field is-wide">계정 주소 또는 @핸들 *<input type="text" id="mRef" placeholder="https://www.tiktok.com/@아이디"></label>
          <label class="im-field">이름<input type="text" id="mName"></label>
          <label class="im-field">팔로워<input type="number" min="0" id="mF"></label>
          <label class="im-field">조회수 중앙값<input type="number" min="0" id="mV"></label>
          <label class="im-field">평균 조회수<input type="number" min="0" id="mAvg"></label>
          <label class="im-field">참여율(%)<input type="number" min="0" max="100" step="0.1" id="mEr"></label>
          <label class="im-field">베트남 시청자(%)<input type="number" min="0" max="100" id="mVn"></label>
          <label class="im-field">수집일<input type="date" id="mAt" value="${today()}"></label></div>
        <p class="im-muted im-small" style="margin:6px 0 0">평균만 알면 평균 칸에만 넣으세요. 중앙값 칸에 평균을 넣지 않아요.</p>
        <div class="im-row" style="margin-top:10px"><button type="button" class="im-btn" id="mFill">YouTube 지표 채우기</button><button type="button" class="im-btn" id="mChk">중복 확인</button><button type="button" class="im-btn is-primary" id="mAdd">후보로 등록</button><span class="im-small" id="mMsg"></span></div></div>
      <div class="im-panel" id="dResP" style="margin-top:var(--space-5)"><h2>결과 <small id="dMeta"></small></h2><div id="dNotice"></div><div id="dRes"></div>
        <div class="im-row" style="margin-top:10px"><button type="button" class="im-btn is-primary" id="dReg" disabled>선택한 후보 등록</button><span class="im-muted im-small" id="dRegMsg">같은 플랫폼의 같은 계정은 자동으로 건너뛰어요. 등록하면 '후보' 상태로 인플루언서 목록에 들어가요.</span></div></div>`;
      $$('#dSubs button', v).forEach(b => { b.onclick = () => this.sub(v, b.dataset.sub); });
      $('#dPf', v).onchange = e => { D.platform = e.target.value; this.providers(v); };
      $('#dTier', v).onchange = e => { D.tier = e.target.value; };
      $('#dSort', v).onchange = e => { D.sort = e.target.value; this.results(v); };
      $('#dSeg', v).onchange = e => this.applySegment(v, e.target.value);
      $('#dGo', v).onclick = () => this.search(v);
      $('#dReg', v).onclick = () => this.register(v, D.rows.filter((r, i) => D.sel.has(i)));
      const manual = () => { const [st, prov] = $('#mSrc', v).value.split('|'); return { platform: $('#mPf', v).value, url: $('#mRef', v).value.trim(), name: $('#mName', v).value.trim(), followers: $('#mF', v).value, median_views: $('#mV', v).value, avg_views: $('#mAvg', v).value, er: $('#mEr', v).value, vn_audience: $('#mVn', v).value, collected_on: $('#mAt', v).value, category: '', source_type: st, provider: prov, country: D.country, language: D.language, segment: $('#mSeg', v).value }; };
      const mMsg = (t, bad) => { const m = $('#mMsg', v); m.textContent = t; m.style.color = bad ? 'var(--im-bad)' : 'var(--im-ok)'; };
      $('#mFill', v).onclick = async () => { const pf = $('#mPf', v).value, ref = $('#mRef', v).value.trim();
        if (pf !== 'yt') { mMsg('자동 채우기는 YouTube만 돼요. TikTok·Instagram·Facebook은 화면에서 확인한 값을 입력하세요', true); return; }
        if (!ref) { mMsg('계정 주소를 먼저 넣어 주세요', true); return; }
        const b = $('#mFill', v); b.disabled = true; mMsg('YouTube에서 가져오는 중… (약 3유닛)', false);
        try { const r = await api('POST', 'api/discovery/fill', { platform: pf, ref });
          const set = (id, val) => { if (val != null && val !== '') $('#' + id, v).value = val; };
          if (!$('#mName', v).value.trim()) set('mName', r.name); set('mF', r.followers); set('mV', r.median_views); set('mAvg', r.avg_views); set('mEr', r.er);
          $('#mAt', v).value = today(); $('#mSrc', v).value = 'official_api|YouTube API';
          mMsg(`채웠어요. ${r.note || ''} 베트남 시청자 비중은 공개 API로 알 수 없어 비워 둬요`, false); }
        catch (e) { mMsg(e.message, true); } finally { b.disabled = false; } };
      $('#mChk', v).onclick = async () => { const m = manual(); if (!m.url) { mMsg('계정 주소를 넣어 주세요', true); return; }
        try { const r = await api('POST', 'api/discovery/check', { platform: m.platform, ref: m.url }); mMsg(r.duplicate ? `이미 등록된 계정이에요: ${r.duplicate_of.name}` : '새 계정이에요. 등록할 수 있어요', r.duplicate); } catch (e) { mMsg(e.message, true); } };
      $('#mAdd', v).onclick = async () => { const m = manual(); if (!m.url) { mMsg('계정 주소를 넣어 주세요', true); return; } await this.register(v, [m], mMsg); };
      bindKw(v); this.sub(v, D.sub); this.providers(v); this.results(v);
    },
    sub(v, k) {
      S.disc.sub = k;
      $$('#dSubs button', v).forEach(b => b.setAttribute('aria-selected', b.dataset.sub === k));
      $$('[data-pane]', v).forEach(p => { p.hidden = p.dataset.pane !== k; });
      $('#dResP', v).hidden = k === 'manual';
    },
    /* 검색 조건 (Ver_023): 규모 드롭다운 → 최소·최대 팔로워('전체'는 Nano 이상), 국가·언어는 타깃에서. 조회수·참여율·시청자 조건은 화면에서 뺌 */
    filters(v) {
      const D = S.disc, t = TIERS.find(x => x.k === D.tier);
      return { country: D.country, language: D.language, min_followers: t ? t.min : TIERS[0].min, max_followers: t && t.max !== Infinity ? t.max - 1 : null, min_views: null, min_er: null, min_vn_audience: null, categories: D.cats, keyword: $('#dKw', v).value.trim() };
    },
    applySegment(v, name) {
      const D = S.disc, sg = segOf(name);
      D.segment = sg ? sg.name : '';
      if (sg) { D.platform = sg.platform; $('#dPf', v).value = sg.platform; D.country = sg.country; D.language = sg.language; $('#dKw', v).value = sg.keyword; D.cats = [...sg.cats]; }
      const ms = $('#mSeg', v); if (ms) ms.value = D.segment;
      this.providers(v);
    },
    async providers(v) {
      const sel = $('#dProv', v); let list;
      try { list = (await api('GET', 'api/discovery/providers')).filter(shownProvider); } catch (e) { $('#dGoMsg', v).textContent = e.message; return; }
      const D = S.disc, ok = p => p.search && p.configured && p.platforms.includes(D.platform), usable = list.filter(ok);
      if (!usable.some(p => p.key === D.provider)) D.provider = (usable.find(p => p.ref) || usable[0] || {}).key || '';
      sel.innerHTML = list.map(p => `<option value="${esc(p.key)}" ${p.key === D.provider ? 'selected' : ''} ${ok(p) ? '' : `disabled title="${!p.platforms.includes(D.platform) ? '이 플랫폼 없음' : p.ref ? '파일 없음' : '키 없음'}"`}>${esc(p.name)}</option>`).join('');
      const sync = () => {
        $('#dKwWrap', v).hidden = $('#dKwEx', v).hidden = D.provider !== 'youtube'; };
      sel.onchange = () => { D.provider = sel.value; sync(); }; sync();
      $('#dGo', v).disabled = !usable.length;
      $('#dGoMsg', v).textContent = usable.length ? '' : '이 플랫폼에 쓸 수 있는 조회 방법이 없어요. [직접 등록]을 쓰세요';
    },
    async search(v) {
      const D = S.disc, b = $('#dGo', v); if (!D.provider) { toast('조회할 곳을 고르세요'); return; }
      b.disabled = true; $('#dRes', v).innerHTML = '<p class="im-muted" style="margin:0">조회 중…</p>';
      const platform = D.platform;
      try { const r = await api('POST', 'api/discovery/search', { provider: D.provider, platform, filters: { ...this.filters(v), include_excluded: false } });
        D.rows = r.rows; D.meta = { ...r.meta, platform }; D.source = D.provider; D.sel = new Set(); this.results(v); }
      catch (e) { D.rows = []; $('#dRes', v).innerHTML = `<div class="im-note">${esc(e.message)}<br>[직접 등록]으로 이어서 진행할 수 있어요.</div>`; $('#dMeta', v).textContent = ''; }
      finally { b.disabled = false; }
    },
    order() {
      const D = S.disc, idx = D.rows.map((r, i) => i), val = (r, k) => (k === 'fol' ? r.followers : (r.median_views ?? r.avg_views)) ?? -1;
      if (D.sort === 'fol' || D.sort === 'views') idx.sort((a, b) => val(D.rows[b], D.sort) - val(D.rows[a], D.sort));
      return idx;
    },
    results(v) {
      const D = S.disc, box = $('#dRes', v);
      if (!D.rows.length) { box.innerHTML = `<div class="im-empty">${D.meta ? '이 플랫폼에는 대시보드 기준(팔로워·구독자 1천 이상, 대시보드 분야)에 맞는 후보가 아직 없어요' : '[후보 검색]을 누르면 후보가 여기에 나와요'}</div>`; $('#dReg', v).disabled = true; $('#dMeta', v).textContent = ''; $('#dNotice', v).innerHTML = ''; return; }
      this.notice(v);
      const m = D.meta || {}, pfName = PFN[m.platform || D.platform];
      $('#dMeta', v).textContent = m.ref ? `${m.label}${m.as_of ? '(' + m.as_of.slice(2).replace(/-/g, '/') + ' 기준)' : ''} · 전체 ${m.total}개 중 ${pfName} ${m.platform_total}개${(m.hidden_excluded || 0) + (m.below_nano || 0) ? ` · 대시보드 기준 밖 ${(m.hidden_excluded || 0) + (m.below_nano || 0)}개 제외` : ''} → 검색 조건 적용 후 ${D.rows.length}개${(m.after_filter ?? D.rows.length) < (m.returned ?? 0) ? ` (규모 조건 밖 ${m.returned - m.after_filter}개 숨김)` : ''}` : m.csv ? `파일 ${D.rows.length}명${(m.errors || []).length ? ` · 오류 ${m.errors.length}줄` : ''}` : `${pfName} · 받은 결과 ${m.returned ?? D.rows.length}건 → 조건 적용 후 ${D.rows.length}건`;
      const visible = {followers: D.rows.some(r => r.followers != null), views: D.rows.some(r => r.median_views != null || r.avg_views != null), er: D.rows.some(r => r.er != null), vn: D.rows.some(r => r.vn_audience != null)};
      const emptyCell = '<span class="im-faint">–</span>';
      const metricHeaders = `${visible.followers ? `<th class="r">${((D.meta || {}).platform || D.platform) === 'yt' ? '구독자 수' : '팔로워'}</th>` : ''}`;  // Ver_023: 조회수·베트남 시청자 열은 결과 표에서 뺌
      box.innerHTML = `<div class="im-tblwrap is-scroll"><table class="im-dres"><thead><tr><th><input type="checkbox" id="dAll" aria-label="모두 선택"></th><th>계정</th>${metricHeaders}</tr></thead><tbody>${this.order().map(i => { const r = D.rows[i]; return `<tr>
        <td><input type="checkbox" data-i="${i}" ${D.sel.has(i) ? 'checked' : ''} ${r.duplicate ? `disabled title="이미 등록됨: ${esc(r.duplicate_of.name)}"` : ''} aria-label="${esc(r.name)} 선택"></td>
        <td>${r.display_name !== undefined ? (/^https?:/.test(r.url || '') ? `<a href="${esc(r.url)}" target="_blank" rel="noopener"><b>${r.handle && !r.handle.startsWith('UC') ? '@' + esc(r.handle) : esc(r.name)}</b></a>${r.handle && !r.handle.startsWith('UC') ? ` <span class="im-muted">${esc(r.name)}</span>` : ''}` : `<b>${esc(r.name)}</b>`) + (r.display_name && r.display_name !== r.name ? `<div class="im-sub">Nox 표기: ${esc(r.display_name)}</div>` : '') : /^https?:/.test(r.url || '') ? `<a href="${esc(r.url)}" target="_blank" rel="noopener"><b>${esc(r.name || r.handle)}</b></a>` : `<b>${esc(r.name)}</b>`}<div class="im-sub"><span class="im-pf pf-${r.platform}"><i></i>${PFN[r.platform]}</span> ${r.handle ? '@' + esc(r.handle) : ''}${r.country ? ' · ' + esc(r.country) : ''}</div>${r.enriched ? `<div class="im-sub">지표 채움: ${esc(r.enriched)}</div>` : ''}${(r.cleansing || []).length ? `<div class="im-sub" style="color:var(--im-warn)">정제: ${esc(r.cleansing.join(', '))}</div>` : ''}</td>
        ${visible.followers ? `<td class="r im-num">${r.followers != null ? short(r.followers) : emptyCell}</td>` : ''}
        </tr>`; }).join('')}</tbody></table></div>`;
      const upd = () => { $('#dReg', v).disabled = !D.sel.size; $('#dReg', v).textContent = D.sel.size ? `선택한 후보 ${D.sel.size}명 등록` : '선택한 후보 등록'; };
      $$('input[data-i]', box).forEach(c => { c.onchange = () => { const i = +c.dataset.i; c.checked ? D.sel.add(i) : D.sel.delete(i); upd(); }; });
      $('#dAll', box).onchange = e => { D.rows.forEach((r, i) => { if (!r.duplicate) e.target.checked ? D.sel.add(i) : D.sel.delete(i); }); this.results(v); };
      upd();
    },
    notice(v) {
      const D = S.disc, labels = [...new Set(D.rows.flatMap(r => (r.unverified || []).filter(x => !x.startsWith('활동 국가'))))];
      const canFill = D.rows.some(r => r.platform === 'yt' && !r.enriched && !r.no_fill && !r.no_url && (r.median_views == null || r.er == null));
      const parts = [];
      if (labels.length) parts.push(`일부 조건(${esc(labels.join('·'))})은 자료가 없어 적용하지 못했어요.`);
      if (labels.includes('베트남 시청자 비중')) parts.push('베트남 시청자 비중은 채널 주인만 볼 수 있어요 (협업 제안 때 인사이트 캡처를 요청하세요).');
      if (canFill) parts.push('<b>[지표 채우기]</b>를 누르면 YouTube 후보의 최근 영상 기준 조회수 중앙값·참여율을 가져와요 (채널당 약 3유닛). 채운 뒤 조건을 다시 적용해요.');
      $('#dNotice', v).innerHTML = parts.length ? `<div class="im-banner is-info" style="margin:0 0 10px"><div class="im-grow im-small">${parts.join('<br>')}</div>${canFill ? '<button type="button" class="im-btn is-sm" id="dFill">지표 채우기</button>' : ''}</div>` : '';
      const fb = $('#dFill', v); if (fb) fb.onclick = async () => {
        fb.disabled = true; fb.textContent = '가져오는 중…';
        try { const targets = D.rows.slice(0, 25); const r = await api('POST', 'api/discovery/enrich', { rows: targets, filters: this.filters(v) });
          D.rows = [...r.rows, ...D.rows.slice(25)]; D.sel = new Set(); this.results(v);
          toast(`지표를 채웠어요${r.removed ? ` · 조건에 맞지 않아 ${r.removed}명 제외` : ''}${r.failed.length ? ` · 실패 ${r.failed.length}명(${r.failed[0].error})` : ''}`); }
        catch (e) { toast(e.message); fb.disabled = false; fb.textContent = '지표 채우기'; } };
    },
    async register(v, recs, msgFn) {
      if (!recs.length) { toast('등록할 후보를 고르세요'); return; }
      try {
        const r = await api('POST', 'api/discovery/register', { records: recs.map(x => ({ ...x, segment: x.segment || S.disc.segment || '' })), eventId: S.flt.ev || '' });
        replaceAll(r);
        const txt = `등록 ${r.created.length}명${r.skipped.length ? ` · 중복으로 건너뜀 ${r.skipped.length}명(${r.skipped.map(x => x.existing).join(', ')})` : ''}${r.errors.length ? ` · 오류 ${r.errors.length}명(${r.errors.map(x => x.error).join(', ')})` : ''}`;
        if (msgFn) msgFn(txt, !r.created.length); else $('#dRegMsg', v).textContent = txt;
        toast(r.created.length ? `${r.created.length}명을 후보로 등록했어요. [인플루언서]·[제안 메일]에서 이어서 진행하세요` : '새로 등록된 후보가 없어요');
        const made = new Map(r.created.map(x => [x.account_key, x.name]));
        S.disc.rows.forEach(row => { if (made.has(row.account_key) && row.account_key) { row.duplicate = true; row.duplicate_of = { name: made.get(row.account_key) }; } });
        S.disc.sel = new Set(); if (S.tab === 'discover') this.results(v);
      } catch (e) { if (msgFn) msgFn(e.message, true); else toast(e.message); }
    },
  };

  /* ---------- 시작 ---------- */
  buildTabs(); show(S.tab, true); renderBanners();
})();
