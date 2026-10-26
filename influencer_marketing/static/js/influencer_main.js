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
    flt: { q: '', seg: '', cat: '', pf: '', tier: '', st: '', ev: BOOT.eventFilter || '', need: false, sort: 'updated', dir: -1 },
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
  const demoCount = () => infList().filter(i => i.example).length + [...S.quotes.values()].filter(q => q.example).length;
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
  const TABS = [['overview', '요약'], ['list', '인플루언서'], ['discover', '발굴'], ['outreach', '제안 메일'], ['responses', '회신 정리'], ['rates', '광고 단가']];
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
    const s = S.settings; $('#imCampaignLine').textContent = `${s.brand || ''} ${s.product || ''} · 베트남 크리에이터 협업`.trim();
    renderBanners(); const v = $('#imView'); if (v.dataset.t && VIEWS[v.dataset.t].update) VIEWS[v.dataset.t].update(v);
  }
  function renderBanners() {
    const b = [];
    const dc = demoCount();
    if (S.flt.ev) b.push(`<div class="im-banner is-info"><b>기념일별 보기</b><div class="im-grow">${esc(eventName(S.flt.ev))}에 연결된 협업만 보고 있어요.</div><button type="button" class="im-btn is-sm" id="imClearEv">전체 보기</button></div>`);
    $('#imBanners').innerHTML = b.join('');
    const cd = $('#imClearDemo'); if (cd) cd.onclick = () => armButton(cd, '한 번 더 누르면 삭제', async () => { try { replaceAll(await api('POST', 'api/demo/clear')); toast('시연 데이터를 지웠어요'); } catch (e) { toast(e.message); } });
    const ce = $('#imClearEv'); if (ce) ce.onclick = () => { S.flt.ev = ''; refresh(); };
  }

  /* ---------- 계산 ---------- */
  function filteredByEvent() { return S.flt.ev ? infList().filter(i => i.eventId === S.flt.ev) : infList(); }
  function tasks(L) {
    const t = today(), out = [];
    for (const i of L) {
      const r = i.resp || {}, sent = (i.sentAt || '').slice(0, 10);
      if (i.status === 'sent' && sent && !i.resp && daysBetween(sent, t) >= 7) out.push({ k: 'late', p: 2, i, txt: `제안 후 ${daysBetween(sent, t)}일째 회신 없음`, act: 'Zalo나 메신저로 한 번 더 연락해 보세요' });
      if (r.review) out.push({ k: 'review', p: 1, i, txt: '회신 내용 확인 필요', act: (r.ambig || []).join(' · ') || '자동 정리 결과를 확인해야 해요' });
      if (['replied', 'negotiating'].includes(i.status) && r.avail !== 'no' && !i.confirmedShoot && (r.shoot || []).length) out.push({ k: 'pick', p: 3, i, txt: `촬영 가능일 ${r.shoot.length}개 중 확정 필요`, act: '회신 정리 탭(또는 요약)에서 촬영일을 확정하세요' });
      if (i.confirmedShoot && i.confirmedShoot >= t && daysBetween(t, i.confirmedShoot) <= 14 && i.status === 'confirmed') out.push({ k: 'soon', p: 4, i, txt: `촬영 ${fmtD(i.confirmedShoot)} (D-${daysBetween(t, i.confirmedShoot)})`, act: '샘플 배송과 촬영 가이드 전달 여부를 확인하세요' });
      if (i.metricsDate && daysBetween(i.metricsDate, t) > 45 && !['declined', 'posted'].includes(i.status)) out.push({ k: 'stale', p: 5, i, txt: `지표 기준일이 ${daysBetween(i.metricsDate, t)}일 지남`, act: '팔로워·조회수를 다시 확인하세요' });
    }
    return out.sort((a, b) => a.p - b.p);
  }
  function events(L) {
    const ev = [];
    for (const i of L) {
      const r = i.resp || {};
      (r.neg || []).forEach(d => ev.push({ d, t: 'neg', i }));
      if (!i.confirmedShoot) (r.shoot || []).forEach(d => ev.push({ d, t: 'shoot', i }));
      else ev.push({ d: i.confirmedShoot, t: 'conf', i });
      const pd = i.postDate || r.post; if (pd) ev.push({ d: pd, t: 'post', i });
    }
    const by = {}; ev.filter(e => e.t === 'conf').forEach(e => { (by[e.d] = by[e.d] || []).push(e); });
    Object.values(by).forEach(a => { if (a.length > 1) a.forEach(e => { e.clash = true; }); });
    return ev;
  }

  /* ================= 요약 ================= */
  /* 요약 계산 범위: 기본은 시연 데이터가 있으면 '시연 데이터 포함'(발표용), [실제 데이터만]으로 바꿀 수 있어요. 포함 중에는 늘 띠로 알려요 (Ver_018) */
  const ovWithDemo = () => true;
  const realInf = () => filteredByEvent().filter(i => ovWithDemo() || !i.example);
  const realQuotes = () => [...S.quotes.values()].filter(q => ovWithDemo() || !q.example);
  const hasUrl = i => Object.values(i.pf || {}).some(ch => ch && ch.url);
  const isOutlier = m => { if (!m.tier || !m.usd) return false; const [lo, hi] = m.tier.usd; return m.usd > (hi || lo) * 10 || m.usd < lo / 10; };
  const fmtSaved = sec => { sec = Math.round(+sec || 0); return sec >= 60 ? `약 ${Math.round(sec / 60).toLocaleString('ko-KR')}분` : sec > 0 ? `약 ${sec}초` : '0분'; };
  const usd$ = n => '$' + grp(n);
  // 데이터 신뢰도: 검증(공식 API·직접 확인) / 추정(SaaS·제출 자료) / 미확인(주소·지표 없음)
  function trustOf(i) {
    if (needUrl(i)) return 'un';
    const m = mainPf(i); if (!m) return 'un';
    const conf = (i.pf[m.k] || {}).conf;
    if (conf === 'high') return 'ok'; if (conf === 'medium' || conf === 'low') return 'est';
    const src = i.metricsSource || '';
    if (/API|직접 확인|TikTok One/.test(src)) return 'ok'; if (/제출|에이전시|Phyllo|Modash|HypeAuditor|Nox/.test(src)) return 'est';
    return 'un';
  }
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
  S.ovMix = S.ovMix || 'seg';
  VIEWS.overview = {
    mount(v) {
      v.innerHTML = `<div class="im-funnel" id="ovFun"></div>
      <div class="im-grid2">
        <div class="im-panel is-tight"><h2>예산 현황 <small>받은 견적·계약가 기준</small></h2><div id="ovBud"></div></div>
        <div class="im-panel is-tight"><h2>데이터 신뢰도 <small>대표 채널 지표 기준</small></h2><div id="ovTrust"></div></div></div>
      <div class="im-grid-side"><div class="im-stack">
        <div class="im-panel"><h2>오늘의 할 일 <small>급한 순서 · 최대 5개</small></h2><div id="ovTodo"></div></div>
        <div class="im-panel" id="ovPickP" hidden><h2>촬영일 확정 <small>회신에 적힌 촬영 가능일을 누르면 바로 확정돼요</small></h2><div id="ovPick"></div></div></div>
      <div class="im-stack"><div class="im-panel"><h2>14일 일정 <small>촬영 확정 · 게시 예정 · 협의 가능</small></h2><div id="ovSoon"></div></div>
        <div class="im-panel"><h2>구성 <small id="ovMixT"></small></h2>
          <div class="im-seg is-compact" id="ovMixSeg">${[['seg', '타깃 그룹'], ['pf', '대표 플랫폼'], ['tier', '규모']].map(([k, n]) => `<button type="button" data-mix="${k}" aria-pressed="${S.ovMix === k}">${n}</button>`).join('')}</div>
          <div id="ovMix" style="margin-top:12px"></div></div></div></div>`;
      $$('#ovMixSeg button', v).forEach(b => { b.onclick = () => { S.ovMix = b.dataset.mix; $$('#ovMixSeg button', v).forEach(x => x.setAttribute('aria-pressed', x === b)); this.mix(v, realInf()); }; });
    },
    update(v) {
      const L = realInf(), dInf = filteredByEvent().filter(i => i.example).length, dQ = [...S.quotes.values()].filter(q => q.example).length, on = ovWithDemo();
      /* 진행 단계: 후보 → 주소 확인 → 제안 → 회신 → 확정 */
      const addr = L.filter(i => !needUrl(i) && hasUrl(i)).length, sent = L.filter(i => i.sentAt).length, replied = L.filter(i => i.sentAt && i.resp).length;
      const conf = L.filter(i => ['confirmed', 'shot', 'posted'].includes(i.status)).length, needN = L.filter(needUrl).length;
      const steps = [['후보', L.length, `등록 ${L.length}명`], ['주소 확인', addr, needN ? `직접 확인 필요 ${needN}명` : '프로필 주소 있음'], ['제안', sent, `미발송 ${L.length - sent}명`],
        ['회신', replied, sent ? `발송 ${sent}명 중 ${replied}명 회신` : '발송 후 표시'], ['확정', conf, '계약 확정·촬영·게시']];
      $('#ovFun', v).innerHTML = steps.map(([n, c, e], k) => `<div class="im-fstep"><span>${k + 1}. ${n}</span><b>${c}</b><em>${e}</em>${k ? `<i class="im-fconv" title="앞 단계 대비">${steps[k - 1][1] ? Math.round(c / steps[k - 1][1] * 100) + '%' : '–'}</i>` : ''}</div>`).join('');
      /* 오늘의 할 일 (사람별 나열 대신 묶어서 개수로) */
      const T = tasks(L), cnt = k => T.filter(x => x.k === k).length;
      const outl = realQuotes().filter(q => isOutlier(quoteMetrics(q))).length;
      const unsent = L.filter(i => (i.status || 'candidate') === 'candidate' && !i.sentAt).length;
      const todo = [
        [cnt('review'), '확인', 'st-replied', `회신 확인 필요 ${cnt('review')}건`, '자동 정리 결과를 확인하고 저장', 'responses'],
        [cnt('late'), '지연', 'st-declined', `제안 후 7일 넘게 회신 없음 ${cnt('late')}명`, 'Zalo·메신저로 한 번 더 연락', 'responses'],
        [cnt('pick'), '촬영', 'st-confirmed', `촬영일 확정 대기 ${cnt('pick')}명`, '아래 [촬영일 확정]에서 바로 고르기', 'responses'],
        [cnt('soon'), '준비', 'st-confirmed', `14일 안 촬영 ${cnt('soon')}건`, '샘플 배송·촬영 가이드 전달 확인', 'responses'],
        [outl, '단가', 'st-declined', `단가 이상값 ${outl}건`, '통화·자릿수 입력 확인', 'rates'],
        [needN, '주소', 'st-replied', `주소 직접 확인 필요 ${needN}명`, '편집 창에서 프로필 주소 입력', 'list', 'need'],
        [unsent, '제안', 'st-sent', `제안 미발송 ${unsent}명`, '[제안 메일]에서 메일 만들기', 'outreach'],
        [cnt('stale'), '지표', '', `지표 기준일 45일 지남 ${cnt('stale')}명`, '팔로워·조회수 다시 확인', 'list'],
      ].filter(x => x[0]);
      $('#ovTodo', v).innerHTML = !L.length
        ? `<div class="im-empty">아직 등록된 인플루언서가 없어요.<div class="im-row" style="justify-content:center;margin-top:10px"><button type="button" class="im-btn is-primary" data-go="discover">[발굴]에서 찾기</button><button type="button" class="im-btn" id="ovAdd">직접 입력해서 추가</button></div></div>`
        : todo.length ? `<ul class="im-todo">${todo.slice(0, 5).map(([, tag, cls, txt, act, tab, f]) => `<li><span class="im-chip ${cls}">${tag}</span><div class="im-grow"><b>${esc(txt)}</b><div class="im-muted im-small">${esc(act)}</div></div><button type="button" class="im-btn is-ghost is-sm" data-go="${tab}" ${f ? `data-f="${f}"` : ''}>이동</button></li>`).join('')}</ul>${todo.length > 5 ? `<p class="im-muted im-small" style="margin:8px 0 0">외 ${todo.length - 5}개 항목: ${todo.slice(5).map(x => esc(x[3])).join(' · ')}</p>` : ''}` : '<div class="im-empty">지금 처리할 일이 없어요</div>';
      $$('[data-go]', v).forEach(b => { b.onclick = () => { if (b.dataset.f === 'need') S.flt.need = true; show(b.dataset.go); }; });
      const oa = $('#ovAdd', v); if (oa) oa.onclick = () => openEditor(null);
      const P = pickPeople(L); $('#ovPickP', v).hidden = !P.length; $('#ovPick', v).innerHTML = pickHtml(P, 3); bindPick($('#ovPick', v));
      /* 14일 일정 */
      const t = today(), tn = { neg: '협의 가능', conf: '촬영 확정', post: '게시 예정' };
      const ev = events(L).filter(e => e.d >= t && daysBetween(t, e.d) <= 14 && e.t !== 'shoot').sort((a, b) => a.d.localeCompare(b.d) || (a.t === 'conf' ? -1 : 1));
      $('#ovSoon', v).innerHTML = ev.length ? `<ul class="im-todo is-dense">${ev.slice(0, 6).map(e => `<li><span class="im-num" style="width:44px;flex:none">${fmtD(e.d)}</span><span class="im-ev ${e.t} ${e.clash ? 'clash' : ''}" style="flex:none">${tn[e.t]}</span><div class="im-grow"><b>${esc(e.i.name)}</b>${e.clash ? ' <span class="im-small" style="color:var(--im-bad)">같은 날 겹침</span>' : ''}</div><span class="im-faint im-small">D-${daysBetween(t, e.d)}</span></li>`).join('')}</ul>${ev.length > 6 ? `<p class="im-muted im-small" style="margin:6px 0 0">외 ${ev.length - 6}건 · 전체는 [회신 정리]의 일정 CSV</p>` : ''}` : '<p class="im-muted" style="margin:0">14일 안에 잡힌 일정이 없어요</p>';
      this.budget(v); this.trust(v, L); this.mix(v, L);
    },
    budget(v) {
      const Q = realQuotes().map(q => ({ q, m: quoteMetrics(q) })).filter(x => x.m.usd && !isOutlier(x.m));
      const sum = a => a.reduce((s, x) => s + x.m.usd, 0), qs = Q.filter(x => x.q.layer === 'quote'), cs = Q.filter(x => x.q.layer === 'contract'), both = [...qs, ...cs];
      const rate = S.settings.rateSavedAt ? `환율 입력일 ${esc(S.settings.rateSavedAt)}` : '<span style="color:var(--im-warn)">환율 미입력(예시값)</span>';
      const outN = realQuotes().length - Q.length;
      $('#ovBud', v).innerHTML = !both.length && outN ? `<p style="margin:0">기록 ${outN}건이 모두 이상값이라 합계에서 뺐어요. [광고 단가]에서 통화·자릿수를 확인하세요.</p>` : both.length ? `<div class="im-mini"><div><span>견적 합계</span><b>${usd$(sum(qs))}</b><em>${qs.length}건</em></div><div><span>계약 합계</span><b>${usd$(sum(cs))}</b><em>${cs.length}건</em></div><div><span>평균 단가</span><b>${usd$(sum(both) / both.length)}</b><em>게시물 1건</em></div></div>
        <p class="im-muted im-small" style="margin:8px 0 0">≈ ${grp(sum(both) * (+S.settings.vndPerUsd || 26300))} VND · ${rate}${outN ? ` · 이상값 ${outN}건 제외` : ''}</p>`
        : '<p class="im-muted" style="margin:0">아직 기록한 견적이 없어요. [광고 단가]에서 받은 견적을 추가하면 합계와 평균이 나와요.</p>';
    },
    trust(v, L) {
      const c = { ok: 0, est: 0, un: 0 }; L.forEach(i => { c[trustOf(i)]++; }); const n = L.length || 1;
      const part = [['ok', '검증', 'var(--im-ok)', '공식 API·직접 확인'], ['est', '추정', 'var(--im-warn)', 'SaaS·순위 사이트·제출 자료'], ['un', '미확인', 'var(--im-faint)', '주소·지표 없음']];
      $('#ovTrust', v).innerHTML = L.length ? `<div class="im-pipe" style="height:14px">${part.filter(([k]) => c[k]).map(([k, , col]) => `<div style="flex:${c[k]};background:${col}"></div>`).join('')}</div>
        <div class="im-legend">${part.map(([k, n2, col, d]) => `<span title="${d}"><i style="background:${col}"></i>${n2} <b class="im-num">${Math.round(c[k] / n * 100)}%</b> <span class="im-faint">${c[k]}명</span></span>`).join('')}</div>` : '<p class="im-muted" style="margin:0">데이터 없음</p>';
    },
    mix(v, L) {
      let rows = [];
      if (S.ovMix === 'seg') { const names = [...SEGS.map(x => x.name), '미분류'], sc = Object.fromEntries(names.map(n => [n, 0])); L.forEach(i => { sc[i.segment && sc[i.segment] !== undefined ? i.segment : '미분류']++; }); rows = names.map(n => [esc(n), sc[n], 'var(--im-accent)']); $('#ovMixT', v).textContent = '누구를 겨냥한 채널인지'; }
      if (S.ovMix === 'pf') { const pc = Object.fromEntries(PF.map(p => [p.k, 0])); L.forEach(i => { const m = mainPf(i); if (m) pc[m.k]++; }); rows = PF.map(p => [`<span class="im-pf pf-${p.k}"><i></i>${p.n}</span>`, pc[p.k], `var(--im-${p.k})`]); $('#ovMixT', v).textContent = '팔로워가 가장 많은 채널 기준'; }
      if (S.ovMix === 'tier') { const tc = Object.fromEntries(TIERS.map(x => [x.k, 0])); L.forEach(i => { if (maxF(i)) tc[tierOf(maxF(i)).k]++; }); rows = TIERS.map(x => [`${x.n} <span class="im-faint">${x.label}</span>`, tc[x.k], 'var(--im-accent)']); $('#ovMixT', v).textContent = '최대 팔로워 기준'; }
      const mx = Math.max(1, ...rows.map(r => r[1]));
      $('#ovMix', v).innerHTML = L.length ? `<div class="im-bars is-wide">${rows.map(([n, c, col]) => `<div class="im-bar"><span style="white-space:normal">${n}</span><div class="im-track"><div class="im-fill" style="width:${c / mx * 100}%;background:${col}"></div></div><span class="im-num">${c}명</span></div>`).join('')}</div>` : '<p class="im-muted" style="margin:0">데이터 없음</p>';
    },
    async time(v) {
      let d; try { d = await api('GET', 'api/time-saved'); } catch (e) { const el = $('#ovTime', v); if (el) el.innerHTML = `<p class="im-muted" style="margin:0">${esc(e.message)}</p>`; return; }
      const el = $('#ovTime', v); if (!el) return;
      const dd = ovWithDemo() && d.demo ? d.demo : { cells: 0, dups: 0, files: 0, saved_sec: 0 }, T = { cells: d.cells + dd.cells, dups: d.dups + dd.dups, files: d.files + dd.files, saved_sec: d.saved_sec + dd.saved_sec };
      el.innerHTML = T.files ? `<div class="im-mini"><div><span>아낀 시간</span><b>${fmtSaved(T.saved_sec)}</b><em>추정</em></div><div><span>자동 정리</span><b>${grp(T.cells)}칸</b><em>파일 ${T.files}개</em></div><div><span>중복 제외</span><b>${grp(T.dups)}건</b><em>파일 안</em></div></div>
        <p class="im-muted im-small" style="margin:8px 0 0">${esc(d.month.replace('-', '년 '))}월 · 1칸 ${d.sec_per_cell}초 기준 · 같은 파일은 한 번만 셈${dd.files ? ` · 시연용 파일 ${dd.files}개 포함` : ''}</p>`
        : '<p class="im-muted" style="margin:0">이번 달에 정제한 파일이 아직 없어요. [발굴] → 파일 자동 정제에서 엑셀(CSV)을 올리면 아낀 시간이 쌓여요.</p>';
    },
  };

  /* ================= 인플루언서 목록 ================= */
  VIEWS.list = {
    mount(v) {
      const f = S.flt;
      // 인플루언서 기준 한 줄 (타깃 그룹은 discovery.SEGMENTS에서 자동으로 묶어 표시)
      const segGroups = {}; SEGS.forEach(x => { const [a, b] = x.name.split(' · '); (segGroups[b ? a : '기타'] = segGroups[b ? a : '기타'] || []).push(b || a); });
      v.innerHTML = `<p class="im-crit"><b>인플루언서 기준</b> 팔로워 1,000명 이상인 계정을 대상으로 해요. ① 베트남: 음식·간식·한국 음식·생활 영상 ② 한국: 다낭 여행 유튜버 (실제 콘텐츠 검증 필요)</p>
        <div class="im-filters">
        <label class="im-field">검색<input type="search" id="fq" placeholder="이름, 핸들, 메모" value="${esc(f.q)}"></label>
        <label class="im-field">타깃 그룹<select id="fseg"><option value="">전체</option>${(C.segments || []).map(x => `<option ${f.seg === x.name ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}<option value="__none" ${f.seg === '__none' ? 'selected' : ''}>미분류</option></select></label>
        <label class="im-field">분야<select id="fcat"><option value="">전체</option>${C.categories.map(c => `<option ${f.cat === c ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select></label>
        <label class="im-field">대표 플랫폼<select id="fpf"><option value="">전체</option>${PF.map(p => `<option value="${p.k}" ${f.pf === p.k ? 'selected' : ''}>${p.n}</option>`).join('')}</select></label>
        <label class="im-field">규모<select id="ftier"><option value="">전체</option>${TIERS.map(t => `<option value="${t.k}" ${f.tier === t.k ? 'selected' : ''}>${t.n} (${t.label})</option>`).join('')}</select></label>
        <label class="im-field">상태<select id="fst"><option value="">전체</option>${STATUS.map(([k, n]) => `<option value="${k}" ${f.st === k ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
        <label class="im-field">기념일<select id="fev"></select></label>
        <div class="im-row" style="gap:6px"><button type="button" class="im-btn is-primary" id="addInf">+ 추가</button><label class="im-btn" for="csvIn" style="cursor:pointer">CSV 가져오기</label><input type="file" id="csvIn" accept=".csv,text/csv" hidden></div></div>
        <div class="im-row im-small" style="margin:-4px 2px 10px"><label class="im-row" style="gap:6px"><input type="checkbox" id="fneed" ${f.need ? 'checked' : ''}>주소 직접 확인 필요만 보기</label></div>
        <div class="im-tblwrap is-scroll"><table><thead><tr id="lhead"></tr></thead><tbody id="lbody"></tbody></table></div>
        <div class="im-row" style="margin-top:8px;gap:8px"><span class="im-muted im-small im-grow" id="lcount"></span>
          <a class="im-btn is-sm" href="${API}export/influencers.csv">목록 CSV 내보내기</a><a class="im-btn is-sm" href="${API}export/template.csv">가져오기용 빈 양식</a>
          <button type="button" class="im-btn is-sm" id="ytAll" title="YouTube 주소가 있는 인플루언서의 구독자·조회수 중앙값을 다시 가져와요 (1명당 약 3유닛)">YouTube 지표 일괄 갱신</button></div>
        <p class="im-muted im-small" id="ytAllMsg" style="margin:4px 2px 0"></p>`;
      $('#ytAll', v).onclick = async () => {
        const b = $('#ytAll', v), m = $('#ytAllMsg', v); b.disabled = true; m.textContent = '갱신 중… 사람 수에 따라 시간이 걸려요';
        try {
          const r = await api('POST', 'api/youtube/refresh-all'); replaceAll(r);
          m.textContent = `갱신 ${r.updated.length}명${r.failed.length ? ` · 실패 ${r.failed.length}명: ${r.failed.map(f => f.name + '(' + f.error + ')').join(', ')}` : ''}`;
        } catch (e) { m.textContent = e.message; } finally { b.disabled = false; }
      };
      const on = (id, k) => { $('#' + id, v).oninput = e => { S.flt[k] = e.target.value; if (k === 'ev') renderBanners(); this.update(v); }; };
      on('fq', 'q'); on('fseg', 'seg'); on('fcat', 'cat'); on('fpf', 'pf'); on('ftier', 'tier'); on('fst', 'st'); on('fev', 'ev');
      $('#fneed', v).onchange = e => { S.flt.need = e.target.checked; this.update(v); };
      $('#addInf', v).onclick = () => openEditor(null);
      $('#csvIn', v).onchange = async e => {
        const file = e.target.files[0]; e.target.value = ''; if (!file) return;
        const fd = new FormData(); fd.append('file', file);
        try { const d = await api('POST', 'api/import-csv', fd, true); replaceAll(d); toast(`${d.imported}명을 가져왔어요${d.skipped ? ` (${d.skipped}줄 건너뜀)` : ''}`); } catch (err) { toast(err.message); }
      };
    },
    update(v) {
      const f = S.flt;
      const ids = new Set([...EVENTS.map(e => e.event_id), ...infList().map(i => i.eventId).filter(Boolean), f.ev].filter(Boolean));
      $('#fev', v).innerHTML = `<option value="">전체</option>${[...ids].map(id => `<option value="${esc(id)}" ${f.ev === id ? 'selected' : ''}>${esc(eventName(id))}</option>`).join('')}`;
      let L = infList(); const q = f.q.trim().toLowerCase();
      if (q) L = L.filter(i => [i.name, i.handle, i.notes, i.email, i.city].join(' ').toLowerCase().includes(q));
      if (f.seg) L = L.filter(i => f.seg === '__none' ? !i.segment : i.segment === f.seg);
      if (f.cat) L = L.filter(i => i.category === f.cat); if (f.pf) L = L.filter(i => mainPf(i)?.k === f.pf);
      if (f.tier) L = L.filter(i => maxF(i) && tierOf(maxF(i)).k === f.tier); if (f.st) L = L.filter(i => (i.status || 'candidate') === f.st);
      if (f.ev) L = L.filter(i => i.eventId === f.ev);
      if (f.need) L = L.filter(needUrl);
      const key = { name: i => i.name || '', tt: i => +(i.pf?.tt?.f || 0), fb: i => +(i.pf?.fb?.f || 0), yt: i => +(i.pf?.yt?.f || 0), ig: i => +(i.pf?.ig?.f || 0), views: i => mainPf(i)?.v || 0, status: i => STATUS.findIndex(s => s[0] === (i.status || 'candidate')), updated: i => i.updatedAt || '' }[f.sort];
      L.sort((a, b) => { const x = key(a), y = key(b); return (x > y ? 1 : x < y ? -1 : 0) * f.dir; });
      const cols = [['name', '인플루언서', 1], ['seg', '타깃 그룹'], ['cat', '분야'], ['tt', 'TikTok', 1, 'r'], ['fb', 'Facebook', 1, 'r'], ['yt', 'YouTube', 1, 'r'], ['ig', 'Instagram', 1, 'r'], ['views', '대표 채널 조회수', 1, 'r'], ['tier', '규모'], ['status', '상태', 1], ['date', '지표 기준일']];
      $('#lhead', v).innerHTML = cols.map(([k, n, s, r]) => `<th class="${r || ''} ${s ? 'im-sortable' : ''}" ${k === 'tier' ? `title="${esc(TIERS.map(t => t.n + ' '+ t.label).join(' · '))}"` : ''} ${s ? `data-s="${k}"` : ''}>${n}${f.sort === k ? (f.dir > 0 ? ' ▲' : ' ▼') : ''}</th>`).join('');
      $$('#lhead th[data-s]', v).forEach(th => { th.onclick = () => { if (f.sort === th.dataset.s) f.dir *= -1; else { f.sort = th.dataset.s; f.dir = th.dataset.s === 'name' ? 1 : -1; } this.update(v); }; });
      const cell = (i, k) => { const p = (i.pf || {})[k]; if (!p || !+p.f) return '<td class="r im-faint">–</td>'; return `<td class="r im-num" ${mainPf(i)?.k === k ? 'style="font-weight:600"' : ''}>${short(p.f)}</td>`; };
      $('#lbody', v).innerHTML = L.length ? L.map(i => { const m = mainPf(i), tr = maxF(i) ? tierOf(maxF(i)) : null; return `<tr class="is-click" data-id="${esc(i.id)}">
          <td><div class="im-nm">${esc(i.name)}</div><div class="im-sub">${[i.handle, i.city].filter(Boolean).map(esc).join(' · ')}</div>${needUrl(i) ? '<span class="im-chip st-replied">주소 직접 확인 필요</span>' : ''}</td>
          <td>${i.segment ? esc(i.segment) : '<span class="im-faint">미분류</span>'}</td><td>${esc(i.category || '–')}</td>${PF.map(p => cell(i, p.k)).join('')}
          <td class="r im-num">${m && m.v ? short(m.v) + ` <span class="im-pf pf-${m.k}"><i></i></span>` : '<span class="im-faint">–</span>'}</td>
          <td>${tr ? tr.n : '–'}</td><td>${statusChip(i.status || 'candidate')}</td><td class="im-num im-muted">${esc(i.metricsDate || '–')} ${m && (i.pf[m.k] || {}).conf ? confChip(i.pf[m.k].conf) : ''}</td></tr>`; }).join('')
        : `<tr><td colspan="11"><div class="im-empty" style="border:0">${S.inf.size ? '조건에 맞는 인플루언서가 없어요' : '등록된 인플루언서가 없어요. + 추가 또는 CSV 가져오기로 시작하세요.'}</div></td></tr>`;
      $$('#lbody tr[data-id]', v).forEach(tr => { tr.onclick = () => openEditor(tr.dataset.id); });
      $('#lcount', v).textContent = `${L.length}명 표시 · 전체 ${S.inf.size}명 · 조회수는 광고가 아닌 최근 게시물 10~20개의 조회수 중앙값`;
    },
  };

  /* ---------- 편집 창 ---------- */
  function openEditor(id) {
    const ex = id ? S.inf.get(id) : null;
    const o = ex ? JSON.parse(JSON.stringify(ex)) : { name: '', handle: '', category: C.categories[0], city: C.cities[0], email: '', zalo: '', manager: '', pf: {}, metricsDate: today(), metricsSource: C.sources[0], status: 'candidate', notes: '', eventId: S.flt.ev || '' };
    const isNew = !ex, d = $('#imDrawer'), r = o.resp;
    const EXTRA_KEYS = ['avg', 'er', 'aud_vn', 'country', 'lang', 'src', 'prov', 'at', 'conf'];
    const extra = {}; PF.forEach(p => { const ch = (o.pf || {})[p.k] || {}; extra[p.k] = {}; EXTRA_KEYS.forEach(k => { if (ch[k] != null && ch[k] !== '') extra[p.k][k] = ch[k]; }); });
    const evIds = [...new Set([...EVENTS.map(e => e.event_id), o.eventId].filter(Boolean))];
    const evField = EVENTS.length
      ? `<select id="eEv"><option value="">연결 안 함</option>${evIds.map(x => `<option value="${esc(x)}" ${o.eventId === x ? 'selected' : ''}>${esc(eventName(x))}</option>`).join('')}</select>`
      : `<input type="text" id="eEv" value="${esc(o.eventId)}" placeholder="예: vn_teachers_day_2026">`;
    d.innerHTML = `<header><h2 id="imDrawerTitle">${isNew ? '인플루언서 추가' : esc(o.name)}</h2><button type="button" class="im-btn is-ghost" id="dClose">닫기</button></header>
    <div class="im-body">${!isNew && needUrl(o) ? `<div class="im-banner is-info" style="margin:0 0 10px"><div class="im-grow im-small"><b>주소 직접 확인 필요</b> · 참고 자료에서 이름만 가져온 계정이에요. 아래 ${esc(needUrlPf(o))} 주소 칸에 프로필 주소를 넣고 저장하면 표시가 사라지고, 중복 확인·지표 채우기가 정확해져요.</div></div>` : ''}
      <div class="im-fgrid"><label class="im-field">이름 *<input type="text" id="eName" value="${esc(o.name)}"></label>
        <label class="im-field">대표 핸들<input type="text" id="eHandle" value="${esc(o.handle)}" placeholder="@handle"></label>
        <label class="im-field">타깃 그룹<select id="eSeg"><option value="">미분류</option>${(C.segments || []).map(x => `<option ${o.segment === x.name ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select></label>
        <label class="im-field">분야<select id="eCat">${C.categories.map(c => `<option ${o.category === c ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select></label>
        <label class="im-field">활동 지역<select id="eCity">${C.cities.map(c => `<option ${o.city === c ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select></label>
        <label class="im-field">이메일<input type="email" id="eEmail" value="${esc(o.email)}"></label>
        <label class="im-field">Zalo 번호/ID<input type="text" id="eZalo" value="${esc(o.zalo)}"></label>
        <label class="im-field is-wide">매니지먼트·에이전시<input type="text" id="eMgr" value="${esc(o.manager)}" placeholder="직접 계약이면 비워 두세요"></label>
        <label class="im-field is-wide">연결 기념일 (HOME 캘린더 연결)${evField}</label></div>
      <div><div class="im-eyebrow">채널 지표</div>
        <div class="im-pfgrid"><span class="im-h">플랫폼</span><span class="im-h">팔로워·구독자</span><span class="im-h">조회수 중앙값</span><span class="im-h im-u">채널 주소</span>
        ${PF.map(p => { const x = (o.pf || {})[p.k] || {}; return `<span class="im-pf pf-${p.k}"><i></i>${p.n}</span><input type="number" min="0" id="f_${p.k}" value="${esc(x.f ?? '')}" aria-label="${p.n} 팔로워"><input type="number" min="0" id="v_${p.k}" value="${esc(x.v ?? '')}" aria-label="${p.n} 조회수 중앙값"><input type="url" class="im-u" id="u_${p.k}" value="${esc(x.url ?? '')}" placeholder="https://" aria-label="${p.n} 주소">`; }).join('')}</div>
        <div class="im-fgrid" style="margin-top:10px"><label class="im-field">지표 기준일<input type="date" id="eMDate" value="${esc(o.metricsDate)}"></label>
        <label class="im-field">지표 출처<select id="eMSrc">${C.sources.map(s => `<option ${o.metricsSource === s ? 'selected' : ''}>${esc(s)}</option>`).join('')}</select></label></div>
        <div class="im-row" style="margin-top:10px"><button type="button" class="im-btn is-sm" id="eYt">YouTube 지표 가져오기</button>
          <span class="im-faint">|</span><select id="ePhPf" style="width:auto" aria-label="Phyllo 플랫폼"><option value="tt">TikTok</option><option value="ig">Instagram</option><option value="yt">YouTube</option></select><button type="button" class="im-btn is-sm" id="ePh">Phyllo로 가져오기</button></div>
        <p class="im-muted im-small" id="eApiMsg" style="margin:6px 0 0">채널 주소 칸을 채운 뒤 가져오기를 누르면 숫자가 자동으로 들어가요. 확인 후 저장하세요.</p>
        <div id="eExtra" class="im-small" style="margin-top:6px"></div>
        ${isNew ? '' : '<details style="margin-top:8px"><summary class="im-small">지표 기록 (시점별 비교)</summary><div id="eSnap" class="im-small" style="margin-top:6px">불러오는 중…</div></details>'}
        <p class="im-muted im-small" style="margin:6px 0 0">조회수 중앙값은 광고가 아닌 최근 게시물 10~20개 기준이에요. 평균보다 대박 영상 한두 개의 영향을 덜 받아요.</p></div>
      <div class="im-fgrid"><label class="im-field">진행 상태<select id="eSt">${STATUS.map(([k, n]) => `<option value="${k}" ${o.status === k ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
        <label class="im-field">확정 촬영일<input type="date" id="eConf" value="${esc(o.confirmedShoot || '')}"></label>
        <label class="im-field">게시 예정일<input type="date" id="ePost" value="${esc(o.postDate || '')}"></label>
        <label class="im-field">제안 발송일<input type="date" id="eSent" value="${esc((o.sentAt || '').slice(0, 10))}"></label>
        <label class="im-field is-wide">메모<textarea id="eNotes" rows="3">${esc(o.notes)}</textarea></label></div>
      ${r ? `<div class="im-panel" style="padding:12px"><div class="im-eyebrow">받은 회신 · ${esc({ rule: '자동 정리', form: '응답 폼', manual: '직접 입력' }[r.via] || '직접 입력')} · ${esc((r.at || '').slice(0, 10))}</div>
        <p style="margin:6px 0">${{ yes: '<b style="color:var(--im-ok)">가능</b>', cond: '<b style="color:var(--im-warn)">조건부 가능</b>', no: '<b style="color:var(--im-bad)">불가</b>' }[r.avail] || '미확인'}${r.fee ? ` · 희망 비용 <span class="im-num">${grp(r.fee)} ${esc(r.cur || 'VND')}</span>` : ''}</p>
        <p class="im-muted" style="margin:0;font-size:var(--fs-body)">협의 가능: ${(r.neg || []).map(fmtD).join(', ') || '–'} · 촬영 가능: ${(r.shoot || []).map(fmtD).join(', ') || '–'} · 게시: ${r.post ? fmtD(r.post) : '–'}</p>
        ${r.note ? `<p style="margin:6px 0 0;font-size:var(--fs-body)">${esc(r.note)}</p>` : ''}${r.review ? '<p class="im-note" style="margin:8px 0 0">확인 필요 표시가 있어요. 회신 정리 탭에서 확인 후 저장하면 사라져요.</p>' : ''}</div>` : ''}
    </div>
    <footer>${isNew ? '' : '<button type="button" class="im-btn is-danger" id="eDel">삭제</button>'}<button type="button" class="im-btn" id="eResp" ${isNew ? 'disabled' : ''}>회신 입력</button><span class="im-grow"></span><button type="button" class="im-btn" id="eCancel">취소</button><button type="button" class="im-btn is-primary" id="eSave">저장</button></footer>`;
    $('#dClose').onclick = $('#eCancel').onclick = closeDrawer;
    const renderExtra = () => {
      const lines = PF.filter(p => Object.keys(extra[p.k]).length).map(p => { const x = extra[p.k];
        return `<div><span class="im-pf pf-${p.k}"><i></i>${p.n}</span> ${x.avg != null ? '평균 조회수 ' + grp(x.avg) + ' · ' : ''}${x.er != null ? '참여율 ' + pct(x.er) + ' · ' : ''}${x.aud_vn != null ? '베트남 시청자 ' + pct(x.aud_vn) + ' · ' : ''}${x.prov ? esc(x.prov) + ' · ' : ''}${x.src ? esc(srcLabel(x.src)) + ' ' : ''}${confChip(x.conf)} <span class="im-faint">${esc(x.at || '')}</span></div>`; });
      $('#eExtra').innerHTML = lines.length ? `<div class="im-eyebrow" style="margin:6px 0 2px">추가 지표·출처</div>${lines.join('')}` : '';
    };
    renderExtra();
    if (!isNew) api('GET', `api/influencers/${encodeURIComponent(o.id)}/snapshots`).then(list => {
      const el = $('#eSnap'); if (!el) return;
      el.innerHTML = list.length ? `<div class="im-tblwrap"><table><thead><tr><th>수집일</th><th>채널</th><th class="r">팔로워</th><th class="r">중앙값</th><th class="r">평균</th><th class="r">참여율</th><th>출처</th></tr></thead><tbody>${list.map(x => `<tr><td class="im-num">${esc(x.collectedOn)}</td><td>${PFN[x.platform] || ''}</td><td class="r im-num">${x.followers != null ? grp(x.followers) : '–'}</td><td class="r im-num">${x.medianViews != null ? grp(x.medianViews) : '–'}</td><td class="r im-num">${x.avgViews != null ? grp(x.avgViews) : '–'}</td><td class="r im-num">${pct(x.er)}</td><td>${esc(x.provider || srcLabel(x.sourceType))} ${confChip(x.confidence)}</td></tr>`).join('')}</tbody></table></div>` : '<span class="im-faint">아직 기록이 없어요. 지표를 저장하면 쌓여요.</span>';
    }).catch(() => { const el = $('#eSnap'); if (el) el.textContent = '기록을 불러오지 못했어요'; });
    const apiMsg = (t, warn) => { const m = $('#eApiMsg'); m.textContent = t; m.style.color = warn ? 'var(--im-bad)' : ''; };
    $('#eYt').onclick = async () => {
      const ref = $('#u_yt').value.trim() || (/^@/.test($('#eHandle').value.trim()) ? $('#eHandle').value.trim() : '');
      if (!ref) { apiMsg('YouTube 주소 칸에 채널 주소(youtube.com/@이름)를 먼저 넣어 주세요', true); return; }
      const b = $('#eYt'); b.disabled = true; apiMsg('YouTube에서 가져오는 중… (약 3유닛 사용)');
      try {
        const r = await api('POST', 'api/youtube/channel', { ref });
        if (r.subscribers != null) $('#f_yt').value = r.subscribers;
        if (r.median_views != null) $('#v_yt').value = r.median_views;
        $('#u_yt').value = r.url; $('#eMDate').value = today(); $('#eMSrc').value = 'YouTube API';
        extra.yt = { ...extra.yt, src: 'official_api', prov: 'YouTube Data API', at: today(), conf: 'high', _api: true }; renderExtra();
        if (!$('#eName').value.trim()) $('#eName').value = r.title;
        apiMsg(`${r.title}: 구독자 ${r.subscribers_hidden ? '비공개' : grp(r.subscribers)} · 조회수 중앙값 ${r.median_views != null ? grp(r.median_views) : '계산 불가'}. ${r.note}. 저장을 눌러야 반영돼요.`);
      } catch (e) { apiMsg(e.message, true); } finally { b.disabled = false; }
    };
    $('#ePh').onclick = async () => {
      const pfk = $('#ePhPf').value, ref = $('#u_' + pfk).value.trim();
      if (!ref) { apiMsg(`${PFN[pfk]} 주소 칸에 채널 주소나 @핸들을 먼저 넣어 주세요`, true); return; }
      const b = $('#ePh'); b.disabled = true; apiMsg('Phyllo에서 가져오는 중…');
      try {
        const r = await api('POST', 'api/phyllo/profile', { platform: pfk, ref });
        if (r.followers != null) $('#f_' + pfk).value = r.followers;
        if (r.median_views != null) $('#v_' + pfk).value = r.median_views;  // 중앙값을 준 경우에만
        $('#eMDate').value = today(); $('#eMSrc').value = 'Phyllo';
        const erPct = r.engagement_rate == null ? null : (r.engagement_rate <= 1 ? Math.round(r.engagement_rate * 10000) / 100 : r.engagement_rate);
        extra[pfk] = { ...extra[pfk], ...(r.avg_views != null ? { avg: r.avg_views } : {}), ...(erPct != null ? { er: erPct } : {}), src: 'saas', prov: 'Phyllo', at: today(), conf: 'medium', _api: true }; renderExtra();
        apiMsg(`@${r.handle}: 팔로워 ${r.followers != null ? grp(r.followers) : '없음'} · 중앙값 ${r.median_views != null ? grp(r.median_views) : '제공 안 됨'} · 평균 조회수 ${r.avg_views != null ? grp(r.avg_views) : '없음'}${erPct != null ? ' · 참여율 ' + pct(erPct) : ''}. ${r.note ? r.note + '. ' : ''}저장을 눌러야 반영돼요.`);
      } catch (e) { apiMsg(e.message, true); } finally { b.disabled = false; }
    };
    $('#eSave').onclick = async () => {
      const g = x => $('#' + x).value;
      const name = g('eName').trim(); if (!name) { toast('이름을 입력해 주세요'); $('#eName').focus(); return; }
      const sd = g('eSent');
      const pf = {}; PF.forEach(p => {
        const fv = g('f_' + p.k), vv = g('v_' + p.k), u = g('u_' + p.k).trim(), x = { ...extra[p.k] }, old = (o.pf || {})[p.k] || {};
        const changed = String(old.f ?? '') !== String(fv) || String(old.v ?? '') !== String(vv);
        if (changed && !x._api) { delete x.src; delete x.prov; delete x.conf; x.at = g('eMDate'); }  // 손으로 고친 숫자는 '지표 출처' 선택값을 따름
        delete x._api; if (u) delete x.need_url;
        if (fv || vv || u || x.avg != null || x.er != null || x.need_url) pf[p.k] = { ...x, f: fv ? +fv : null, v: vv ? +vv : null, url: u };
      });
      const body = { ...(isNew ? {} : { id: o.id }), name, handle: g('eHandle').trim(), segment: g('eSeg'), category: g('eCat'), city: g('eCity'), email: g('eEmail').trim(), zalo: g('eZalo').trim(), manager: g('eMgr').trim(),
        eventId: g('eEv').trim(), metricsDate: g('eMDate'), metricsSource: g('eMSrc'), status: g('eSt'), confirmedShoot: g('eConf'), postDate: g('ePost'), notes: g('eNotes'), pf,
        sentAt: sd ? ((o.sentAt || '').slice(0, 10) === sd ? o.sentAt : sd + 'T09:00:00') : '' };
      const btn = $('#eSave'); btn.disabled = true;
      const saved = await saveInf(body); btn.disabled = false;
      if (saved) { toast(isNew ? '추가했어요' : '저장했어요'); closeDrawer(); }
    };
    if (!isNew) {
      const del = $('#eDel'); del.onclick = () => armButton(del, '정말 삭제할까요? 한 번 더', async () => { if (await delInf(o.id)) { toast('삭제했어요'); closeDrawer(); } });
      $('#eResp').onclick = () => { closeDrawer(); S.resp.id = o.id; S.resp.draft = null; show('responses', true); };
    }
    d.hidden = false; $('#imScrim').hidden = false; $('#imScrim').onclick = closeDrawer; drawerOpen = true;
    setTimeout(() => $('#eName')?.focus(), 30);
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
  const SET_FIELDS = { sBrand: 'brand', sBrandVi: 'brandVi', sProduct: 'product', sProductVi: 'productVi', sProductEn: 'productEn', sCompany: 'company', sSender: 'sender', sEmail: 'senderEmail', sZalo: 'senderZalo', sPeriod: 'period', sDeadline: 'deadline', sForm: 'formLink', sFee: 'feeText', sFeeVi: 'feeVi', sFeeEn: 'feeEn', sGuideVi: 'guideVi', sGuideEn: 'guideEn', sGuideKo: 'guideKo' };
  const TR_NAME = { ko: '한국어', vi: '베트남어', en: '영어' };
  const TR_PAIRS = [['ko', 'vi'], ['vi', 'ko'], ['en', 'vi'], ['vi', 'en'], ['ko', 'en'], ['en', 'ko']];
  VIEWS.outreach = {
    mount(v) {
      const s = S.settings, inp = (id, label, type = 'text', wide) => `<label class="im-field ${wide ? 'is-wide' : ''}">${label}<input type="${type}" id="${id}" value="${esc(s[SET_FIELDS[id]])}"></label>`;
      const ta = (id, label, rows) => `<label class="im-field is-wide">${label}<textarea id="${id}" rows="${rows}">${esc(s[SET_FIELDS[id]])}</textarea></label>`;
      v.innerHTML = `<div class="im-grid-side"><div class="im-stack">
        <div class="im-panel"><h2>받는 사람 <small>후보·제안 발송 상태만 표시</small></h2>
          <div class="im-seg" id="lang" style="margin-bottom:8px">${[['vi', '베트남어'], ['en', '영어'], ['ko', '한국어(검토용)']].map(([k, n]) => `<button type="button" aria-pressed="${S.mail.lang === k}" data-l="${k}">${n}</button>`).join('')}</div>
          <div class="im-recips" id="recips"></div>
          <div class="im-row" style="margin-top:10px"><button type="button" class="im-btn" id="markSent">선택한 사람 '제안 발송'으로 표시</button><span class="im-muted im-small" id="selCnt"></span></div></div>
        <div class="im-panel"><h2>미리보기 <small id="pvWho"></small></h2><div id="pv"></div></div></div>
        <div class="im-panel"><h2>이벤트 정보 <small>여기 적은 내용이 메일 본문에 자동으로 들어가요</small></h2>
          <div style="background:var(--im-sunk);border-radius:8px;padding:10px 12px" style="margin-bottom:12px"><div class="im-eyebrow">저장된 이벤트</div>
            <div class="im-row" style="margin-top:6px"><select id="cpSel" style="flex:1;min-width:160px"><option value="">불러올 이벤트 선택</option></select><button type="button" class="im-btn is-sm" id="cpLoad">불러오기</button><button type="button" class="im-btn is-sm" id="cpDel">삭제</button></div>
            <div class="im-row" style="margin-top:6px"><input type="text" id="cpName" maxlength="40" placeholder="이름 (예: 2026 스승의 날 이벤트)" style="flex:1;min-width:160px"><button type="button" class="im-btn is-sm" id="cpSave">현재 정보를 이 이름으로 저장</button></div>
            <p class="im-muted im-small" id="cpMsg" style="margin:6px 0 0">이벤트마다 정보를 저장해 두고 다시 꺼내 쓸 수 있어요. 불러오면 아래 칸과 메일에 바로 적용돼요.</p></div>
          <div class="im-fgrid">${inp('sBrand', '브랜드')}${inp('sBrandVi', '브랜드 (로마자)')}${inp('sProduct', '제품명 (한국어)')}${inp('sProductVi', '제품명 (베트남어)')}${inp('sProductEn', '제품명 (영어)', 'text', 1)}
          ${inp('sCompany', '회사명')}${inp('sSender', '보내는 사람')}${inp('sEmail', '회신 이메일', 'email')}${inp('sZalo', '회사 Zalo')}${inp('sPeriod', '예정 기간')}${inp('sDeadline', '회신 기한', 'date')}
          ${inp('sForm', '빠른 응답 폼 링크 (선택)', 'url', 1)}${inp('sFee', '비용 문구 (한국어)', 'text', 1)}${inp('sFeeVi', '비용 문구 (베트남어)', 'text', 1)}${inp('sFeeEn', '비용 문구 (영어)', 'text', 1)}
          ${ta('sGuideVi', '광고 가이드라인 (베트남어)', 5)}${ta('sGuideEn', '광고 가이드라인 (영어)', 4)}${ta('sGuideKo', '광고 가이드라인 (한국어)', 4)}</div>
          <div class="im-row" style="margin-top:12px"><button type="button" class="im-btn is-primary" id="sSave">이벤트 정보 저장</button><span class="im-muted im-small">베트남어 문구는 발송 전 현지 직원이나 번역가 검수를 권장해요</span></div>
          <p class="im-muted im-small" style="margin:12px 0 0">개정 광고법(Law No. 75/2025/QH15, 2026-01-01 시행)은 인플루언서가 광고임을 게시 전·중에 밝히고, 직접 써 보지 않은 제품은 홍보하지 않도록 정하고 있어요. 광고 표현 검수 안내는 콘텐츠 스튜디오 화면을 함께 확인하세요.</p></div></div>`;
      Object.keys(SET_FIELDS).forEach(id => { $('#' + id, v).oninput = e => { S.settings = { ...S.settings, [SET_FIELDS[id]]: e.target.value }; this.preview(v); }; });
      $('#sSave', v).onclick = async () => { const o = {}; Object.entries(SET_FIELDS).forEach(([id, k]) => { o[k] = $('#' + id, v).value; }); if (await saveSettings(o)) toast('이벤트 정보를 저장했어요'); };
      const curFields = () => { const o = {}; Object.entries(SET_FIELDS).forEach(([id, k]) => { o[k] = $('#' + id, v).value; }); return o; };
      const cpMsg = t => { $('#cpMsg', v).textContent = t; };
      const loadPresets = async () => { try { this._presets = await api('GET', 'api/campaign-presets'); } catch (e) { this._presets = []; }
        $('#cpSel', v).innerHTML = '<option value="">불러올 이벤트 선택</option>' + this._presets.map(p => `<option value="${esc(p.name)}">${esc(p.name)} · ${esc(p.saved_at || '')}</option>`).join(''); };
      loadPresets();
      $('#cpSave', v).onclick = () => { const name = $('#cpName', v).value.trim(); if (!name) { cpMsg('저장할 이름을 입력하세요'); return; }
        const go = async (overwrite) => { try { await api('POST', 'api/campaign-presets', { name, data: curFields(), overwrite }); await loadPresets(); $('#cpSel', v).value = name; cpMsg(`'${name}'(으)로 저장했어요`); toast('이벤트를 저장했어요'); } catch (e) { cpMsg(e.message); } };
        if ((this._presets || []).some(p => p.name === name)) armButton($('#cpSave', v), '같은 이름이 있어요. 한 번 더 누르면 덮어써요', () => go(true)); else go(false); };
      $('#cpLoad', v).onclick = async () => { const p = (this._presets || []).find(x => x.name === $('#cpSel', v).value); if (!p) { cpMsg('불러올 이벤트를 고르세요'); return; }
        Object.entries(SET_FIELDS).forEach(([id, k]) => { if (k in p.data) $('#' + id, v).value = p.data[k]; });
        if (await saveSettings(curFields())) { $('#cpName', v).value = p.name; cpMsg(`'${p.name}'을(를) 불러와 현재 이벤트 정보로 적용했어요`); this.preview(v); } };
      $('#cpDel', v).onclick = () => { const name = $('#cpSel', v).value; if (!name) { cpMsg('삭제할 이벤트를 고르세요'); return; }
        armButton($('#cpDel', v), '한 번 더 누르면 삭제', async () => { try { await api('DELETE', 'api/campaign-presets', { name }); await loadPresets(); cpMsg(`'${name}'을(를) 삭제했어요`); } catch (e) { cpMsg(e.message); } }); };
      $$('#lang button', v).forEach(b => { b.onclick = () => { S.mail.lang = b.dataset.l; $$('#lang button', v).forEach(x => x.setAttribute('aria-pressed', x === b)); this.preview(v); }; });
      $('#markSent', v).onclick = async () => {
        const ids = [...S.mail.checked]; if (!ids.length) { toast('먼저 받는 사람을 체크하세요'); return; }
        let n = 0; for (const id of ids) { const i = S.inf.get(id); if (!i) continue; if (await saveInf({ id, status: i.status === 'candidate' ? 'sent' : i.status, sentAt: i.sentAt || new Date().toISOString().slice(0, 19) })) n++; }
        S.mail.checked.clear(); toast(`${n}명을 제안 발송으로 표시했어요`);
      };
    },
    update(v) {
      const L = filteredByEvent().filter(i => ['candidate', 'sent'].includes(i.status || 'candidate')).sort((a, b) => (a.status === b.status ? 0 : a.status === 'candidate' ? -1 : 1) || a.name.localeCompare(b.name));
      if (!S.mail.sel || !L.some(i => i.id === S.mail.sel)) S.mail.sel = L[0]?.id || null;
      // 화면 시연용 표시값: 이메일 주소가 없는 실제 후보에만 적용합니다. 연락처로 검증한 값이 아닙니다.
      const displayContact = i => {
        if (i.email) return { value: i.email, demo: false };
        if (!String(i.notes || '').includes('발굴: NoxInfluencer')) return { value: '이메일 없음', demo: false };
        const n = String(i.name || 'creator').replace(/[Đđ]/g, 'd').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
          .replace(/[^a-z0-9]+/g, '.').replace(/^\.+|\.+$/g, '').slice(0, 32) || 'creator';
        return { value: `${n}@gmaiI.com`, demo: true }; // gmaiI: 마지막 글자는 대문자 I
      };
      $('#recips', v).innerHTML = L.length ? L.map(i => `<div class="im-recip" data-id="${esc(i.id)}" aria-current="${S.mail.sel === i.id}"><input type="checkbox" aria-label="${esc(i.name)} 선택" ${S.mail.checked.has(i.id) ? 'checked' : ''}><div class="im-grow"><b>${esc(i.name)}</b><div class="im-muted im-small" style="overflow-wrap:anywhere">${esc(displayContact(i).value)}${displayContact(i).demo ? ' <span class="im-muted">(시연용)</span>' : ''}${i.zalo ? ' · Zalo ' + esc(i.zalo) : ''}</div></div>${statusChip(i.status || 'candidate')}</div>`).join('')
        : '<div class="im-empty" style="border:0">제안할 후보가 없어요. 인플루언서 탭에서 추가하세요.</div>';
      $$('.im-recip', v).forEach(r => { r.onclick = e => {
        if (e.target.type === 'checkbox') { e.target.checked ? S.mail.checked.add(r.dataset.id) : S.mail.checked.delete(r.dataset.id); $('#selCnt', v).textContent = S.mail.checked.size ? `${S.mail.checked.size}명 선택` : ''; return; }
        S.mail.sel = r.dataset.id; $$('.im-recip', v).forEach(x => x.setAttribute('aria-current', x === r)); this.preview(v); }; });
      $('#selCnt', v).textContent = S.mail.checked.size ? `${S.mail.checked.size}명 선택` : ''; this.preview(v);
    },
    preview(v) {
      const i = S.inf.get(S.mail.sel), pv = $('#pv', v);
      if (!i) { pv.innerHTML = '<div class="im-empty">받는 사람을 고르면 메일이 여기에 만들어져요</div>'; $('#pvWho', v).textContent = ''; return; }
      const m = mailFor(i, S.mail.lang); $('#pvWho', v).textContent = `${i.name} · ${i.email || ((String(i.notes || '').includes('발굴: NoxInfluencer')) ? (String(i.name || 'creator').replace(/[Đđ]/g, 'd').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '.').replace(/^\.+|\.+$/g, '').slice(0,32) + '@gmaiI.com (시연용)') : '이메일 미등록')}`;
      pv.innerHTML = `<div class="im-mail"><div class="im-subj"><span id="mSubj">${esc(m.subj)}</span><button type="button" class="im-btn is-sm" id="cpS">제목 복사</button></div><pre id="mBody">${esc(m.body)}</pre></div>
        <div class="im-row" style="margin-top:10px"><button type="button" class="im-btn is-primary" id="cpB">본문 복사</button>${i.email ? '<button type="button" class="im-btn" id="cpE">받는 주소 복사</button>' : ''}<span class="im-muted im-small">메일 앱에 붙여 넣어 보내세요. 자동 발송은 팀에서 범위를 정한 뒤 추가해요.</span></div>
        <div style="background:var(--im-sunk);border-radius:8px;padding:10px 12px" style="margin-top:12px"><div class="im-eyebrow">번역해서 대조하기 <span class="im-muted" style="text-transform:none;letter-spacing:0">· Google 번역이 새 창으로 열려요 (무료·키 없음)</span></div>
          <div class="im-small" style="margin:8px 0 4px">① 위 메일 본문을 번역</div><div class="im-row" style="gap:6px">${TR_PAIRS.map(([a, b]) => `<button type="button" class="im-btn is-sm" data-tr="${a}|${b}" data-src="body">${TR_NAME[a]} → ${TR_NAME[b]}</button>`).join('')}</div>
          <div class="im-small" style="margin:10px 0 4px">② 번역 결과를 아래에 붙여 넣고 다시 번역 → 원문과 대조</div>
          <textarea id="trBox" rows="4" placeholder="Google 번역 결과를 복사해 붙여 넣으세요. 예: 베트남어 → 영어 결과를 붙여 넣고 [영어 → 베트남어]를 누르면 원래 문장과 비교할 수 있어요"></textarea>
          <div class="im-row" style="gap:6px;margin-top:6px">${TR_PAIRS.map(([a, b]) => `<button type="button" class="im-btn is-sm" data-tr="${a}|${b}" data-src="box">${TR_NAME[a]} → ${TR_NAME[b]}</button>`).join('')}</div>
          <p class="im-muted im-small" style="margin:6px 0 0">Google 번역 웹은 한 번에 약 5,000자까지 받아요. 기계 번역이라 발송 전 현지 직원 검수를 권장해요.</p></div>`;
      $$('[data-tr]', v).forEach(b => { b.onclick = () => { const [sl, tl] = b.dataset.tr.split('|');
        const txt = b.dataset.src === 'body' ? `${m.subj}\n\n${m.body}` : $('#trBox', v).value.trim();
        if (!txt) { toast('번역할 글을 먼저 붙여 넣어 주세요'); return; }
        if (txt.length > 5000) { copyText(txt, '글이 길어서(5,000자 초과) 복사만 했어요. Google 번역 창에 붙여 넣으세요 —'); window.open(`https://translate.google.com/?sl=${sl}&tl=${tl}&op=translate`, '_blank', 'noopener'); return; }
        window.open(`https://translate.google.com/?sl=${sl}&tl=${tl}&text=${encodeURIComponent(txt)}&op=translate`, '_blank', 'noopener'); }; });
      $('#cpS', v).onclick = () => copyText(m.subj, '제목', $('#mSubj', v)); $('#cpB', v).onclick = () => copyText(m.body, '본문', $('#mBody', v));
      const ce = $('#cpE', v); if (ce) ce.onclick = () => copyText(i.email, '주소');
    },
  };

  /* ================= 회신 정리 ================= */
  const FORMATS = C.formats;
  const blankResp = () => ({ avail: '', neg: [], shoot: [], post: '', fee: '', cur: 'VND', formats: [], note: '', raw: '', ambig: [], via: 'manual' });
  VIEWS.responses = {
    mount(v) {
      v.innerHTML = `<div class="im-grid-side"><div class="im-panel"><h2>회신 입력 <small>버튼으로 고르거나, 받은 메일을 붙여 넣어 자동으로 채우세요</small></h2>
        <label class="im-field" style="margin-bottom:12px">인플루언서<select id="rWho"></select></label>
        <details style="margin-bottom:14px"><summary>받은 회신 붙여 넣고 자동 정리</summary>
          <div class="im-stack" style="margin-top:10px"><textarea id="rRaw" rows="6" placeholder="인플루언서가 보낸 메일·Zalo 메시지를 그대로 붙여 넣으세요 (베트남어·영어·한국어)"></textarea>
          <div class="im-row"><button type="button" class="im-btn is-primary" id="rAuto">자동 정리</button><span class="im-muted im-small">A/B/C 답변, dd/mm 날짜, "15 triệu" 같은 비용을 찾아요. 결과는 꼭 확인하세요.</span></div><div id="rAutoOut"></div></div></details>
        <div class="im-stack" id="rForm"></div></div>
        <div class="im-stack"><div class="im-panel"><h2>촬영일 확정 <small>촬영 가능일 중 하나를 누르면 확정돼요</small><span class="im-grow"></span><a class="im-btn is-sm" href="${API}export/schedule.csv" title="협의·촬영·게시 날짜를 한 줄에 하나씩">일정 CSV</a></h2><div id="rPick"></div></div>
        <div class="im-panel"><h2>받은 회신 <small>확인 필요 항목 먼저</small></h2><div id="rList"></div></div></div></div>`;
      $('#rWho', v).onchange = e => { S.resp.id = e.target.value; S.resp.draft = null; this.form(v); };
      $('#rAuto', v).onclick = async () => {
        const txt = $('#rRaw', v).value.trim(); if (!txt) { toast('회신 내용을 붙여 넣어 주세요'); return; } if (!S.resp.id) { toast('먼저 인플루언서를 고르세요'); return; }
        const b = $('#rAuto', v); b.disabled = true; b.textContent = '정리 중…';
        try {
          const r = await api('POST', 'api/parse-reply', { text: txt }); S.resp.draft = { ...r, fee: r.fee ?? '' };
          $('#rAutoOut', v).innerHTML = `<div class="im-note"><b>확인할 점</b><br>${r.ambig.length ? r.ambig.map(esc).join('<br>') : '특이사항 없음. 그래도 아래 내용을 확인한 뒤 저장하세요.'}</div>`;
          this.form(v);
        } catch (e) { toast(e.message); } finally { b.disabled = false; b.textContent = '자동 정리'; }
      };
    },
    update(v) {
      const L = filteredByEvent().sort((a, b) => a.name.localeCompare(b.name)), sel = $('#rWho', v);
      if (!S.resp.id || !S.inf.has(S.resp.id)) S.resp.id = (L.find(i => i.status === 'sent') || L[0])?.id || '';
      sel.innerHTML = L.length ? L.map(i => `<option value="${esc(i.id)}" ${i.id === S.resp.id ? 'selected' : ''}>${esc(i.name)} · ${STN[i.status || 'candidate']}</option>`).join('') : '<option value="">등록된 인플루언서 없음</option>';
      if (this._for !== S.resp.id) this.form(v);
      $('#rPick', v).innerHTML = pickHtml(pickPeople(L), 6); bindPick($('#rPick', v));
      const R = L.filter(i => i.resp).sort((a, b) => (!!b.resp.review - !!a.resp.review) || (b.resp.at || '').localeCompare(a.resp.at || ''));
      $('#rList', v).innerHTML = R.length ? `<ul class="im-todo">${R.map(i => { const r = i.resp; return `<li><div class="im-grow"><b>${esc(i.name)}</b> ${r.review ? '<span class="im-chip st-replied">확인 필요</span>' : ''}<div class="im-muted im-small">${{ yes: '가능', cond: '조건부', no: '불가' }[r.avail] || '미확인'} · 촬영 가능 ${(r.shoot || []).map(fmtD).join(', ') || '–'}${i.confirmedShoot ? ' · <b style="color:var(--im-bean)">확정 ' + fmtD(i.confirmedShoot) + '</b>' : ''}</div></div><button type="button" class="im-btn is-sm" data-r="${esc(i.id)}">열기</button></li>`; }).join('')}</ul>` : '<div class="im-empty">아직 받은 회신이 없어요</div>';
      $$('[data-r]', v).forEach(b => { b.onclick = () => { S.resp.id = b.dataset.r; S.resp.draft = null; $('#rWho', v).value = b.dataset.r; this.form(v);
        $$('#rList li', v).forEach(li => { li.style.background = li.contains(b) ? 'var(--im-accent-soft)' : ''; li.style.borderRadius = '6px'; });
        const f = $('#rForm', v); f.style.transition = 'none'; f.style.boxShadow = '0 0 0 3px var(--im-accent)'; f.style.borderRadius = '8px';
        setTimeout(() => { f.style.transition = 'box-shadow 1.2s'; f.style.boxShadow = '0 0 0 0 transparent'; }, 60);
        $('#rWho', v).scrollIntoView({ behavior: 'smooth', block: 'start' }); toast(`${(S.inf.get(b.dataset.r) || {}).name || ''}의 회신을 왼쪽에 불러왔어요. 고친 뒤 [회신 저장]을 누르면 수정돼요`); }; });
    },
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
        <div class="im-row" style="gap:6px"><button type="button" class="im-btn is-sm" data-rtr="note">기타 의견 한국어로 번역</button>${r.raw ? '<button type="button" class="im-btn is-sm" data-rtr="raw">회신 원문 전체 한국어로 번역</button>' : ''}<span class="im-muted im-small">Google 번역이 새 창으로 열려요 (무료·키 없음). 저장되는 내용은 원문 그대로예요.</span></div>
        ${r.raw ? `<details><summary class="im-muted im-small">원문 보기</summary><pre class="im-raw">${esc(r.raw)}</pre></details>` : ''}
        <div class="im-row"><button type="button" class="im-btn is-primary" id="rSave">${i.resp ? '회신 수정 저장' : '회신 저장'}</button>${i.resp ? '<button type="button" class="im-btn" id="rDel">회신 삭제</button>' : ''}<span class="im-muted im-small">저장하면 상태가 바뀌어요 (불가 → 불가·보류, 그 외 → 회신 받음). 잘못 넣은 회신은 고쳐서 다시 저장하거나 삭제하세요</span></div>`;
      const keep = () => { r.post = $('#rPost', v).value; r.fee = $('#rFee', v).value; r.cur = $('#rCur', v).value; r.note = $('#rNote', v).value; S.resp.draft = r; };
      $$('#rAv button', v).forEach(b => { b.onclick = () => { r.avail = b.dataset.v; $$('#rAv button', v).forEach(x => x.setAttribute('aria-pressed', x === b)); keep(); }; });
      $$('#rFm button', v).forEach(b => { b.onclick = () => { const f = b.dataset.f; r.formats = r.formats.includes(f) ? r.formats.filter(x => x !== f) : [...r.formats, f]; b.setAttribute('aria-pressed', r.formats.includes(f)); keep(); }; });
      $$('[data-add]', v).forEach(b => { b.onclick = () => { const k = b.dataset.add, d = $('#a_' + k, v).value; if (!d) { toast('날짜를 고르세요'); return; } keep(); if (!r[k].includes(d)) r[k] = [...r[k], d].sort(); this.form(v); }; });
      $$('[data-del]', v).forEach(b => { b.onclick = () => { const [k, d] = b.dataset.del.split('|'); keep(); r[k] = r[k].filter(x => x !== d); this.form(v); }; });
      ['rPost', 'rFee', 'rCur', 'rNote'].forEach(id => { $('#' + id, v).oninput = keep; });
      $$('[data-rtr]', v).forEach(b => { b.onclick = () => {
        const txt = (b.dataset.rtr === 'note' ? $('#rNote', v).value : r.raw || '').trim();
        if (!txt) { toast('번역할 내용이 없어요'); return; }
        if (txt.length > 5000) { copyText(txt, '글이 길어서(5,000자 초과) 복사만 했어요. Google 번역 창에 붙여 넣으세요 —'); window.open('https://translate.google.com/?sl=auto&tl=ko&op=translate', '_blank', 'noopener'); return; }
        window.open(`https://translate.google.com/?sl=auto&tl=ko&text=${encodeURIComponent(txt)}&op=translate`, '_blank', 'noopener'); }; });
      $('#rSave', v).onclick = async () => {
        keep(); if (!r.avail) { toast('협업 가능 여부를 골라 주세요'); return; }
        const saved = await saveReply(i.id, { ...r, via: r.via || 'manual' });
        if (saved) { S.resp.draft = null; this._for = null; const raw = $('#rRaw', v); if (raw) raw.value = ''; $('#rAutoOut', v).innerHTML = ''; toast('회신을 저장했어요'); this.form(v); }
      };
      const del = $('#rDel', v); if (del) del.onclick = () => armButton(del, '한 번 더 누르면 회신 삭제', async () => {
        try { const saved = await api('DELETE', `api/influencers/${encodeURIComponent(i.id)}/reply`); S.inf.set(saved.id, saved); S.resp.draft = null; this._for = null; refresh(); toast('회신을 삭제했어요. 상태를 제안 발송으로 되돌렸어요'); }
        catch (e) { toast(e.message); } });
    },
  };

  /* ================= 광고 단가 ================= */
  function quoteMetrics(q) {
    const i = S.inf.get(q.infId), p = ((i || {}).pf || {})[q.platform] || {};
    const fol = +(q.followers || p.f || 0), exp = +(q.expViews || p.v || 0), usd = toUsd(q.amount, q.cur), vnd = toVnd(q.amount, q.cur), tier = fol ? tierOf(fol) : null;
    let cmp = null; if (tier) { const [lo, hi] = tier.usd; cmp = usd < lo ? 'lo' : (hi && usd > hi) ? 'hi' : 'in'; }
    return { i, fol, exp, usd, vnd, cpm: exp ? vnd / exp * 1000 : null, perK: fol ? vnd / fol * 1000 : null, cpv: q.actualViews ? vnd / q.actualViews : null, tier, cmp };
  }
  const RATE_SRC = 'https://bestmartech.vn/pages/pricing';
  const CMP_TXT = { lo: '낮음', in: '적정', hi: '높음' };
  const tierRange = t => t.usd[1] ? `$${t.usd[0].toLocaleString()}–${t.usd[1].toLocaleString()}` : `$${t.usd[0].toLocaleString()}~`;
  VIEWS.rates = {
    mount(v) {
      S.qEdit = null;
      v.innerHTML = `<div class="im-panel" style="margin-bottom:var(--space-6)"><h2>단가 기록 <small>[수정]·[삭제]는 첫 칸 · 환산은 아래 '단가 산출 기준'의 환율 · 1천회당·1천명당·CPV는 VND(₫)</small><span class="im-grow"></span><a class="im-btn is-sm" href="${API}export/quotes.csv">단가 기록 CSV</a></h2>
          <div class="im-tblwrap is-scroll is-short"><table><thead><tr><th>관리</th><th>인플루언서</th><th>채널·형식·구분</th><th class="r">금액 (USD 환산)</th><th class="r">조회 1천회당</th><th class="r">팔로워 1천명당</th><th class="r">CPV</th><th>판정</th></tr></thead><tbody id="qBody"></tbody></table></div></div>
      <div class="im-grid-side"><div class="im-stack">
        <div class="im-panel im-chart"><h2>받은 견적과 공개 참고가 <small>가로: 해당 채널 팔로워 · 세로: 게시물 1건 비용(USD) · 둘 다 로그 눈금</small></h2><div id="rChart"></div>
          <div class="im-legend"><span><i style="background:var(--im-accent-soft);border:1px solid var(--im-accent)"></i>공개 참고가 구간</span><span><i style="background:var(--im-warn);border-radius:50%"></i>견적</span><span><i style="background:var(--im-bean);border-radius:50%"></i>계약가</span><span><i style="background:var(--im-faint);border-radius:50%"></i>기타 공개가</span></div></div></div>
      <div class="im-stack"><div class="im-panel" id="qFormP"><h2 id="qFormT">단가 기록 추가</h2><div class="im-fgrid">
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
          <p class="im-small" id="qWarn" style="margin:8px 0 0" hidden></p>
          <div class="im-row" style="margin-top:12px"><button type="button" class="im-btn is-primary" id="qAdd">추가</button><button type="button" class="im-btn" id="qCancel" hidden>수정 취소</button></div></div></div></div>
      <div class="im-panel" style="margin-top:var(--space-6)"><h2>단가 산출 기준 <small>팀 공통 · 견적 판정과 요약 예산에 쓰는 기준</small><span class="im-grow"></span><button type="button" class="im-btn is-sm" id="qCopy">팀 공유용 복사</button></h2>
          <dl class="im-basis is-2col">
            <dt>기준</dt><dd>게시물 1건 · USD · VAT·광고비 별도</dd>
            <dt>출처</dt><dd><a href="${RATE_SRC}" target="_blank" rel="noopener">Best Martech 2026 가격표</a> · 베트남 대행사 공개가(KOL &amp; KOC). 개별 계약가·평균값 아님, 대행 수수료 15% 별도</dd>
            <dt>구간</dt><dd><div class="im-tiers">${TIERS.map(t => `<b>${t.n}</b><em>${t.label}</em><span>${tierRange(t)}</span>`).join('')}</div></dd>
            <dt>환율</dt><dd><div class="im-row" style="gap:6px"><span>1 USD =</span><input type="number" id="xV" value="${esc(S.settings.vndPerUsd)}" aria-label="1달러당 동" style="width:110px"><span>VND ·</span><input type="number" id="xK" value="${esc(S.settings.krwPerUsd)}" aria-label="1달러당 원" style="width:90px"><span>KRW</span><button type="button" class="im-btn is-sm" id="xSave">저장</button></div><div class="im-small" id="xState" style="margin-top:4px"></div></dd>
            <dt>공식</dt><dd>조회 1천회당 = 금액 ÷ 조회수 중앙값 × 1,000<br>팔로워 1천명당 = 금액 ÷ 팔로워 × 1,000<br>CPV = 금액 ÷ 실제 조회수 (게시 후)</dd>
            <dt>판정</dt><dd><span class="im-cmp lo">낮음</span> 구간 하한 미만 · <span class="im-cmp in">적정</span> 구간 안 · <span class="im-cmp hi">높음</span> 상한 초과<br><span class="im-muted">상한의 10배 초과 또는 하한의 1/10 미만 → '입력 확인 필요(통화·자릿수)'</span></dd>
          </dl><pre id="qBasisTxt" hidden></pre></div>`;
      const qi = $('#qInf', v); qi.onchange = () => { const i = S.inf.get(qi.value), m = i && mainPf(i); if (m && !S.qEdit) $('#qPf', v).value = m.k; this.warn(v); };
      ['qPf', 'qAmt', 'qCur'].forEach(id => { $('#' + id, v).oninput = () => this.warn(v); });
      const body = () => ({ ...(S.qEdit ? { id: S.qEdit } : {}), infId: qi.value, platform: $('#qPf', v).value, format: $('#qFmt', v).value, layer: $('#qLayer', v).value, date: $('#qDate', v).value, amount: $('#qAmt', v).value, cur: $('#qCur', v).value, expViews: $('#qExp', v).value, actualViews: $('#qAct', v).value, cond: $('#qCond', v).value.trim() });
      $('#qAdd', v).onclick = () => {
        const b = body(); if (!b.infId) { toast('인플루언서를 고르세요'); return; } if (!+b.amount) { toast('금액을 입력하세요'); return; }
        const run = async () => { this._okAt = 0; const editing = !!S.qEdit; if (await saveQuote(b)) { toast(editing ? '단가 기록을 고쳤어요' : '단가 기록을 추가했어요'); this.resetForm(v); } };
        // 이상값이면 한 번 더 눌러야 저장 (4초 안에). 버튼 글자는 바꾸지 않아요
        if (isOutlier(quoteMetrics(b)) && !(this._okAt && Date.now() - this._okAt < 4000)) { this._okAt = Date.now(); this.warn(v); toast('이상값 같아요. 통화·자릿수를 확인했으면 버튼을 한 번 더 누르세요'); return; }
        run();
      };
      $('#qCancel', v).onclick = () => this.resetForm(v);
      $('#xSave', v).onclick = async () => { const a = +$('#xV', v).value, b = +$('#xK', v).value; if (!a || !b) { toast('환율을 숫자로 입력하세요'); return; } if (await saveSettings({ vndPerUsd: a, krwPerUsd: b, rateConfirm: true })) { toast('환율을 저장했어요'); this.rateState(v); } };
      $('#qCopy', v).onclick = () => { const t = this.basisText(); const pre = $('#qBasisTxt', v); pre.textContent = t; copyText(t, '단가 산출 기준', pre); };
      this.rateState(v);
    },
    basisText() {
      const s = S.settings;
      return ['[광고 단가 산출 기준 · 한정선 베트남 인플루언서]', '기준: 게시물 1건 · USD · VAT·광고비 별도',
        `출처: Best Martech 2026 가격표 (베트남 대행사 공개가, KOL & KOC 항목, 개별 계약가 아님) ${RATE_SRC}`, '구간 (팔로워 → 게시물 1건 USD):',
        ...TIERS.map(t => `  ${t.n} (${t.label}): ${tierRange(t)}${t.usd[1] ? '' : ' 별도 견적'}`),
        `환율: 1 USD = ${grp(s.vndPerUsd)} VND / ${grp(s.krwPerUsd)} KRW (${s.rateSavedAt ? '입력일 ' + s.rateSavedAt : '아직 입력 전 예시값'})`,
        '공식:', '  조회 1천회당 = 금액 ÷ 조회수 중앙값 × 1,000', '  팔로워 1천명당 = 금액 ÷ 팔로워 × 1,000', '  CPV = 금액 ÷ 실제 조회수 (게시 후)',
        '판정: 구간 하한 미만 = 낮음 / 구간 안 = 적정 / 상한 초과 = 높음', '이상값: 구간 상한의 10배 초과 또는 하한의 1/10 미만이면 "입력 확인 필요(통화·자릿수)"'].join('\n');
    },
    warn(v) {
      const el = $('#qWarn', v); if (!el) return;
      const m = quoteMetrics({ infId: $('#qInf', v).value, platform: $('#qPf', v).value, amount: $('#qAmt', v).value, cur: $('#qCur', v).value });
      const bad = +$('#qAmt', v).value && isOutlier(m);
      el.hidden = !bad; el.innerHTML = bad ? `<span class="im-chip st-declined">입력 확인 필요(통화·자릿수)</span> ${usd$(m.usd)}은(는) ${m.tier.n} 구간(${tierRange(m.tier)})에서 너무 멀어요. 통화(VND·USD·KRW)와 0의 개수를 확인하세요` : '';
    },
    resetForm(v) {
      S.qEdit = null; $('#qFormT', v).textContent = '단가 기록 추가'; $('#qAdd', v).textContent = '추가'; $('#qCancel', v).hidden = true;
      ['qAmt', 'qExp', 'qAct', 'qCond'].forEach(id => { $('#' + id, v).value = ''; }); $('#qDate', v).value = today(); this.warn(v); this.update(v);
    },
    edit(v, id) {
      const q = S.quotes.get(id); if (!q) return; S.qEdit = id; this.update(v);
      const set = (k, val) => { $('#' + k, v).value = val ?? ''; };
      set('qInf', q.infId); set('qPf', q.platform); set('qFmt', q.format || FORMATS[0]); set('qLayer', q.layer || 'quote'); set('qDate', q.date); set('qAmt', q.amount); set('qCur', q.cur || 'VND');
      set('qExp', q.expViews); set('qAct', q.actualViews); set('qCond', q.cond);
      $('#qFormT', v).textContent = `단가 기록 수정 · ${(S.inf.get(q.infId) || {}).name || q.name || ''}`; $('#qAdd', v).textContent = '수정 저장'; $('#qCancel', v).hidden = false;
      this.warn(v); $('#qFormP', v).scrollIntoView({ behavior: 'smooth', block: 'nearest' }); $('#qAmt', v).focus();
    },
    rateState(v) {
      const d = S.settings.rateSavedAt, el = $('#xState', v); if (!el) return;
      el.innerHTML = d ? `직접 입력한 환율 · 입력일 <b>${esc(d)}</b>` : '<span style="color:var(--im-warn)">아직 예시값이에요. 환율을 입력하고 저장하세요</span>';
    },
    update(v) {
      const L = infList().sort((a, b) => a.name.localeCompare(b.name)), qi = $('#qInf', v), cur = qi.value;
      qi.innerHTML = '<option value="">선택</option>' + L.map(i => `<option value="${esc(i.id)}" ${i.id === cur ? 'selected' : ''}>${esc(i.name)}</option>`).join('');
      const Q = [...S.quotes.values()].sort((a, b) => (b.date || '').localeCompare(a.date || ''));
      $('#qBody', v).innerHTML = Q.length ? Q.map(q => { const m = quoteMetrics(q), bad = isOutlier(m); return `<tr ${S.qEdit === q.id ? 'class="is-editing"' : ''}>
          <td><div class="im-acts"><button type="button" class="im-btn is-sm" data-qe="${esc(q.id)}">수정</button><button type="button" class="im-btn is-sm is-ghost" data-qd="${esc(q.id)}">삭제</button></div></td>
          <td><b>${esc(m.i?.name || q.name || '삭제됨')}</b>${q.example ? ' <span class="im-demo">시연</span>' : ''}<div class="im-sub">${esc(q.date || '')}${q.cond ? ' · ' + esc(q.cond) : ''}</div>${bad ? '<span class="im-chip st-declined">입력 확인 필요(통화·자릿수)</span>' : ''}</td>
          <td><span class="im-pf pf-${q.platform}"><i></i>${PFN[q.platform] || ''}</span><div class="im-sub">${esc(q.format || '')} · ${LAYERS[q.layer] || ''}</div></td>
          <td class="r im-num">${grp(q.amount)} <span class="im-faint">${esc(q.cur)}</span><div class="im-sub">$${grp(m.usd)}</div></td>
          <td class="r im-num">${m.cpm != null ? grp(m.cpm) + ' ₫' : '–'}</td><td class="r im-num">${m.perK != null ? grp(m.perK) + ' ₫' : '–'}</td><td class="r im-num">${m.cpv != null ? grp(m.cpv) + ' ₫' : '–'}</td>
          <td>${bad ? '<span class="im-cmp hi">확인 필요</span>' : m.cmp ? `<span class="im-cmp ${m.cmp}" title="${m.tier.n} 구간 ${tierRange(m.tier)}">${CMP_TXT[m.cmp]}</span> <span class="im-faint">${m.tier.n}</span>` : '<span class="im-faint">팔로워 없음</span>'}</td></tr>`; }).join('')
        : '<tr><td colspan="8"><div class="im-empty" style="border:0">받은 견적이나 계약 금액을 아래 오른쪽에서 추가하세요. 쌓일수록 회사 자체 기준표가 돼요.</div></td></tr>';
      $$('[data-qd]', v).forEach(b => { b.onclick = () => armButton(b, '확인', async () => { if (await delQuote(b.dataset.qd)) { if (S.qEdit === b.dataset.qd) this.resetForm(v); toast('삭제했어요'); } }); });
      $$('[data-qe]', v).forEach(b => { b.onclick = () => this.edit(v, b.dataset.qe); });
      this.chart(v, Q); this.rateState(v);
    },
    chart(v, Q) {
      const W = 640, H = 300, ml = 52, mr = 14, mt = 12, mb = 34, x0 = 3, x1 = 7, y0 = 1, y1 = 5;
      const X = f => ml + (Math.log10(Math.max(f, 10 ** x0)) - x0) / (x1 - x0) * (W - ml - mr), Y = u => mt + (1 - (Math.log10(Math.min(Math.max(u, 10 ** y0), 10 ** y1)) - y0) / (y1 - y0)) * (H - mt - mb);
      let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="팔로워 대비 게시물 단가 산점도">`;
      for (let e = y0; e <= y1; e++) s += `<line class="im-ax" x1="${ml}" x2="${W - mr}" y1="${Y(10 ** e)}" y2="${Y(10 ** e)}" stroke-width="1"/><text x="${ml - 6}" y="${Y(10 ** e) + 4}" text-anchor="end">$${short(10 ** e)}</text>`;
      for (let e = x0; e <= x1; e++) s += `<line class="im-ax" y1="${mt}" y2="${H - mb}" x1="${X(10 ** e)}" x2="${X(10 ** e)}" stroke-width="1"/><text x="${X(10 ** e)}" y="${H - mb + 16}" text-anchor="middle">${short(10 ** e)}</text>`;
      s += `<text x="${(ml + W - mr) / 2}" y="${H - 4}" text-anchor="middle">팔로워</text>`;
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
  const needUrlPf = i => Object.entries(i.pf || {}).filter(([, ch]) => ch && ch.need_url && !ch.url).map(([k]) => PFN[k] || k).join('·');
  const SL_ORDER = ['TikTok', 'Instagram', 'YouTube', 'Facebook', 'Google'];
  const searchLinks = r => r.search_links && Object.keys(r.search_links).length ? `<div class="im-sub">직접 찾기: ${SL_ORDER.filter(k => r.search_links[k]).map(k => `<a href="${esc(r.search_links[k])}" target="_blank" rel="noopener">${k}</a>`).join(' · ')}</div>` : '';
  // 참고 자료 CSV(reference_data) 결과의 분류 색 칩. 색은 팀 토큰만 사용
  const REF_COLOR = { 초록: ['var(--im-ok)', 'var(--on-dark)'], 연두: ['var(--im-ok-soft)', 'var(--im-ok)'], 노랑: ['var(--im-warn-soft)', 'var(--im-warn)'],
    회색: ['var(--im-sunk)', 'var(--im-muted)'], 주황: ['var(--im-warn-soft)', 'var(--im-bad)'], 빨강: ['var(--im-bad-soft)', 'var(--im-bad)'], 보라: ['var(--im-accent-soft)', 'var(--im-accent)'] };
  const refChip = r => {
    if (!r.ref_class && !r.ref_identity) return '';
    const [bg, fg] = REF_COLOR[r.ref_color] || REF_COLOR['회색'];
    const warn = r.ref_identity && r.ref_identity.startsWith('이름만') ? '<div class="im-sub" style="color:var(--im-warn)">순위 계정과 같은 계정인지 확인 필요(이름만 일치)</div>' : '';
    return `<div class="im-sub"><span class="im-chip" style="background:${bg};color:${fg}">${esc(r.ref_class || '')}${r.ref_color ? ' · ' + esc(r.ref_color) : ''}</span>${r.ref_food !== '' && r.ref_food != null ? ` 식품 관련성 ${esc(r.ref_food)}/3` : ''}${r.ref_rank ? ' · ' + esc(r.ref_rank) : ''}</div>${r.ref_fol_src && r.followers != null ? `<div class="im-sub">팔로워: ${esc(r.ref_fol_src)}</div>` : ''}${warn}`;
  };
  /* 화면에 보이는 조회 방법: YouTube Data API + 참고 자료 CSV(NoxInfluencer).
     Modash·HypeAuditor·Phyllo·TikTok One 연결 코드는 discovery.py·external_api.py에 그대로 있고 화면에서만 뺐어요 (Ver_017) */
  const shownProvider = p => p.key === 'youtube' || p.ref;
  const TTO_URL = 'https://ads.tiktok.com/creative';
  const DSUBS = [['find', '후보 탐색', 'YouTube API·NoxInfluencer 기반 후보 일괄 조회'], ['file', '파일 자동 정제', '엑셀(CSV) 넣으면 숫자·칸 이름 자동 정리'], ['manual', '직접 등록', 'TikTok 화면 확인값 입력·중복 확인']];
  const SORTS = [['base', '기본 순서 (Nox 순위·검색 순서)'], ['fol', '인기순 (팔로워 많은 순)'], ['views', '조회수 많은 순']];
  S.disc = S.disc || { platform: 'tt', provider: '', cats: ['Dessert', 'Korean Food'], rows: [], sel: new Set(), meta: null, source: '', segment: '', sub: 'find', sort: 'base' };
  const SEGS = C.segments || [];
  const segOf = name => SEGS.find(x => x.name === name);
  VIEWS.discover = {
    mount(v) {
      const D = S.disc;
      v.innerHTML = `<div class="im-apiline" id="dApi"><span class="im-muted">YouTube Data API 상태 확인 중…</span></div>
      <div class="im-subtabs" role="tablist" id="dSubs">${DSUBS.map(([k, n, s], i) => `<button type="button" role="tab" data-sub="${k}" aria-selected="${D.sub === k}"><b>${i + 1}. ${n}</b><span>${s}</span></button>`).join('')}</div>
      <div class="im-panel" data-pane="find">
        <div class="im-eyebrow">타깃 그룹 <span class="im-muted" style="text-transform:none;letter-spacing:0;font-weight:400">· 누르면 조건이 바뀌고, 등록할 때 이 그룹으로 저장돼요</span></div>
        <div class="im-seg is-compact" id="dSegs">${SEGS.map(x => `<button type="button" data-seg="${esc(x.name)}" aria-pressed="${D.segment === x.name}">${esc(x.name)}</button>`).join('')}<button type="button" data-seg="" aria-pressed="false">선택 해제</button></div>
        <p class="im-muted im-small" id="dSegMsg" style="margin:6px 0 0">${D.segment ? `선택: <b>${esc(D.segment)}</b>` : '그룹을 고르지 않으면 등록할 때 미분류로 저장돼요'}</p>
        <div class="im-fgrid" style="margin-top:12px">
          <label class="im-field">플랫폼<select id="dPf">${[['tt', 'TikTok'], ['ig', 'Instagram'], ['yt', 'YouTube']].map(([k, n]) => `<option value="${k}" ${D.platform === k ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
          <label class="im-field is-span2">조회할 곳<select id="dProv"></select></label>
          <label class="im-field">최소 팔로워<input type="number" min="0" id="dMinF" value="1000" placeholder="1000 (Nano 이상)"></label>
          <label class="im-field">최대 팔로워<input type="number" min="0" id="dMaxF" value="" placeholder="제한 없음"></label>
          <label class="im-field is-span2">정렬<select id="dSort">${SORTS.map(([k, n]) => `<option value="${k}" ${D.sort === k ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
          <label class="im-field is-wide" id="dKwWrap">YouTube 검색어<input type="text" id="dKw" placeholder="비우면 타깃 그룹에 맞는 검색어를 써요"></label></div>
        <details class="im-fold" id="dKwEx"><summary>베트남어 검색어 예시</summary>${kwChips('dKw')}</details>
        <details class="im-fold"><summary>조건 더 보기 <span class="im-muted im-small">국가·언어·조회수·참여율·베트남 시청자</span></summary><div class="im-fgrid" style="margin-top:10px">
          <label class="im-field">국가/지역<select id="dCountry"><option value="Vietnam">베트남</option><option value="Korea">한국</option><option value="">제한 없음</option></select></label>
          <label class="im-field">콘텐츠 언어<select id="dLang"><option value="vi">베트남어</option><option value="">제한 없음</option><option value="en">영어</option><option value="ko">한국어</option></select></label>
          <label class="im-field">최소 조회수<input type="number" min="0" id="dMinV" placeholder="예: 5000"></label>
          <label class="im-field">최소 참여율(%)<input type="number" min="0" max="100" step="0.1" id="dMinEr" placeholder="예: 3"></label>
          <label class="im-field">베트남 시청자 최소(%)<input type="number" min="0" max="100" id="dMinVn" placeholder="예: 60"></label></div></details>
        <div class="im-row" style="margin-top:12px"><button type="button" class="im-btn is-primary" id="dGo">후보 검색</button><label class="im-row im-small" id="dRefOpt" style="gap:4px" hidden><input type="checkbox" id="dRefEx">제외(D) 등급도 보기</label><span class="im-muted im-small" id="dGoMsg"></span></div>
        <p class="im-muted im-small" id="dProvNote" style="margin:8px 0 0"></p></div>
      <div class="im-panel" data-pane="file">
        <p class="im-small" style="margin:0 0 10px">에이전시 자료·SaaS 내보내기처럼 열 이름과 숫자 표기(1.2M, 12,5K, 0.035 등)가 제각각인 파일을 자동으로 정리해 미리보기로 보여 줘요. 저장은 아래 결과 표에서 골라서 해요. 엑셀은 'CSV UTF-8'로 저장해서 올리세요.</p>
        <div class="im-fgrid">
          <label class="im-field">이 파일의 출처<select id="dCsvSrc"><option value="">파일의 '출처' 열 따르기 (우리 양식)</option><option value="saas">전문 SaaS 내보내기 파일</option><option value="submitted">에이전시·인플루언서 제출 자료</option><option value="manual">직접 확인한 값</option></select></label>
          <label class="im-field">제공처 이름 (선택)<input type="text" id="dCsvProv" maxlength="60" placeholder="예: OO에이전시"></label>
          <label class="im-field">플랫폼 열이 없을 때<select id="dCsvPf"><option value="">주소로 자동 판별</option><option value="tt">TikTok</option><option value="ig">Instagram</option><option value="yt">YouTube</option><option value="fb">Facebook</option></select></label>
          <input type="checkbox" id="dCsvDemo" hidden></div>
        <div class="im-row" style="margin-top:10px"><label class="im-btn is-primary" for="dCsv" style="cursor:pointer">파일 올리기</label><input type="file" id="dCsv" accept=".csv,.tsv,.txt,text/csv,text/tab-separated-values" hidden><a class="im-btn is-sm" href="${API}export/discovery_template.csv">발굴 후보 CSV 양식</a></div>
        <div id="dCsvRep" style="margin-top:10px"></div></div>
      <div class="im-panel" data-pane="manual">
        <div class="im-row" style="margin-bottom:10px"><p class="im-small im-grow" style="margin:0">TikTok One 같은 화면에서 확인한 값을 옮겨 적어 등록해요. 주소를 넣고 [중복 확인]을 누르면 이미 있는 계정인지 알려 줘요.</p><a class="im-btn is-sm" href="${TTO_URL}" target="_blank" rel="noopener">TikTok One 열기</a></div>
        <div class="im-fgrid">
          <label class="im-field">플랫폼<select id="mPf"><option value="tt">TikTok</option><option value="ig">Instagram</option><option value="yt">YouTube</option><option value="fb">Facebook</option></select></label>
          <label class="im-field is-span2">타깃 그룹<select id="mSeg"><option value="">미분류</option>${SEGS.map(x => `<option ${D.segment === x.name ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select></label>
          <label class="im-field">출처<select id="mSrc"><option value="manual|TikTok One (화면 확인)">TikTok One 화면 확인</option><option value="manual|직접 확인">채널에서 직접 확인</option><option value="submitted|인플루언서 제출">인플루언서 제출 자료</option><option value="submitted|에이전시 자료">에이전시 자료</option><option value="official_api|YouTube API">YouTube API (자동 채우기)</option></select></label>
          <label class="im-field is-wide">계정 주소 또는 @핸들 *<input type="text" id="mRef" placeholder="https://www.tiktok.com/@아이디"></label>
          <label class="im-field">이름<input type="text" id="mName"></label>
          <label class="im-field">팔로워<input type="number" min="0" id="mF"></label>
          <label class="im-field">조회수 중앙값<input type="number" min="0" id="mV"></label>
          <label class="im-field">평균 조회수<input type="number" min="0" id="mAvg"></label>
          <label class="im-field">참여율(%)<input type="number" min="0" max="100" step="0.1" id="mEr"></label>
          <label class="im-field">베트남 시청자(%)<input type="number" min="0" max="100" id="mVn"></label>
          <label class="im-field">수집일<input type="date" id="mAt" value="${today()}"></label>
          <label class="im-field">분야<select id="mCat"><option value="">선택 안 함</option>${C.categories.map(c => `<option>${esc(c)}</option>`).join('')}</select></label></div>
        <p class="im-muted im-small" style="margin:6px 0 0">평균만 알면 평균 칸에만 넣으세요. 중앙값 칸에 평균을 넣지 않아요.</p>
        <div class="im-row" style="margin-top:10px"><button type="button" class="im-btn" id="mFill">YouTube 지표 채우기</button><button type="button" class="im-btn" id="mChk">중복 확인</button><button type="button" class="im-btn is-primary" id="mAdd">후보로 등록</button><span class="im-small" id="mMsg"></span></div></div>
      <div class="im-panel" id="dResP" style="margin-top:var(--space-5)"><h2>결과 <small id="dMeta"></small></h2><div id="dNotice"></div><div id="dRes"></div>
        <div class="im-row" style="margin-top:10px"><button type="button" class="im-btn is-primary" id="dReg" disabled>선택한 후보 등록</button><span class="im-muted im-small" id="dRegMsg">같은 플랫폼의 같은 계정은 자동으로 건너뛰어요. 등록하면 '후보' 상태로 인플루언서 목록에 들어가요.</span></div></div>`;
      $$('#dSubs button', v).forEach(b => { b.onclick = () => this.sub(v, b.dataset.sub); });
      $('#dPf', v).onchange = e => { D.platform = e.target.value; this.followersLabel(v); this.providers(v); };
      $('#dSort', v).onchange = e => { D.sort = e.target.value; this.results(v); };
      $$('#dSegs button', v).forEach(b => { b.onclick = () => this.applySegment(v, b.dataset.seg); });
      $('#dGo', v).onclick = () => this.search(v);
      $('#dReg', v).onclick = () => this.register(v, D.rows.filter((r, i) => D.sel.has(i)));
      const manual = () => { const [st, prov] = $('#mSrc', v).value.split('|'); return { platform: $('#mPf', v).value, url: $('#mRef', v).value.trim(), name: $('#mName', v).value.trim(), followers: $('#mF', v).value, median_views: $('#mV', v).value, avg_views: $('#mAvg', v).value, er: $('#mEr', v).value, vn_audience: $('#mVn', v).value, collected_on: $('#mAt', v).value, category: $('#mCat', v).value, source_type: st, provider: prov, country: $('#dCountry', v).value, language: $('#dLang', v).value, segment: $('#mSeg', v).value }; };
      const mMsg = (t, bad) => { const m = $('#mMsg', v); m.textContent = t; m.style.color = bad ? 'var(--im-bad)' : 'var(--im-ok)'; };
      $('#mFill', v).onclick = async () => { const pf = $('#mPf', v).value, ref = $('#mRef', v).value.trim();
        if (pf !== 'yt') { mMsg('자동 채우기는 YouTube만 돼요. TikTok·Instagram·Facebook은 화면에서 확인한 값을 입력하세요', true); return; }
        if (!ref) { mMsg('계정 주소를 먼저 넣어 주세요', true); return; }
        const b = $('#mFill', v); b.disabled = true; mMsg('YouTube에서 가져오는 중… (약 3유닛)', false);
        try { const r = await api('POST', 'api/discovery/fill', { platform: pf, ref });
          const set = (id, val) => { if (val != null && val !== '') $('#' + id, v).value = val; };
          if (!$('#mName', v).value.trim()) set('mName', r.name); set('mF', r.followers); set('mV', r.median_views); set('mAvg', r.avg_views); set('mEr', r.er);
          $('#mAt', v).value = today(); $('#mSrc', v).value = 'official_api|YouTube API';
          mMsg(`채웠어요. ${r.note || ''} 베트남 시청자 비중은 공개 API로 알 수 없어 비워 둬요`, false); this.apiLine(v); }
        catch (e) { mMsg(e.message, true); } finally { b.disabled = false; } };
      $('#mChk', v).onclick = async () => { const m = manual(); if (!m.url) { mMsg('계정 주소를 넣어 주세요', true); return; }
        try { const r = await api('POST', 'api/discovery/check', { platform: m.platform, ref: m.url }); mMsg(r.duplicate ? `이미 등록된 계정이에요: ${r.duplicate_of.name}` : '새 계정이에요. 등록할 수 있어요', r.duplicate); } catch (e) { mMsg(e.message, true); } };
      $('#mAdd', v).onclick = async () => { const m = manual(); if (!m.url) { mMsg('계정 주소를 넣어 주세요', true); return; } await this.register(v, [m], mMsg); };
      $('#dCsv', v).onchange = async e => { const file = e.target.files[0]; e.target.value = ''; if (!file) return;
        const fd = new FormData(); fd.append('file', file); fd.append('source', $('#dCsvSrc', v).value); fd.append('provider', $('#dCsvProv', v).value.trim());
        fd.append('platform', $('#dCsvPf', v).value); if ($('#dCsvDemo', v).checked) fd.append('demo', '1');
        try { const r = await api('POST', 'api/discovery/import-csv', fd, true); D.rows = r.rows; D.sel = new Set(r.rows.map((x, i) => x.duplicate ? -1 : i).filter(i => i >= 0)); D.meta = { csv: true, errors: r.errors, report: r.report }; D.source = 'CSV'; this.csvReport(v, r.report, r.errors, file.name); this.results(v); toast(`${r.rows.length}명을 읽었어요. 확인 후 [선택한 후보 등록]을 누르세요`); }
        catch (err) { $('#dCsvRep', v).innerHTML = `<div class="im-note">${esc(err.message)}</div>`; toast(err.message); } };
      this.followersLabel(v); bindKw(v); this.sub(v, D.sub); this.providers(v); this.results(v); this.apiLine(v);
    },
    sub(v, k) {
      S.disc.sub = k;
      $$('#dSubs button', v).forEach(b => b.setAttribute('aria-selected', b.dataset.sub === k));
      $$('[data-pane]', v).forEach(p => { p.hidden = p.dataset.pane !== k; });
      $('#dResP', v).hidden = k === 'manual';
    },
    async apiLine(v) {
      const el = $('#dApi', v); if (!el) return;
      let st; try { st = await api('GET', 'api/integrations/status'); } catch (e) { el.innerHTML = `<span class="im-muted">YouTube Data API · 상태를 불러오지 못했어요 (${esc(e.message)})</span>`; return; }
      const y = st.youtube || {}, s = (st.services || {}).youtube || {};
      const state = !y.configured ? '<b class="is-off">키 없음</b> <span class="im-muted">· 서버 .env의 YOUTUBE_API_KEY에 넣고 다시 켜면 연결돼요. NoxInfluencer 참고 자료는 키 없이 검색돼요</span>'
        : s.last_result === 'error' ? `<b class="is-bad">연결 실패</b> <span class="im-muted">· ${esc(s.last_error || '')}</span>` : s.last_result === 'ok' ? '<b class="is-ok">연결됨 ✓</b>' : '<b>키 설정됨</b> <span class="im-muted">· 연결 확인 전</span>';
      el.innerHTML = `<span class="im-grow">YouTube Data API · ${state}${y.configured ? ` · <span title="서버를 켠 뒤 이 대시보드에서 쓴 양 (미국 태평양 시간 자정에 0으로)">오늘 사용 <span class="im-num">${grp(y.units_used || 0)}/${grp(y.daily_limit || 10000)}</span> 유닛</span>` : ''}</span>${y.configured ? '<button type="button" class="im-btn is-sm is-ghost" id="dApiTest">연결 확인</button>' : ''}`;
      const tb = $('#dApiTest', v); if (tb) tb.onclick = async () => { tb.disabled = true; tb.textContent = '확인 중…'; try { await api('POST', 'api/integrations/youtube/test'); toast('YouTube Data API 연결을 확인했어요'); } catch (e) { toast(e.message); } this.apiLine(v); };
    },
    csvReport(v, rep, errors, fname) {
      const box = $('#dCsvRep', v); if (!rep) { box.innerHTML = ''; return; }
      const items = [
        `읽은 행 ${grp(rep.rows_read)}개 → 미리보기 ${grp(rep.rows_ok)}명${rep.row_errors ? ` · 오류 ${rep.row_errors}줄` : ''}${rep.truncated ? ' · 2,000행까지만 읽음' : ''}`,
        `인코딩 ${esc(rep.encoding)} · 구분자 ${esc(rep.delimiter)}`,
        `열 대응: ${rep.mapping.map(m => `${esc(m.column)} → <b>${esc(m.label)}</b>`).join(', ')}`,
        rep.unused_columns.length ? `사용하지 않은 열: ${esc(rep.unused_columns.join(', '))}` : '',
        rep.fixed_cells ? `숫자 표기 정리 ${grp(rep.fixed_cells)}칸 (예: 1.2M → 1,200,000)` : '',
        rep.blanked_cells ? `<span style="color:var(--im-warn)">읽지 못해 비워 둔 칸 ${grp(rep.blanked_cells)}개</span>` : '',
        rep.pct_scaled.length ? `${esc(rep.pct_scaled.join('·'))}: 0~1 비율로 적혀 있어 %로 바꿈` : '',
        rep.views_basis_unknown ? '<span style="color:var(--im-warn)">조회수 기준(중앙값/평균)이 없는 열 → 중앙값 칸에 넣지 않고 평균 칸에 저장</span>' : '',
        rep.date_filled ? `수집일이 없는 ${grp(rep.date_filled)}행은 오늘 날짜로 채움` : '',
        rep.duplicates_in_file.length ? `파일 안 중복 ${rep.duplicates_in_file.length}행 제외 (${rep.duplicates_in_file.map(d => d.line + '행=' + d.same_as_line + '행').join(', ')})` : '',
        rep.skipped_example ? `양식 예시 줄 ${rep.skipped_example}개 건너뜀` : '',
      ].filter(Boolean);
      const saved = rep.auto_cells != null ? `<div class="im-saved"><b>${grp(rep.auto_cells)}칸 자동 정리 · 중복 ${grp(rep.dup_removed)}건 제외 · ${fmtSaved(rep.saved_sec)} 절약</b><span>(1칸 ${rep.sec_per_cell}초 기준${rep.counted ? ' · 이번 달 칼퇴 지표에 더함' : ' · 이번 달에 이미 올린 파일이라 누적에는 다시 더하지 않음'})</span></div>` : '';
      box.innerHTML = `${saved}<details class="im-fold" style="margin-top:8px"><summary>정제 내역 자세히 <span class="im-muted im-small">${esc(fname)}</span></summary><ul class="im-small" style="margin:6px 0 0;padding-left:18px">${items.map(t => `<li>${t}</li>`).join('')}</ul></details>${(errors || []).length ? `<div class="im-note" style="margin-top:8px">${errors.slice(0, 20).map(e => esc(e.line + '행: ' + e.error)).join('<br>')}${errors.length > 20 ? '<br>…' : ''}</div>` : ''}`;
    },
    followersLabel(v) {
      const yt = S.disc.platform === 'yt';
      const ids = ['dMinF','dMaxF'];
      ids.forEach((id, i) => { const field = $('#' + id, v)?.closest('label'); if (field) field.firstChild.textContent = (i ? '최대 ' : '최소 ') + (yt ? '구독자 수' : '팔로워'); });
    },
    filters(v) {
      const n = id => { const x = $('#' + id, v).value; return x === '' ? null : +x; };
      return { country: $('#dCountry', v).value, language: $('#dLang', v).value, min_followers: n('dMinF'), max_followers: n('dMaxF'), min_views: n('dMinV'), min_er: n('dMinEr'), min_vn_audience: n('dMinVn'), categories: S.disc.cats, keyword: $('#dKw', v).value.trim() };
    },
    applySegment(v, name) {
      const D = S.disc, sg = segOf(name);
      D.segment = sg ? sg.name : '';
      $$('#dSegs button', v).forEach(x => x.setAttribute('aria-pressed', !!sg && x.dataset.seg === sg.name));
      $('#dSegMsg', v).innerHTML = sg ? `선택: <b>${esc(sg.name)}</b> · ${esc({ tt: 'TikTok', ig: 'Instagram', yt: 'YouTube' }[sg.platform])}, ${sg.country === 'Korea' ? '한국·한국어' : '베트남·베트남어'}, 검색어 "${esc(sg.keyword)}"` : '그룹을 고르지 않으면 등록할 때 미분류로 저장돼요';
      if (sg) { D.platform = sg.platform; $('#dPf', v).value = sg.platform; $('#dCountry', v).value = sg.country; $('#dLang', v).value = sg.language; $('#dKw', v).value = sg.keyword; D.cats = [...sg.cats]; }
      const ms = $('#mSeg', v); if (ms) ms.value = D.segment;
      this.providers(v);
    },
    async providers(v) {
      const sel = $('#dProv', v); let list;
      try { list = (await api('GET', 'api/discovery/providers')).filter(shownProvider); } catch (e) { $('#dProvNote', v).textContent = e.message; return; }
      const D = S.disc, ok = p => p.search && p.configured && p.platforms.includes(D.platform), usable = list.filter(ok);
      if (!usable.some(p => p.key === D.provider)) D.provider = (usable.find(p => p.ref) || usable[0] || {}).key || '';
      sel.innerHTML = list.map(p => `<option value="${esc(p.key)}" ${p.key === D.provider ? 'selected' : ''} ${ok(p) ? '' : 'disabled'}>${esc(p.name)}${p.note ? ' ' + esc(p.note) : ''}${p.ref ? ` · ${p.count}개` : ''}${ok(p) ? '' : !p.platforms.includes(D.platform) ? ' (이 플랫폼 없음)' : p.ref ? ' (파일 없음)' : ' (키 없음)'}</option>`).join('');
      const sync = () => { const p = list.find(x => x.key === D.provider);
        $('#dRefOpt', v).hidden = !String(D.provider || '').startsWith('ref:');
        $('#dKwWrap', v).hidden = $('#dKwEx', v).hidden = D.provider !== 'youtube';
        $('#dProvNote', v).textContent = p ? `${srcLabel(p.source_type)} · ${p.cost}${p.not_supported.length ? ' · 이 자료로 거를 수 없는 조건: ' + p.not_supported.join(', ') : ''}` : ''; };
      sel.onchange = () => { D.provider = sel.value; sync(); }; sync();
      $('#dGo', v).disabled = !usable.length;
      $('#dGoMsg', v).textContent = usable.length ? '' : '이 플랫폼에 쓸 수 있는 조회 방법이 없어요. [파일 자동 정제]·[직접 등록]을 쓰세요';
    },
    async search(v) {
      const D = S.disc, b = $('#dGo', v); if (!D.provider) { toast('조회할 곳을 고르세요'); return; }
      b.disabled = true; $('#dRes', v).innerHTML = '<p class="im-muted" style="margin:0">조회 중…</p>';
      const platform = D.platform;
      try { const ex = $('#dRefEx', v); const r = await api('POST', 'api/discovery/search', { provider: D.provider, platform, filters: { ...this.filters(v), include_excluded: !!(ex && ex.checked) } });
        D.rows = r.rows; D.meta = { ...r.meta, platform }; D.source = D.provider; D.sel = new Set(); this.results(v); if (D.provider === 'youtube') this.apiLine(v); }
      catch (e) { D.rows = []; $('#dRes', v).innerHTML = `<div class="im-note">${esc(e.message)}<br>[파일 자동 정제]·[직접 등록]으로 이어서 진행할 수 있어요.</div>`; $('#dMeta', v).textContent = ''; }
      finally { b.disabled = false; }
    },
    order() {
      const D = S.disc, idx = D.rows.map((r, i) => i), val = (r, k) => (k === 'fol' ? r.followers : (r.median_views ?? r.avg_views)) ?? -1;
      if (D.sort === 'fol' || D.sort === 'views') idx.sort((a, b) => val(D.rows[b], D.sort) - val(D.rows[a], D.sort));
      return idx;
    },
    results(v) {
      const D = S.disc, box = $('#dRes', v);
      if (!D.rows.length) { box.innerHTML = '<div class="im-empty">[후보 검색]을 누르거나 파일을 올리면 후보가 여기에 나와요</div>'; $('#dReg', v).disabled = true; $('#dMeta', v).textContent = ''; $('#dNotice', v).innerHTML = ''; return; }
      this.notice(v);
      const m = D.meta || {}, pfName = PFN[m.platform || D.platform];
      $('#dMeta', v).textContent = m.ref ? `${m.label}${m.as_of ? ' (' + m.as_of.replace(/-/g, '/') + ' 기준)' : ''} · 전체 ${m.total}개 중 ${pfName} ${m.platform_total}개${m.hidden_excluded ? ` · 제외(D) 등급 ${m.hidden_excluded}개 숨김` : ''}${m.below_nano ? ` · 팔로워 1천 미만 ${m.below_nano}개 제외(Nano 미만)` : ''} → 검색 조건 적용 후 ${D.rows.length}개${(m.after_filter ?? D.rows.length) < (m.returned ?? 0) ? ` (팔로워·참여율 조건 밖 ${m.returned - m.after_filter}개 숨김 · 조건 칸을 비우면 보여요)` : ''}${D.rows.some(r => r.no_url) ? ` · 주소 직접 확인 필요 ${D.rows.filter(r => r.no_url).length}개` : ''}` : m.csv ? `파일 ${D.rows.length}명${(m.errors || []).length ? ` · 오류 ${m.errors.length}줄` : ''}` : `${pfName} · 받은 결과 ${m.returned ?? D.rows.length}건 → 조건 적용 후 ${D.rows.length}건`;
      const visible = {followers: D.rows.some(r => r.followers != null), views: D.rows.some(r => r.median_views != null || r.avg_views != null), er: D.rows.some(r => r.er != null), vn: D.rows.some(r => r.vn_audience != null)};
      const emptyCell = '<span class="im-faint im-small">미공개</span>';
      const metricHeaders = `${visible.followers ? `<th class="r">${D.platform === 'yt' ? '구독자 수' : '팔로워'}</th>` : ''}${visible.views ? '<th class="r">조회수</th>' : ''}${visible.er ? '<th class="r">참여율</th>' : ''}${visible.vn ? '<th class="r">베트남 시청자</th>' : ''}`;
      box.innerHTML = `<div class="im-tblwrap is-scroll"><table><thead><tr><th><input type="checkbox" id="dAll" aria-label="모두 선택"></th><th>계정</th>${metricHeaders}<th>출처·신뢰도</th><th>등록 여부</th></tr></thead><tbody>${this.order().map(i => { const r = D.rows[i]; return `<tr>
        <td><input type="checkbox" data-i="${i}" ${D.sel.has(i) ? 'checked' : ''} ${r.duplicate ? 'disabled' : ''} aria-label="${esc(r.name)} 선택"></td>
        <td>${r.display_name !== undefined ? (r.url ? `<a href="${esc(r.url)}" target="_blank" rel="noopener"><b>${r.handle && !r.handle.startsWith('UC') ? '@' + esc(r.handle) : esc(r.name)}</b></a>${r.handle && !r.handle.startsWith('UC') ? ` <span class="im-muted">${esc(r.name)}</span>` : ''} <span class="im-chip st-shot">프로필 링크</span>` : `<b>${esc(r.name)}</b> <span class="im-chip st-replied">주소 직접 확인 필요</span>`) + (r.display_name && r.display_name !== r.name ? `<div class="im-sub">Nox 표기: ${esc(r.display_name)}</div>` : '') + searchLinks(r) : r.url ? `<a href="${esc(r.url)}" target="_blank" rel="noopener"><b>${esc(r.name || r.handle)}</b></a>` : `<b>${esc(r.name)}</b>`}${refChip(r)}<div class="im-sub"><span class="im-pf pf-${r.platform}"><i></i>${PFN[r.platform]}</span> ${r.handle ? '@' + esc(r.handle) : '<span class="im-faint">주소 미확인</span>'}${r.country ? ' · ' + esc(r.country) : ''}</div>${r.enriched ? `<div class="im-sub">지표 채움: ${esc(r.enriched)}</div>` : ''}${(r.cleansing || []).length ? `<div class="im-sub" style="color:var(--im-warn)">정제: ${esc(r.cleansing.join(', '))}</div>` : ''}</td>
        ${visible.followers ? `<td class="r im-num">${r.followers != null ? short(r.followers) : emptyCell}</td>` : ''}
        ${visible.views ? `<td class="r im-num">${r.median_views != null ? short(r.median_views) + '<div class="im-sub">중앙값</div>' : r.avg_views != null ? short(r.avg_views) + '<div class="im-sub">평균</div>' : emptyCell}</td>` : ''}
        ${visible.er ? `<td class="r im-num">${r.er != null ? pct(r.er) : emptyCell}</td>` : ''}${visible.vn ? `<td class="r im-num">${r.vn_audience != null ? pct(r.vn_audience) : emptyCell}</td>` : ''}
        <td>${esc(r.provider || '')}<div class="im-sub">${esc(srcLabel(r.source_type))} ${confChip(r.confidence)} · ${esc(r.collected_on || '')}</div>${r.est_cost != null ? `<div class="im-sub">SaaS 추정 광고비 ${grp(r.est_cost)} (계약가 아님)</div>` : ''}</td>
        <td>${r.duplicate ? `<span class="im-chip st-declined">등록됨</span><div class="im-sub">${esc(r.duplicate_of.name)}</div>` : r.no_url ? '<span class="im-chip st-sent">신규</span><div class="im-sub" style="color:var(--im-warn)">주소 직접 확인 필요<br>등록 후 편집 창에서 주소 입력</div>' : '<span class="im-chip st-sent">신규</span>'}</td></tr>`; }).join('')}</tbody></table></div>`;
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
          D.rows = [...r.rows, ...D.rows.slice(25)]; D.sel = new Set(); this.results(v); this.apiLine(v);
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
