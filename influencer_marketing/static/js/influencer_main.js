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
  const ST_COLOR = { candidate: 'var(--im-faint)', sent: 'var(--im-accent)', replied: 'var(--im-warn)', negotiating: '#C9932F', confirmed: 'var(--im-bean)', shot: 'var(--im-ok)', posted: '#3E9B73', declined: 'var(--im-bad)' };
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
    flt: { q: '', cat: '', pf: '', tier: '', st: '', ev: BOOT.eventFilter || '', sort: 'updated', dir: -1 },
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
  const demoTag = o => o && o.example ? '<span class="im-demo">시연 데이터</span>' : '';
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
  const TABS = [['overview', '요약'], ['list', '인플루언서'], ['discover', '발굴'], ['outreach', '제안 메일'], ['responses', '회신 정리'], ['schedule', '일정'], ['rates', '광고 단가'], ['export', '내보내기'], ['api', '연결 여부 확인']];
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
    if (dc) b.push(`<div class="im-banner is-info"><b>시연 데이터</b><div class="im-grow">지금 보이는 인플루언서·견적 중 <span class="im-num">${dc}</span>건은 사용법을 보여 주는 가상의 시연 데이터예요. 실제 인물이 아닙니다.</div><button type="button" class="im-btn is-sm" id="imClearDemo">시연 데이터 지우기</button></div>`);
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
      if (['replied', 'negotiating'].includes(i.status) && r.avail !== 'no' && !i.confirmedShoot && (r.shoot || []).length) out.push({ k: 'pick', p: 3, i, txt: `촬영 가능일 ${r.shoot.length}개 중 확정 필요`, act: '일정 탭에서 촬영일을 확정하세요' });
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
  VIEWS.overview = {
    mount(v) {
      v.innerHTML = `<div class="im-kpis" id="ovK"></div>
      <div class="im-grid-side"><div class="im-stack">
        <div class="im-panel"><h2>진행 단계 <small>인플루언서별 현재 상태</small></h2><div id="ovPipe"></div></div>
        <div class="im-panel"><h2>다음 할 일 <small>회신 확인 · 회신 지연 · 촬영일 확정 · 촬영 임박 · 지표 갱신</small></h2><div id="ovTodo"></div></div></div>
      <div class="im-stack"><div class="im-panel"><h2>대표 플랫폼 <small>팔로워가 가장 많은 채널 기준</small></h2><div id="ovPf"></div></div>
        <div class="im-panel"><h2>규모별 분포 <small>최대 팔로워 기준</small></h2><div id="ovTier"></div></div>
        <div class="im-panel"><h2>14일 안의 일정</h2><div id="ovSoon"></div></div></div></div>`;
    },
    update(v) {
      const L = filteredByEvent();
      const sent = L.filter(i => i.sentAt).length, replied = L.filter(i => i.sentAt && i.resp).length, conf = L.filter(i => ['confirmed', 'shot', 'posted'].includes(i.status)).length, rv = L.filter(i => i.resp?.review).length;
      $('#ovK', v).innerHTML = [[L.length, '등록 인플루언서', `후보 ${L.filter(i => i.status === 'candidate').length}명`], [sent, '제안 발송', `미발송 ${L.length - sent}명`],
        [sent ? Math.round(replied / sent * 100) + '%' : '–', '회신율', `${replied} / ${sent}명 회신`], [conf, '계약 확정 이상', '촬영·게시 포함'], [rv, '확인 필요 회신', rv ? '회신 정리 탭에서 확인' : '모두 확인됨']]
        .map(([b, s, e]) => `<div class="im-kpi"><span>${s}</span><b>${b}</b><em>${e}</em></div>`).join('');
      if (!L.length) {
        $('#ovPipe', v).innerHTML = `<div class="im-empty">아직 등록된 인플루언서가 없어요.<div class="im-row" style="justify-content:center;margin-top:10px"><button type="button" class="im-btn is-primary" id="ovFind">[발굴] 탭에서 자동으로 찾기</button><button type="button" class="im-btn" id="ovAdd">직접 입력해서 추가</button>${S.inf.size ? '' : '<button type="button" class="im-btn" id="ovSeed">시연 데이터 넣기</button>'}</div><p class="im-muted im-small" style="margin:10px 0 0">[발굴] 탭: YouTube 후보 검색·인기 순위·파일 가져오기 / 직접 입력 창에서도 채널 주소를 넣고 [YouTube 지표 가져오기]를 누르면 숫자가 자동으로 채워져요</p></div>`;
        $('#ovAdd', v).onclick = () => openEditor(null);
        $('#ovFind', v).onclick = () => show('discover');
        const sd = $('#ovSeed', v); if (sd) sd.onclick = async () => { try { replaceAll(await api('POST', 'api/demo/seed')); toast('시연 데이터를 넣었어요'); } catch (e) { toast(e.message); } };
        ['#ovTodo', '#ovPf', '#ovTier', '#ovSoon'].forEach(id => { $(id, v).innerHTML = '<p class="im-muted" style="margin:0">데이터 없음</p>'; });
        return;
      }
      const cnt = {}; STATUS.forEach(([k]) => { cnt[k] = 0; }); L.forEach(i => { cnt[i.status || 'candidate']++; });
      $('#ovPipe', v).innerHTML = `<div class="im-pipe">${STATUS.filter(([k]) => cnt[k]).map(([k, n]) => `<div style="flex:${cnt[k]};background:${ST_COLOR[k]}" title="${n} ${cnt[k]}명"></div>`).join('')}</div>
        <div class="im-legend">${STATUS.map(([k, n]) => `<span><i style="background:${ST_COLOR[k]}"></i>${n} <b class="im-num">${cnt[k]}</b></span>`).join('')}</div>`;
      const T = tasks(L), tagFor = { late: ['회신 지연', 'st-declined'], review: ['확인', 'st-replied'], pick: ['일정', 'st-sent'], soon: ['촬영', 'st-confirmed'], stale: ['지표', ''] };
      $('#ovTodo', v).innerHTML = T.length ? `<ul class="im-todo">${T.slice(0, 8).map(x => `<li><span class="im-chip ${tagFor[x.k][1]}">${tagFor[x.k][0]}</span><div class="im-grow"><b>${esc(x.i.name)}</b> ${demoTag(x.i)} · ${esc(x.txt)}<div class="im-muted im-small">${esc(x.act)}</div></div><button type="button" class="im-btn is-ghost is-sm" data-open="${esc(x.i.id)}">열기</button></li>`).join('')}</ul>${T.length > 8 ? `<p class="im-muted im-small" style="margin:8px 0 0">외 ${T.length - 8}건</p>` : ''}` : '<div class="im-empty">지금 처리할 일이 없어요</div>';
      $$('[data-open]', v).forEach(b => { b.onclick = () => openEditor(b.dataset.open); });
      const pc = {}; PF.forEach(p => { pc[p.k] = 0; }); L.forEach(i => { const m = mainPf(i); if (m) pc[m.k]++; }); const pm = Math.max(1, ...Object.values(pc));
      $('#ovPf', v).innerHTML = `<div class="im-bars">${PF.map(p => `<div class="im-bar"><span class="im-pf pf-${p.k}"><i></i>${p.n}</span><div class="im-track"><div class="im-fill" style="width:${pc[p.k] / pm * 100}%;background:var(--im-${p.k})"></div></div><span class="im-num">${pc[p.k]}명</span></div>`).join('')}</div>`;
      const tc = {}; TIERS.forEach(x => { tc[x.k] = 0; }); L.forEach(i => { if (maxF(i)) tc[tierOf(maxF(i)).k]++; }); const tm = Math.max(1, ...Object.values(tc));
      $('#ovTier', v).innerHTML = `<div class="im-bars">${TIERS.map(x => `<div class="im-bar"><span>${x.n} <span class="im-faint">${x.label}</span></span><div class="im-track"><div class="im-fill" style="width:${tc[x.k] / tm * 100}%"></div></div><span class="im-num">${tc[x.k]}명</span></div>`).join('')}</div>`;
      const t = today(), tn = { neg: '협의 가능', conf: '촬영 확정', post: '게시 예정' };
      const ev = events(L).filter(e => e.d >= t && daysBetween(t, e.d) <= 14 && e.t !== 'shoot').sort((a, b) => a.d.localeCompare(b.d));
      $('#ovSoon', v).innerHTML = ev.length ? `<ul class="im-todo">${ev.slice(0, 7).map(e => `<li><span class="im-num" style="width:44px;flex:none">${fmtD(e.d)}</span><div class="im-grow"><b>${esc(e.i.name)}</b> <span class="im-ev ${e.t}" style="display:inline-block">${tn[e.t]}</span></div></li>`).join('')}</ul>` : '<p class="im-muted" style="margin:0">14일 안에 잡힌 일정이 없어요</p>';
    },
  };

  /* ================= 인플루언서 목록 ================= */
  VIEWS.list = {
    mount(v) {
      const f = S.flt;
      v.innerHTML = `<div class="im-filters">
        <label class="im-field">검색<input type="search" id="fq" placeholder="이름, 핸들, 메모" value="${esc(f.q)}"></label>
        <label class="im-field">분야<select id="fcat"><option value="">전체</option>${C.categories.map(c => `<option ${f.cat === c ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select></label>
        <label class="im-field">대표 플랫폼<select id="fpf"><option value="">전체</option>${PF.map(p => `<option value="${p.k}" ${f.pf === p.k ? 'selected' : ''}>${p.n}</option>`).join('')}</select></label>
        <label class="im-field">규모<select id="ftier"><option value="">전체</option>${TIERS.map(t => `<option value="${t.k}" ${f.tier === t.k ? 'selected' : ''}>${t.n} (${t.label})</option>`).join('')}</select></label>
        <label class="im-field">상태<select id="fst"><option value="">전체</option>${STATUS.map(([k, n]) => `<option value="${k}" ${f.st === k ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
        <label class="im-field">기념일<select id="fev"></select></label>
        <div class="im-row" style="gap:6px"><button type="button" class="im-btn is-primary" id="addInf">+ 추가</button><label class="im-btn" for="csvIn" style="cursor:pointer">CSV 가져오기</label><input type="file" id="csvIn" accept=".csv,text/csv" hidden></div></div>
        <details class="im-panel" id="ytFind" style="margin-bottom:12px"><summary>YouTube에서 후보 찾기 · 지표 일괄 갱신</summary>
          <div class="im-stack" style="margin-top:12px">
            <div class="im-row"><input type="search" id="ytQ" placeholder="예: review bánh Hàn Quốc, ăn thử đồ Hàn, mukbang" style="flex:1;min-width:220px"><button type="button" class="im-btn is-primary" id="ytGo">베트남 채널 검색</button></div>
            ${kwChips('ytQ')}
            <p class="im-muted im-small" style="margin:0">검색 1번에 약 101유닛을 써요 (하루 기본 10,000유닛). 결과에서 [후보로 추가]를 누르면 목록에 들어가요.</p>
            <div id="ytRes"></div><div class="im-hr"></div>
            <div class="im-row"><button type="button" class="im-btn" id="ytAll">YouTube 지표 일괄 갱신</button><span class="im-muted im-small" id="ytAllMsg">YouTube 주소가 있는 인플루언서의 구독자·조회수 중앙값을 다시 가져와요 (1명당 약 3유닛, 시연 데이터 제외).</span></div>
          </div></details>
        <div class="im-tblwrap"><table><thead><tr id="lhead"></tr></thead><tbody id="lbody"></tbody></table></div>
        <p class="im-muted im-small" id="lcount" style="margin:8px 2px 0"></p>`;
      const ytRes = $('#ytRes', v); bindKw(v);
      $('#ytGo', v).onclick = async () => {
        const q = $('#ytQ', v).value.trim(); if (!q) { toast('검색어를 입력하세요'); return; }
        const b = $('#ytGo', v); b.disabled = true; ytRes.innerHTML = '<p class="im-muted" style="margin:0">검색 중…</p>';
        try {
          const list = await api('POST', 'api/youtube/search', { q });
          const known = new Set(infList().map(i => ((i.pf || {}).yt || {}).url || '').filter(Boolean));
          ytRes.innerHTML = list.length ? `<div class="im-tblwrap"><table><thead><tr><th>채널</th><th class="r">구독자</th><th class="r">영상 수</th><th>국가</th><th></th></tr></thead><tbody>${list.map(c => `<tr><td><a href="${esc(c.url)}" target="_blank" rel="noopener"><b>${esc(c.title)}</b></a><div class="im-sub">${esc(c.handle)}</div></td><td class="r im-num">${c.subscribers != null ? short(c.subscribers) : '비공개'}</td><td class="r im-num">${grp(c.video_count)}</td><td>${esc(c.country || '–')}</td><td>${known.has(c.url) ? '<span class="im-faint">등록됨</span>' : `<button type="button" class="im-btn is-sm" data-add='${esc(JSON.stringify(c))}'>후보로 추가</button>`}</td></tr>`).join('')}</tbody></table></div>` : '<p class="im-muted" style="margin:0">검색 결과가 없어요</p>';
          $$('[data-add]', ytRes).forEach(btn => { btn.onclick = async () => {
            btn.disabled = true;
            try { const saved = await api('POST', 'api/youtube/add-candidate', JSON.parse(btn.dataset.add)); S.inf.set(saved.id, saved); btn.outerHTML = '<span class="im-faint">추가됨</span>'; refresh(); toast(`${saved.name}을(를) 후보로 추가했어요. 조회수 중앙값은 편집 창에서 가져오세요`); }
            catch (e) { btn.disabled = false; toast(e.message); }
          }; });
        } catch (e) { ytRes.innerHTML = `<p class="im-note" style="margin:0">${esc(e.message)}</p>`; } finally { b.disabled = false; }
      };
      $('#ytAll', v).onclick = async () => {
        const b = $('#ytAll', v), m = $('#ytAllMsg', v); b.disabled = true; m.textContent = '갱신 중… 사람 수에 따라 시간이 걸려요';
        try {
          const r = await api('POST', 'api/youtube/refresh-all'); replaceAll(r);
          m.textContent = `갱신 ${r.updated.length}명${r.failed.length ? ` · 실패 ${r.failed.length}명: ${r.failed.map(f => f.name + '(' + f.error + ')').join(', ')}` : ''}`;
        } catch (e) { m.textContent = e.message; } finally { b.disabled = false; }
      };
      const on = (id, k) => { $('#' + id, v).oninput = e => { S.flt[k] = e.target.value; if (k === 'ev') renderBanners(); this.update(v); }; };
      on('fq', 'q'); on('fcat', 'cat'); on('fpf', 'pf'); on('ftier', 'tier'); on('fst', 'st'); on('fev', 'ev');
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
      if (f.cat) L = L.filter(i => i.category === f.cat); if (f.pf) L = L.filter(i => mainPf(i)?.k === f.pf);
      if (f.tier) L = L.filter(i => maxF(i) && tierOf(maxF(i)).k === f.tier); if (f.st) L = L.filter(i => (i.status || 'candidate') === f.st);
      if (f.ev) L = L.filter(i => i.eventId === f.ev);
      const key = { name: i => i.name || '', tt: i => +(i.pf?.tt?.f || 0), fb: i => +(i.pf?.fb?.f || 0), yt: i => +(i.pf?.yt?.f || 0), ig: i => +(i.pf?.ig?.f || 0), views: i => mainPf(i)?.v || 0, status: i => STATUS.findIndex(s => s[0] === (i.status || 'candidate')), updated: i => i.updatedAt || '' }[f.sort];
      L.sort((a, b) => { const x = key(a), y = key(b); return (x > y ? 1 : x < y ? -1 : 0) * f.dir; });
      const cols = [['name', '인플루언서', 1], ['cat', '분야'], ['tt', 'TikTok', 1, 'r'], ['fb', 'Facebook', 1, 'r'], ['yt', 'YouTube', 1, 'r'], ['ig', 'Instagram', 1, 'r'], ['views', '대표 채널 조회수', 1, 'r'], ['tier', '규모'], ['status', '상태', 1], ['date', '지표 기준일']];
      $('#lhead', v).innerHTML = cols.map(([k, n, s, r]) => `<th class="${r || ''} ${s ? 'im-sortable' : ''}" ${s ? `data-s="${k}"` : ''}>${n}${f.sort === k ? (f.dir > 0 ? ' ▲' : ' ▼') : ''}</th>`).join('');
      $$('#lhead th[data-s]', v).forEach(th => { th.onclick = () => { if (f.sort === th.dataset.s) f.dir *= -1; else { f.sort = th.dataset.s; f.dir = th.dataset.s === 'name' ? 1 : -1; } this.update(v); }; });
      const cell = (i, k) => { const p = (i.pf || {})[k]; if (!p || !+p.f) return '<td class="r im-faint">–</td>'; return `<td class="r im-num" ${mainPf(i)?.k === k ? 'style="font-weight:600"' : ''}>${short(p.f)}</td>`; };
      $('#lbody', v).innerHTML = L.length ? L.map(i => { const m = mainPf(i), tr = maxF(i) ? tierOf(maxF(i)) : null; return `<tr class="is-click" data-id="${esc(i.id)}">
          <td><div class="im-nm">${esc(i.name)} ${demoTag(i)}</div><div class="im-sub">${esc(i.handle || '')}${i.city ? ' · ' + esc(i.city) : ''}</div></td>
          <td>${esc(i.category || '–')}</td>${PF.map(p => cell(i, p.k)).join('')}
          <td class="r im-num">${m && m.v ? short(m.v) + ` <span class="im-pf pf-${m.k}"><i></i></span>` : '<span class="im-faint">–</span>'}</td>
          <td>${tr ? tr.n : '–'}</td><td>${statusChip(i.status || 'candidate')}</td><td class="im-num im-muted">${esc(i.metricsDate || '–')} ${m && (i.pf[m.k] || {}).conf ? confChip(i.pf[m.k].conf) : ''}</td></tr>`; }).join('')
        : `<tr><td colspan="10"><div class="im-empty" style="border:0">${S.inf.size ? '조건에 맞는 인플루언서가 없어요' : '등록된 인플루언서가 없어요. + 추가 또는 CSV 가져오기로 시작하세요.'}</div></td></tr>`;
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
    d.innerHTML = `<header><h2 id="imDrawerTitle">${isNew ? '인플루언서 추가' : esc(o.name)} ${demoTag(o)}</h2><button type="button" class="im-btn is-ghost" id="dClose">닫기</button></header>
    <div class="im-body">
      <div class="im-fgrid"><label class="im-field">이름 *<input type="text" id="eName" value="${esc(o.name)}"></label>
        <label class="im-field">대표 핸들<input type="text" id="eHandle" value="${esc(o.handle)}" placeholder="@handle"></label>
        <label class="im-field">분야<select id="eCat">${C.categories.map(c => `<option ${o.category === c ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select></label>
        <label class="im-field">활동 지역<select id="eCity">${C.cities.map(c => `<option ${o.city === c ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select></label>
        <label class="im-field">이메일<input type="email" id="eEmail" value="${esc(o.email)}"></label>
        <label class="im-field">Zalo 번호/ID<input type="text" id="eZalo" value="${esc(o.zalo)}"></label>
        <label class="im-field is-wide">매니지먼트·에이전시<input type="text" id="eMgr" value="${esc(o.manager)}" placeholder="직접 계약이면 비워 두세요"></label>
        <label class="im-field is-wide">연결 기념일 (HOME 캘린더 역산 일정용)${evField}</label></div>
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
        <p class="im-muted" style="margin:0;font-size:13px">협의 가능: ${(r.neg || []).map(fmtD).join(', ') || '–'} · 촬영 가능: ${(r.shoot || []).map(fmtD).join(', ') || '–'} · 게시: ${r.post ? fmtD(r.post) : '–'}</p>
        ${r.note ? `<p style="margin:6px 0 0;font-size:13px">${esc(r.note)}</p>` : ''}${r.review ? '<p class="im-note" style="margin:8px 0 0">확인 필요 표시가 있어요. 회신 정리 탭에서 확인 후 저장하면 사라져요.</p>' : ''}</div>` : ''}
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
        delete x._api;
        if (fv || vv || u || x.avg != null || x.er != null) pf[p.k] = { ...x, f: fv ? +fv : null, v: vv ? +vv : null, url: u };
      });
      const body = { ...(isNew ? {} : { id: o.id }), name, handle: g('eHandle').trim(), category: g('eCat'), city: g('eCity'), email: g('eEmail').trim(), zalo: g('eZalo').trim(), manager: g('eMgr').trim(),
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
        <div class="im-panel"><h2>캠페인 정보 <small>여기 적은 내용이 메일 본문에 자동으로 들어가요</small></h2>
          <div style="background:var(--im-sunk);border-radius:8px;padding:10px 12px" style="margin-bottom:12px"><div class="im-eyebrow">저장된 캠페인</div>
            <div class="im-row" style="margin-top:6px"><select id="cpSel" style="flex:1;min-width:160px"><option value="">불러올 캠페인 선택</option></select><button type="button" class="im-btn is-sm" id="cpLoad">불러오기</button><button type="button" class="im-btn is-sm" id="cpDel">삭제</button></div>
            <div class="im-row" style="margin-top:6px"><input type="text" id="cpName" maxlength="40" placeholder="이름 (예: 2026 스승의 날 캠페인)" style="flex:1;min-width:160px"><button type="button" class="im-btn is-sm" id="cpSave">현재 정보를 이 이름으로 저장</button></div>
            <p class="im-muted im-small" id="cpMsg" style="margin:6px 0 0">캠페인마다 정보를 저장해 두고 다시 꺼내 쓸 수 있어요. 불러오면 아래 칸과 메일에 바로 적용돼요.</p></div>
          <div class="im-fgrid">${inp('sBrand', '브랜드')}${inp('sBrandVi', '브랜드 (로마자)')}${inp('sProduct', '제품명 (한국어)')}${inp('sProductVi', '제품명 (베트남어)')}${inp('sProductEn', '제품명 (영어)', 'text', 1)}
          ${inp('sCompany', '회사명')}${inp('sSender', '보내는 사람')}${inp('sEmail', '회신 이메일', 'email')}${inp('sZalo', '회사 Zalo')}${inp('sPeriod', '예정 기간')}${inp('sDeadline', '회신 기한', 'date')}
          ${inp('sForm', '빠른 응답 폼 링크 (선택)', 'url', 1)}${inp('sFee', '비용 문구 (한국어)', 'text', 1)}${inp('sFeeVi', '비용 문구 (베트남어)', 'text', 1)}${inp('sFeeEn', '비용 문구 (영어)', 'text', 1)}
          ${ta('sGuideVi', '광고 가이드라인 (베트남어)', 5)}${ta('sGuideEn', '광고 가이드라인 (영어)', 4)}${ta('sGuideKo', '광고 가이드라인 (한국어)', 4)}</div>
          <div class="im-row" style="margin-top:12px"><button type="button" class="im-btn is-primary" id="sSave">캠페인 정보 저장</button><span class="im-muted im-small">베트남어 문구는 발송 전 현지 직원이나 번역가 검수를 권장해요</span></div>
          <p class="im-muted im-small" style="margin:12px 0 0">개정 광고법(Law No. 75/2025/QH15, 2026-01-01 시행)은 인플루언서가 광고임을 게시 전·중에 밝히고, 직접 써 보지 않은 제품은 홍보하지 않도록 정하고 있어요. 광고 표현 검수 안내는 콘텐츠 스튜디오 화면을 함께 확인하세요.</p></div></div>`;
      Object.keys(SET_FIELDS).forEach(id => { $('#' + id, v).oninput = e => { S.settings = { ...S.settings, [SET_FIELDS[id]]: e.target.value }; this.preview(v); }; });
      $('#sSave', v).onclick = async () => { const o = {}; Object.entries(SET_FIELDS).forEach(([id, k]) => { o[k] = $('#' + id, v).value; }); if (await saveSettings(o)) toast('캠페인 정보를 저장했어요'); };
      const curFields = () => { const o = {}; Object.entries(SET_FIELDS).forEach(([id, k]) => { o[k] = $('#' + id, v).value; }); return o; };
      const cpMsg = t => { $('#cpMsg', v).textContent = t; };
      const loadPresets = async () => { try { this._presets = await api('GET', 'api/campaign-presets'); } catch (e) { this._presets = []; }
        $('#cpSel', v).innerHTML = '<option value="">불러올 캠페인 선택</option>' + this._presets.map(p => `<option value="${esc(p.name)}">${esc(p.name)} · ${esc(p.saved_at || '')}</option>`).join(''); };
      loadPresets();
      $('#cpSave', v).onclick = () => { const name = $('#cpName', v).value.trim(); if (!name) { cpMsg('저장할 이름을 입력하세요'); return; }
        const go = async (overwrite) => { try { await api('POST', 'api/campaign-presets', { name, data: curFields(), overwrite }); await loadPresets(); $('#cpSel', v).value = name; cpMsg(`'${name}'(으)로 저장했어요`); toast('캠페인을 저장했어요'); } catch (e) { cpMsg(e.message); } };
        if ((this._presets || []).some(p => p.name === name)) armButton($('#cpSave', v), '같은 이름이 있어요. 한 번 더 누르면 덮어써요', () => go(true)); else go(false); };
      $('#cpLoad', v).onclick = async () => { const p = (this._presets || []).find(x => x.name === $('#cpSel', v).value); if (!p) { cpMsg('불러올 캠페인을 고르세요'); return; }
        Object.entries(SET_FIELDS).forEach(([id, k]) => { if (k in p.data) $('#' + id, v).value = p.data[k]; });
        if (await saveSettings(curFields())) { $('#cpName', v).value = p.name; cpMsg(`'${p.name}'을(를) 불러와 현재 캠페인 정보로 적용했어요`); this.preview(v); } };
      $('#cpDel', v).onclick = () => { const name = $('#cpSel', v).value; if (!name) { cpMsg('삭제할 캠페인을 고르세요'); return; }
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
      $('#recips', v).innerHTML = L.length ? L.map(i => `<div class="im-recip" data-id="${esc(i.id)}" aria-current="${S.mail.sel === i.id}"><input type="checkbox" aria-label="${esc(i.name)} 선택" ${S.mail.checked.has(i.id) ? 'checked' : ''}><div class="im-grow"><b>${esc(i.name)}</b> ${demoTag(i)}<div class="im-muted im-small" style="overflow-wrap:anywhere">${esc(i.email || '이메일 없음')}${i.zalo ? ' · Zalo ' + esc(i.zalo) : ''}</div></div>${statusChip(i.status || 'candidate')}</div>`).join('')
        : '<div class="im-empty" style="border:0">제안할 후보가 없어요. 인플루언서 탭에서 추가하세요.</div>';
      $$('.im-recip', v).forEach(r => { r.onclick = e => {
        if (e.target.type === 'checkbox') { e.target.checked ? S.mail.checked.add(r.dataset.id) : S.mail.checked.delete(r.dataset.id); $('#selCnt', v).textContent = S.mail.checked.size ? `${S.mail.checked.size}명 선택` : ''; return; }
        S.mail.sel = r.dataset.id; $$('.im-recip', v).forEach(x => x.setAttribute('aria-current', x === r)); this.preview(v); }; });
      $('#selCnt', v).textContent = S.mail.checked.size ? `${S.mail.checked.size}명 선택` : ''; this.preview(v);
    },
    preview(v) {
      const i = S.inf.get(S.mail.sel), pv = $('#pv', v);
      if (!i) { pv.innerHTML = '<div class="im-empty">받는 사람을 고르면 메일이 여기에 만들어져요</div>'; $('#pvWho', v).textContent = ''; return; }
      const m = mailFor(i, S.mail.lang); $('#pvWho', v).textContent = `${i.name} · ${i.email || '이메일 미등록'}`;
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
        <div class="im-panel"><h2>받은 회신 <small>확인 필요 항목 먼저</small></h2><div id="rList"></div></div></div>`;
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
      sel.innerHTML = L.length ? L.map(i => `<option value="${esc(i.id)}" ${i.id === S.resp.id ? 'selected' : ''}>${esc(i.name)} · ${STN[i.status || 'candidate']}${i.example ? ' (시연)' : ''}</option>`).join('') : '<option value="">등록된 인플루언서 없음</option>';
      if (this._for !== S.resp.id) this.form(v);
      const R = L.filter(i => i.resp).sort((a, b) => (!!b.resp.review - !!a.resp.review) || (b.resp.at || '').localeCompare(a.resp.at || ''));
      $('#rList', v).innerHTML = R.length ? `<ul class="im-todo">${R.map(i => { const r = i.resp; return `<li><div class="im-grow"><b>${esc(i.name)}</b> ${demoTag(i)} ${r.review ? '<span class="im-chip st-replied">확인 필요</span>' : ''}<div class="im-muted im-small">${{ yes: '가능', cond: '조건부', no: '불가' }[r.avail] || '미확인'} · 촬영 가능 ${(r.shoot || []).map(fmtD).join(', ') || '–'}${i.confirmedShoot ? ' · <b style="color:var(--im-bean)">확정 ' + fmtD(i.confirmedShoot) + '</b>' : ''}</div></div><button type="button" class="im-btn is-sm" data-r="${esc(i.id)}">열기</button></li>`; }).join('')}</ul>` : '<div class="im-empty">아직 받은 회신이 없어요</div>';
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
        ${r.raw ? `<details><summary class="im-muted im-small">원문 보기</summary><pre class="im-raw">${esc(r.raw)}</pre></details>` : ''}
        <div class="im-row"><button type="button" class="im-btn is-primary" id="rSave">${i.resp ? '회신 수정 저장' : '회신 저장'}</button>${i.resp ? '<button type="button" class="im-btn" id="rDel">회신 삭제</button>' : ''}<span class="im-muted im-small">저장하면 상태가 바뀌어요 (불가 → 불가·보류, 그 외 → 회신 받음). 잘못 넣은 회신은 고쳐서 다시 저장하거나 삭제하세요</span></div>`;
      const keep = () => { r.post = $('#rPost', v).value; r.fee = $('#rFee', v).value; r.cur = $('#rCur', v).value; r.note = $('#rNote', v).value; S.resp.draft = r; };
      $$('#rAv button', v).forEach(b => { b.onclick = () => { r.avail = b.dataset.v; $$('#rAv button', v).forEach(x => x.setAttribute('aria-pressed', x === b)); keep(); }; });
      $$('#rFm button', v).forEach(b => { b.onclick = () => { const f = b.dataset.f; r.formats = r.formats.includes(f) ? r.formats.filter(x => x !== f) : [...r.formats, f]; b.setAttribute('aria-pressed', r.formats.includes(f)); keep(); }; });
      $$('[data-add]', v).forEach(b => { b.onclick = () => { const k = b.dataset.add, d = $('#a_' + k, v).value; if (!d) { toast('날짜를 고르세요'); return; } keep(); if (!r[k].includes(d)) r[k] = [...r[k], d].sort(); this.form(v); }; });
      $$('[data-del]', v).forEach(b => { b.onclick = () => { const [k, d] = b.dataset.del.split('|'); keep(); r[k] = r[k].filter(x => x !== d); this.form(v); }; });
      ['rPost', 'rFee', 'rCur', 'rNote'].forEach(id => { $('#' + id, v).oninput = keep; });
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

  /* ================= 일정 ================= */
  VIEWS.schedule = {
    mount(v) {
      if (!S.cal) { const d = new Date(); S.cal = { y: d.getFullYear(), m: d.getMonth() }; }
      v.innerHTML = `<div class="im-grid-side"><div class="im-panel"><div class="im-calhead"><button type="button" class="im-btn is-sm" id="cPrev" aria-label="이전 달">‹</button><h2 id="cTitle"></h2><button type="button" class="im-btn is-sm" id="cNext" aria-label="다음 달">›</button><button type="button" class="im-btn is-sm is-ghost" id="cToday">오늘</button>
        <div class="im-legend"><span><i style="border:1px dashed var(--im-accent)"></i>협의 가능</span><span><i style="background:var(--im-accent-soft);border:1px solid var(--im-accent)"></i>촬영 가능</span><span><i style="background:var(--im-bean)"></i>촬영 확정</span><span><i style="background:var(--im-ok-soft);border:1px solid var(--im-ok)"></i>게시</span></div></div>
        <div class="im-cal" id="cal"></div><p class="im-muted im-small" style="margin:8px 0 0">날짜는 베트남 시간(UTC+7) 기준이에요. 한국은 2시간 빨라요. 빨간 테두리는 같은 날 촬영 확정이 겹친 경우예요.</p></div>
        <div class="im-stack"><div class="im-panel"><h2 id="dayTitle">날짜를 누르면 그날 일정이 보여요</h2><div id="dayList"></div></div>
        <div class="im-panel"><h2>촬영일 확정 대기 <small>촬영 가능일 중 하나를 고르세요</small></h2><div id="pickList"></div></div></div></div>`;
      $('#cPrev', v).onclick = () => { S.cal.m--; if (S.cal.m < 0) { S.cal.m = 11; S.cal.y--; } this.update(v); };
      $('#cNext', v).onclick = () => { S.cal.m++; if (S.cal.m > 11) { S.cal.m = 0; S.cal.y++; } this.update(v); };
      $('#cToday', v).onclick = () => { const d = new Date(); S.cal = { y: d.getFullYear(), m: d.getMonth() }; S.calSel = today(); this.update(v); };
    },
    update(v) {
      const { y, m } = S.cal, L = filteredByEvent(); $('#cTitle', v).textContent = `${y}년 ${m + 1}월`;
      const ev = events(L), by = {}; ev.forEach(e => { (by[e.d] = by[e.d] || []).push(e); });
      const first = new Date(y, m, 1), start = new Date(first); start.setDate(1 - ((first.getDay() + 6) % 7));
      const t = today(), ord = { conf: 0, shoot: 1, neg: 2, post: 3 }, tn = { neg: '협의', shoot: '촬영 가능', conf: '촬영 확정', post: '게시' };
      let h = ['월', '화', '수', '목', '금', '토', '일'].map(d => `<div class="im-dow">${d}</div>`).join('');
      for (let k = 0; k < 42; k++) {
        const d = new Date(start); d.setDate(start.getDate() + k); const s = iso(d), es = (by[s] || []).sort((a, b) => ord[a.t] - ord[b.t]);
        h += `<div class="im-day ${d.getMonth() !== m ? 'is-out' : ''} ${s === t ? 'is-today' : ''} ${S.calSel === s ? 'is-sel' : ''}" data-d="${s}" tabindex="0" role="button" aria-label="${s} 일정 ${es.length}건"><span class="im-d">${d.getDate()}</span>${es.slice(0, 3).map(e => `<span class="im-ev ${e.t} ${e.clash ? 'clash' : ''}" title="${esc(e.i.name)} ${tn[e.t]}">${esc(e.i.name)}</span>`).join('')}${es.length > 3 ? `<span class="im-more">+${es.length - 3}</span>` : ''}</div>`;
        if (k === 34) { const nx = new Date(start); nx.setDate(start.getDate() + 35); if (nx.getMonth() !== m) break; }
      }
      $('#cal', v).innerHTML = h;
      $$('.im-day', v).forEach(c => { const go = () => { S.calSel = c.dataset.d; this.update(v); }; c.onclick = go; c.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } }; });
      const ds = S.calSel, de = (by[ds] || []).sort((a, b) => ord[a.t] - ord[b.t]);
      $('#dayTitle', v).textContent = ds ? `${ds.replace(/-/g, '.')} 일정` : '날짜를 누르면 그날 일정이 보여요';
      $('#dayList', v).innerHTML = ds ? (de.length ? `<ul class="im-todo">${de.map(e => `<li><span class="im-ev ${e.t} ${e.clash ? 'clash' : ''}" style="flex:none">${tn[e.t]}</span><div class="im-grow"><b>${esc(e.i.name)}</b> ${demoTag(e.i)}<div class="im-muted im-small">${STN[e.i.status || 'candidate']}${e.clash ? ' · 같은 날 다른 촬영과 겹침' : ''}</div></div>${e.t === 'shoot' ? `<button type="button" class="im-btn is-sm is-bean" data-cf="${esc(e.i.id)}|${e.d}">이 날로 확정</button>` : ''}</li>`).join('')}</ul>` : '<p class="im-muted" style="margin:0">이 날짜에는 일정이 없어요</p>') : '<p class="im-muted" style="margin:0">달력에서 날짜를 고르세요</p>';
      const P = L.filter(i => !i.confirmedShoot && i.resp && i.resp.avail !== 'no' && (i.resp.shoot || []).length);
      $('#pickList', v).innerHTML = P.length ? `<ul class="im-todo">${P.map(i => `<li><div class="im-grow"><b>${esc(i.name)}</b> ${demoTag(i)}<div class="im-row" style="gap:6px;margin-top:6px">${i.resp.shoot.map(d => `<button type="button" class="im-btn is-sm" data-cf="${esc(i.id)}|${d}">${fmtD(d)}</button>`).join('')}</div></div></li>`).join('')}</ul>` : '<p class="im-muted" style="margin:0">확정을 기다리는 사람이 없어요</p>';
      $$('[data-cf]', v).forEach(b => { b.onclick = async () => {
        const [id, d] = b.dataset.cf.split('|'), i = S.inf.get(id); if (!i) return;
        const clash = infList().filter(x => x.id !== id && x.confirmedShoot === d);
        if (await saveInf({ id, confirmedShoot: d })) toast(`${i.name} 촬영일을 ${fmtD(d)}로 확정했어요${clash.length ? ' (같은 날 ' + clash.length + '건 겹침)' : ''}`);
      }; });
    },
  };

  /* ================= 광고 단가 ================= */
  function quoteMetrics(q) {
    const i = S.inf.get(q.infId), p = ((i || {}).pf || {})[q.platform] || {};
    const fol = +(q.followers || p.f || 0), exp = +(q.expViews || p.v || 0), usd = toUsd(q.amount, q.cur), vnd = toVnd(q.amount, q.cur), tier = fol ? tierOf(fol) : null;
    let cmp = null; if (tier) { const [lo, hi] = tier.usd; cmp = usd < lo ? 'lo' : (hi && usd > hi) ? 'hi' : 'in'; }
    return { i, fol, exp, usd, vnd, cpm: exp ? vnd / exp * 1000 : null, perK: fol ? vnd / fol * 1000 : null, cpv: q.actualViews ? vnd / q.actualViews : null, tier, cmp };
  }
  VIEWS.rates = {
    mount(v) {
      v.innerHTML = `<div class="im-grid-side"><div class="im-stack">
        <div class="im-panel im-chart"><h2>받은 견적과 공개 참고가 <small>가로: 해당 채널 팔로워 · 세로: 게시물 1건 비용(USD) · 둘 다 로그 눈금</small></h2><div id="rChart"></div>
          <div class="im-legend"><span><i style="background:var(--im-accent-soft);border:1px solid var(--im-accent)"></i>공개 참고가 범위</span><span><i style="background:var(--im-warn);border-radius:50%"></i>견적</span><span><i style="background:var(--im-bean);border-radius:50%"></i>계약가</span><span><i style="background:var(--im-faint);border-radius:50%"></i>기타 공개가</span></div>
          <p class="im-src">출처: 공개 참고가 범위 = <a href="https://bestmartech.vn/pages/pricing" target="_blank" rel="noopener">Best Martech 2026 가격표</a> (베트남 대행사 공개가, KOL &amp; KOC 항목, 게시물 1건·USD·VAT·광고비 별도). 평균값이나 실제 계약가가 아니에요. 점은 이 탭에 기록한 견적·계약가예요.</p></div>
        <div class="im-panel"><h2>단가 기록 <small>환산은 아래 환율 기준</small></h2><div class="im-tblwrap"><table><thead><tr><th>인플루언서</th><th>채널·형식</th><th>구분</th><th class="r">금액</th><th class="r">USD 환산</th><th class="r">조회 1천회당</th><th class="r">팔로워 1천명당</th><th class="r">실제 1회 조회당</th><th>참고가 비교</th><th></th></tr></thead><tbody id="qBody"></tbody></table></div>
          <p class="im-muted im-small" style="margin:8px 0 0">조회 1천회당 = 금액 ÷ 해당 채널 조회수 중앙값 × 1,000 (VND). 참고용 계산이며, 예산·광고비 공식은 KPI 화면에서 확정해요.</p></div></div>
      <div class="im-stack"><div class="im-panel"><h2>단가 기록 추가</h2><div class="im-fgrid">
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
          <div class="im-row" style="margin-top:12px"><button type="button" class="im-btn is-primary" id="qAdd">추가</button></div></div>
        <div class="im-panel"><h2>환율 <small>직접 입력해요 (자동으로 가져오지 않아요)</small></h2>
          <p class="im-small" id="xState" style="margin:0 0 8px"></p><div class="im-fgrid">
          <label class="im-field">1 USD = VND<input type="number" id="xV" value="${esc(S.settings.vndPerUsd)}"></label>
          <label class="im-field">1 USD = KRW<input type="number" id="xK" value="${esc(S.settings.krwPerUsd)}"></label></div>
          <div class="im-row" style="margin-top:10px"><button type="button" class="im-btn" id="xSave">환율 저장</button></div></div>
        <div class="im-panel"><h2>공개 참고가 <small>대행사가 공개한 가격. 개별 계약가 아님</small></h2>
          <div class="im-tblwrap is-wrap"><table><thead><tr><th>규모 (팔로워)</th><th class="r">게시물 1건 (USD)</th></tr></thead><tbody>
          ${TIERS.map(t => `<tr><td>${t.n} · ${t.label}</td><td class="r im-num">${t.usd[1] ? `${t.usd[0].toLocaleString()}–${t.usd[1].toLocaleString()}` : `${t.usd[0].toLocaleString()}부터 (별도 견적)`}</td></tr>`).join('')}</tbody></table></div>
          <p class="im-muted im-small" style="margin:8px 0 0">출처: <a href="https://bestmartech.vn/pages/pricing" target="_blank" rel="noopener">Best Martech 2026 가격표</a>, KOL &amp; KOC 항목. VAT·광고비 별도, 대행 수수료 15%가 따로 붙는 구조예요.</p></div></div></div>`;
      const qi = $('#qInf', v); qi.onchange = () => { const i = S.inf.get(qi.value), m = i && mainPf(i); if (m) $('#qPf', v).value = m.k; };
      $('#qAdd', v).onclick = async () => {
        const body = { infId: qi.value, platform: $('#qPf', v).value, format: $('#qFmt', v).value, layer: $('#qLayer', v).value, date: $('#qDate', v).value, amount: $('#qAmt', v).value, cur: $('#qCur', v).value, expViews: $('#qExp', v).value, actualViews: $('#qAct', v).value, cond: $('#qCond', v).value.trim() };
        if (!body.infId) { toast('인플루언서를 고르세요'); return; } if (!+body.amount) { toast('금액을 입력하세요'); return; }
        if (await saveQuote(body)) { toast('단가 기록을 추가했어요'); ['qAmt', 'qExp', 'qAct', 'qCond'].forEach(id => { $('#' + id, v).value = ''; }); }
      };
      $('#xSave', v).onclick = async () => { const a = +$('#xV', v).value, b = +$('#xK', v).value; if (!a || !b) { toast('환율을 숫자로 입력하세요'); return; } if (await saveSettings({ vndPerUsd: a, krwPerUsd: b, rateConfirm: true })) { toast('환율을 저장했어요'); this.rateState(v); } };
      this.rateState(v);
    },
    rateState(v) {
      const d = S.settings.rateSavedAt, el = $('#xState', v); if (!el) return;
      el.innerHTML = d ? `직접 입력한 환율 · 저장일 <b>${esc(d)}</b>` : '<span style="color:var(--im-warn)">아직 예시값이에요. 실제 환율을 입력하고 [환율 저장]을 누르세요</span>';
    },
    update(v) {
      const L = infList().sort((a, b) => a.name.localeCompare(b.name)), qi = $('#qInf', v), cur = qi.value;
      qi.innerHTML = '<option value="">선택</option>' + L.map(i => `<option value="${esc(i.id)}" ${i.id === cur ? 'selected' : ''}>${esc(i.name)}${i.example ? ' (시연)' : ''}</option>`).join('');
      const Q = [...S.quotes.values()].sort((a, b) => (b.date || '').localeCompare(a.date || ''));
      const cmpTxt = { in: '범위 안', hi: '범위보다 높음', lo: '범위보다 낮음' };
      $('#qBody', v).innerHTML = Q.length ? Q.map(q => { const m = quoteMetrics(q); return `<tr><td><b>${esc(m.i?.name || q.name || '삭제됨')}</b> ${demoTag(q)}<div class="im-sub">${esc(q.date || '')}${q.cond ? ' · ' + esc(q.cond) : ''}</div></td>
          <td><span class="im-pf pf-${q.platform}"><i></i>${PFN[q.platform] || ''}</span><div class="im-sub">${esc(q.format || '')}</div></td><td>${LAYERS[q.layer] || ''}</td>
          <td class="r im-num">${grp(q.amount)} <span class="im-faint">${esc(q.cur)}</span></td><td class="r im-num">$${grp(m.usd)}</td>
          <td class="r im-num">${m.cpm != null ? grp(m.cpm) + ' ₫' : '–'}</td><td class="r im-num">${m.perK != null ? grp(m.perK) + ' ₫' : '–'}</td><td class="r im-num">${m.cpv != null ? grp(m.cpv) + ' ₫' : '–'}</td>
          <td>${m.cmp ? `<span class="im-cmp ${m.cmp}">${cmpTxt[m.cmp]}</span> <span class="im-faint" style="font-size:11px">${m.tier.n}</span>` : '<span class="im-faint">팔로워 없음</span>'}</td>
          <td><button type="button" class="im-btn is-sm is-ghost" data-qd="${esc(q.id)}">삭제</button></td></tr>`; }).join('')
        : '<tr><td colspan="10"><div class="im-empty" style="border:0">받은 견적이나 계약 금액을 오른쪽에서 추가하세요. 쌓일수록 회사 자체 기준표가 돼요.</div></td></tr>';
      $$('[data-qd]', v).forEach(b => { b.onclick = () => armButton(b, '확인', async () => { if (await delQuote(b.dataset.qd)) toast('삭제했어요'); }); });
      this.chart(v, Q);
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

  /* ================= 발굴 (외부 후보 → 기존 DB) ================= */
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
  /* 선택 연동 서비스: 키가 설정되면 자동으로 보이고, 키가 없으면 '선택 연동 보기' 안에 접혀 있어요 */
  const OPTIONAL_SVC = ['modash', 'hypeauditor'];
  const optFold = (n, inner) => `<details class="im-optfold"><summary>선택 연동 서비스 보기 <span class="im-muted im-small">(${n}개 · 키 미설정, 있으면 쓰는 유료 API)</span></summary><div class="im-optfold-body">${inner}</div></details>`;
  const DISC_CATS = C.discoveryCategories || ['Food', 'Dessert', 'Mukbang', 'Korean Food', 'Lifestyle'];
  const TTO_LINKS = [['TikTok One 열기', 'https://ads.tiktok.com/creative'], ['크리에이터 검색 공식 안내', 'https://ads.tiktok.com/help/article/how-to-find-creators-in-tiktok-one']];
  S.disc = S.disc || { platform: 'tt', provider: '', cats: ['Dessert', 'Korean Food'], rows: [], sel: new Set(), meta: null, source: '' };
  VIEWS.discover = {
    mount(v) {
      const D = S.disc;
      v.innerHTML = `<div class="im-grid-side"><div class="im-stack">
        <div class="im-panel"><h2>검색 조건 <small>API가 없어도 아래 'TikTok One 연계'로 같은 조건을 쓸 수 있어요</small></h2>
          <div class="im-fgrid">
            <label class="im-field">플랫폼<select id="dPf">${[['tt', 'TikTok'], ['ig', 'Instagram'], ['yt', 'YouTube']].map(([k, n]) => `<option value="${k}" ${D.platform === k ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
            <label class="im-field">국가/지역<select id="dCountry"><option value="Vietnam">베트남</option><option value="">제한 없음</option></select></label>
            <label class="im-field">콘텐츠 언어<select id="dLang"><option value="vi">베트남어</option><option value="">제한 없음</option><option value="en">영어</option><option value="ko">한국어</option></select></label>
            <label class="im-field">최소 팔로워<input type="number" min="0" id="dMinF" value="10000"></label>
            <label class="im-field">최대 팔로워<input type="number" min="0" id="dMaxF" value="500000"></label>
            <label class="im-field">최소 조회수<input type="number" min="0" id="dMinV" placeholder="예: 5000"></label>
            <label class="im-field">최소 참여율(%)<input type="number" min="0" max="100" step="0.1" id="dMinEr" placeholder="예: 3"></label>
            <label class="im-field">베트남 시청자 비중 최소(%)<input type="number" min="0" max="100" id="dMinVn" placeholder="예: 60"></label>
            <label class="im-field is-wide">YouTube 검색어 (선택)<input type="text" id="dKw" placeholder="비우면 카테고리로 검색어를 만들어요"></label></div>
          ${kwChips('dKw')}
          <div class="im-eyebrow" style="margin-top:12px">콘텐츠 카테고리</div>
          <div class="im-seg" id="dCats">${DISC_CATS.map(c => `<button type="button" data-c="${esc(c)}" aria-pressed="${D.cats.includes(c)}">${esc(c)}</button>`).join('')}</div>
          <div class="im-eyebrow" style="margin-top:14px">조회할 곳</div>
          <div id="dProv" class="im-stack" style="gap:6px"></div>
          <div class="im-row" style="margin-top:12px"><button type="button" class="im-btn is-primary" id="dGo">후보 검색</button><span class="im-muted im-small" id="dGoMsg"></span></div></div>
        <div class="im-panel"><h2>검색 결과 <small id="dMeta"></small></h2><div id="dNotice"></div><div id="dRes"></div>
          <div class="im-row" style="margin-top:10px"><button type="button" class="im-btn is-primary" id="dReg" disabled>선택한 후보 등록</button><span class="im-muted im-small" id="dRegMsg">같은 플랫폼의 같은 계정은 자동으로 건너뛰어요. 등록하면 '후보' 상태로 인플루언서 목록에 들어가요.</span></div></div>
        <div class="im-panel" id="rkPanel"><h2>인기 순위 <small>공식 API로 가져와요 · 크롤링 없음</small></h2>
          <div class="im-fgrid">
            <label class="im-field is-wide">순위 종류<select id="rkKind"></select></label>
            <label class="im-field" id="rkPfWrap" hidden>플랫폼<select id="rkPf"><option value="tt">TikTok</option><option value="ig">Instagram</option><option value="yt">YouTube</option></select></label>
            <label class="im-field">개수<select id="rkSize"><option value="30">Top 30</option><option value="50" selected>Top 50</option><option value="100">Top 100</option></select></label>
            <label class="im-field is-wide" id="rkKwWrap" hidden>키워드<input type="text" id="rkKw" placeholder="예: mukbang"></label>
            <label class="im-field is-wide" id="rkFoodWrap" style="flex-direction:row;align-items:center;gap:8px" hidden><input type="checkbox" id="rkFood" checked>식품 관련만 보기 <span class="im-muted im-small">(게임·음악·스포츠·뉴스 제외 + 제목·태그에 음식 단어 포함)</span></label></div>
          <div id="rkKwChips" hidden>${kwChips('rkKw')}</div>
          <p class="im-muted im-small" id="rkInfo" style="margin:8px 0 0"></p>
          <div class="im-row" style="margin-top:10px"><button type="button" class="im-btn is-primary" id="rkGo">순위 가져오기</button><a class="im-btn" id="rkCsv" href="${API}export/ranking.csv" hidden>순위 CSV 내려받기</a><span class="im-muted im-small" id="rkMsg"></span></div>
          <div id="rkMeta" style="margin-top:10px"></div><div id="rkRes"></div>
          <div class="im-row" style="margin-top:10px"><button type="button" class="im-btn is-primary" id="rkReg" disabled>선택한 계정 후보로 등록</button><span class="im-muted im-small" id="rkRegMsg"></span></div></div></div>
        <div class="im-stack">
        <div class="im-panel"><h2>TikTok One 연계 <small>API 없이 쓰는 기본 방법</small></h2>
          <p class="im-small" style="margin:0 0 8px">TikTok One 크리에이터 검색 API는 일반 광고주 권한이 확인되지 않아 연결하지 않았어요. 화면에서 찾고, 숫자를 옮겨 적어 등록해요.</p>
          <div class="im-row">${TTO_LINKS.map(([n, u]) => `<a class="im-btn is-sm" href="${u}" target="_blank" rel="noopener">${n}</a>`).join('')}<button type="button" class="im-btn is-sm" id="dCopy">검색 기준 복사</button></div>
          <pre class="im-raw" id="dCrit"></pre></div>
        <div class="im-panel"><h2>후보 직접 입력 <small>TikTok One·인플루언서 자료에서 확인한 값</small></h2>
          <div class="im-fgrid">
            <label class="im-field">플랫폼<select id="mPf"><option value="tt">TikTok</option><option value="ig">Instagram</option><option value="yt">YouTube</option><option value="fb">Facebook</option></select></label>
            <label class="im-field">출처<select id="mSrc"><option value="manual|TikTok One (화면 확인)">TikTok One 화면 확인</option><option value="manual|직접 확인">채널에서 직접 확인</option><option value="submitted|인플루언서 제출">인플루언서 제출 자료</option><option value="submitted|에이전시 자료">에이전시 자료</option><option value="official_api|YouTube API">YouTube API (자동 채우기)</option><option value="saas|Phyllo">Phyllo (자동 채우기)</option></select></label>
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
          <div class="im-row" style="margin-top:10px"><button type="button" class="im-btn" id="mFill">주소로 지표 채우기</button><button type="button" class="im-btn" id="mChk">중복 확인</button><button type="button" class="im-btn is-primary" id="mAdd">후보로 등록</button><span class="im-small" id="mMsg"></span></div></div>
        <div class="im-panel"><h2>파일로 여러 명 가져오기 <small>CSV·TSV · 자동 정제 후 미리보기</small></h2>
          <p class="im-small" style="margin:0 0 8px">우리 양식뿐 아니라 SaaS 내보내기·에이전시 자료처럼 열 이름과 숫자 표기가 다른 파일도 정리해서 미리보기로 보여 줘요. 저장은 결과 표에서 골라서 해요. 엑셀 파일은 'CSV UTF-8'로 저장해서 올려 주세요.</p>
          <div class="im-fgrid">
            <label class="im-field">이 파일의 출처<select id="dCsvSrc"><option value="">파일의 '출처' 열 따르기 (우리 양식)</option><option value="saas">전문 SaaS 내보내기 파일</option><option value="submitted">에이전시·인플루언서 제출 자료</option><option value="manual">직접 확인한 값</option></select></label>
            <label class="im-field">제공처 이름 (선택)<input type="text" id="dCsvProv" maxlength="60" placeholder="예: Modash 내보내기, OO에이전시"></label>
            <label class="im-field">플랫폼 열이 없을 때<select id="dCsvPf"><option value="">주소로 자동 판별</option><option value="tt">TikTok</option><option value="ig">Instagram</option><option value="yt">YouTube</option><option value="fb">Facebook</option></select></label>
            <label class="im-field" style="flex-direction:row;align-items:center;gap:8px;margin-top:22px"><input type="checkbox" id="dCsvDemo">시연용 파일 (시연 데이터로 표시)</label></div>
          <div class="im-row" style="margin-top:10px"><a class="im-btn is-sm" href="${API}export/discovery_template.csv">발굴 후보 CSV 양식</a><label class="im-btn is-sm is-primary" for="dCsv" style="cursor:pointer">파일 올리기</label><input type="file" id="dCsv" accept=".csv,.tsv,.txt,text/csv,text/tab-separated-values" hidden></div>
          <div id="dCsvRep" style="margin-top:10px"></div></div>
        </div></div>`;
      $('#dPf', v).onchange = e => { D.platform = e.target.value; this.providers(v); this.crit(v); };
      ['dCountry', 'dLang', 'dMinF', 'dMaxF', 'dMinV', 'dMinEr', 'dMinVn'].forEach(id => { $('#' + id, v).oninput = () => this.crit(v); });
      $$('#dCats button', v).forEach(b => { b.onclick = () => { const c = b.dataset.c; D.cats = D.cats.includes(c) ? D.cats.filter(x => x !== c) : [...D.cats, c]; b.setAttribute('aria-pressed', D.cats.includes(c)); this.crit(v); }; });
      $('#dCopy', v).onclick = () => copyText($('#dCrit', v).textContent, '검색 기준', $('#dCrit', v));
      $('#dGo', v).onclick = () => this.search(v);
      $('#dReg', v).onclick = () => this.register(v, D.rows.filter((r, i) => D.sel.has(i)));
      const manual = () => { const [st, prov] = $('#mSrc', v).value.split('|'); return { platform: $('#mPf', v).value, url: $('#mRef', v).value.trim(), name: $('#mName', v).value.trim(), followers: $('#mF', v).value, median_views: $('#mV', v).value, avg_views: $('#mAvg', v).value, er: $('#mEr', v).value, vn_audience: $('#mVn', v).value, collected_on: $('#mAt', v).value, category: $('#mCat', v).value, source_type: st, provider: prov, country: $('#dCountry', v).value, language: $('#dLang', v).value }; };
      const mMsg = (t, bad) => { const m = $('#mMsg', v); m.textContent = t; m.style.color = bad ? 'var(--im-bad)' : 'var(--im-ok)'; };
      $('#mFill', v).onclick = async () => { const pf = $('#mPf', v).value, ref = $('#mRef', v).value.trim();
        if (!ref) { mMsg('계정 주소를 먼저 넣어 주세요', true); return; }
        if (pf === 'fb') { mMsg('Facebook은 자동으로 채울 수 없어요. 직접 입력해 주세요', true); return; }
        const b = $('#mFill', v); b.disabled = true; mMsg(pf === 'yt' ? 'YouTube에서 가져오는 중… (약 3유닛)' : 'Phyllo에서 가져오는 중…', false);
        try { const r = await api('POST', 'api/discovery/fill', { platform: pf, ref });
          const set = (id, val) => { if (val != null && val !== '') $('#' + id, v).value = val; };
          if (!$('#mName', v).value.trim()) set('mName', r.name); set('mF', r.followers); set('mV', r.median_views); set('mAvg', r.avg_views); set('mEr', r.er);
          $('#mAt', v).value = today(); $('#mSrc', v).value = pf === 'yt' ? 'official_api|YouTube API' : 'saas|Phyllo';
          mMsg(`채웠어요. ${r.note || ''} 베트남 시청자 비중은 공개 API로 알 수 없어 비워 둬요`, false); }
        catch (e) { mMsg(e.message, true); } finally { b.disabled = false; } };
      $('#mChk', v).onclick = async () => { const m = manual(); if (!m.url) { mMsg('계정 주소를 넣어 주세요', true); return; }
        try { const r = await api('POST', 'api/discovery/check', { platform: m.platform, ref: m.url }); mMsg(r.duplicate ? `이미 등록된 계정이에요: ${r.duplicate_of.name}` : '새 계정이에요. 등록할 수 있어요', r.duplicate); } catch (e) { mMsg(e.message, true); } };
      $('#mAdd', v).onclick = async () => { const m = manual(); if (!m.url) { mMsg('계정 주소를 넣어 주세요', true); return; } await this.register(v, [m], mMsg); };
      $('#dCsv', v).onchange = async e => { const file = e.target.files[0]; e.target.value = ''; if (!file) return;
        const fd = new FormData(); fd.append('file', file); fd.append('source', $('#dCsvSrc', v).value); fd.append('provider', $('#dCsvProv', v).value.trim());
        fd.append('platform', $('#dCsvPf', v).value); if ($('#dCsvDemo', v).checked) fd.append('demo', '1');
        try { const r = await api('POST', 'api/discovery/import-csv', fd, true); D.rows = r.rows; D.sel = new Set(r.rows.map((x, i) => x.duplicate ? -1 : i).filter(i => i >= 0)); D.meta = { csv: true, errors: r.errors, report: r.report }; D.source = 'CSV'; this.csvReport(v, r.report, r.errors, file.name); this.results(v); toast(`${r.rows.length}명을 읽었어요. 확인 후 [선택한 후보 등록]을 누르세요`); }
        catch (err) { $('#dCsvRep', v).innerHTML = `<div class="im-note">${esc(err.message)}</div>`; toast(err.message); } };
      bindKw(v); this.providers(v); this.crit(v); this.results(v); this.rankInit(v);
    },
    async rankInit(v) {
      const R = S.disc.rank = S.disc.rank || { rows: [], meta: null, sel: new Set(), kinds: [] };
      let d; try { d = await api('GET', 'api/discovery/ranking'); } catch (e) { $('#rkInfo', v).textContent = e.message; return; }
      R.kinds = d.kinds;
      $('#rkKind', v).innerHTML = d.kinds.map(k => `<option value="${k.key}" ${k.configured ? '' : 'disabled'}>${esc(k.label)}${k.configured ? '' : ' (키 없음)'}</option>`).join('');
      const firstOk = d.kinds.find(k => k.configured); if (firstOk) $('#rkKind', v).value = firstOk.key;
      const sync = () => { const k = R.kinds.find(x => x.key === $('#rkKind', v).value) || {};
        $('#rkKwWrap', v).hidden = $('#rkKwChips', v).hidden = !k.needs_keyword; $('#rkPfWrap', v).hidden = (k.platforms || []).length < 2;
        $('#rkFoodWrap', v).hidden = !(k.key || '').startsWith('yt_popular');
        $('#rkInfo', v).textContent = k.key ? `집계 기준: ${k.basis} · 비용: ${k.cost}` : '';
        $('#rkGo', v).disabled = !k.configured; if (!k.configured) $('#rkMsg', v).textContent = 'YouTube 키가 있어야 순위를 가져올 수 있어요. 키가 없을 때는 위의 직접 입력·파일 가져오기를 쓰세요'; };
      $('#rkKind', v).onchange = sync; sync();
      $('#rkGo', v).onclick = () => this.rankFetch(v);
      $('#rkReg', v).onclick = () => this.rankRegister(v);
      if (!R.meta && d.last && d.last.meta) { R.rows = d.last.rows || []; R.meta = d.last.meta; }
      this.rankRender(v);
    },
    async rankFetch(v) {
      const R = S.disc.rank, b = $('#rkGo', v), kind = $('#rkKind', v).value;
      b.disabled = true; $('#rkMsg', v).textContent = '가져오는 중…';
      try { const r = await api('POST', 'api/discovery/ranking', { kind, size: +$('#rkSize', v).value, platform: $('#rkPf', v).value, keyword: $('#rkKw', v).value.trim(), food_only: $('#rkFood', v).checked });
        R.rows = r.rows; R.meta = r.meta; R.sel = new Set(); $('#rkMsg', v).textContent = `${r.rows.length}개를 가져왔어요`; this.rankRender(v); }
      catch (e) { $('#rkMsg', v).textContent = e.message; }
      finally { b.disabled = false; }
    },
    rankRender(v) {
      const R = S.disc.rank, box = $('#rkRes', v), m = R.meta;
      $('#rkCsv', v).hidden = !R.rows.length;
      if (m && !R.rows.length && (m.food_filter || {}).applied) { box.innerHTML = `<div class="im-empty">오늘 인기 차트 ${m.food_filter.chart_total}개 중 식품 관련 영상이 없어요. 'YouTube 키워드 채널'로 mukbang·review đồ ăn 등을 검색해 보세요</div>`; $('#rkMeta', v).innerHTML = ''; $('#rkReg', v).disabled = true; return; }
      if (!m || !R.rows.length) { box.innerHTML = '<div class="im-empty">[순위 가져오기]를 누르면 기준 시각과 함께 순위가 나와요</div>'; $('#rkMeta', v).innerHTML = ''; $('#rkReg', v).disabled = true; return; }
      const at = m.collected_at || {}, isVid = m.kind === 'yt_popular_videos';
      $('#rkMeta', v).innerHTML = `<div class="im-banner is-info" style="margin:0"><div class="im-grow"><b>${esc(m.label)} · Top ${m.size}${m.keyword ? ` · 키워드 "${esc(m.keyword)}"` : ''}</b>
        <div class="im-small">기준 시각: ${esc(at.kst || '')} = ${esc(at.ict || '')}</div><div class="im-small im-muted">집계 기준: ${esc(m.basis)} · 지역 ${esc(m.region || '')} · ${m.count}개</div>
        ${(m.food_filter || {}).applied ? `<div class="im-small">식품 관련만: 인기 차트 ${m.food_filter.chart_total}개 중 ${m.food_filter.matched}개 (${esc(m.food_filter.rule)})</div>` : ''}
        ${(m.food_filter || {}).applied && m.count < m.size ? `<div class="im-small" style="color:var(--im-warn)">오늘 차트에 식품 영상이 ${m.count}개뿐이에요. 더 많이 보려면 순위 종류를 'YouTube 키워드 채널'로 바꾸고 mukbang·review đồ ăn 같은 검색어를 쓰세요</div>` : ''}</div></div>`;
      box.innerHTML = `<div class="im-tblwrap" style="margin-top:8px;max-height:560px;overflow:auto"><table><thead><tr><th><input type="checkbox" id="rkAll" aria-label="모두 선택"></th><th class="r">순위</th><th>${isVid ? '영상 · 채널' : '계정'}</th>${isVid ? '<th class="r">영상 조회수</th>' : ''}<th class="r">${m.platform === 'yt' ? '구독자' : '팔로워'}</th><th>출처</th><th>등록 여부</th></tr></thead><tbody>${R.rows.map((r, i) => `<tr>
        <td><input type="checkbox" data-rk="${i}" ${R.sel.has(i) ? 'checked' : ''} ${r.duplicate ? 'disabled' : ''} aria-label="${esc(r.name)} 선택"></td>
        <td class="r im-num">${r.rank}</td>
        <td>${isVid ? `<a href="${esc(r.video_url)}" target="_blank" rel="noopener">${esc(r.video_title)}</a><div class="im-sub">` : ''}<a href="${esc(r.url)}" target="_blank" rel="noopener"><b>${esc(r.name || r.handle)}</b></a>${isVid ? '' : '<div class="im-sub">'}<span class="im-pf pf-${r.platform}"><i></i>${PFN[r.platform]}</span> @${esc(r.handle)}${r.country ? ' · ' + esc(r.country) : ''}</div></td>
        ${isVid ? `<td class="r im-num">${r.video_views != null ? short(r.video_views) : '–'}</td>` : ''}
        <td class="r im-num">${r.followers != null ? short(r.followers) : '비공개'}</td>
        <td>${esc(r.provider || '')}<div class="im-sub">${esc(r.source_label || '')} ${confChip(r.confidence)}</div></td>
        <td>${r.duplicate ? `<span class="im-chip st-declined">등록됨</span><div class="im-sub">${esc((r.duplicate_of || {}).name || '')}</div>` : '<span class="im-chip st-sent">신규</span>'}</td></tr>`).join('')}</tbody></table></div>`;
      const upd = () => { $('#rkReg', v).disabled = !R.sel.size; $('#rkReg', v).textContent = R.sel.size ? `선택한 계정 ${R.sel.size}개 후보로 등록` : '선택한 계정 후보로 등록'; };
      $$('input[data-rk]', box).forEach(c => { c.onchange = () => { const i = +c.dataset.rk; c.checked ? R.sel.add(i) : R.sel.delete(i); upd(); }; });
      $('#rkAll', box).onchange = e => { R.rows.forEach((r, i) => { if (!r.duplicate) e.target.checked ? R.sel.add(i) : R.sel.delete(i); }); this.rankRender(v); };
      upd();
    },
    async rankRegister(v) {
      const R = S.disc.rank, recs = R.rows.filter((r, i) => R.sel.has(i));
      if (!recs.length) { toast('등록할 계정을 고르세요'); return; }
      try { const r = await api('POST', 'api/discovery/register', { records: recs, eventId: S.flt.ev || '' }); replaceAll(r);
        const made = new Map(r.created.map(x => [x.account_key, x.name]));
        R.rows.forEach(row => { if (row.account_key && made.has(row.account_key)) { row.duplicate = true; row.duplicate_of = { name: made.get(row.account_key) }; } });
        R.sel = new Set(); this.rankRender(v);
        $('#rkRegMsg', v).textContent = `등록 ${r.created.length}명${r.skipped.length ? ` · 중복으로 건너뜀 ${r.skipped.length}명` : ''}${r.errors.length ? ` · 오류 ${r.errors.length}명` : ''}`;
        toast(r.created.length ? `${r.created.length}명을 후보로 등록했어요` : '새로 등록된 후보가 없어요'); }
      catch (e) { $('#rkRegMsg', v).textContent = e.message; }
    },
    csvReport(v, rep, errors, fname) {
      const box = $('#dCsvRep', v); if (!rep) { box.innerHTML = ''; return; }
      const li = (t) => `<li>${t}</li>`;
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
      box.innerHTML = `<div class="im-eyebrow">정제 결과</div><div class="im-muted im-small">${esc(fname)}</div><ul class="im-small" style="margin:6px 0 0;padding-left:18px">${items.map(li).join('')}</ul>${(errors || []).length ? `<div class="im-note" style="margin-top:8px">${errors.slice(0, 20).map(e => esc(e.line + '행: ' + e.error)).join('<br>')}${errors.length > 20 ? '<br>…' : ''}</div>` : ''}`;
    },
    filters(v) {
      const n = id => { const x = $('#' + id, v).value; return x === '' ? null : +x; };
      return { country: $('#dCountry', v).value, language: $('#dLang', v).value, min_followers: n('dMinF'), max_followers: n('dMaxF'), min_views: n('dMinV'), min_er: n('dMinEr'), min_vn_audience: n('dMinVn'), categories: S.disc.cats, keyword: $('#dKw', v).value.trim() };
    },
    crit(v) {
      const f = this.filters(v), pn = { tt: 'TikTok', ig: 'Instagram', yt: 'YouTube' }[S.disc.platform];
      $('#dCrit', v).textContent = [`[${pn} 크리에이터 검색 기준 · 한정선 찹쌀떡 베트남]`,
        `국가/지역: ${f.country || '제한 없음'} (Creator location: Vietnam)`, `카테고리: ${(f.categories || []).join(', ') || '전체'}`,
        `팔로워: ${f.min_followers ? grp(f.min_followers) : '-'} ~ ${f.max_followers ? grp(f.max_followers) : '-'}`,
        `조회수 중앙값(Median views) 최소: ${f.min_views ? grp(f.min_views) : '-'}`, `참여율 최소: ${f.min_er != null ? f.min_er + '%' : '-'}`,
        `베트남 시청자 비중 최소: ${f.min_vn_audience != null ? f.min_vn_audience + '%' : '-'}`, `콘텐츠 언어: ${f.language || '제한 없음'}`,
        '찾은 계정은 대시보드 [발굴] → 후보 직접 입력 또는 CSV 양식으로 등록'].join('\n');
    },
    async providers(v) {
      const box = $('#dProv', v); let list;
      try { list = await api('GET', 'api/discovery/providers'); } catch (e) { box.innerHTML = `<p class="im-note" style="margin:0">${esc(e.message)}</p>`; return; }
      const D = S.disc, usable = list.filter(p => p.search && p.configured && p.platforms.includes(D.platform));
      if (!usable.some(p => p.key === D.provider)) D.provider = usable[0]?.key || '';
      const item = p => {
        const ok = p.search && p.configured;
        return `<label class="im-row" style="gap:8px;align-items:flex-start;${ok ? '' : 'opacity:.6'}"><input type="radio" name="dProvR" value="${p.key}" ${D.provider === p.key ? 'checked' : ''} ${ok ? '' : 'disabled'} style="margin-top:3px">
          <span class="im-grow"><b>${esc(p.name)}</b> ${ok ? '<span class="im-chip st-shot">사용 가능</span>' : !p.search ? '<span class="im-chip">검색 없음</span>' : '<span class="im-chip st-declined">키 없음</span>'}${p.sandbox ? ' <span class="im-chip st-replied">샌드박스</span>' : ''}
          <span class="im-muted im-small" style="display:block">${esc(srcLabel(p.source_type))} · 지원 조건: ${esc(p.filters.join(', ') || '-')}${p.not_supported.length ? ' · 지원 안 함: ' + esc(p.not_supported.join(', ')) : ''} · ${esc(p.cost)}</span></span></label>`; };
      const shown = list.filter(p => p.platforms.includes(D.platform));
      const main = shown.filter(p => !OPTIONAL_SVC.includes(p.key) || p.configured), hid = shown.filter(p => OPTIONAL_SVC.includes(p.key) && !p.configured);
      box.innerHTML = main.map(item).join('') + (hid.length ? optFold(hid.length, hid.map(item).join('')) : '');
      $$('input[name=dProvR]', box).forEach(r => { r.onchange = () => { D.provider = r.value; }; });
      $('#dGo', v).disabled = !usable.length;
      $('#dGoMsg', v).textContent = usable.length ? '' : '이 플랫폼에 쓸 수 있는 API가 없어요. 오른쪽 TikTok One 연계·직접 입력·CSV를 쓰세요';
    },
    async search(v) {
      const D = S.disc, b = $('#dGo', v); if (!D.provider) { toast('조회할 곳을 고르세요'); return; }
      b.disabled = true; $('#dRes', v).innerHTML = '<p class="im-muted" style="margin:0">조회 중…</p>';
      try { const r = await api('POST', 'api/discovery/search', { provider: D.provider, platform: D.platform, filters: this.filters(v) });
        D.rows = r.rows; D.meta = r.meta; D.source = D.provider; D.sel = new Set(); this.results(v); }
      catch (e) { D.rows = []; $('#dRes', v).innerHTML = `<div class="im-note">${esc(e.message)}<br>API 대신 오른쪽 TikTok One 연계·직접 입력·CSV로 이어서 진행할 수 있어요.</div>`; $('#dMeta', v).textContent = ''; }
      finally { b.disabled = false; }
    },
    results(v) {
      const D = S.disc, box = $('#dRes', v);
      if (!D.rows.length) { box.innerHTML = '<div class="im-empty">검색하거나 CSV를 올리면 후보가 여기에 나와요</div>'; $('#dReg', v).disabled = true; $('#dMeta', v).textContent = ''; $('#dNotice', v).innerHTML = ''; return; }
      this.notice(v);
      const m = D.meta || {};
      $('#dMeta', v).textContent = m.csv ? `CSV ${D.rows.length}명${(m.errors || []).length ? ` · 오류 ${m.errors.length}줄: ` + m.errors.map(e => e.line + '행 ' + e.error).join(', ') : ''}` : `받은 결과 ${m.returned ?? D.rows.length}건 → 조건 적용 후 ${D.rows.length}건${m.category_filter_applied === false && D.provider !== 'youtube' ? ' · 카테고리는 이 API 필터에 적용 안 됨' : ''}`;
      box.innerHTML = `<div class="im-tblwrap"><table><thead><tr><th><input type="checkbox" id="dAll" aria-label="모두 선택"></th><th>계정</th><th class="r">팔로워</th><th class="r">조회수</th><th class="r">참여율</th><th class="r">베트남 시청자</th><th>출처·신뢰도</th><th>등록 여부</th></tr></thead><tbody>${D.rows.map((r, i) => `<tr>
        <td><input type="checkbox" data-i="${i}" ${D.sel.has(i) ? 'checked' : ''} ${r.duplicate ? 'disabled' : ''} aria-label="${esc(r.name)} 선택"></td>
        <td><a href="${esc(r.url)}" target="_blank" rel="noopener"><b>${esc(r.name || r.handle)}</b></a><div class="im-sub"><span class="im-pf pf-${r.platform}"><i></i>${PFN[r.platform]}</span> @${esc(r.handle)}${r.country ? ' · ' + esc(r.country) : ''}</div>${(r.unverified || []).filter(x => x.startsWith('활동 국가')).length ? `<div class="im-sub" style="color:var(--im-warn)">채널 표기 국가가 달라요</div>` : ''}${r.enriched ? `<div class="im-sub">지표 채움: ${esc(r.enriched)}</div>` : ''}${(r.cleansing || []).length ? `<div class="im-sub" style="color:var(--im-warn)">정제: ${esc(r.cleansing.join(', '))}</div>` : ''}</td>
        <td class="r im-num">${r.followers != null ? short(r.followers) : '–'}</td>
        <td class="r im-num">${r.median_views != null ? short(r.median_views) + '<div class="im-sub">중앙값</div>' : r.avg_views != null ? short(r.avg_views) + '<div class="im-sub">평균</div>' : '–'}</td>
        <td class="r im-num">${r.er != null ? pct(r.er) : '<span class="im-faint" title="이 조회 방식에서는 값을 주지 않아요">–</span>'}</td><td class="r im-num">${r.vn_audience != null ? pct(r.vn_audience) : '<span class="im-faint" title="채널 주인만 볼 수 있는 정보예요">–</span>'}</td>
        <td>${esc(r.provider || '')}<div class="im-sub">${esc(srcLabel(r.source_type))} ${confChip(r.confidence)} · ${esc(r.collected_on || '')}</div>${r.est_cost != null ? `<div class="im-sub">SaaS 추정 광고비 ${grp(r.est_cost)} (계약가 아님)</div>` : ''}</td>
        <td>${r.duplicate ? `<span class="im-chip st-declined">등록됨</span><div class="im-sub">${esc(r.duplicate_of.name)}</div>` : '<span class="im-chip st-sent">신규</span>'}</td></tr>`).join('')}</tbody></table></div>`;
      const upd = () => { $('#dReg', v).disabled = !D.sel.size; $('#dReg', v).textContent = D.sel.size ? `선택한 후보 ${D.sel.size}명 등록` : '선택한 후보 등록'; };
      $$('input[data-i]', box).forEach(c => { c.onchange = () => { const i = +c.dataset.i; c.checked ? D.sel.add(i) : D.sel.delete(i); upd(); }; });
      $('#dAll', box).onchange = e => { D.rows.forEach((r, i) => { if (!r.duplicate) e.target.checked ? D.sel.add(i) : D.sel.delete(i); }); this.results(v); };
      upd();
    },
    notice(v) {
      const D = S.disc, labels = [...new Set(D.rows.flatMap(r => (r.unverified || []).filter(x => !x.startsWith('활동 국가'))))];
      const canFill = D.rows.some(r => ['yt', 'tt', 'ig'].includes(r.platform) && !r.enriched && (r.median_views == null || r.er == null));
      const parts = [];
      if (labels.length) parts.push(`검색 조건 중 <b>${esc(labels.join('·'))}</b>은(는) 이 조회 방식이 값을 주지 않아 걸러지지 않았어요. 값이 없는 후보도 빼지 않고 보여 줘요.`);
      if (labels.includes('베트남 시청자 비중')) parts.push('베트남 시청자 비중은 채널 주인만 볼 수 있어 공개 API로는 알 수 없어요 (협업 제안 때 인사이트 캡처를 요청하세요).');
      if (canFill) parts.push('<b>[지표 채우기]</b>를 누르면 YouTube는 최근 영상 기준 조회수 중앙값·참여율을 가져오고(채널당 약 3유닛), TikTok·Instagram은 Phyllo 권한이 있을 때 채워요. 채운 뒤 조건을 다시 적용해요.');
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
        const r = await api('POST', 'api/discovery/register', { records: recs, eventId: S.flt.ev || '' });
        replaceAll(r);
        const txt = `등록 ${r.created.length}명${r.skipped.length ? ` · 중복으로 건너뜀 ${r.skipped.length}명(${r.skipped.map(x => x.existing).join(', ')})` : ''}${r.errors.length ? ` · 오류 ${r.errors.length}명(${r.errors.map(x => x.error).join(', ')})` : ''}`;
        if (msgFn) msgFn(txt, !r.created.length); else $('#dRegMsg', v).textContent = txt;
        toast(r.created.length ? `${r.created.length}명을 후보로 등록했어요. [인플루언서]·[제안 메일]에서 이어서 진행하세요` : '새로 등록된 후보가 없어요');
        const made = new Map(r.created.map(x => [x.account_key, x.name]));
        r.skipped.forEach(x => made.set('', ''));
        S.disc.rows.forEach(row => { if (made.has(row.account_key) && row.account_key) { row.duplicate = true; row.duplicate_of = { name: made.get(row.account_key) }; } });
        S.disc.sel = new Set(); if (S.tab === 'discover') this.results(v);
      } catch (e) { if (msgFn) msgFn(e.message, true); else toast(e.message); }
    },
  };

  /* ================= 연결 여부 확인 (API) ================= */
  const SERVICE_META = [
    { key: 'youtube', name: 'YouTube Data API', test: 'api/integrations/youtube/test', envs: ['YOUTUBE_API_KEY'], can: '구독자·총 조회수·영상 수, 최근 영상 조회수 중앙값, 베트남 채널 검색', get: '무료 (Google Cloud 콘솔에서 키 발급, 하루 10,000유닛)' },
    { key: 'phyllo', name: 'Phyllo', test: 'api/integrations/phyllo/test', envs: ['PHYLLO_CLIENT_ID', 'PHYLLO_CLIENT_SECRET', 'PHYLLO_ENV'], can: '연결 확인, 공개 프로필 분석 시도(팔로워·평균 조회수·참여율)', get: '대시보드 가입 후 sandbox 키 발급. 공개 분석은 요금제 확인 필요' },
    { key: 'modash', name: 'Modash', test: 'api/integrations/modash/test', envs: ['MODASH_API_KEY'], can: '베트남 크리에이터 검색(팔로워·조회수 중앙값·참여율·시청자 국가 조건), 남은 크레딧', get: 'API 별도 계약(공식 안내: 연 $16,200부터). 시험 크레딧은 영업 상담으로 요청' },
    { key: 'hypeauditor', name: 'HypeAuditor', test: 'api/integrations/hypeauditor/test', envs: ['HYPEAUDITOR_CLIENT_ID', 'HYPEAUDITOR_API_TOKEN', 'HYPEAUDITOR_SANDBOX'], can: '크리에이터 검색(팔로워·평균 조회수·참여율·시청자 국가 조건), 남은 조회 수', get: 'API 계약 필요(가격·무료 시험 여부 미확인). 샌드박스 검색 경로는 문서에 있음' },
  ];
  VIEWS.api = {
    mount(v) {
      v.innerHTML = `<div class="im-grid2" id="apiCards"></div>
        <div class="im-panel" style="margin-top:16px"><h2>호출 기록 <small>최근 60건 · 서버를 다시 켜면 지워져요 · 터미널(검은 창)에도 같은 내용이 찍혀요</small></h2>
          <div class="im-row" style="margin-bottom:8px"><button type="button" class="im-btn is-sm" id="apiReload">새로고침</button></div>
          <div class="im-tblwrap"><table><thead><tr><th>시각</th><th>서비스</th><th>호출</th><th>결과</th><th class="r">걸린 시간</th><th class="r">YouTube 유닛</th><th>내용</th></tr></thead><tbody id="apiLog"></tbody></table></div></div>
        <div class="im-panel" style="margin-top:16px"><h2>API 키 설정 안내</h2>
          <p style="margin:0 0 8px">이 화면에는 키를 입력하지 않아요. 서버 접근 통제와 안전한 비밀 저장소가 없어서, 키는 서버의 <b>.env</b> 파일(또는 환경변수)에만 넣어요. 키는 브라우저로 보내지 않고, 화면·기록에는 앞뒤 몇 글자만 보여요.</p>
          <pre class="im-raw">YOUTUBE_API_KEY=
PHYLLO_CLIENT_ID=
PHYLLO_CLIENT_SECRET=
PHYLLO_ENV=sandbox            # sandbox / staging / production
# ↓ 선택 연동 (있을 때만, 비워 두면 화면에서 접혀 있어요)
MODASH_API_KEY=
HYPEAUDITOR_CLIENT_ID=
HYPEAUDITOR_API_TOKEN=
HYPEAUDITOR_SANDBOX=1         # 1이면 샌드박스 검색(시험용 데이터)</pre>
          <p class="im-muted im-small" style="margin:8px 0 0">.env를 고친 뒤에는 서버를 껐다 켜야 반영돼요. .env는 Git에 올리지 마세요. 키가 채팅·메신저·캡처 등으로 노출됐다면 해당 서비스에서 키(Secret)를 새로 발급받고 이전 키는 폐기하세요.</p></div>`;
      $('#apiReload', v).onclick = () => this.update(v);
    },
    async update(v) {
      let st; try { st = await api('GET', 'api/integrations/status'); } catch (e) { $('#apiCards', v).innerHTML = `<div class="im-note">${esc(e.message)}</div>`; return; }
      const badge = ok => ok ? '<span class="im-chip st-shot">설정됨</span>' : '<span class="im-chip">키 없음</span>';
      const svc = st.services || {};
      const card = m => { const c = st[m.key] || {}, s = svc[m.key] || {};
        const credits = m.key === 'youtube' ? `오늘 사용(이번 실행 기준) ${grp(c.units_used)} / ${grp(c.daily_limit)} 유닛` : s.credits != null ? `남은 크레딧·조회 ${grp(s.credits)}` : m.key === 'phyllo' ? 'API에서 사용량 정보를 주지 않음' : '연결 확인 후 표시 (응답에 있을 때만)';
        const state = !c.configured ? '<span class="im-muted">비활성 (기존 기능에는 영향 없음)</span>' : s.last_result === 'ok' ? '<span class="im-chip st-shot">연결 성공</span>' : s.last_result === 'error' ? `<span class="im-chip st-declined">${s.permission_denied ? '권한 부족' : s.credits_exhausted ? '크레딧·사용량 부족' : '실패'}</span>` : '<span class="im-muted">아직 확인 안 함</span>';
        return `<div class="im-panel"><h2>${m.name} ${badge(c.configured)}</h2>
          <table class="im-small" style="border-collapse:collapse;width:100%"><tbody>
          <tr><td class="im-muted" style="width:110px;padding:2px 0">환경</td><td>${esc(c.env || (m.key === 'youtube' ? 'production' : '-'))}${c.key_hint || c.id_hint ? ' · ' + esc(c.key_hint || c.id_hint) : ''}</td></tr>
          <tr><td class="im-muted" style="padding:2px 0">상태</td><td>${state}</td></tr>
          <tr><td class="im-muted" style="padding:2px 0">사용량</td><td>${esc(credits)}</td></tr>
          <tr><td class="im-muted" style="padding:2px 0">마지막 성공</td><td>${esc((s.last_ok_at || '-').replace('T', ' '))}</td></tr>
          <tr><td class="im-muted" style="padding:2px 0">할 수 있는 것</td><td>${esc(m.can)}</td></tr>
          <tr><td class="im-muted" style="padding:2px 0">키 확보</td><td>${esc(m.get)}</td></tr>
          <tr><td class="im-muted" style="padding:2px 0">환경변수</td><td class="im-num">${m.envs.join(', ')}</td></tr></tbody></table>
          ${s.last_error ? `<div class="im-note" style="margin-top:8px"><b>오류 원인·대응</b><br>${esc(s.last_error)}</div>` : ''}
          <div class="im-row" style="margin-top:10px"><button type="button" class="im-btn is-primary" data-test="${m.test}" ${c.configured ? '' : 'disabled'}>연결 확인</button></div><div class="im-test-out" style="margin-top:8px"></div></div>`; };
      const tto = st.tiktok_one || {};
      const mainSvc = SERVICE_META.filter(m => !OPTIONAL_SVC.includes(m.key) || (st[m.key] || {}).configured);
      const hidSvc = SERVICE_META.filter(m => OPTIONAL_SVC.includes(m.key) && !(st[m.key] || {}).configured);
      $('#apiCards', v).innerHTML = mainSvc.map(card).join('') + `<div class="im-panel"><h2>TikTok One <span class="im-chip">API 미연동</span></h2>
        <p class="im-small" style="margin:0 0 8px">${esc(tto.note || '')}</p>
        <p class="im-muted im-small" style="margin:0 0 10px">TikTok One 공식 API 권한이 실제로 확인되면 그때 연결을 추가해요. 비공식 로그인 자동화·크롤링은 하지 않아요.</p>
        <div class="im-row">${TTO_LINKS.map(([n, u]) => `<a class="im-btn is-sm" href="${u}" target="_blank" rel="noopener">${n}</a>`).join('')}<button type="button" class="im-btn is-sm" id="apiToDisc">[발굴] 탭으로</button></div></div>`
        + (hidSvc.length ? `<div style="grid-column:1/-1">${optFold(hidSvc.length, `<p class="im-muted im-small" style="margin:0 0 10px">${hidSvc.map(m => m.name).join('·')} 키를 .env에 넣고 서버를 다시 켜면 이 접힘 없이 위에 바로 나타나요. 키가 없어도 다른 기능에는 영향이 없어요.</p><div class="im-grid2">${hidSvc.map(card).join('')}</div>`)}</div>` : '');
      $$('[data-test]', v).forEach(b => { b.onclick = async () => {
        const out = b.closest('.im-panel').querySelector('.im-test-out'); b.disabled = true; out.innerHTML = '<span class="im-muted">확인 중…</span>';
        try { const r = await api('POST', b.dataset.test); out.innerHTML = `<div class="im-banner is-info" style="margin:0"><b>성공</b><div class="im-grow">${esc(r.message)}</div></div>`; }
        catch (e) { out.innerHTML = `<div class="im-note">${esc(e.message)}</div>`; }
        finally { b.disabled = false; setTimeout(() => this.update(v), 300); }
      }; });
      const toD = $('#apiToDisc', v); if (toD) toD.onclick = () => show('discover');
      this.renderLog(v, st.log);
    },
    renderLog(v, log) {
      $('#apiLog', v).innerHTML = (log || []).length ? log.map(l => `<tr><td class="im-num">${esc(l.time)}</td><td>${esc(l.service)}</td><td>${esc(l.call)}</td><td>${l.status === '성공' ? '<span class="im-chip st-shot">성공</span>' : `<span class="im-chip st-declined">${esc(l.status)}</span>`}</td><td class="r im-num">${l.ms}ms</td><td class="r im-num">${l.units || ''}</td><td style="white-space:normal;min-width:240px">${esc(l.detail)}</td></tr>`).join('')
        : '<tr><td colspan="7"><div class="im-empty" style="border:0">아직 호출한 기록이 없어요. 위의 [연결 확인]부터 눌러 보세요</div></td></tr>';
    },
  };

  /* ================= 내보내기 ================= */
  VIEWS.export = {
    mount(v) {
      v.innerHTML = `<div class="im-grid2">
        <div class="im-panel"><h2>CSV 내보내기 <small>엑셀에서 한글·베트남어가 깨지지 않게 저장돼요</small></h2><div class="im-stack">
          <div class="im-row"><a class="im-btn is-primary" href="${API}export/influencers.csv">인플루언서 목록 CSV</a><span class="im-muted im-small" id="xInfN"></span></div>
          <div class="im-row"><a class="im-btn" href="${API}export/schedule.csv">일정 CSV</a><span class="im-muted im-small">협의·촬영·게시 날짜를 한 줄에 하나씩</span></div>
          <div class="im-row"><a class="im-btn" href="${API}export/quotes.csv">단가 기록 CSV</a><span class="im-muted im-small">환산값과 참고가 비교 포함</span></div>
          <div class="im-hr"></div>
          <div class="im-row"><a class="im-btn" href="${API}export/template.csv">가져오기용 빈 양식 CSV</a><span class="im-muted im-small">이 양식에 채워 인플루언서 탭에서 가져오면 한꺼번에 등록돼요</span></div></div></div>
        <div class="im-panel"><h2>PDF 보고서 <small>보고·공유용 요약</small></h2><p class="im-muted" style="margin-top:0">현황 수치, 인플루언서 목록, 다가오는 일정, 단가 기록을 A4로 묶어요. 새 창에서 'PDF로 저장 / 인쇄'를 누르고 대상을 'PDF로 저장'으로 고르세요.</p>
          <a class="im-btn is-primary" href="${API}report" target="_blank" rel="noopener">보고서 열기</a></div></div>`;
    },
    update(v) { const e = $('#xInfN', v); if (e) e.textContent = `${S.inf.size}명`; },
  };

  /* ---------- 시작 ---------- */
  buildTabs(); show(S.tab, true); renderBanners();
})();
