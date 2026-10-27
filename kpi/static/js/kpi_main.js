// KPI 화면 스크립트 [민지]
// type="module"로 불러오므로 전역 변수·함수가 생기지 않습니다. (README 7장)
// 차트는 Chart.js(CDN). 라이브러리를 바꾸게 되면 아래 "차트" 묶음만 고칩니다.
// 엑셀(.xlsx)은 같은 폴더의 kpi_xlsx.js가 만듭니다(새 라이브러리 없음).

import { Sheet, downloadXlsx } from "./kpi_xlsx.js";

const root = document.querySelector(".kpi-page");
const API = {
  summary: "/kpi/api/summary",
  voc: "/kpi/api/voc",
  analyze: "/kpi/api/voc/analyze",
  simulator: "/kpi/api/simulator",
};
const charts = {};
// 화면 선택 상태: ROAS 통화(기본 원화), 리뷰 언어(기본 한국어), 감성 필터(기본 전체)
// surveyComments: 설문 주관식 의견(응답자 1명당 1줄, platform = 설문을 받은 창구) — 1:1 문의 뒤로 이어 붙여 함께 집계
// channels: VOC 창구(팜플렛 QR 3개) · vocAiChannels: AI 창구별 요약([AI로 분석] 전에는 비어 있음)
const view = {
  currency: "KRW", summary: null,
  reviewLang: "ko", reviewFilter: "all", reviewChannel: "all", reviewPage: 1, reviews: [],
  surveyComments: [], channels: [], vocAiChannels: [], vocAiMeta: null,
};
const REVIEW_PAGE_SIZE = 10;

const $ = (name) => root.querySelector(`[data-kpi="${name}"]`);
const setText = (name, text) => {
  const el = $(name);
  if (el) {
    el.textContent = text;
    el.hidden = !String(text ?? "").trim();
  }
};

// ---------- 숫자 표시 ----------
const num = (n) => Number(n).toLocaleString("ko-KR");
const krwMan = (n) => `${num(Math.round(n / 10000))}만 원`;
const vnd = (n) => `${num(n)} VND`;
const pct = (n) => (n === null || n === undefined ? "—" : `${n.toFixed(1)}%`);
const signedKrw = (n) => `${n >= 0 ? "+" : "−"}${num(Math.abs(n))}원`;
const usd = (n) => `$${Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const duration = (sec) => (sec >= 60 ? `${Math.floor(sec / 60)}분 ${String(Math.round(sec % 60)).padStart(2, "0")}초` : `${Math.round(sec)}초`);

// 화면에서는 '감성' 대신 '만족도'(만족 · 보통 · 불만)로 표시합니다. 데이터 값은 Positive/Neutral/Negative 그대로.
const SENTIMENT_LABEL = { Positive: "만족", Neutral: "보통", Negative: "불만" };
// VOC 창구: 제품 팜플렛 하단 QR 3개
const PLATFORM_LABEL = { Zalo_OA: "Zalo", KakaoTalk: "카카오톡", WhatsApp: "WhatsApp" };
const STATUS_CLASS = { live: "is-live", fallback: "is-fallback", public_demo: "is-public", demo: "is-demo", warn: "is-warn" };

// ---------- 차트 마우스 좌표 보정 ----------
// 공통 화면 배율(base.css --ui-zoom, CSS zoom)이 걸리면 Chart.js가 읽는 마우스 위치(화면 px)와 차트 크기(CSS px)가 어긋나
// 툴팁이 다른 막대에 뜹니다. 마우스 위치를 차트 CSS 좌표로 다시 계산해 넘깁니다(배율이 없으면 값이 그대로).
window.Chart?.register({
  id: "kpiZoomPointer",
  beforeEvent(chart, args) {
    const e = args.event;
    const native = e.native;
    if (!native || native.clientX === undefined) return;
    const rect = chart.canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    e.x = (native.clientX - rect.left) * (chart.width / rect.width);
    e.y = (native.clientY - rect.top) * (chart.height / rect.height);
    const a = chart.chartArea;
    args.inChartArea = Boolean(a) && e.x >= a.left && e.x <= a.right && e.y >= a.top && e.y <= a.bottom;
  },
});

// ---------- 디자인 변수 ----------
// .kpi-page에서 읽어야 KPI 안에서만 정의한 변수(--kpi-pink)까지 함께 읽힙니다.
const cssVar = (name) => getComputedStyle(root).getPropertyValue(name).trim();
// 차트 색: 공통 톤(남색·청록·갈색·살구) 안에서 서로 잘 구분되는 진한 색을 씁니다. (base.css 변수 + KPI 전용 분홍)
const palette = () => ({
  pink: cssVar("--kpi-pink"),   // 예산: 인플루언서 예상(분홍, kpi_main.css에서 정의)
  ivory: cssVar("--beige"),     // 예산: 잔여 가용 예산(아이보리)
  light: cssVar("--gold"),      // VOC: 2위 이하 키워드(연한 갈색)
  muted: cssVar("--muted"),
  line: cssVar("--line"),
  lineStrong: cssVar("--line-strong"),
  strong: cssVar("--navy"),   // 진한 남색(기준선 등)
  navy: cssVar("--kpi-navy"), // 예산: 인플루언서 예상(밝은 남색, kpi_main.css에서 정의)
  good: cssVar("--teal"),     // 기준 이상 · 긍정 · 전환
  low: cssVar("--orange"),    // 기준 미달 · 부정 · 예상 지출
  mid: cssVar("--brown"),     // 보조 계열(인플루언서 집행 · 키워드 · 클릭)
  soft: cssVar("--beige"),    // 중립
  ref: cssVar("--navy"),      // 기준선(손익분기 · 전체 평균)
  font: cssVar("--font-body"),
});

// ---------- 화면 조각 ----------
function el(tag, { text, className } = {}, children = []) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  children.forEach((child) => node.append(child));
  return node;
}

// 조치가 필요한 문구: ⚠ + 붉은 굵은 글씨
function warning(text) {
  return el("strong", { text: `⚠ ${text}`, className: "kpi-warn" });
}

function badge(text, tone) {
  return el("span", { text, className: tone ? `badge ${tone}` : "badge" });
}

function setStatus(name, text, status, title = "") {
  const node = $(name);
  if (!node) return;
  node.hidden = status === "demo" || status === "public_demo";
  node.textContent = node.hidden ? "" : text;
  node.className = `kpi-status ${STATUS_CLASS[status] || ""}`;
  node.title = node.hidden ? "" : title;
}

// 머리 칸에 .is-text가 있는 열은 본문 칸도 왼쪽 정렬합니다.
function fillRows(name, rows) {
  const body = $(name);
  const heads = body.closest("table")?.querySelectorAll("thead th") || [];
  const textCols = new Set([...heads].flatMap((th, i) => (th.classList.contains("is-text") ? [i] : [])));
  body.replaceChildren(...rows.map((cells) => el("tr", {}, cells.map((c, i) => {
    const td = c instanceof Node ? el("td", {}, [c]) : el("td", { text: c });
    if (textCols.has(i)) td.classList.add("is-text");
    return td;
  }))));
}

// ---------- 차트 ----------
function drawChart(key, config) {
  const canvas = root.querySelector(`[data-kpi-chart="${key}"]`);
  if (!canvas || !window.Chart) return;
  charts[key]?.destroy();
  const p = palette();
  window.Chart.defaults.font.family = p.font;
  window.Chart.defaults.font.size = parseFloat(cssVar("--fs-table"));
  window.Chart.defaults.color = p.muted;
  charts[key] = new window.Chart(canvas, config);
}

function doughnut(key, labels, values, colors, { cutout = "68%", legend = false, title = "" } = {}) {
  drawChart(key, {
    type: "doughnut",
    data: { labels, datasets: [{ data: values, backgroundColor: colors, borderWidth: 0 }] },
    options: {
      cutout,
      maintainAspectRatio: false,
      plugins: {
        legend: legend ? { position: "right", labels: { boxWidth: 8, padding: 6 } } : { display: false },
        title: { display: Boolean(title), text: title, align: "start", padding: { top: 0, bottom: 4 } },
      },
    },
  });
}

// 가로 막대 끝에 값을 적는 작은 플러그인(축 눈금 대신 숫자를 바로 읽게)
const barValueLabels = {
  id: "kpiBarValues",
  afterDatasetsDraw(chart) {
    const { ctx } = chart;
    ctx.save();
    ctx.fillStyle = cssVar("--ink");
    ctx.font = `600 ${cssVar("--fs-table")} ${cssVar("--font-body")}`;
    ctx.textBaseline = "middle";
    chart.getDatasetMeta(0).data.forEach((bar, i) => {
      ctx.fillText(num(chart.data.datasets[0].data[i]), bar.x + 6, bar.y);
    });
    ctx.restore();
  },
};

function chartNotice() {
  if (window.Chart) return;
  root.querySelectorAll("[data-kpi-chart]").forEach((canvas) => {
    canvas.replaceWith(el("p", { text: "차트 라이브러리를 불러오지 못했습니다. 확대해서 표의 숫자를 확인해 주세요.", className: "kpi-note" }));
  });
}

// ---------- 상단 KPI ----------
function renderScorecards(data) {
  const { totals, fx } = data;
  setText("month", `기준월 ${data.campaign_month}`);
  setText("spend-krw", krwMan(totals.ad_spend_krw_base));
  setText("spend-vnd", `${vnd(totals.ad_spend_vnd)} · 기준 환율 ${fx.base_rate.toFixed(2)}원 환산`);
  setText("roas", pct(totals.roas_percent));
  setText("roas-sub", `손익분기 ${data.roas_bep_percent}% ${totals.roas_percent >= data.roas_bep_percent ? "초과" : "미달"} · 전환 ${num(totals.conversions)}건`);

  const gainEl = $("fx-gain");
  if (!fx.ok) {
    setText("revenue-krw", krwMan(totals.revenue_krw_base));
    setText("revenue-vnd", `${vnd(totals.revenue_vnd)} · 기준 환율 환산`);
    setText("fx-rate", "—");
    setStatus("fx-badge", "연결 실패", "warn", fx.error || "");
    gainEl.textContent = `${fx.error} · 기준 ${fx.base_rate.toFixed(2)}원`;
    return;
  }

  setText("revenue-krw", krwMan(fx.revenue_krw_live));
  setText("revenue-vnd", `${vnd(totals.revenue_vnd)} · ${fx.is_fallback ? "대체 환율" : "ECOS 환율"} 환산`);
  setText("fx-rate", `${fx.live_rate.toFixed(2)}원`);
  const tip = `${fx.source} ${fx.updated_at || ""}${fx.source_detail ? ` · ${fx.source_detail}` : ""}`;
  if (fx.is_stale) setStatus("fx-badge", `${fx.age_days}일 지난 값`, "warn", `기준일이 ${fx.stale_days}일보다 오래되었습니다. ${tip}`);
  else if (fx.is_fallback) setStatus("fx-badge", "대체 출처", "fallback", tip);
  else setStatus("fx-badge", "ECOS 고시", "live", tip);

  const tone = fx.gain_loss_krw >= 0 ? "kpi-up" : "kpi-down";
  gainEl.replaceChildren(
    el("span", { text: `환차${fx.gain_loss_krw >= 0 ? "익" : "손"} ${signedKrw(fx.gain_loss_krw)}`, className: tone }),
    document.createTextNode(` · 기준 ${fx.base_rate.toFixed(2)}원 · ${fx.as_of || ""}`),
  );
  gainEl.title = `매출 ${signedKrw(fx.revenue_gain_krw)} / 지출 ${signedKrw(fx.spend_loss_krw)} · ${tip}`;
}

// ---------- 예산 ----------
function renderBudget(data) {
  const b = data.budget;
  const p = palette();
  const remaining = Math.max(b.remaining_krw, 0);
  // 예산 색: 녹색 · 분홍 · 밝은 남색 · 아이보리 (남색은 가장 작은 몫인 인플루언서 예상에만 써서 눈에 덜 무겁게)
  const parts = [
    ["플랫폼 광고비", b.platform_krw, p.good],
    ["인플루언서 집행", b.influencer_paid_krw, p.pink],
    ["인플루언서 예상", b.influencer_expected_krw, p.navy],
    ["잔여 가용 예산", remaining, p.ivory],
  ];
  doughnut("budget", parts.map((x) => x[0]), parts.map((x) => x[1]), parts.map((x) => x[2]));
  setText("remaining-pct", pct(b.remaining_percent));

  // '추정': 인플루언서 예상(견적 기준)과, 그 예상을 뺀 잔여 가용 예산
  const estimated = new Set(["인플루언서 예상", "잔여 가용 예산"]);
  const rows = parts.map(([label, value, color]) => {
    const swatch = el("span", { className: "kpi-swatch" });
    swatch.style.background = color;
    const est = estimated.has(label) ? [el("span", { className: "kpi-est", text: "추정" })] : [];
    return el("div", {}, [el("dt", {}, [swatch, document.createTextNode(label), ...est]), el("dd", { text: krwMan(value) })]);
  });
  rows.push(el("div", {}, [el("dt", { text: "총 배정 예산" }), el("dd", { text: krwMan(b.total_krw) })]));
  if (b.remaining_krw < 0) rows.push(el("div", {}, [el("dt", {}, [badge("예산 초과", "red")]), el("dd", { text: krwMan(-b.remaining_krw) })]));
  $("budget-list").replaceChildren(...rows);

  // 예산 소진 막대: 도넛과 같은 색 구간(플랫폼 · 인플루언서 집행 · 인플루언서 예상 · 잔여)
  setText("burn-pct", pct(b.burn_rate_percent));
  const share = (v) => (b.total_krw ? Math.max((v / b.total_krw) * 100, 0) : 0);
  $("burn-segments").replaceChildren(...parts.map(([label, value, color]) => {
    const seg = el("span", { className: "kpi-burn-seg" });
    seg.style.width = `${Math.min(share(value), 100)}%`;
    seg.style.background = color;
    seg.title = `${label} ${krwMan(value)} (${pct(share(value))})`;
    return seg;
  }));
  setText(
    "burn-legend",
    `소진 ${pct(b.burn_rate_percent)} · 인플루언서 예상 ${pct(share(b.influencer_expected_krw))} · 잔여 ${pct(b.remaining_percent)}`,
  );

  const link = data.influencer_link;
  setText(
    "influencer-link",
    !link.ok
      ? `${link.error} — 협찬비는 기본값으로 표시합니다.`
      : link.total === 0
        ? "인플루언서 탭 단가 데이터: 아직 없음 — 협찬비는 기본값으로 표시합니다."
        : `인플루언서 탭 단가 ${link.total}건 연동(견적 ${link.counts.quote} · 계약 ${link.counts.contract}). 예산 반영 기준은 확정 전이라 협찬비는 기본값입니다.`,
  );
  setText("budget-meta", `기간: ${data.campaign_month} · 범위: 베트남 전체 이벤트 · 단위: 원(기준 환율 ${data.fx.base_rate.toFixed(2)}원/100 VND)`);

  // 확대 시: 채널별 집행액과 총 예산 대비 비중
  const rate = data.fx.base_rate;
  fillRows("spend-rows", data.channels.map((c) => {
    const krw = Math.round((c.ad_spend_vnd * rate) / 100);
    return [c.label, num(c.ad_spend_vnd), krwMan(krw), pct((krw / b.total_krw) * 100), pct(c.roas_percent)];
  }));
}

// ---------- ROAS ----------
function renderRoas(data) {
  const p = palette();
  const bep = data.roas_bep_percent;
  const ch = data.channels;
  drawChart("roas", {
    data: {
      labels: ch.map((c) => c.label),
      datasets: [
        {
          type: "bar",
          label: "ROAS(%)",
          data: ch.map((c) => c.roas_percent),
          backgroundColor: ch.map((c) => (c.roas_percent >= bep ? p.good : p.low)),
          maxBarThickness: 40,
        },
        {
          type: "line",
          label: `손익분기 ${bep}%`,
          data: ch.map(() => bep),
          borderColor: p.ref,
          borderDash: [5, 4],
          borderWidth: 1.5,
          pointRadius: 0,
        },
      ],
    },
    options: {
      maintainAspectRatio: false,
      scales: {
        y: { beginAtZero: true, ticks: { callback: (v) => `${v}%` }, grid: { color: p.line } },
        x: { grid: { display: false } },
      },
      plugins: { legend: { position: "top", align: "end", labels: { boxWidth: 8 } } },
    },
  });

  // 손익분기 미달 채널은 ⚠ + 붉은 글씨로 눈에 띄게 표시합니다.
  const best = [...ch].sort((a, b) => b.roas_percent - a.roas_percent)[0];
  const below = ch.filter((c) => c.roas_percent < bep).map((c) => c.label);
  const advice = $("roas-advice");
  advice.replaceChildren(
    document.createTextNode(`최고 ${best.label} ${pct(best.roas_percent)}`),
    ...(below.length ? [document.createTextNode(" · "), warning(`손익분기 미달: ${below.join(", ")} → 예산 조정 검토`)] : []),
  );
  advice.hidden = false;
  renderRoasMoney(data);
}

// ROAS 블록의 금액(광고비·매출·CPA)을 선택한 통화로 표시합니다. ROAS(%)는 비율이라 통화와 무관합니다.
// A안: 원화 = VND × 편성 기준 환율 ÷ 100, 달러 = 그 원화 ÷ 현재 원/달러 고시 환율
const CURRENCY_LABEL = { KRW: "원", USD: "달러", VND: "VND" };

function money(vnd, data, cur) {
  if (vnd == null) return null;
  const krw = (vnd * data.fx.base_rate) / 100;
  if (cur === "KRW") return krw;
  if (cur === "USD") return data.usd?.ok ? krw / data.usd.krw_per_usd : null;
  return vnd;
}

function fmtMoney(value, cur) {
  if (value == null) return "—";
  if (cur === "USD") return `$${Number(value).toLocaleString("en-US", { maximumFractionDigits: value < 100 ? 2 : 0 })}`;
  if (cur === "KRW") return `${num(Math.round(value))}원`;
  return `${num(Math.round(value))} VND`;
}

function renderRoasMoney(data) {
  const cur = view.currency;
  const bep = data.roas_bep_percent;
  const unit = CURRENCY_LABEL[cur];
  setText("th-spend", `광고비(${unit})`);
  setText("th-revenue", `매출(${unit})`);
  setText("th-cpa", `CPA(${unit})`);
  fillRows("channel-rows", data.channels.map((c) => [
    c.label,
    fmtMoney(money(c.ad_spend_vnd, data, cur), cur),
    fmtMoney(money(c.sales_revenue_vnd, data, cur), cur),
    pct(c.roas_percent),
    fmtMoney(money(c.cpa_vnd, data, cur), cur),
    c.roas_percent >= bep ? badge("기준 초과", "green") : badge("기준 미달", "red"),
  ]));
  $("roas-totals").replaceChildren(
    el("div", {}, [el("dt", { text: "총 광고비" }), el("dd", { text: fmtMoney(money(data.totals.ad_spend_vnd, data, cur), cur) })]),
    el("div", {}, [el("dt", { text: "총 매출" }), el("dd", { text: fmtMoney(money(data.totals.revenue_vnd, data, cur), cur) })]),
  );

  // 달러 환율을 못 받으면 달러 버튼을 끄고 원화로 돌아갑니다.
  const usdBtn = root.querySelector('[data-kpi-action="currency"][data-cur="USD"]');
  usdBtn.disabled = !data.usd?.ok;
  usdBtn.title = data.usd?.ok
    ? `1달러 = ${num(data.usd.krw_per_usd)}원 · ${data.usd.source}${data.usd.as_of ? ` ${data.usd.as_of} 고시` : ""}`
    : data.usd?.error || "달러 환율을 불러오지 못했습니다.";
  if (cur === "USD" && !data.usd?.ok) return setCurrency("KRW");

  const rateNote = cur === "KRW"
    ? `원화 = 편성 기준 환율 ${data.fx.base_rate.toFixed(2)}원/100 VND`
    : cur === "USD"
      ? `달러 = 원화 ÷ ${num(data.usd.krw_per_usd)}원/달러(${data.usd.source}${data.usd.as_of ? ` ${data.usd.as_of}` : ""})`
      : "현지 통화 그대로";
  setText("roas-meta", `기간: ${data.campaign_month} · 범위: 베트남 · 단위: ${unit} (${rateNote})`);
}

function setCurrency(cur) {
  view.currency = cur;
  setSegment("currency", "cur", cur);
  if (view.summary) renderRoasMoney(view.summary);
}

// ---------- GA4 / 크리에이터 ----------
function renderGa4(data) {
  const g = data.ga4;
  setText("ga4-engagement", pct(g.engagement_rate_percent));
  setText("ga4-engagement-sub", g.engaged_sessions == null ? "참여 세션 열 없음" : `${num(g.engaged_sessions)} / ${num(g.sessions)} 세션`);
  setText("ga4-ctr", pct(g.store_action_ctr_percent));
  setText("ga4-ctr-sub", `${num(g.store_action_clicks)}회 클릭`);
  setText("ga4-pamphlet", num(g.pamphlet_sessions));
  setText("ga4-note", g.note);
  // 확대 시: 전환 대체 지표(주요 이벤트 · 비율 · 평균 참여 시간 · 수익) — 값이 없으면 칸을 숨깁니다.
  const conv = [
    ["세션 주요 이벤트 비율", g.session_key_event_rate_percent == null ? null : pct(g.session_key_event_rate_percent)],
    ["주요 이벤트", g.key_events == null ? null : `${num(g.key_events)}건`],
    ["평균 참여 시간", g.avg_engagement_sec == null ? null : duration(g.avg_engagement_sec)],
    ["수익", g.revenue_usd == null ? null : usd(g.revenue_usd)],
  ].filter(([, v]) => v != null);
  $("ga4-conv").replaceChildren(...conv.map(([k, v]) => el("div", {}, [el("dt", { text: k }), el("dd", { text: v })])));
  $("ga4-conv").hidden = !conv.length;
  renderGa4Events(g);
  const period = g.period && (g.period.start || g.period.end) ? `${g.period.start || "?"} ~ ${g.period.end || "?"}` : "—";
  ga4View.status = g.status;
  ga4View.note = g.note;
  ga4View.meta = `출처: ${g.source} · 기간: ${period} · 범위: ${g.scope} · 표본: 세션 ${num(g.sessions)}`;
  renderGa4Channels(g);
  renderCreators(data.creators);
  setGa4Visible($("ga4-panel").hidden === false);
}

// 기본 화면: 세션이 많은 채널 5개의 참여율 막대 (세로 점선 = 전체 참여율)
function renderGa4Top(g) {
  const avg = g.engagement_rate_percent;
  const top = [...g.channels].sort((a, b) => b.sessions - a.sessions).slice(0, 5);
  $("ga4-top").replaceChildren(...top.map((c) => {
    const rate = c.engagement_rate_percent ?? 0;
    const fill = el("span", { className: `kpi-bar-fill${avg != null && rate >= avg ? " is-high" : ""}` });
    fill.style.width = `${Math.min(rate, 100)}%`;
    const track = el("span", { className: "kpi-bar-track" }, [fill]);
    if (avg != null) {
      const mark = el("span", { className: "kpi-bar-avg" });
      mark.style.left = `${Math.min(avg, 100)}%`;
      mark.title = `전체 참여율 ${pct(avg)}`;
      track.append(mark);
    }
    const name = el("span", { className: "kpi-bar-name" }, [document.createTextNode(c.channel), el("small", { text: `${num(c.sessions)}세션` })]);
    name.title = `${c.channel} · 세션 ${num(c.sessions)} · 참여 세션 ${c.engaged_sessions == null ? "—" : num(c.engaged_sessions)}`;
    return el("li", {}, [name, track, el("span", { className: "kpi-bar-value", text: pct(c.engagement_rate_percent) })]);
  }));
}

// 확대 시: 유입 채널별 세션·참여율 (GA4 데모 CSV의 채널별 줄)
function renderGa4Channels(g) {
  const hasChannels = g.channels && g.channels.length > 0;
  $("ga4-channel-section").hidden = !hasChannels;
  $("ga4-channel-empty").hidden = hasChannels;
  $("ga4-top-section").hidden = !hasChannels;
  if (!hasChannels) return;
  renderGa4Top(g);
  setStatus("ga4-channel-badge", g.status === "public_demo" ? "공개 데모" : "시연", g.status);
  const p = palette();
  const avg = g.engagement_rate_percent;
  const rows = g.channels.filter((c) => c.engagement_rate_percent != null);
  drawChart("ga4-channels", {
    data: {
      labels: rows.map((c) => c.channel),
      datasets: [
        {
          type: "bar",
          label: "채널 참여율(%)",
          data: rows.map((c) => c.engagement_rate_percent),
          backgroundColor: rows.map((c) => (avg != null && c.engagement_rate_percent >= avg ? p.good : p.low)),
          maxBarThickness: 28,
        },
        ...(avg != null
          ? [{ type: "line", label: `전체 ${pct(avg)}`, data: rows.map(() => avg), borderColor: p.ref, borderDash: [5, 4], borderWidth: 1.5, pointRadius: 0 }]
          : []),
      ],
    },
    options: {
      maintainAspectRatio: false,
      scales: {
        y: { beginAtZero: true, max: 100, ticks: { callback: (v) => `${v}%` }, grid: { color: p.line } },
        x: { grid: { display: false }, ticks: { autoSkip: false, maxRotation: 30 } },
      },
      plugins: { legend: { position: "top", align: "end", labels: { boxWidth: 8 } } },
    },
  });
  const dash = (v, f) => (v == null ? "—" : f(v));
  fillRows("ga4-channel-rows", [
    ...g.channels.map((c) => [
      c.channel,
      num(c.sessions),
      pct((c.sessions / g.sessions) * 100),
      pct(c.engagement_rate_percent),
      dash(c.avg_engagement_sec, duration),
      dash(c.key_events, num),
      dash(c.session_key_event_rate_percent, pct),
      dash(c.revenue_usd, usd),
    ]),
    ["합계", num(g.sessions), "100.0%", pct(g.engagement_rate_percent), dash(g.avg_engagement_sec, duration),
      dash(g.key_events, num), dash(g.session_key_event_rate_percent, pct), dash(g.revenue_usd, usd)],
  ]);
  $("ga4-channel-rows").lastElementChild.classList.add("kpi-row-total");
}

// 확대 시: 이벤트 보고서 Top 10 (이벤트 수 · 전체 이벤트 대비 · 사용자 · 사용자당 횟수)
function renderGa4Events(g) {
  const rows = g.top_events || [];
  $("ga4-events-section").hidden = !rows.length;
  if (!rows.length) return;
  setText("ga4-events-count", g.event_count ? `전체 이벤트 ${num(g.event_count)}건 중` : "");
  fillRows("ga4-event-rows", rows.map((e) => [
    e.event,
    num(e.count),
    g.event_count ? pct((e.count / g.event_count) * 100) : "—",
    e.users == null ? "—" : num(e.users),
    e.users ? (e.count / e.users).toFixed(2) : "—",
  ]));
}

// 크리에이터 전환표 + 확대 시 클릭·전환 막대
function renderCreators(creators) {
  const p = palette();
  fillRows("creator-rows", creators.map((c, i) => [String(i + 1), c.creator, c.platform, num(c.clicks), num(c.conversions), pct(c.cvr_percent)]));
  const clicks = creators.reduce((s, c) => s + c.clicks, 0);
  const conversions = creators.reduce((s, c) => s + c.conversions, 0);
  $("creator-total").replaceChildren(
    el("td", { text: "합계", className: "is-text" }),
    el("td", { className: "is-text" }),
    el("td", { className: "is-text" }),
    el("td", { text: num(clicks) }),
    el("td", { text: num(conversions) }),
    el("td", { text: pct(clicks ? (conversions / clicks) * 100 : null) }),
  );
  drawChart("creators", {
    type: "bar",
    data: {
      labels: creators.map((c) => c.creator),
      datasets: [
        { label: "링크 클릭", data: creators.map((c) => c.clicks), backgroundColor: p.mid, maxBarThickness: 26, yAxisID: "y" },
        { label: "전환", data: creators.map((c) => c.conversions), backgroundColor: p.good, maxBarThickness: 26, yAxisID: "y1" },
      ],
    },
    options: {
      maintainAspectRatio: false,
      scales: {
        y: { beginAtZero: true, position: "left", title: { display: true, text: "클릭" }, grid: { color: p.line } },
        y1: { beginAtZero: true, position: "right", title: { display: true, text: "전환" }, grid: { display: false } },
        x: { grid: { display: false } },
      },
      plugins: { legend: { position: "top", align: "end", labels: { boxWidth: 8 } } },
    },
  });
}

// GA4 켜기/끄기 — 크리에이터 표는 시연 값이므로 배지·출처도 함께 바꿉니다.
const ga4View = { status: "demo", note: "", meta: "출처: —" };

function setGa4Visible(show) {
  $("ga4-panel").hidden = !show;
  $("creator-panel").hidden = show;
  setText("ga4-title", show ? "GA4 트래픽 · 전환" : "크리에이터별 클릭 · 전환 Top 5");
  if (show) {
    setStatus("ga4-badge", ga4View.status === "public_demo" ? "공개 데모" : "시연", ga4View.status, ga4View.note);
    setText("ga4-meta", ga4View.meta);
  } else {
    setStatus("ga4-badge", "시연", "demo", "크리에이터별 클릭·전환은 시연 값입니다.");
    setText("ga4-meta", "범위: 베트남 · 표본: 크리에이터 5명 (인플루언서 탭 공개 함수에 클릭·전환 항목 추가 필요)");
  }
  resizeCharts();
  // 큰 창(확대)에서 바꾸면 새로 보이는 차트도 확대할 때와 같이 막대가 하나씩 올라오게 합니다.
  const panel = $("ga4-panel").closest(".kpi-panel");
  if (panel.classList.contains("is-expanded")) animatePanel(panel);
}

// ---------- VOC ----------
// CS 창구는 팜플렛 QR 3개(Zalo · 카카오톡 · WhatsApp). 1:1 문의·후기와 설문 의견을 모두 view.reviews에 모아
// 도넛 · 창구별 막대 · 키워드 · 창구별 요약 · 목록을 같은 데이터로 계산합니다(AI 분류가 오면 그 결과로 다시 계산).
const SENTIMENT_KEYS = ["Positive", "Neutral", "Negative"];
const vocColors = () => [cssVar("--kpi-voc-good"), cssVar("--kpi-voc-mid"), cssVar("--kpi-voc-bad")];
const countBy = (list, key) => list.reduce((acc, r) => ({ ...acc, [r[key]]: (acc[r[key]] || 0) + 1 }), {});
const channelList = (channel) => (channel === "all" ? view.reviews : view.reviews.filter((r) => r.platform === channel));
const positivePct = (list) => (list.length ? Math.round((list.filter((r) => r.sentiment === "Positive").length / list.length) * 100) : 0);

function renderVoc(reviews, source) {
  view.reviews = [...reviews, ...view.surveyComments];
  const counts = countBy(view.reviews, "sentiment");
  const surveys = view.surveyComments.length;
  const sampleTitle = surveys ? `문의 ${num(reviews.length)} + 설문 ${num(surveys)}` : `문의 ${num(reviews.length)}`;
  doughnut(
    "sentiment",
    SENTIMENT_KEYS.map((k) => `${SENTIMENT_LABEL[k]} ${num(counts[k] || 0)}`),
    SENTIMENT_KEYS.map((k) => counts[k] || 0),
    vocColors(),
    { cutout: "58%", legend: true },
  );
  if (charts.sentiment) {
    // 도넛 조각을 누르면 그 만족도 글만 봅니다(같은 조각을 다시 누르면 전체).
    // 목록은 확대 화면에 있으므로, 기본 화면에서 누르면 블록을 확대한 뒤 거릅니다.
    charts.sentiment.options.onClick = (_e, els) => {
      if (!els.length) return;
      const key = SENTIMENT_KEYS.at(els[0].index);
      const panel = root.querySelector('[data-kpi-panel="voc"]');
      if (!panel.classList.contains("is-expanded")) {
        setExpanded(panel);
        setReviewFilter(key);
      } else {
        setReviewFilter(view.reviewFilter === key ? "all" : key);
      }
    };
    charts.sentiment.options.onHover = (e, els) => { e.native.target.style.cursor = els.length ? "pointer" : "default"; };
  }

  setText("voc-sample", sampleTitle);
  renderVocSummaryBox();
  renderVocChannelBars();
  renderVocKeywords();
  renderVocSummaries();
  renderVocChannels();
  renderReviewList();

  setStatus("voc-source", source.text, source.status, source.title || "");
  const platforms = view.channels.map((c) => PLATFORM_LABEL[c] || c).join("·");
  setText("voc-meta", `출처: ${source.meta} · 창구: ${platforms} · 표본: ${sampleTitle}건 · 범위: 베트남`);
}

// 기본 화면 오른쪽: 창구별 만족도 막대(건수 · 만족/보통/불만 비율). 누르면 확대 화면에서 그 창구를 봅니다.
function renderVocChannelBars() {
  const colors = vocColors();
  $("voc-chbars").replaceChildren(...view.channels.map((ch) => {
    const list = channelList(ch);
    const c = countBy(list, "sentiment");
    const bar = el("span", { className: "kpi-voc-chbar" }, SENTIMENT_KEYS.map((k, i) => {
      const seg = el("span");
      seg.style.width = `${list.length ? ((c[k] || 0) / list.length) * 100 : 0}%`;
      seg.style.background = colors[i];
      seg.title = `${SENTIMENT_LABEL[k]} ${num(c[k] || 0)}건`;
      return seg;
    }));
    const btn = el("button", { className: "kpi-voc-chrow" }, [
      el("span", { className: "kpi-voc-chname" }, [document.createTextNode(PLATFORM_LABEL[ch] || ch), el("small", { text: `${num(list.length)}건` })]),
      bar,
      el("span", { className: "kpi-voc-chpct", text: list.length ? `만족 ${positivePct(list)}%` : "—" }),
    ]);
    btn.type = "button";
    btn.dataset.kpiAction = "voc-channel-open";
    btn.dataset.channel = ch;
    return el("li", {}, [btn]);
  }));
}

// 확대 화면: 핵심 키워드 Top 5 (창구 블록에서 고른 창구 기준, 1위만 진한 청록)
function renderVocKeywords() {
  const top = Object.entries(countBy(channelList(view.reviewChannel), "keyword_tag")).sort((a, b) => b[1] - a[1]).slice(0, 5);
  const strong = cssVar("--kpi-voc-key");
  const soft = cssVar("--kpi-voc-key-soft");
  setText("voc-keyword-scope", view.reviewChannel === "all" ? "전체 창구" : PLATFORM_LABEL[view.reviewChannel] || view.reviewChannel);
  drawChart("keywords", {
    type: "bar",
    data: {
      labels: top.map(([k]) => k),
      datasets: [{ label: "언급 수", data: top.map(([, n]) => n), backgroundColor: top.map((_, i) => (i === 0 ? strong : soft)), maxBarThickness: 16 }],
    },
    options: {
      indexAxis: "y",
      maintainAspectRatio: false,
      layout: { padding: { right: 36 } },  // 막대 끝 숫자 자리
      scales: {
        x: { display: false, beginAtZero: true },  // 눈금 대신 막대 끝에 숫자 표시
        y: { grid: { display: false }, ticks: { autoSkip: false, color: palette().muted } },
      },
      plugins: { legend: { display: false } },
    },
    plugins: [barValueLabels],
  });
}

// 창구별 요약은 [AI로 분석]을 누른 결과(channel_summaries)만 씁니다. 누르기 전(결과 없음)에는 null.
// 결과는 이 화면에만 두고(vocAiResult) 서버는 보관하지 않으므로, 페이지를 다시 열면 다시 분석 전입니다.
const AI_PENDING = "[AI로 분석]을 누르면 창구별 요약이 나옵니다.";
const channelSummary = (ch) => (view.vocAiChannels || []).find((x) => x.channel === ch) || null;

// AI 요약 창(기본 화면 위): 창구마다 한 줄 요약 + ⚠ 유의할 점. 누르기 전에는 안내 한 줄만 두고 보고서(PDF)에서는 뺍니다.
function renderVocSummaryBox() {
  const ai = view.vocAiChannels || [];
  const meta = view.vocAiMeta;
  const box = $("voc-summary");
  // 제목은 왼쪽 세로 라벨로 두어 기본 화면에서 한 줄을 아낍니다. 안내 문구는 라벨에 마우스를 올리면 보입니다.
  const head = el("strong", { className: "kpi-ai-head", text: "AI 요약" });
  box.toggleAttribute("data-report-skip", !ai.length);
  if (!ai.length) {
    head.title = "[AI로 분석]을 누르면 AI가 창구별 문의·설문을 요약합니다.";
    box.replaceChildren(head, el("div", { className: "kpi-ai-rows" }, [el("span", { className: "kpi-note", text: AI_PENDING })]));
    return;
  }
  head.title = "AI가 창구별 문의·설문을 요약한 결과(사람 검수 전)";
  const rows = view.channels.map((ch) => {
    const s = channelSummary(ch) || { summary: "—" };
    const caution = s.caution || (s.improve || [])[0] || "";
    return el("div", { className: "kpi-ai-row" }, [
      el("b", { text: PLATFORM_LABEL[ch] || ch }),
      el("span", { text: s.summary || "—" }),
      el("span", { className: "kpi-ai-caution", text: caution ? `⚠ ${caution}` : "" }),
    ]);
  });
  const foot = meta ? [el("div", { className: "kpi-ai-meta", text: `${meta.model} · ${meta.analyzed_at} 분석 · 사람 검수 전` })] : [];
  box.replaceChildren(head, el("div", { className: "kpi-ai-rows" }, [...rows, ...foot]));
}

// 확대 화면: 창구별 요약 카드(요약 · 유지할 점 · 개선할 점). AI 분석 전에는 안내 한 줄, 보고서(PDF)에서는 뺍니다.
function renderVocSummaries() {
  const ai = view.vocAiChannels || [];
  setText("voc-summary-source", ai.length ? "AI 분석" : "AI 분석 전");
  $("voc-summary-source").parentElement.toggleAttribute("data-report-skip", !ai.length);
  $("voc-ch-summaries").toggleAttribute("data-report-skip", !ai.length);
  if (!ai.length) {
    $("voc-ch-summaries").replaceChildren(el("p", { className: "kpi-note", text: AI_PENDING }));
    return;
  }
  $("voc-ch-summaries").replaceChildren(...view.channels.map((ch) => {
    const s = channelSummary(ch) || { summary: "—" };
    const list = channelList(ch);
    const line = (label, items, tone) => el("p", { className: `kpi-voc-sum-line is-${tone}` }, [
      el("b", { text: label }),
      document.createTextNode(items.length ? items.join(" · ") : "—"),
    ]);
    return el("article", { className: `kpi-voc-sum${view.reviewChannel === ch ? " is-on" : ""}` }, [
      el("header", {}, [el("strong", { text: PLATFORM_LABEL[ch] || ch }), el("small", { text: `${num(list.length)}건 · 만족 ${positivePct(list)}%` })]),
      el("p", { className: "kpi-voc-sum-text", text: s.summary || "—" }),
      line("유지", s.keep || [], "keep"),
      line("개선", s.improve || [], "improve"),
    ]);
  }));
}

// 창구 블록(확대 화면): 창구마다 건수 · 만족/보통/불만 비율 막대. 누르면 리뷰 목록을 그 창구로 거릅니다.
function renderVocChannels() {
  const keys = view.channels;
  const block = (key, label, list) => {
    const n = list.length;
    const count = (s) => list.filter((r) => r.sentiment === s).length;
    const bar = el("span", { className: "kpi-voc-ch-bar" }, ["Positive", "Neutral", "Negative"].map((s) => {
      const seg = el("span", { className: `kpi-voc-ch-${s.toLowerCase()}` });
      seg.style.width = `${n ? (count(s) / n) * 100 : 0}%`;
      return seg;
    }));
    const btn = el("button", { className: `kpi-voc-ch${view.reviewChannel === key ? " is-on" : ""}` }, [
      // 이름 · 건수를 한 줄에(이름 왼쪽, 건수 오른쪽)
      el("span", { className: "kpi-voc-ch-top" }, [el("span", { className: "kpi-voc-ch-name", text: label }), el("strong", { text: `${num(n)}건` })]),
      bar,
      el("small", { text: n ? `만족 ${Math.round((count("Positive") / n) * 100)}% · 불만 ${Math.round((count("Negative") / n) * 100)}%` : "—" }),
    ]);
    btn.type = "button";
    btn.dataset.kpiAction = "review-channel";
    btn.dataset.channel = key;
    btn.setAttribute("aria-pressed", String(view.reviewChannel === key));
    return btn;
  };
  $("voc-channels").replaceChildren(
    block("all", "전체", view.reviews),
    ...keys.map((k) => block(k, PLATFORM_LABEL[k] || k, view.reviews.filter((r) => r.platform === k))),
  );
}

function setReviewChannel(channel, { toggle = true } = {}) {
  view.reviewChannel = toggle && view.reviewChannel === channel ? "all" : channel;
  view.reviewPage = 1;
  renderVocChannels();
  renderVocKeywords();
  renderVocSummaries();
  renderReviewList();
}

// 리뷰 목록(확대 화면): 창구 블록 · 언어(한국어 / 원문 / 둘 다) · 만족도 드롭다운 · 10건씩 페이지 넘김
function renderReviewList() {
  // 만족도는 박스 없이 작은 글씨로: 만족 녹색 · 보통 회색 · 불만 붉은색
  const mood = (text, tone) => el("span", { text, className: `kpi-mood kpi-mood-${tone}` });
  const tone = { Positive: "good", Neutral: "mid", Negative: "bad" };
  const list = view.reviews.filter((r) => (view.reviewChannel === "all" || r.platform === view.reviewChannel)
    && (view.reviewFilter === "all" || r.sentiment === view.reviewFilter));
  const label = [
    view.reviewChannel === "all" ? "" : PLATFORM_LABEL[view.reviewChannel] || view.reviewChannel,
    view.reviewFilter === "all" ? "" : SENTIMENT_LABEL[view.reviewFilter],
  ].filter(Boolean).join(" · ") || "전체";
  const pages = Math.max(Math.ceil(list.length / REVIEW_PAGE_SIZE), 1);
  view.reviewPage = Math.min(Math.max(view.reviewPage, 1), pages);
  $("review-count").textContent = `${label} ${num(list.length)}건 · ${view.reviewPage}/${pages}쪽`;
  renderReviewPager(pages);
  if (!list.length) {
    $("review-list").replaceChildren(el("li", { className: "kpi-review-empty", text: `${label} 리뷰가 없습니다.` }));
    return;
  }
  const start = (view.reviewPage - 1) * REVIEW_PAGE_SIZE;
  $("review-list").replaceChildren(...list.slice(start, start + REVIEW_PAGE_SIZE).map((r) => {
    const head = el("div", { className: "kpi-review-head" }, [
      el("span", { text: `${PLATFORM_LABEL[r.platform] || r.platform}${r.source === "survey" ? " · 설문" : ""}` }),
      r.sentiment ? mood(SENTIMENT_LABEL[r.sentiment], tone[r.sentiment]) : mood("미분류", "mid"),
      el("span", { text: r.keyword_tag || "" }),
    ]);
    const ko = el("p", { className: "kpi-review-ko", text: r.translated_kr || r.raw_text_vn });
    const vi = el("p", { className: "kpi-review-vi", text: r.raw_text_vn });
    vi.lang = r.lang || "vi";
    // 한국어 원문(카카오톡 등)은 번역과 원문이 같으므로 '둘 다'에서도 한 번만 보여 줍니다.
    const body = view.reviewLang === "vi" ? [vi] : view.reviewLang === "ko" || r.lang === "ko" ? [ko] : [ko, vi];
    return el("li", {}, [head, ...body]);
  }));
}

function setSegment(action, attr, value) {
  root.querySelectorAll(`[data-kpi-action="${action}"]`).forEach((b) => {
    const on = b.dataset[attr] === value;
    b.classList.toggle("is-on", on);
    b.setAttribute("aria-pressed", String(on));
  });
}

// 페이지 버튼: ‹ 1 … 4 5 [6] 7 8 … 23 › (현재 쪽 앞뒤 2쪽 + 처음·끝)
function renderReviewPager(pages) {
  const cur = view.reviewPage;
  const pageButton = (page, text, { disabled = false, current = false, label = "" } = {}) => {
    const btn = el("button", { text, className: current ? "is-on" : "" });
    btn.type = "button";
    btn.dataset.kpiAction = "review-page";
    btn.dataset.page = String(page);
    btn.disabled = disabled;
    if (current) btn.setAttribute("aria-current", "page");
    if (label) btn.setAttribute("aria-label", label);
    return btn;
  };
  const shown = [...new Set([1, pages, ...[-2, -1, 0, 1, 2].map((d) => cur + d)])]
    .filter((p) => p >= 1 && p <= pages)
    .sort((a, b) => a - b);
  const items = [pageButton(cur - 1, "‹", { disabled: cur <= 1, label: "이전 쪽" })];
  shown.forEach((p, i) => {
    if (i && p - shown[i - 1] > 1) items.push(el("span", { text: "…", className: "kpi-pager-gap" }));
    items.push(pageButton(p, String(p), { current: p === cur }));
  });
  items.push(pageButton(cur + 1, "›", { disabled: cur >= pages, label: "다음 쪽" }));
  $("review-pager").replaceChildren(...items);
  $("review-pager").hidden = pages <= 1;
}

function setReviewPage(page) {
  view.reviewPage = page;
  renderReviewList();
  $("review-list").scrollIntoView({ block: "nearest" });
}

// 언어·감성을 바꾸면 1쪽부터 다시 봅니다.
function setReviewLang(lang) {
  view.reviewLang = lang;
  view.reviewPage = 1;
  $("review-lang").value = lang;
  renderReviewList();
}

function setReviewFilter(sentiment) {
  view.reviewFilter = sentiment;
  view.reviewPage = 1;
  $("review-filter").value = sentiment;
  renderReviewList();
}

function renderQr(qr) {
  view.qr = qr;  // 엑셀 내보내기(QR 흐름·설문 시트)에서 씁니다.
  const strip = $("qr-strip");
  const step = (label, value) => el("span", {}, [document.createTextNode(`${label} `), el("b", { text: value })]);
  const arrow = () => el("span", { text: "→", className: "kpi-arrow" });
  strip.replaceChildren(
    step("팜플렛 QR 스캔", num(qr.qr_scans)),
    arrow(),
    step("채널 추가", num(qr.follows_total)),
    el("span", { className: "kpi-qr-split", text: `(${Object.entries(qr.follows).sort((x, y) => y[1] - x[1]).map(([ch, n]) => `${PLATFORM_LABEL[ch] || ch} ${num(n)}`).join(" · ")})` }),
    arrow(),
    step("설문 응답", `${num(qr.survey_responses)} (${pct(qr.response_rate_percent)})`),
    ...(qr.survey.overall_avg != null ? [el("span", { text: "·", className: "kpi-arrow" }), step("만족도 평균", `${qr.survey.overall_avg.toFixed(1)} / 5`)] : []),
  );
  const bySurvey = qr.survey_by_channel || {};
  strip.title = [
    `배포 팜플렛 ${num(qr.pamphlets)}장 · 스캔율 ${pct(qr.scan_rate_percent)} · 채널 추가율 ${pct(qr.follow_rate_percent)}`,
    ...Object.entries(qr.follows).sort((x, y) => y[1] - x[1]).map(([ch, n]) => `${PLATFORM_LABEL[ch] || ch}: 추가 ${num(n)} (${pct((n / qr.qr_scans) * 100)}) · 설문 응답 ${num(bySurvey[ch] || 0)}`),
  ].join("\n");

  // 확대 화면: 문항별 1~5점 분포 막대 · 평균 · 긍정(4~5점) 비율 · 응답 수
  const items = qr.survey.items;
  $("survey-count").textContent = `응답 ${num(qr.survey_responses)}건 · ${items.length}문항`;
  fillRows("survey-rows", items.map((s) => {
    const bar = el("span", { className: "kpi-survey-bar" }, s.dist.map((count, i) => {
      const seg = el("span", { className: `kpi-s${i + 1}` });
      seg.style.width = `${s.responses ? (count / s.responses) * 100 : 0}%`;
      seg.title = `${i + 1}점 ${num(count)}명 (${pct(s.responses ? (count / s.responses) * 100 : 0)})`;
      return seg;
    }));
    return [s.item, bar, s.avg == null ? "—" : s.avg.toFixed(2), pct(s.top2_percent), `${num(s.responses)}명`];
  }));
}

function showVocAi(demoReviews, ai) {
  const byId = Object.fromEntries(ai.reviews.map((r) => [r.review_id, r]));
  const merged = demoReviews.map((r) => ({ ...r, ...(byId[r.review_id] || { translated_kr: "", sentiment: null, keyword_tag: null }) }));
  view.vocAiChannels = ai.channel_summaries || [];
  view.vocAiMeta = { model: ai.model, analyzed_at: ai.analyzed_at };
  renderVoc(merged, {
    text: "OpenAI 분석 · 검수 전",
    status: "live",
    title: `${ai.model} · ${ai.analyzed_at} · AI 번역·분류는 사람이 검수하기 전 결과입니다.`,
    meta: `OpenAI ${ai.model} 분석(${ai.analyzed_at}, 검수 전)`,
  });
}

// ---------- 집행 시뮬레이션 (화면에서만 계산, 저장하지 않음) ----------
// 단일 입력 폼: 집행 유형(KOL 협찬 / 공식 매체 광고)에 따라 입력 칸·매체 목록·예상 ROAS 기본값이 바뀝니다.
// 상태는 sim 하나에 모읍니다: 서버 데이터 · 집행 유형 · ROAS 직접 수정 여부 · 집행 예정 목록.
const sim = { data: null, type: "kol", roasEdited: false, items: [], nextId: 1, accountNames: [], suggestActive: -1 };
const SIM_TYPE_LABEL = { kol: "KOL 협찬", paid: "공식 매체" };
const CUSTOM = "__custom__";  // 매체 · 콘텐츠 형태 드롭다운의 '직접 입력'
// KOL 콘텐츠 형태 기본 목록(매체별). 인플루언서 탭 단가에 있는 형식은 자동으로 더합니다.
const KOL_FORMATS = {
  TikTok: ["숏폼 1편", "숏폼 2편", "라이브 1회"],
  Instagram: ["릴스 1편", "피드 1건", "스토리 1건", "릴스 1편 + 스토리 2"],
  YouTube: ["쇼츠 1편", "롱폼 리뷰 1편"],
  Facebook: ["피드 1건", "릴스 1편"],
};
// 매체 목록. roasFrom: 예상 ROAS 기본값을 가져올 실적 채널, help: 매체 아래 보조 글씨
const SIM_MEDIA = {
  kol: [
    { value: "TikTok", roasFrom: "Influencer" },
    { value: "Instagram", roasFrom: "Influencer" },
    { value: "YouTube", roasFrom: "Influencer" },
    { value: "Facebook", roasFrom: "Influencer" },
  ],
  paid: [
    { value: "Meta", roasFrom: "Meta" },
    { value: "TikTok", roasFrom: "TikTok" },
    { value: "Shopee", roasFrom: "Shopee_Ads" },
    { value: "Instagram", roasFrom: "Meta", help: "Meta 광고 관리자에서 집행 · ROAS는 Meta 실적 기준" },
  ],
};

const simForm = () => $("sim-form");

function simRoas(channel) {
  return sim.data?.channels.find((c) => c.channel === channel)?.roas_percent ?? null;
}

// 금액 입력: 1,000 단위 쉼표를 자동으로 붙이고, 커서는 입력하던 숫자 뒤에 그대로 둡니다.
function formatMoneyInput(input) {
  const digitsBefore = input.value.slice(0, input.selectionStart ?? input.value.length).replace(/\D/g, "").length;
  const digits = input.value.replace(/\D/g, "").replace(/^0+(?=\d)/, "");
  input.value = digits ? Number(digits).toLocaleString("en-US") : "";
  let pos = 0;
  for (let seen = 0; pos < input.value.length && seen < digitsBefore; pos++) {
    if (/\d/.test(input.value[pos])) seen++;
  }
  input.setSelectionRange(pos, pos);
}

const parseMoney = (value) => Number(String(value).replace(/\D/g, ""));
// 화폐 환산: VND ↔ 원은 편성 기준 환율, 달러 ↔ 원은 ROAS 블록과 같은 현재 원/달러 고시 환율(요약 API)
const usdRate = () => (view.summary?.usd?.ok ? view.summary.usd.krw_per_usd : null);
const toKrw = (amount, unit) => {
  if (unit === "KRW") return Math.round(amount);
  if (unit === "USD") return Math.round(amount * usdRate());
  return Math.round((amount * sim.data.base_rate) / 100);
};
const fromKrw = (krw, unit) => {
  if (unit === "KRW") return Math.round(krw);
  if (unit === "USD") return Math.round(krw / usdRate());
  return Math.round((krw * 100) / sim.data.base_rate);
};
const toVnd = (amount, unit) => (unit === "VND" ? Math.round(amount) : fromKrw(toKrw(amount, unit), "VND"));

// 화폐 선택: 기본은 달러. 달러 환율을 못 받으면 달러를 끄고 원화로 돌아갑니다(요약 API를 받기 전에는 그대로 둠).
function syncSimUnit(summaryFailed = false) {
  const f = simForm().elements;
  const usdOpt = [...f.unit.options].find((o) => o.value === "USD");
  const known = Boolean(view.summary) || summaryFailed;
  usdOpt.disabled = known && !usdRate();
  if (usdOpt.disabled && f.unit.value === "USD") f.unit.value = "KRW";
  if (!sim.data) return;
  const usd = view.summary?.usd;
  const vndNote = `1원 ≈ ${(100 / sim.data.base_rate).toFixed(1)} VND (편성 기준 환율 ${sim.data.base_rate.toFixed(2)}원/100 VND)`;
  setText(
    "sim-rate-help",
    f.unit.value === "USD"
      ? (usdRate() ? `1달러 = ${num(usd.krw_per_usd)}원 (${usd.source}${usd.as_of ? ` ${usd.as_of}` : ""}) · ${vndNote}` : "달러 환율을 불러오는 중입니다…")
      : vndNote,
  );
  updateSimPreview();  // 달러 환율을 늦게 받아도 미리보기 금액을 다시 맞춤
}
const estRevenue = (cost, roas) => (roas == null ? null : Math.round((cost * roas) / 100));
// 본전 매출 = 집행 비용 × 손익분기 ROAS(서버 기준선) / 100. 예상 매출이 이보다 많으면 이익, 적으면 손해.
const breakEvenRevenue = (cost) => Math.round((cost * sim.data.roas_bep_percent) / 100);
function verdict(revenue, breakEven) {
  const [key, text] = revenue > breakEven ? ["gain", "이익"] : revenue < breakEven ? ["loss", "손해"] : ["even", "본전"];
  return el("strong", { text, className: `kpi-verdict is-${key}` });
}
const parseRoas = (text) => (text.trim() === "" ? null : Number(text.replace(/[^\d.]/g, "")));

// 손익 미리보기: 폼 값이 바뀔 때마다 본전 매출 · 예상 매출 · 이익/손해를 보여 줍니다(목록에 넣기 전 판단용).
function updateSimPreview() {
  if (!sim.data) return;
  const f = simForm().elements;
  const bep = sim.data.roas_bep_percent;
  const roas = parseRoas(f.roas.value);
  const amount = parseMoney(f.amount.value);
  const text = (s) => document.createTextNode(s);
  if (roas == null || !Number.isFinite(roas)) return $("sim-preview").replaceChildren(text("예상 ROAS 선택 시 손익 표시"));
  // 명사형으로 필요한 정보만: 판정 · (예산이 있으면) 본전 매출 · 예상 매출 · 차액
  if (!amount || (f.unit.value === "USD" && !usdRate())) {
    const gap = roas - bep;
    const gapText = gap ? ` · 손익분기 ${pctShort(bep)} 대비 ${gap > 0 ? "+" : "−"}${pctShort(Math.abs(gap))}p` : ` · 손익분기 ${pctShort(bep)}`;
    return $("sim-preview").replaceChildren(verdict(roas, bep), text(gapText));
  }
  const cost = toKrw(amount, f.unit.value);
  const breakEven = breakEvenRevenue(cost);
  const revenue = estRevenue(cost, roas);
  const diff = revenue - breakEven;
  const result = diff > 0 ? ` · ${krwMan(diff)} 초과` : diff < 0 ? ` · ${krwMan(-diff)} 부족` : "";
  $("sim-preview").replaceChildren(verdict(revenue, breakEven), text(` · 본전 매출 ${krwMan(breakEven)} · 예상 매출 ${krwMan(revenue)}${result}`));
}

function currentMedia() {
  return SIM_MEDIA[sim.type].find((m) => m.value === simForm().elements.media.value) || null;
}

// 집행 유형 전환: 세그먼트 · 유형별 칸 · 매체 목록 · ROAS 기본값
function setSimType(type) {
  sim.type = type;
  sim.roasEdited = false;
  setSegment("sim-type", "type", type);
  root.querySelectorAll(".kpi-sim-kol").forEach((n) => { n.hidden = type !== "kol"; });
  root.querySelectorAll(".kpi-sim-paid").forEach((n) => { n.hidden = type !== "paid"; });
  $("sim-format-name").hidden = true;  // KOL이면 onMediaChange → fillFormats에서 다시 판단
  const option = (value, text = value) => {
    const opt = el("option", { text });
    opt.value = value;
    return opt;
  };
  $("sim-media").replaceChildren(
    ...SIM_MEDIA[type].map((m) => option(m.value)),
    ...(type === "paid" ? [option(CUSTOM, "직접 입력 (새 매체)")] : []),
  );
  onMediaChange();
}

function onMediaChange() {
  $("sim-media-name").hidden = simForm().elements.media.value !== CUSTOM;
  setText("sim-media-help", currentMedia()?.help || "");
  if (sim.type === "kol") fillFormats();
  fillDefaultRoas();
  updateSimPreview();
}

// KOL 콘텐츠 형태: 매체별 기본 형식 + 그 계정의 인플루언서 탭 단가 형식 + 직접 입력
function fillFormats() {
  const f = simForm().elements;
  const prev = f.format.value;
  const fromQuotes = accountQuotes().filter((o) => o.platform === f.media.value && o.content_format).map((o) => o.content_format);
  const formats = [...new Set([...fromQuotes, ...(KOL_FORMATS[f.media.value] || [])])];
  $("sim-format").replaceChildren(
    ...formats.map((v) => Object.assign(el("option", { text: v }), { value: v })),
    Object.assign(el("option", { text: "직접 입력" }), { value: CUSTOM }),
  );
  if ([...f.format.options].some((o) => o.value === prev)) f.format.value = prev;
  onFormatChange();
}

function onFormatChange() {
  $("sim-format-name").hidden = sim.type !== "kol" || simForm().elements.format.value !== CUSTOM;
  syncQuote();
}

// 예상 ROAS 드롭다운 단계(화면 안내용). 매체 실적값은 목록에 자동으로 더합니다.
const ROAS_STEPS = [200, 250, 300, 350, 400, 500];
const pctShort = (v) => `${Number.isInteger(v) ? v : v.toFixed(1)}%`;  // 300.0% → 300%

// 예상 ROAS: % 숫자만 보이는 드롭다운 + 직접 입력. 실제 값은 숨은 roas 칸에 둡니다(손해·이익은 미리보기 줄에서 표시).
// 사용자가 고르거나 고치지 않았으면(roasEdited=false) 매체 실적값을 기본으로 고릅니다.
function fillDefaultRoas() {
  if (!sim.data) return;
  const f = simForm().elements;
  const m = currentMedia();
  const actual = m ? simRoas(m.roasFrom) : null;
  const label = m && sim.data.channels.find((c) => c.channel === m.roasFrom)?.label;
  if (!sim.roasEdited) f.roas.value = actual == null ? "" : String(actual);

  const opt = (value, text) => Object.assign(el("option", { text }), { value });
  const values = [...new Set([...ROAS_STEPS, ...(actual == null ? [] : [actual])])].sort((a, b) => a - b);
  $("sim-roas-pick").replaceChildren(
    ...(actual == null ? [opt("", "선택 안 함")] : []),
    ...values.map((v) => opt(String(v), pctShort(v))),
    opt(CUSTOM, "직접 입력…"),
  );
  // 지금 값이 목록에 있으면 그 항목을, 없으면 '직접 입력'을 고르고 숫자 칸을 보입니다.
  const current = f.roas.value.trim();
  const listed = [...f.roasPick.options].some((o) => o.value === current && o.value !== CUSTOM);
  f.roasPick.value = listed ? current : CUSTOM;
  f.roas.hidden = listed;
  setText("sim-roas-help", actual == null ? "실적 없는 매체" : `${label} 실적 ${pctShort(actual)}`);
}

// 드롭다운 선택: 단계를 고르면 그 값을 쓰고, '직접 입력…'이면 숫자 칸을 열어 줍니다.
function onRoasPick() {
  const f = simForm().elements;
  const custom = f.roasPick.value === CUSTOM;
  f.roas.hidden = !custom;
  if (custom) {
    sim.roasEdited = true;
    f.roas.focus();
    return;
  }
  f.roas.value = f.roasPick.value;
  const m = currentMedia();
  sim.roasEdited = f.roas.value !== String(m ? simRoas(m.roasFrom) ?? "" : "");
}

function renderSimOptions() {
  const d = sim.data;
  const inf = d.influencers;
  const list = d.influencer_list || [];
  // 계정 자동완성: 계정 이름만(보조 글씨 없음, 같은 이름은 한 번). 순서는 인플루언서 탭 리스트 → 단가 목록 → 크리에이터 목록
  const creators = d.creator_list || [];
  const names = [...new Set([...list.map((x) => x.influencer), ...inf.options.map((o) => o.influencer), ...creators.map((c) => c.name)])];
  sim.accountNames = names;  // 계정 칸 검색 추천(accountSuggest)이 이 목록에서 찾습니다.
  syncSimUnit();
  setText(
    "sim-source",
    `KOL 자동완성: ${list.length ? `인플루언서 탭 리스트 ${num(list.length)}명 · ` : ""}${inf.note}`
      + (creators.length ? ` · 크리에이터 목록 ${num(creators.length)}명(실제 자료${creators[0].list_as_of ? ` ${creators[0].list_as_of}` : ""})` : ""),
  );
  setSimType(sim.type);
}

// 계정명이 인플루언서 탭 단가와 일치하면 매체 · 콘텐츠 형태를 맞추고, 예산은 syncQuote가 채웁니다.
function accountQuotes() {
  const name = simForm().elements.account.value.trim();
  return (sim.data?.influencers.options || []).filter((o) => o.influencer === name);
}

// 인플루언서 탭 리스트(get_collaborations)에서 입력한 계정을 찾습니다.
function accountListEntry() {
  const name = simForm().elements.account.value.trim();
  return (sim.data?.influencer_list || []).find((x) => x.influencer === name) || null;
}


// ---------- 계정 칸 검색 추천 ----------
// 비교용 글자: 대소문자 · 베트남어 성조(ễ→e, đ→d) · @ · 띄어쓰기 · . _ - 를 무시합니다.
// map[k] = 비교용 글자 k번째가 원래 이름의 몇 번째 글자인지(맞는 부분을 굵게 표시할 때 사용)
function searchKey(text) {
  let key = "";
  const map = [];
  for (let i = 0; i < text.length; i++) {
    const k = text[i].replace(/[đĐ]/, "d").normalize("NFD").replace(/[̀-ͯ@\s._-]/g, "").toLowerCase();
    for (const ch of k) { key += ch; map.push(i); }
  }
  return { key, map };
}

const SUGGEST_MAX = 8;
// 순위: 이름 앞부분이 맞음(0) → 중간 단어 앞부분이 맞음(1) → 글자가 포함됨(2). 같은 순위는 원래 목록 순서.
function accountSuggestions(query) {
  const q = searchKey(query).key;
  if (!q) return [];
  return sim.accountNames.map((name, order) => {
    const { key, map } = searchKey(name);
    const pos = key.indexOf(q);
    if (pos < 0) return null;
    const wordStart = pos > 0 && /[\s@._-]/.test(name[map[pos] - 1] || "");
    return { name, order, rank: pos === 0 ? 0 : wordStart ? 1 : 2, from: map[pos], to: map[pos + q.length - 1] + 1 };
  }).filter(Boolean).sort((a, b) => a.rank - b.rank || a.order - b.order).slice(0, SUGGEST_MAX);
}

function closeAccountSuggest() {
  $("sim-accounts").hidden = true;
  $("sim-account").setAttribute("aria-expanded", "false");
  $("sim-account").removeAttribute("aria-activedescendant");
  sim.suggestActive = -1;
}

function renderAccountSuggest() {
  const items = accountSuggestions($("sim-account").value);
  sim.suggestActive = -1;
  if (!items.length) return closeAccountSuggest();
  $("sim-accounts").replaceChildren(...items.map((s, i) => {
    const li = el("li", {}, [document.createTextNode(s.name.slice(0, s.from)), el("b", { text: s.name.slice(s.from, s.to) }), document.createTextNode(s.name.slice(s.to))]);
    li.id = `kpi-sim-account-${i}`;
    li.setAttribute("role", "option");
    li.dataset.name = s.name;
    return li;
  }));
  $("sim-accounts").hidden = false;
  $("sim-account").setAttribute("aria-expanded", "true");
}

function moveAccountSuggest(step) {
  const items = [...$("sim-accounts").children];
  if ($("sim-accounts").hidden || !items.length) return;
  sim.suggestActive = (sim.suggestActive + step + items.length) % items.length;
  items.forEach((li, i) => li.classList.toggle("is-active", i === sim.suggestActive));
  $("sim-account").setAttribute("aria-activedescendant", items[sim.suggestActive].id);
}

// 추천에서 고르면 칸에 넣고, 직접 입력할 때와 같은 연동(매체 · 단가 · 손익 미리보기)을 실행합니다.
function chooseAccount(name) {
  const input = $("sim-account");
  input.value = name;
  closeAccountSuggest();
  input.dispatchEvent(new CustomEvent("input", { bubbles: true, detail: { chosen: true } }));
}

// 크리에이터 목록에서 계정 찾기: 같은 이름이 여러 플랫폼에 있으면 지금 고른 매체를 먼저(없으면 팔로워 많은 쪽)
function accountCreator() {
  const name = simForm().elements.account.value.trim();
  const found = (sim.data?.creator_list || []).filter((c) => c.name === name);
  return found.find((c) => c.platform === simForm().elements.media.value) || found[0] || null;
}

// 크리에이터 목록 계정(단가 없음): 집행 매체를 그 플랫폼으로 맞춤(예산은 직접 입력)
function applyCreator() {
  const f = simForm().elements;
  const c = accountCreator();
  if (SIM_MEDIA.kol.some((m) => m.value === c.platform)) f.media.value = c.platform;
  onMediaChange();
}

function applyQuote() {
  const f = simForm().elements;
  const quotes = accountQuotes();
  const entry = accountListEntry();
  if (!quotes.length) {
    // 리스트에는 있지만 단가가 없는 인플루언서: 대표 매체만 맞추고 예산은 직접 입력
    if (entry && SIM_MEDIA.kol.some((m) => m.value === entry.platform)) f.media.value = entry.platform;
    onMediaChange();
    return;
  }
  const q = quotes.find((o) => o.platform === f.media.value) || quotes[0];
  if (SIM_MEDIA.kol.some((m) => m.value === q.platform)) f.media.value = q.platform;
  fillFormats();  // 그 계정의 단가 형식을 목록에 넣고
  if (q.content_format) f.format.value = q.content_format;  // 단가의 형식을 고른 뒤
  onMediaChange();  // ROAS · 형식 직접 입력 칸 · 예산(syncQuote)을 맞춥니다.
}

// 계정 + 매체 + 형식이 인플루언서 탭 단가와 맞으면 집행 예산을 그 단가로 채웁니다(고른 화폐 기준).
function syncQuote() {
  const f = simForm().elements;
  if (sim.type !== "kol") return;
  const q = accountQuotes().find((o) => o.platform === f.media.value && o.content_format === f.format.value);
  if (!q) return;  // 이 매체·형식의 단가가 없으면 예산은 직접 입력
  if (f.unit.value === "USD" && !usdRate()) return;
  f.amount.value = (f.unit.value === "VND" ? q.amount_vnd : fromKrw(toKrw(q.amount_vnd, "VND"), f.unit.value)).toLocaleString("en-US");
}

function renderSim() {
  const d = sim.data;
  if (!d) return;
  const now = d.budget.remaining_krw;
  const total = d.budget.total_krw;
  const sumOf = (list, key) => list.reduce((s, it) => s + (it[key] || 0), 0);
  const byType = Object.fromEntries(Object.keys(SIM_TYPE_LABEL).map((t) => [t, sim.items.filter((it) => it.type === t)]));
  const planned = sumOf(sim.items, "cost_krw");
  const after = now - planned;

  // 표: 구분 | 매체 및 대상 | 세부 내용 | 집행 비용(원/VND) | 예상 ROAS | 예상 매출 | 관리 — 구분별 소계
  const cost = (krw, vndValue) => el("span", {}, [document.createTextNode(krwMan(krw)), el("small", { text: `${num(vndValue)} VND` })]);
  const rows = [];
  const subtotalRows = [];
  Object.entries(byType).forEach(([type, list]) => {
    if (!list.length) return;
    list.forEach((it) => {
      const remove = el("button", { text: "삭제", className: "btn kpi-sim-remove" });
      remove.type = "button";
      remove.dataset.kpiAction = "sim-remove";
      remove.dataset.id = String(it.id);
      rows.push([
        SIM_TYPE_LABEL[type],
        it.target ? `${it.media} · ${it.target}` : it.media,
        it.detail || "—",
        cost(it.cost_krw, it.cost_vnd),
        it.roas == null ? "—" : el("span", {}, [document.createTextNode(pct(it.roas)), verdict(it.revenue_krw, breakEvenRevenue(it.cost_krw))]),
        it.revenue_krw == null ? "—" : krwMan(it.revenue_krw),
        remove,
      ]);
    });
    subtotalRows.push(rows.length);
    const listRevenue = list.some((it) => it.revenue_krw != null) ? krwMan(sumOf(list, "revenue_krw")) : "—";  // ROAS 없는 항목만이면 0 대신 —
    rows.push([`${SIM_TYPE_LABEL[type]} 소계`, `${list.length}건`, "", cost(sumOf(list, "cost_krw"), sumOf(list, "cost_vnd")), "", listRevenue, ""]);
  });
  if (!rows.length) rows.push(["아직 추가한 항목이 없습니다", "", "", "", "", "", ""]);
  fillRows("sim-rows", rows);
  const trs = $("sim-rows").children;
  subtotalRows.forEach((i) => trs[i].classList.add("kpi-sim-subtotal"));

  // 결과 카드: 금액 + 총 예산 대비 %(작게). '집행 후 남는 예산' 카드는 강조, 초과 시 경고 색
  const ofTotal = (krw) => `총 예산의 ${pct((krw / total) * 100)}`;
  const kolKrw = sumOf(byType.kol, "cost_krw");
  const paidKrw = sumOf(byType.paid, "cost_krw");
  setText("sim-now", krwMan(now));
  setText("sim-now-sub", ofTotal(now));
  setText("sim-planned-kol", krwMan(kolKrw));
  setText("sim-planned-kol-sub", `${byType.kol.length}건 · ${ofTotal(kolKrw)}`);
  setText("sim-planned-paid", krwMan(paidKrw));
  setText("sim-planned-paid-sub", `${byType.paid.length}건 · ${ofTotal(paidKrw)}`);
  $("sim-after").textContent = after >= 0 ? krwMan(after) : `−${krwMan(-after)}`;
  setText("sim-after-sub", after >= 0 ? ofTotal(after) : `총 예산 대비 ${pct((-after / total) * 100)} 초과`);
  $("sim-after-card").classList.toggle("is-over", after < 0);

  // 예상 매출 카드: 예상 ROAS가 있는 항목만 합산하고, 그 항목들의 본전 매출과 비교
  const priced = sim.items.filter((it) => it.revenue_krw != null);
  const revenue = sumOf(priced, "revenue_krw");
  const breakEven = priced.reduce((s, it) => s + breakEvenRevenue(it.cost_krw), 0);
  const unpriced = sim.items.length - priced.length;
  setText("sim-revenue", priced.length ? krwMan(revenue) : "—");
  $("sim-revenue-sub").replaceChildren(
    ...(priced.length
      ? [document.createTextNode(`본전 ${krwMan(breakEven)} · `), verdict(revenue, breakEven), document.createTextNode(unpriced ? ` (ROAS 없는 ${unpriced}건 제외)` : "")]
      : [document.createTextNode(sim.items.length ? "예상 ROAS가 있는 항목이 없습니다" : "")]),
  );
  const outlook = priced.length
    ? [document.createTextNode(` 예상 매출 ${krwMan(revenue)} / 본전 매출 ${krwMan(breakEven)} → `), verdict(revenue, breakEven), document.createTextNode(" 예상 (예상 ROAS 기준 추정)")]
    : [];
  const box = $("sim-summary");
  if (sim.items.length && after < 0) {
    box.replaceChildren(warning(`예산 초과 ${krwMan(-after)} — 항목을 줄이거나 예산 조정이 필요합니다.`), ...outlook);
  } else if (!sim.items.length) {
    box.replaceChildren(document.createTextNode("항목을 추가하면 집행 후 남는 예산과 예상 매출을 바로 계산합니다."));
  } else {
    box.replaceChildren(document.createTextNode(`집행 후 총 예산의 ${pct((after / total) * 100)}가 남습니다.`), ...outlook);
  }
  box.hidden = false;
}

function addSimItem(form) {
  const f = form.elements;
  showError("sim-error", "");
  const custom = f.media.value === CUSTOM;
  const media = custom ? f.mediaName.value.trim() : f.media.value;
  if (!media) return showError("sim-error", "매체 이름을 입력해 주세요.");
  const target = sim.type === "kol" ? f.account.value.trim() : "";
  if (sim.type === "kol" && !target) return showError("sim-error", "계정/인물명을 입력해 주세요.");
  const amount = parseMoney(f.amount.value);
  if (!amount) return showError("sim-error", "집행 예산을 0보다 큰 숫자로 입력해 주세요.");
  if (f.unit.value === "USD" && !usdRate()) return showError("sim-error", "달러 환율을 아직 불러오지 못했습니다. 잠시 후 다시 누르거나 원화로 입력해 주세요.");
  const roasText = f.roas.value.trim();
  const roas = parseRoas(roasText);
  if (roasText !== "" && !Number.isFinite(roas)) return showError("sim-error", "예상 ROAS는 숫자(%)로 입력해 주세요.");

  const costKrw = toKrw(amount, f.unit.value);
  sim.items.push({
    id: sim.nextId++,
    type: sim.type,
    media,
    target,
    detail: sim.type === "kol" ? (f.format.value === CUSTOM ? f.formatName.value.trim() : f.format.value) : f.objective.value,
    cost_krw: costKrw,
    cost_vnd: toVnd(amount, f.unit.value),
    roas,
    revenue_krw: estRevenue(costKrw, roas),
  });
  // 다음 입력을 위해 대상·금액을 비우고 ROAS는 기본값으로 되돌립니다(유형·매체는 유지).
  f.account.value = "";
  closeAccountSuggest();
  f.formatName.value = "";
  f.amount.value = "";
  if (custom) f.mediaName.value = "";
  sim.roasEdited = false;
  onMediaChange();  // 계정을 비웠으니 형식 목록 · ROAS 기본값을 다시 맞춥니다.
  renderSim();
}

async function loadSimulator() {
  try {
    sim.data = await getJson(API.simulator);
    renderSimOptions();
    renderSim();
  } catch (err) {
    showError("sim-error", `시뮬레이션 데이터를 불러오지 못했습니다: ${err.message}`);
  }
}

// ---------- 계산식 설명(ⓘ) ----------
// 설명창을 블록 안이 아니라 화면 맨 위 층에 하나만 띄웁니다. 블록 안 스크롤 영역·뒤 내용에 가려 글씨가 겹치지 않게.
const tip = el("div", { className: "kpi-tip" });
tip.setAttribute("role", "tooltip");
tip.hidden = true;
root.append(tip);

function showTip(btn) {
  tip.textContent = btn.dataset.tip;
  tip.hidden = false;
  // 화면 좌표(배율 적용)를 CSS 좌표로 바꿔 계산합니다. 공통 화면 배율(--ui-zoom)이 없으면 z = 1.
  const z = root.getBoundingClientRect().width / root.offsetWidth || 1;
  const b = btn.getBoundingClientRect();
  const r = { left: b.left / z, top: b.top / z, bottom: b.bottom / z };
  const vw = window.innerWidth / z;
  const vh = window.innerHeight / z;
  const left = Math.min(Math.max(8, r.left - 8), vw - tip.offsetWidth - 8);
  const below = r.bottom + 6;
  const top = below + tip.offsetHeight > vh - 8 ? Math.max(8, r.top - tip.offsetHeight - 6) : below;
  tip.style.left = `${left}px`;
  tip.style.top = `${top}px`;
}

const hideTip = () => { tip.hidden = true; };
root.addEventListener("mouseover", (event) => {
  const btn = event.target.closest?.(".kpi-info");
  if (btn) showTip(btn);
});
root.addEventListener("mouseout", (event) => {
  if (event.target.closest?.(".kpi-info") && !event.relatedTarget?.closest?.(".kpi-info")) hideTip();
});
root.addEventListener("focusin", (event) => {
  if (event.target.matches(".kpi-info")) showTip(event.target);
});
root.addEventListener("focusout", (event) => {
  if (event.target.matches(".kpi-info")) hideTip();
});
window.addEventListener("scroll", hideTip, { capture: true, passive: true });

// ---------- 내보내기 (PDF 보고서 · 엑셀) ----------
// [내보내기] 메뉴: PDF 보고서(새 창 미리보기 → [PDF로 저장]) · 엑셀(.xlsx, 새 라이브러리 없이 kpi_xlsx.js로 생성)
const REPORT_TITLE = "마케팅 성과 보고서";
const DATA_NOTE = "데이터 상태: GA4는 Google Merchandise Store 공개 데이터(한정선 데이터 아님), AI 요약은 사람 검수 전 결과입니다. '추정'은 계산·가정으로 나온 값입니다.";

const pad2 = (n) => String(n).padStart(2, "0");
const stamp = (d = new Date()) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
const round1 = (n) => (n == null ? null : Math.round(n * 10) / 10);

function showNotice(message) {
  const note = root.querySelector(".kpi-legend-note");
  note.textContent = message;
  note.hidden = !message;
}

function setExportMenu(open) {
  root.querySelector(".kpi-export-menu").hidden = !open;
  root.querySelector('[data-kpi-action="export-menu"]').setAttribute("aria-expanded", String(open));
}

// 보고서 1쪽 '핵심 요약': 화면에 있는 숫자로만 만든 문장(새로 지어내는 내용 없음)
function reportHighlights() {
  const d = view.summary;
  const lines = [];
  if (d) {
    const b = d.budget;
    lines.push(`예산 ${krwMan(b.total_krw)} 중 ${pct(b.burn_rate_percent)} 소진(인플루언서 예상 포함, 추정) · 남은 가용 예산 ${krwMan(b.remaining_krw)}(${pct(b.remaining_percent)})`);
    const bep = d.roas_bep_percent;
    const top = [...d.channels].sort((x, y) => y.roas_percent - x.roas_percent)[0];
    const below = d.channels.filter((c) => c.roas_percent < bep);
    lines.push(`종합 ROAS ${pct(d.totals.roas_percent)} · 최고 ${top.label} ${pct(top.roas_percent)} · ${below.length
      ? `손익분기 ${bep}% 미달: ${below.map((c) => `${c.label} ${pct(c.roas_percent)}`).join(", ")} → 예산 조정 검토`
      : `모든 채널이 손익분기 ${bep}% 초과`}`);
  }
  if (sim.items.length && sim.data) {
    const after = sim.data.budget.remaining_krw - sim.items.reduce((s, it) => s + it.cost_krw, 0);
    lines.push(`집행 시뮬레이션 ${sim.items.length}건 반영 시 남는 예산 ${after >= 0 ? krwMan(after) : `−${krwMan(-after)}(초과)`} (추정)`);
  }
  if (view.reviews.length) {
    const neg = Math.round((view.reviews.filter((r) => r.sentiment === "Negative").length / view.reviews.length) * 100);
    lines.push(`고객 의견 ${num(view.reviews.length)}건(팜플렛 QR 창구 문의 + 설문) · 만족 ${positivePct(view.reviews)}% · 불만 ${neg}%`);
    // 유의할 점은 [AI로 분석] 결과가 있을 때만(누르기 전에는 넣지 않음)
    const cautions = view.channels.map((ch) => {
      const s = channelSummary(ch);
      const c = s && (s.caution || (s.improve || [])[0]);
      return c ? `${PLATFORM_LABEL[ch] || ch} — ${c}` : "";
    }).filter(Boolean);
    if (cautions.length) lines.push(`유의할 점(AI 요약, 검수 전): ${cautions.join(" / ")}`);
  }
  const g = d?.ga4;
  if (g && !$("ga4-panel").hidden) {
    const low = [...(g.channels || [])].filter((c) => c.engagement_rate_percent != null).sort((x, y) => x.engagement_rate_percent - y.engagement_rate_percent)[0];
    lines.push(`GA4 유효 참여율 ${pct(g.engagement_rate_percent)}${low ? ` · 참여율이 가장 낮은 유입 채널 ${low.channel} ${pct(low.engagement_rate_percent)}` : ""} (${g.status === "public_demo" ? "Google Merchandise Store 공개 데이터, 한정선 아님" : "기본값"})`);
  }
  return lines;
}

// 화면의 차트와 같은 설정으로, 보고서용 크기의 새 캔버스에 애니메이션 없이 한 번 그려 그림으로 만듭니다.
// (숨겨진 상태에서 만든 차트는 다시 그려도 비어 있을 수 있어 화면 차트를 직접 찍지 않습니다.
//  새 창이 열리면 이 탭의 화면 갱신 콜백이 멈추므로 기다리지 않고 한 번에 처리합니다.)
function chartImage(chart, width, height) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  canvas.style.cssText = `position:fixed;left:-10000px;top:0;width:${width}px;height:${height}px`;
  document.body.append(canvas);
  const copy = new window.Chart(canvas, {
    type: chart.config.type,
    data: chart.config.data,
    options: { ...chart.config.options, responsive: false, animation: false, devicePixelRatio: 2, onClick: undefined, onHover: undefined },
    plugins: chart.config.plugins,
  });
  const src = copy.toBase64Image();
  copy.destroy();
  canvas.remove();
  return src;
}

// ---------- PDF 보고서: 덩어리로 나눈 뒤 A4 쪽을 직접 채웁니다 ----------
// 블록마다 새 쪽을 쓰지 않고 차곡차곡 채우되, 차트+범례 · 카드 묶음 · 표 같은 덩어리는 중간에서 자르지 않습니다.
// 한 쪽보다 긴 표는 줄 단위로 나누고 다음 쪽에 머리줄을 다시 붙입니다. 미리보기의 종이 한 장 = PDF 한 쪽.
const PAGE_MM = { width: 210, height: 297, margin: 13, head: 7, foot: 7 };
const MM = 96 / 25.4;  // 1mm = px
// 펼쳐서(안쪽 내용을 덩어리로) 볼 묶음 요소
const REPORT_CONTAINERS = ".kpi-panel-body, .kpi-detail, .kpi-sim, [data-kpi='ga4-panel'], [data-kpi='creator-panel'], [data-kpi='ga4-channel-section'], [data-kpi='ga4-events-section']";

// 블록(패널) 하나를 덩어리 목록으로: [{ nodes: [요소...], table: 표 덩어리면 true }]
function reportBlocks(panel, index) {
  const images = {};
  panel.querySelectorAll("canvas[data-kpi-chart]").forEach((canvas) => {
    const chart = charts[canvas.dataset.kpiChart];
    const box = canvas.closest(".kpi-chart") || canvas.parentElement;
    if (!chart || !box.offsetParent) return;  // 지금 보이지 않는 차트(꺼 둔 GA4 등)는 넣지 않음
    const type = chart.config.type;
    const horizontal = chart.config.options?.indexAxis === "y";
    images[canvas.dataset.kpiChart] = type === "doughnut" ? chartImage(chart, 360, 220) : chartImage(chart, 960, horizontal ? 180 : 215);
  });
  const clone = panel.cloneNode(true);
  clone.querySelectorAll(".kpi-tools, .kpi-info, [hidden], [data-report-skip]").forEach((n) => n.remove());
  const title = (clone.querySelector(".panelhead h2")?.textContent || "").replace(/\s+/g, " ").trim();
  clone.querySelector(".panelhead")?.remove();
  if (!sim.items.length) clone.querySelector('[data-kpi="sim"]')?.remove();
  // 인쇄 시 단추는 빠지므로, 내용이 있는 단추(창구별 만족도 막대 등)는 일반 상자로 바꿉니다.
  clone.querySelectorAll("button").forEach((btn) => {
    if (!btn.textContent.trim() || btn.closest("td")) return btn.remove();
    const box = document.createElement("div");
    box.className = btn.className;
    box.append(...btn.childNodes);
    btn.replaceWith(box);
  });
  clone.querySelectorAll("canvas[data-kpi-chart]").forEach((canvas) => {
    const src = images[canvas.dataset.kpiChart];
    const box = canvas.closest(".kpi-chart") || canvas;
    if (!src) return box.remove();
    const img = document.createElement("img");
    img.src = src;
    img.alt = canvas.getAttribute("aria-label") || "";
    img.className = `kpi-report-chart${charts[canvas.dataset.kpiChart]?.config.type === "doughnut" ? " is-doughnut" : ""}`;
    box.replaceWith(img);
  });

  const heading = document.createElement("h2");
  heading.className = "kpi-rpt-h2";
  heading.innerHTML = "<span></span>";
  heading.firstChild.textContent = pad2(index + 1);
  heading.append(document.createTextNode(title));

  const flat = [];
  const walk = (node) => [...node.children].forEach((child) => {
    if (child.matches(REPORT_CONTAINERS)) return walk(child);
    if (!child.textContent.trim() && !child.querySelector("img") && child.tagName !== "IMG") return;
    flat.push(child);
  });
  walk(clone);
  // 소제목은 다음 덩어리와 붙이고(쪽 끝에 소제목만 남지 않게), 블록 제목은 첫 덩어리와 붙입니다.
  const blocks = [];
  let carry = [heading];
  flat.forEach((el) => {
    if (el.matches(".kpi-detail-title")) {
      carry.push(el);
      return;
    }
    blocks.push({ nodes: [...carry, el], table: Boolean(el.querySelector("table") || el.tagName === "TABLE") });
    carry = [];
  });
  if (carry.length > 1) blocks.push({ nodes: carry, table: false });
  return blocks;
}

function reportCoverBlocks(highlights) {
  const add = (tag, className, text) => {
    const n = document.createElement(tag);
    if (className) n.className = className;
    if (text != null) n.textContent = text;
    return n;
  };
  const head = add("div", "kpi-rpt-cover");
  const meta = add("dl", "kpi-cover-meta");
  [["기준월", view.summary?.campaign_month || "—"], ["작성", stamp()], ["범위", "베트남 · 전체 채널"], ["작성 부서", "마케팅"]].forEach(([k, v]) => {
    const row = add("div");
    row.append(add("dt", "", k), add("dd", "", v));
    meta.append(row);
  });
  head.append(add("p", "kpi-cover-brand", "HANJEONGSEON · VIETNAM MARKETING"), add("h1", "", REPORT_TITLE), meta);
  const list = add("ol", "kpi-highlights");
  highlights.forEach((line) => list.append(add("li", "", line)));
  const summary = add("div");
  summary.append(add("h2", "kpi-report-h", "핵심 요약"), list);
  const cards = root.querySelector(".kpi-scorecards").cloneNode(true);
  cards.querySelectorAll(".kpi-info, [hidden]").forEach((n) => n.remove());
  const kpi = add("div");
  kpi.append(add("h2", "kpi-report-h", "주요 지표"), cards, add("p", "kpi-report-note", DATA_NOTE));
  return [{ nodes: [head] }, { nodes: [summary] }, { nodes: [kpi] }];
}

// 보고서 창에서: 덩어리 높이를 재며 A4 쪽에 채웁니다.
function paginateReport(doc, blocks) {
  // 쪽 안쪽 높이 = 297 - 여백 - 머리줄 - 바닥줄 - 위 간격 3mm - 인쇄 오차 0.5mm
  const contentH = (PAGE_MM.height - PAGE_MM.margin * 2 - PAGE_MM.head - PAGE_MM.foot - 3.5) * MM - 2;
  const measure = doc.createElement("div");
  measure.className = "kpi-page kpi-report kpi-rpt-measure";
  const measureBody = doc.createElement("div");
  measureBody.className = "kpi-rpt-content";
  measure.append(measureBody);
  doc.body.append(measure);
  const pages = [];
  let content = null;
  let left = 0;
  const newPage = () => {
    const page = doc.createElement("section");
    page.className = "kpi-rpt-page";
    const head = doc.createElement("header");
    head.className = "kpi-rpt-pagehead";
    head.innerHTML = "<span></span><span></span>";
    head.children[0].textContent = `한정선 베트남 · ${REPORT_TITLE}`;
    head.children[1].textContent = `기준월 ${view.summary?.campaign_month || "—"}`;
    content = doc.createElement("div");
    content.className = "kpi-rpt-content";
    const foot = doc.createElement("footer");
    foot.className = "kpi-rpt-pagefoot";
    foot.innerHTML = "<span></span><span class=\"kpi-rpt-no\"></span>";
    foot.children[0].textContent = `작성 ${stamp()}`;
    page.append(head, content, foot);
    pages.push(page);
    left = contentH;
  };
  const wrap = (nodes) => {
    const w = doc.createElement("div");
    w.className = "kpi-rpt-blk";
    w.append(...nodes.map((n) => (n.ownerDocument === doc ? n : doc.importNode(n, true))));
    return w;
  };
  const height = (w) => {
    measureBody.append(w);
    const h = w.getBoundingClientRect().height;
    w.remove();
    return h;
  };
  const place = (w, h) => {
    content.append(w);
    left -= h;
  };

  newPage();
  blocks.forEach((block) => {
    const w = wrap(block.nodes);
    const h = height(w);
    if (h <= left) return place(w, h);
    if (block.table) {
      // 표 나누기: 머리줄은 매 조각에 다시 붙이고, 줄은 들어가는 만큼 담습니다.
      const tableOf = (el) => el.querySelector("tbody")?.closest("table");
      const rows = [...tableOf(w).querySelector("tbody").rows];
      let first = true;
      while (rows.length) {
        // 이어지는 조각: 블록 제목은 빼고, 소제목에 '(계속)'을 붙여 어떤 표인지 보이게
        const piece = first ? w.cloneNode(true) : wrap(block.nodes.filter((n) => !n.matches?.(".kpi-rpt-h2")));
        if (!first) piece.querySelectorAll(".kpi-detail-title").forEach((n) => n.append(doc.createTextNode(" (계속)")));
        const body = tableOf(piece).querySelector("tbody");
        body.replaceChildren();
        const shell = height(piece);
        if (shell + 30 > left) newPage();  // 머리줄 + 한 줄도 안 들어가면 다음 쪽에서
        let used = shell;
        while (rows.length) {
          body.append(rows[0]);
          const hh = height(piece);
          if (hh > left && body.rows.length > 1) {
            body.lastElementChild.remove();
            break;
          }
          rows.shift();
          used = hh;
          if (hh > left) break;
        }
        place(piece, used);
        if (rows.length) newPage();
        first = false;
      }
      return undefined;
    }
    if (h > contentH) {
      // 한 쪽보다 큰 덩어리(드묾): 새 쪽에 줄여서 넣습니다.
      if (left < contentH) newPage();
      w.style.zoom = String(Math.max(contentH / h, 0.6));
      return place(w, contentH);
    }
    newPage();
    return place(w, h);
  });
  measure.remove();
  pages.forEach((p, i) => { p.querySelector(".kpi-rpt-no").textContent = `${i + 1} / ${pages.length}`; });
  return pages;
}

function exportPdf() {
  // 팝업 차단을 피하려고 클릭 직후 창부터 엽니다.
  const win = window.open("", "_blank");
  if (!win) return showNotice("새 창이 막혀 PDF 보고서를 열지 못했습니다. 브라우저의 팝업 차단을 풀고 다시 눌러 주세요.");
  showNotice("");
  win.document.title = REPORT_TITLE;
  win.document.body.textContent = "보고서를 만드는 중입니다…";

  // 블록을 하나씩 확대 상태로 펼쳐 덩어리로 복제합니다(새 창이 열리면 이 탭은 멈출 수 있어 기다리지 않고 한 번에).
  const opened = root.querySelector(".kpi-panel.is-expanded");
  const blocks = reportCoverBlocks(reportHighlights());
  try {
    boardPanels().forEach((panel, i) => {
      setExpanded(panel, { animate: false });
      blocks.push(...reportBlocks(panel, i));
    });
  } finally {
    setExpanded(opened, { animate: false });
  }

  const doc = win.document;
  doc.open();
  doc.close();
  doc.documentElement.lang = "ko";
  doc.title = `${REPORT_TITLE} ${view.summary?.campaign_month || ""}`.trim();
  const meta = doc.createElement("meta");
  meta.setAttribute("charset", "utf-8");
  doc.head.append(meta);
  // 화면과 같은 디자인 변수·글꼴(base.css · fonts.css) + KPI 스타일 + 보고서 전용 스타일
  const hrefs = [...document.querySelectorAll('link[rel="stylesheet"]')].map((l) => l.href);
  const kpiCss = hrefs.find((h) => h.includes("kpi_main.css"));
  if (kpiCss) hrefs.push(kpiCss.replace("kpi_main.css", "kpi_report.css"));
  const loaded = hrefs.map((href) => new Promise((resolve) => {
    const link = doc.createElement("link");
    link.rel = "stylesheet";
    link.href = href;
    link.onload = link.onerror = resolve;
    doc.head.append(link);
  }));

  // 미리보기 도구 줄(인쇄에는 나오지 않음): [PDF로 저장] · [닫기]
  const bar = doc.createElement("div");
  bar.className = "kpi-report-toolbar";
  const label = doc.createElement("strong");
  label.textContent = "보고서 미리보기";
  const hint = doc.createElement("span");
  hint.textContent = "보이는 종이 한 장이 PDF 한 쪽입니다 · [PDF로 저장] → 대상 'PDF로 저장' · 옵션 '배경 그래픽' 켜기";
  const save = doc.createElement("button");
  save.type = "button";
  save.className = "is-primary";
  save.textContent = "PDF로 저장";
  save.addEventListener("click", () => win.print());
  const close = doc.createElement("button");
  close.type = "button";
  close.textContent = "닫기";
  close.addEventListener("click", () => win.close());
  bar.append(label, hint, save, close);
  const main = doc.createElement("main");
  main.className = "kpi-page kpi-report";
  doc.body.append(bar, main);

  // 스타일 · 글꼴 · 차트 그림이 준비된 뒤에 높이를 재서 쪽을 나눕니다.
  Promise.all(loaded)
    .then(() => doc.fonts?.ready)
    .then(() => Promise.all(blocks.flatMap((b) => b.nodes).flatMap((n) => [...(n.tagName === "IMG" ? [n] : n.querySelectorAll("img"))])
      .map((img) => (img.decode ? img.decode().catch(() => null) : null))))
    .then(() => {
      main.append(...paginateReport(doc, blocks));
      win.focus();
    });
}

// 엑셀: 시트 4개(요약 보고 · 예산·ROAS 상세 · VOC 상세 · GA4 상세), 구역 제목 · 서식 · 엑셀 기본 차트(데이터 연결형)
// 숫자는 숫자 칸으로 넣고, 차트는 시트의 표 칸을 가리켜 숫자를 고치면 차트도 바뀝니다.
function xlsxKit() {
  const c = (name, fallback) => cssVar(name) || fallback;
  const C = {
    ink: c("--ink", "#2b2a28"), muted: c("--muted", "#8a857c"), paper: c("--paper", "#f1ece3"), teal: c("--teal", "#4e6e6a"),
    pink: c("--kpi-pink", "#e89bb1"), navy: c("--kpi-navy", "#3b5b8c"), beige: c("--beige", "#eadfc8"), orange: c("--orange", "#dfb193"),
    brown: c("--brown", "#8b7355"), celadon: c("--celadon", "#c9d8cf"),
  };
  const FMT = { int: "#,##0", krw: '#,##0"원"', vnd: "#,##0", pct: '0.0"%"', usd: '"$"#,##0.00', dec2: "#,##0.00", sec: '0"초"', rate: '0.00"원"' };
  const cellStyle = (kind, total = false) => ({
    border: total ? "top" : "hair",
    ...(total ? { bold: true } : {}),
    ...(FMT[kind] ? { fmt: FMT[kind] } : {}),
    ...(kind === "wrap" ? { wrap: true, valign: "top" } : {}),
    ...(kind === "center" ? { align: "center" } : {}),
  });
  const S = {
    title: { bold: true, size: 18, color: C.ink },
    sub: { size: 9, color: C.muted },
    note: { size: 9, color: C.muted, wrap: true, valign: "top" },
    section: { bold: true, size: 11, color: "#ffffff", fill: C.teal },
    th: { bold: true, size: 9, color: C.ink, fill: C.paper, border: "bottom", align: "center", wrap: true },
    kpiLabel: { size: 9, color: C.muted, fill: C.paper, border: "box" },
    kpiValue: { bold: true, size: 16, color: C.ink, border: "box", align: "left" },
    kpiSub: { size: 8, color: C.muted, border: "box", wrap: true, valign: "top" },
    hl: { size: 10, wrap: true, valign: "center", border: "hair" },
    hlNo: { bold: true, size: 10, color: C.muted, border: "hair", align: "center" },
  };
  // 구역 제목: c1~c2를 색 띠로 칠하고 병합
  const section = (sh, r, c1, c2, text) => {
    for (let x = c1; x <= c2; x++) sh.put(r, x, x === c1 ? text : "", S.section);
    sh.merge(r, c1, r, c2).height(r, 22);
  };
  // 표: 머리줄 + 줄 + (합계 줄). kinds는 열마다 text · wrap · int · krw · vnd · pct · usd · dec2 · sec · center
  const table = (sh, r, c, headers, rows, kinds, { total = null, height = null } = {}) => {
    headers.forEach((h, i) => sh.put(r, c + i, h, S.th));
    sh.height(r, 30);
    rows.forEach((row, k) => {
      row.forEach((v, i) => sh.put(r + 1 + k, c + i, v ?? null, cellStyle(kinds[i] || "text")));
      if (height) sh.height(r + 1 + k, height);
    });
    let last = r + rows.length;
    if (total) {
      last += 1;
      total.forEach((v, i) => sh.put(last, c + i, v ?? null, cellStyle(kinds[i] || "text", true)));
    }
    return { head: r, first: r + 1, rows: rows.length, last };
  };
  return { C, S, FMT, section, table };
}

function exportXlsx() {
  const d = view.summary;
  if (!d) return showNotice("마케팅 성과 데이터를 아직 불러오지 못해 엑셀을 만들 수 없습니다. [새로고침] 후 다시 눌러 주세요.");
  showNotice("");
  const { C, S, FMT, section, table } = xlsxKit();
  const { budget: b, totals: t, fx } = d;
  const rate = fx.base_rate;
  const krwBase = (v) => Math.round((v * rate) / 100);
  const share = (v) => round1((v / b.total_krw) * 100);
  const bep = d.roas_bep_percent;
  const g = d.ga4;
  const hasGa4 = Boolean(g?.channels?.length);
  const made = stamp();
  const sheets = [];

  // ---------- ① 요약 보고 (한 장 대시보드) ----------
  const sum = new Sheet("요약 보고");
  sum.gridLines = false;
  sum.widths = [2, 18, 14, 14, 14, 14, 14, 14, 18];
  let r = 0;
  sum.put(r, 1, `한정선 베트남 ${REPORT_TITLE}`, S.title).merge(r, 1, r, 8).height(r, 30);
  r += 1;
  sum.put(r, 1, `기준월 ${d.campaign_month} · 작성 ${made} · 범위 베트남 전체 채널`, S.sub).merge(r, 1, r, 8);
  r += 1;
  sum.put(r, 1, DATA_NOTE, S.note).merge(r, 1, r, 8).height(r, 28);
  r += 2;
  section(sum, r, 1, 8, "주요 지표");
  r += 1;
  const kpis = [
    ["총 집행 광고비", t.ad_spend_krw_base, '#,##0"원"', `${num(t.ad_spend_vnd)} VND · 기준 환율 ${rate}원/100 VND`],
    ["종합 ROAS", t.roas_percent, '0.0"%"', `손익분기 ${bep}% ${t.roas_percent >= bep ? "초과" : "미달"} · 전환 ${num(t.conversions)}건`],
    ["누적 매출액", fx.ok ? fx.revenue_krw_live : t.revenue_krw_base, '#,##0"원"', `${num(t.revenue_vnd)} VND · ${fx.ok ? "현재 환율" : "기준 환율"} 환산`],
    ["환율 · 100 VND당", fx.ok ? fx.live_rate : null, '0.00"원"', fx.ok ? `환차${fx.gain_loss_krw >= 0 ? "익" : "손"} ${signedKrw(fx.gain_loss_krw)} · ${fx.source} ${fx.as_of || ""}` : "불러오지 못함"],
  ];
  kpis.forEach(([label, value, fmt, subText], i) => {
    const col = 1 + i * 2;
    sum.put(r, col, label, S.kpiLabel).put(r, col + 1, "", S.kpiLabel).merge(r, col, r, col + 1);
    sum.put(r + 1, col, value, { ...S.kpiValue, fmt }).put(r + 1, col + 1, "", S.kpiValue).merge(r + 1, col, r + 1, col + 1);
    sum.put(r + 2, col, subText, S.kpiSub).put(r + 2, col + 1, "", S.kpiSub).merge(r + 2, col, r + 2, col + 1);
  });
  sum.height(r, 18).height(r + 1, 30).height(r + 2, 30);
  r += 4;
  section(sum, r, 1, 8, "핵심 요약");
  r += 1;
  reportHighlights().forEach((line, i) => {
    sum.put(r, 1, pad2(i + 1), S.hlNo);
    for (let x = 2; x <= 8; x++) sum.put(r, x, x === 2 ? line : "", S.hl);
    sum.merge(r, 2, r, 8).height(r, line.length > 70 ? 32 : 20);
    r += 1;
  });

  // 예산 구성: 표(왼쪽) + 도넛(오른쪽)
  r += 1;
  section(sum, r, 1, 8, `예산 구성 · 소진율 ${pct(b.burn_rate_percent)}`);
  r += 1;
  const budgetRows = [
    ["플랫폼 광고비", b.platform_krw, share(b.platform_krw)],
    ["인플루언서 집행", b.influencer_paid_krw, share(b.influencer_paid_krw)],
    ["인플루언서 예상 (추정)", b.influencer_expected_krw, share(b.influencer_expected_krw)],
    ["잔여 가용 예산 (추정)", b.remaining_krw, b.remaining_percent],
  ];
  const bt = table(sum, r, 1, ["구분", "금액", "비중"], budgetRows, ["text", "krw", "pct"], { total: ["총 배정 예산", b.total_krw, 100] });
  sum.chart({
    type: "doughnut", title: "예산 구성", anchor: [r, 5, r + 11, 9], legendPos: "r",
    cats: [bt.first, 1, bt.first + 3], series: [{ name: "금액", vals: [bt.first, 2, bt.first + 3], colors: [C.teal, C.pink, C.navy, C.beige] }],
  });
  r = Math.max(bt.last, r + 11) + 1;

  // 채널별 ROAS: 표 + 막대(손익분기 미달은 주황) + 손익분기 기준선
  section(sum, r, 1, 8, `채널별 ROAS · 손익분기 ${bep}%`);
  r += 1;
  const roasT = table(sum, r, 1, ["채널", "광고비", "매출", "ROAS", "손익분기", "상태"],
    d.channels.map((ch) => [ch.label, krwBase(ch.ad_spend_vnd), krwBase(ch.sales_revenue_vnd), ch.roas_percent, bep, ch.roas_percent >= bep ? "기준 초과" : "기준 미달"]),
    ["text", "krw", "krw", "pct", "pct", "center"]);
  r = roasT.last + 1;
  sum.chart({
    type: "bar", title: "채널별 ROAS(%)", anchor: [r, 1, r + 13, 9], axisFmt: '0"%"',
    cats: [roasT.first, 1, roasT.last],
    series: [
      { name: "ROAS(%)", vals: [roasT.first, 4, roasT.last], color: C.teal, fmt: '0.0"%"', pointColors: d.channels.map((ch) => (ch.roas_percent >= bep ? null : C.orange)) },
      { name: `손익분기 ${bep}%`, vals: [roasT.first, 5, roasT.last], color: C.ink, line: true },
    ],
  });
  r += 14;

  // 고객 의견(VOC): 창구별 만족도 표 + 누적 막대
  if (view.reviews.length) {
    const aiDone = Boolean(view.vocAiChannels?.length);
    section(sum, r, 1, 8, `고객 의견(VOC) · 창구별 만족도${aiDone ? " · 유의할 점 AI 요약(검수 전)" : ""}`);
    r += 1;
    const vocRows = view.channels.map((ch) => {
      const list = channelList(ch);
      const cnt = countBy(list, "sentiment");
      const s = channelSummary(ch);
      return [PLATFORM_LABEL[ch] || ch, list.length, cnt.Positive || 0, cnt.Neutral || 0, cnt.Negative || 0,
        round1(((cnt.Positive || 0) / (list.length || 1)) * 100), s ? s.caution || (s.improve || [])[0] || "" : "AI 분석 전"];
    });
    const vt = table(sum, r, 1, ["창구", "건수", "만족", "보통", "불만", "만족 비율", "유의할 점"], vocRows,
      ["text", "int", "int", "int", "int", "pct", "wrap"], { height: 30 });
    vocRows.forEach((_, k) => sum.put(vt.first + k, 8, "", { border: "hair" }).merge(vt.first + k, 7, vt.first + k, 8));
    sum.put(vt.head, 8, "", S.th).merge(vt.head, 7, vt.head, 8);
    r = vt.last + 1;
    sum.chart({
      type: "barH", grouping: "stacked", title: "창구별 만족 · 보통 · 불만(건)", anchor: [r, 1, r + 9, 9], hideValueAxis: true, gap: 50,
      cats: [vt.first, 1, vt.last],
      series: [
        { name: "만족", vals: [vt.first, 3, vt.last], color: C.teal, labelColor: "#ffffff" },
        { name: "보통", vals: [vt.first, 4, vt.last], color: C.beige },
        { name: "불만", vals: [vt.first, 5, vt.last], color: C.navy, labelColor: "#ffffff" },
      ],
    });
    r += 10;
  }

  // GA4: 유입 채널 참여율 표 + 막대 + 전체 평균선
  if (hasGa4) {
    section(sum, r, 1, 8, `GA4 유입 채널 참여율 · ${g.status === "public_demo" ? "Google Merchandise Store 공개 데이터(한정선 아님)" : "기본값"}`);
    r += 1;
    const gt = table(sum, r, 1, ["채널", "세션", "참여율", "전체 평균", "주요 이벤트 비율", "수익(USD)"],
      g.channels.map((ch) => [ch.channel, ch.sessions, ch.engagement_rate_percent, g.engagement_rate_percent, ch.session_key_event_rate_percent, ch.revenue_usd]),
      ["text", "int", "pct", "pct", "pct", "usd"]);
    r = gt.last + 1;
    sum.chart({
      type: "bar", title: "유입 채널별 참여율(%)", anchor: [r, 1, r + 13, 9], axisFmt: '0"%"', max: 100,
      cats: [gt.first, 1, gt.last],
      series: [
        { name: "참여율(%)", vals: [gt.first, 3, gt.last], color: C.teal, fmt: '0.0"%"', pointColors: g.channels.map((ch) => (ch.engagement_rate_percent >= g.engagement_rate_percent ? null : C.orange)) },
        { name: `전체 ${pct(g.engagement_rate_percent)}`, vals: [gt.first, 4, gt.last], color: C.ink, line: true },
      ],
    });
    r += 14;
  }
  sheets.push(sum);

  // ---------- ② 예산·ROAS 상세 ----------
  const br = new Sheet("예산·ROAS 상세");
  br.widths = [2, 18, 16, 16, 16, 14, 14, 12, 14, 14, 12];
  r = 0;
  br.put(r, 1, "예산 · 채널별 성과 상세", S.title).merge(r, 1, r, 10).height(r, 28);
  br.put(r + 1, 1, `기준월 ${d.campaign_month} · 원화 = VND × 편성 기준 환율 ${rate}원/100 VND ÷ 100`, S.sub).merge(r + 1, 1, r + 1, 10);
  r += 3;
  section(br, r, 1, 10, `예산 구성 · 소진율 ${pct(b.burn_rate_percent)}`);
  r += 1;
  const bd = table(br, r, 1, ["구분", "금액", "총 예산 대비", "비고"], [
    ["플랫폼 광고비", b.platform_krw, share(b.platform_krw), "Meta · TikTok · Shopee Ads"],
    ["인플루언서 집행", b.influencer_paid_krw, share(b.influencer_paid_krw), ""],
    ["인플루언서 예상", b.influencer_expected_krw, share(b.influencer_expected_krw), "추정(견적 기준)"],
    ["잔여 가용 예산", b.remaining_krw, b.remaining_percent, "추정(예상 지출 포함)"],
  ], ["text", "krw", "pct", "text"], { total: ["총 배정 예산", b.total_krw, 100, `소진율 ${pct(b.burn_rate_percent)}`] });
  br.chart({
    type: "doughnut", title: "예산 구성", anchor: [r, 6, r + 11, 11], legendPos: "r",
    cats: [bd.first, 1, bd.first + 3], series: [{ name: "금액", vals: [bd.first, 2, bd.first + 3], colors: [C.teal, C.pink, C.navy, C.beige] }],
  });
  r = Math.max(bd.last, r + 11) + 2;
  section(br, r, 1, 10, "채널별 광고 성과");
  r += 1;
  const ct = table(br, r, 1, ["채널", "광고비(VND)", "광고비", "매출(VND)", "매출", "ROAS", "CPA(VND)", "전환", "예산 대비 지출", "손익분기"],
    d.channels.map((ch) => [ch.label, ch.ad_spend_vnd, krwBase(ch.ad_spend_vnd), ch.sales_revenue_vnd, krwBase(ch.sales_revenue_vnd), ch.roas_percent,
      ch.cpa_vnd, ch.conversions, share(krwBase(ch.ad_spend_vnd)), ch.roas_percent >= bep ? "기준 초과" : "기준 미달"]),
    ["text", "vnd", "krw", "vnd", "krw", "pct", "vnd", "int", "pct", "center"],
    { total: ["합계", t.ad_spend_vnd, t.ad_spend_krw_base, t.revenue_vnd, t.revenue_krw_base, t.roas_percent, null, t.conversions, share(t.ad_spend_krw_base), ""] });
  r = ct.last + 1;
  br.chart({
    type: "bar", title: "채널별 광고비 · 매출(원)", anchor: [r, 1, r + 14, 11], axisFmt: '#,##0,,"백만"',
    cats: [ct.first, 1, ct.last - 1],
    series: [
      { name: "광고비", vals: [ct.first, 3, ct.last - 1], color: C.beige, fmt: '#,##0,,"백만"' },
      { name: "매출", vals: [ct.first, 5, ct.last - 1], color: C.teal, fmt: '#,##0,,"백만"' },
    ],
  });
  r += 16;
  if (sim.items.length && sim.data) {
    const cost = sim.items.reduce((s, it) => s + it.cost_krw, 0);
    section(br, r, 1, 10, "집행 시뮬레이션 (추정 · 저장되지 않는 계산)");
    r += 1;
    // 본전 매출 · 판정은 예상 ROAS가 있는 항목만(없으면 빈칸), 합계도 그 항목끼리 비교
    const judge = (revenue, breakEven) => (revenue > breakEven ? "이익" : revenue < breakEven ? "손해" : "본전");
    const priced = sim.items.filter((it) => it.revenue_krw != null);
    const revenueSum = priced.reduce((s, it) => s + it.revenue_krw, 0);
    const breakEvenSum = priced.reduce((s, it) => s + breakEvenRevenue(it.cost_krw), 0);
    const st = table(br, r, 1, ["구분", "매체", "대상", "세부 내용", "집행 비용", "집행 비용(VND)", "예상 ROAS", "예상 매출", "본전 매출", "판정"],
      sim.items.map((it) => [SIM_TYPE_LABEL[it.type], it.media, it.target, it.detail, it.cost_krw, it.cost_vnd, it.roas, it.revenue_krw,
        it.revenue_krw == null ? null : breakEvenRevenue(it.cost_krw), it.revenue_krw == null ? "" : judge(it.revenue_krw, breakEvenRevenue(it.cost_krw))]),
      ["text", "text", "text", "text", "krw", "vnd", "pct", "krw", "krw", "text"],
      { total: ["합계", "", "", "", cost, sim.items.reduce((s, it) => s + it.cost_vnd, 0), null, revenueSum,
        priced.length ? breakEvenSum : null, priced.length ? judge(revenueSum, breakEvenSum) : ""] });
    r = st.last + 1;
    br.put(r, 1, "현재 잔여 가용 예산", { bold: true }).put(r, 5, sim.data.budget.remaining_krw, { fmt: FMT.krw, bold: true });
    br.put(r + 1, 1, "집행 후 남는 예산 (추정)", { bold: true }).put(r + 1, 5, sim.data.budget.remaining_krw - cost, { fmt: FMT.krw, bold: true, color: C.teal });
    r += 3;
  }
  sheets.push(br);

  // ---------- ③ VOC 상세 ----------
  if (view.reviews.length) {
    const vs = new Sheet("VOC 상세");
    vs.widths = [2, 20, 9, 10, 10, 42, 42, 18, 18, 12];
    r = 0;
    vs.put(r, 1, "고객 의견(VOC) 상세", S.title).merge(r, 1, r, 9).height(r, 28);
    vs.put(r + 1, 1, `팜플렛 QR 창구(Zalo · 카카오톡 · WhatsApp) 1:1 문의 ${num(view.reviews.length - view.surveyComments.length)}건 + 설문 의견 ${num(view.surveyComments.length)}건`, S.sub).merge(r + 1, 1, r + 1, 9);
    r += 3;
    section(vs, r, 1, 9, `창구별 요약 · ${view.vocAiChannels?.length ? "AI 요약(사람 검수 전)" : "AI 분석 전"}`);
    r += 1;
    const sr = table(vs, r, 1, ["창구", "건수", "만족 비율", "불만 비율", "요약", "유의할 점", "유지", "개선", "출처"],
      view.channels.map((ch) => {
        const list = channelList(ch);
        const cnt = countBy(list, "sentiment");
        const s = channelSummary(ch);
        const n = list.length || 1;
        return [PLATFORM_LABEL[ch] || ch, list.length, round1(((cnt.Positive || 0) / n) * 100), round1(((cnt.Negative || 0) / n) * 100),
          s ? s.summary : "AI 분석 전", s?.caution || "", (s?.keep || []).join(" · "), (s?.improve || []).join(" · "), s ? "AI(검수 전)" : "—"];
      }), ["text", "int", "pct", "pct", "wrap", "wrap", "wrap", "wrap", "center"], { height: 36 });
    r = sr.last + 2;

    const qr = view.qr;
    if (qr) {
      section(vs, r, 1, 9, "팜플렛 QR 흐름");
      r += 1;
      const follows = Object.entries(qr.follows).sort((x, y) => y[1] - x[1]);
      const qt = table(vs, r, 1, ["단계", "수", "QR 스캔 대비"], [
        ["배포 팜플렛", qr.pamphlets, null],
        ["QR 스캔", qr.qr_scans, 100],
        ["채널 추가 합계", qr.follows_total, qr.follow_rate_percent],
        ...follows.map(([ch, n]) => [`채널 추가 · ${PLATFORM_LABEL[ch] || ch}`, n, round1((n / qr.qr_scans) * 100)]),
        ["설문 응답", qr.survey_responses, qr.response_rate_percent],
      ], ["text", "int", "pct"]);
      vs.chart({
        type: "barH", title: "팜플렛 QR 흐름(명)", anchor: [r, 5, r + 10, 9], legend: false, hideValueAxis: true,
        cats: [qt.first, 1, qt.last], series: [{ name: "수", vals: [qt.first, 2, qt.last], color: C.teal }],
      });
      r = Math.max(qt.last, r + 10) + 2;

      section(vs, r, 1, 9, `설문 문항별 점수 분포 · 응답 ${num(qr.survey_responses)}명 · 평균 ${qr.survey.overall_avg ?? "—"} / 5`);
      r += 1;
      const svt = table(vs, r, 1, ["문항", "1점", "2점", "3점", "4점", "5점", "응답", "평균", "만족(4~5점)"],
        qr.survey.items.map((s) => [s.item, ...s.dist, s.responses, s.avg, s.top2_percent]),
        ["text", "int", "int", "int", "int", "int", "int", "dec2", "pct"]);
      r = svt.last + 1;
      const scoreColors = [C.navy, C.pink, C.beige, C.celadon, C.teal];
      vs.chart({
        type: "barH", grouping: "percentStacked", title: "문항별 1~5점 응답 비율", anchor: [r, 1, r + 11, 10], hideValueAxis: true, labels: false, gap: 40,
        cats: [svt.first, 1, svt.last],
        series: [1, 2, 3, 4, 5].map((p, i) => ({ name: `${p}점`, vals: [svt.first, 1 + p, svt.last], color: scoreColors[i] })),
      });
      r += 13;
    }

    section(vs, r, 1, 9, "핵심 키워드 Top 5 (문의 + 설문)");
    r += 1;
    const top = Object.entries(countBy(view.reviews, "keyword_tag")).sort((x, y) => y[1] - x[1]).slice(0, 5);
    const kt = table(vs, r, 1, ["주제", "언급 수"], top, ["text", "int"]);
    vs.chart({
      type: "barH", title: "핵심 키워드(건)", anchor: [r, 4, r + 8, 9], legend: false, hideValueAxis: true,
      cats: [kt.first, 1, kt.last], series: [{ name: "언급 수", vals: [kt.first, 2, kt.last], color: C.beige, pointColors: [C.navy] }],
    });
    r = Math.max(kt.last, r + 8) + 2;

    section(vs, r, 1, 9, `문의·후기 전체 ${num(view.reviews.length)}건 (머리줄 ▼로 창구 · 만족도 · 주제를 거를 수 있어요)`);
    r += 1;
    const lt = table(vs, r, 1, ["창구", "구분", "만족도", "주제", "한국어", "원문", "원문 언어", "번호"],
      view.reviews.map((rv, i) => [PLATFORM_LABEL[rv.platform] || rv.platform, rv.source === "survey" ? "설문" : "문의", SENTIMENT_LABEL[rv.sentiment] || "미분류",
        rv.keyword_tag || "", rv.translated_kr || "", rv.raw_text_vn || "", rv.lang === "ko" ? "한국어" : "베트남어", i + 1]),
      ["text", "center", "center", "text", "wrap", "wrap", "center", "int"]);
    vs.autoFilter(lt.head, 1, lt.last, 8);
    sheets.push(vs);
  }

  // ---------- ④ GA4 상세 ----------
  if (hasGa4 || d.creators?.length) {
    const gs = new Sheet("GA4 상세");
    gs.widths = [2, 20, 12, 12, 12, 12, 14, 12, 14, 14];
    r = 0;
    gs.put(r, 1, "GA4 트래픽 · 전환 상세", S.title).merge(r, 1, r, 9).height(r, 28);
    const period = g?.period?.start ? `${g.period.start} ~ ${g.period.end}` : "—";
    gs.put(r + 1, 1, `${g?.source || "—"} · 기간 ${period} · ${g?.scope || ""}`, S.sub).merge(r + 1, 1, r + 1, 9);
    r += 3;
    if (hasGa4) {
      section(gs, r, 1, 9, "주요 지표");
      r += 1;
      const mt = table(gs, r, 1, ["지표", "값", "", "설명"], [
        ["유효 참여율", g.engagement_rate_percent, null, `참여 세션 ${num(g.engaged_sessions)} ÷ 세션 ${num(g.sessions)}`],
        ["세션 주요 이벤트 비율", g.session_key_event_rate_percent, null, "주요 이벤트가 1회 이상 발생한 세션 ÷ 전체 세션"],
        ["주요 이벤트", g.key_events, null, ""],
        ["평균 참여 시간(초)", g.avg_engagement_sec, null, ""],
        ["수익(USD)", g.revenue_usd, null, "Google Merchandise Store 매출"],
        ["매장 예약·길찾기 클릭률", g.store_action_ctr_percent, null, `${num(g.store_action_clicks)}회 클릭 · 한정선 사이트 전용 이벤트라 기본 비율`],
        ["팜플렛 QR 유입", g.pamphlet_sessions, null, "utm_source=pamphlet 세션 · 기본 비율"],
      ], ["text", "dec2", "text", "text"]);
      [[0, "pct"], [1, "pct"], [2, "int"], [3, "sec"], [4, "usd"], [5, "pct"], [6, "int"]].forEach(([k, kind]) => {
        const cell = gs.cells.get(`${mt.first + k},2`);
        cell.s = { border: "hair", fmt: FMT[kind] };
      });
      for (let k = mt.head; k <= mt.last; k++) gs.merge(k, 4, k, 9);
      r = mt.last + 2;
      section(gs, r, 1, 9, "유입 채널별 세션 · 참여 · 전환");
      r += 1;
      const gt = table(gs, r, 1, ["채널", "세션", "세션 비중", "참여 세션", "참여율", "평균 참여 시간", "주요 이벤트", "주요 이벤트 비율", "수익(USD)"],
        g.channels.map((ch) => [ch.channel, ch.sessions, round1((ch.sessions / g.sessions) * 100), ch.engaged_sessions, ch.engagement_rate_percent,
          ch.avg_engagement_sec, ch.key_events, ch.session_key_event_rate_percent, ch.revenue_usd]),
        ["text", "int", "pct", "int", "pct", "sec", "int", "pct", "usd"],
        { total: ["합계", g.sessions, 100, g.engaged_sessions, g.engagement_rate_percent, g.avg_engagement_sec, g.key_events, g.session_key_event_rate_percent, g.revenue_usd] });
      r = gt.last + 1;
      gs.chart({
        type: "bar", title: "유입 채널별 세션 수", anchor: [r, 1, r + 13, 10], legend: false,
        cats: [gt.first, 1, gt.last - 1], series: [{ name: "세션", vals: [gt.first, 2, gt.last - 1], color: C.teal }],
      });
      r += 15;
      if (g.top_events?.length) {
        section(gs, r, 1, 9, `이벤트 Top ${g.top_events.length} · 전체 이벤트 ${num(g.event_count)}건 중`);
        r += 1;
        const et = table(gs, r, 1, ["이벤트", "이벤트 수", "이벤트 비중", "총 사용자", "총 사용자당"],
          g.top_events.map((e) => [e.event, e.count, g.event_count ? round1((e.count / g.event_count) * 100) : null, e.users, e.users ? Math.round((e.count / e.users) * 100) / 100 : null]),
          ["text", "int", "pct", "int", "dec2"]);
        gs.chart({
          type: "barH", title: "이벤트 수", anchor: [r, 6, r + 12, 10], legend: false, hideValueAxis: true,
          cats: [et.first, 1, et.last], series: [{ name: "이벤트 수", vals: [et.first, 2, et.last], color: C.navy }],
        });
        r = Math.max(et.last, r + 12) + 2;
      }
    }
    if (d.creators?.length) {
      section(gs, r, 1, 9, "크리에이터별 클릭 · 전환 Top 5 (인플루언서 탭 연동 전)");
      r += 1;
      const crt = table(gs, r, 1, ["크리에이터", "플랫폼", "링크 클릭", "전환", "전환율"],
        d.creators.map((cr) => [cr.creator, cr.platform, cr.clicks, cr.conversions, cr.cvr_percent]), ["text", "text", "int", "int", "pct"]);
      gs.chart({
        type: "bar", title: "링크 클릭(회)", anchor: [r, 6, r + 10, 10], legend: false,
        cats: [crt.first, 1, crt.last], series: [{ name: "링크 클릭", vals: [crt.first, 3, crt.last], color: C.brown }],
      });
      r = Math.max(crt.last, r + 10) + 2;
    }
    sheets.push(gs);
  }

  const today = new Date();
  downloadXlsx(`마케팅성과_${d.campaign_month}_${today.getFullYear()}${pad2(today.getMonth() + 1)}${pad2(today.getDate())}.xlsx`, sheets);
}

// ---------- 블록 확대 애니메이션 ----------
// 확대할 때 그 블록의 차트를 다시 그립니다: 막대는 하나씩 올라오고(가로 막대는 뻗고), 도넛은 돌며 채워집니다.
// HTML 막대(소진율 · 창구별 만족도 · 설문 분포 · GA4 Top 5)는 줄마다 차례로 늘어납니다. '동작 줄이기' 설정이면 하지 않습니다.
const REDUCED_MOTION = window.matchMedia("(prefers-reduced-motion: reduce)");
const GROW_BARS = ".kpi-burn-seg, .kpi-voc-chbar > span, .kpi-voc-ch-bar > span, .kpi-survey-bar > span, .kpi-bar-fill";
const animTimers = new WeakMap();

function animatePanel(panel) {
  if (REDUCED_MOTION.matches) return;
  panel.querySelectorAll(GROW_BARS).forEach((n) => {
    const row = n.closest("li, tr");
    const i = row ? [...row.parentElement.children].indexOf(row) : [...n.parentElement.children].indexOf(n);
    n.style.setProperty("--kpi-i", String(Math.max(i, 0)));
  });
  panel.classList.remove("is-animating");
  void panel.offsetWidth;  // 다시 확대해도 처음부터 움직이게
  panel.classList.add("is-animating");
  clearTimeout(animTimers.get(panel));
  animTimers.set(panel, setTimeout(() => panel.classList.remove("is-animating"), 1800));
  // 처음에 숨겨진 상태로 만든 차트(GA4 채널 · 크리에이터 등)는 확대 순간 처음 그려지며 자체 애니메이션(막대가 한꺼번에)을
  // 시작합니다. 움직이는 중인 막대에는 '하나씩' 지연이 적용되지 않으므로 ① 진행 중인 애니메이션을 멈추고 바닥 상태로 그려 둔 뒤
  // ② 크기 조정이 끝나면(약 0.1초) 하나씩 올라오는 애니메이션을 새로 시작합니다. 모든 차트가 같은 타이밍으로 움직입니다.
  const panelCharts = () => [...panel.querySelectorAll("canvas[data-kpi-chart]")]
    .map((canvas) => (canvas.offsetParent ? charts[canvas.dataset.kpiChart] : null))
    .filter(Boolean);
  requestAnimationFrame(() => {
    panelCharts().forEach((chart) => {
      chart.stop();
      fitChart(chart);
      chart.reset();
      chart.draw();
    });
    setTimeout(() => {
      if (!panel.classList.contains("is-expanded")) return;
      panelCharts().forEach((chart) => {
        fitChart(chart);
        // 기준선(손익분기 · 전체 평균 같은 선)은 제자리에 두고, 막대만 왼쪽부터 차례로(같은 항목의 막대 2개는 함께) 올라오게
        chart.data.datasets.forEach((ds) => { if ((ds.type || chart.config.type) === "line") ds.animation = false; });
        chart.options.animation = chart.config.type === "doughnut"
          ? { animateRotate: true, animateScale: false, duration: 800, easing: "easeOutCubic" }
          : { duration: 650, easing: "easeOutCubic", delay: (ctx) => (ctx.type === "data" && ctx.mode === "default" ? ctx.dataIndex * 110 : 0) };
        chart.stop();
        chart.reset();
        chart.update();
      });
    }, 100);
  });
}

// ---------- 블록 확대 ----------
// 화면 배율(zoom 0.8)에서는 Chart.js가 칸 크기를 작게 재므로, 칸의 CSS 크기를 직접 넘겨 차트를 칸에 꼭 맞춥니다.
function fitChart(chart) {
  const box = chart.canvas.parentElement;
  if (box?.clientWidth && box.clientHeight) chart.resize(box.clientWidth, box.clientHeight);
  else chart.resize();
}

function resizeCharts() {
  requestAnimationFrame(() => Object.values(charts).forEach(fitChart));
}

// 4개 블록 높이를 예산 블록(기본 화면) 높이에 맞춥니다. 넘치는 내용은 블록 안에서 스크롤합니다.
function syncBlockHeight() {
  const board = $("board");
  const budget = board.querySelector('[data-kpi-panel="budget"]');
  if (!budget || budget.classList.contains("is-expanded")) return;
  board.classList.remove("is-synced");
  board.style.setProperty("--kpi-block-h", `${Math.ceil(budget.offsetHeight)}px`);  // CSS 높이(화면 배율 적용 전)
  board.classList.add("is-synced");
  resizeCharts();
}

let syncFrame = 0;
window.addEventListener("resize", () => {
  cancelAnimationFrame(syncFrame);
  syncFrame = requestAnimationFrame(syncBlockHeight);
});

function setExpanded(panel, { animate = true } = {}) {
  root.querySelectorAll(".kpi-panel.is-expanded").forEach((p) => p.classList.remove("is-expanded"));
  if (panel) panel.classList.add("is-expanded");
  root.querySelector(".kpi-backdrop").hidden = !panel;
  if (!panel) syncBlockHeight();
  root.querySelectorAll(".kpi-expand").forEach((btn) => {
    const open = btn.closest(".kpi-panel") === panel;
    btn.setAttribute("aria-label", open ? "원래 크기로" : "블록 확대");
    btn.title = open ? "축소 (Esc)" : "확대";
  });
  resizeCharts();
  if (panel && animate) animatePanel(panel);
}

// ---------- 불러오기 ----------
async function getJson(url, options) {
  const res = await fetch(url, options);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `요청 실패 (${res.status})`);
  return body;
}

function showError(name, message) {
  const box = $(name);
  box.textContent = message;
  box.hidden = !message;
}

let vocReviews = [];
// 이 화면에서 [AI로 분석]을 눌러 받은 결과. 페이지를 다시 열면(F5) 비고, 머리줄 새로고침(⟳)에는 유지됩니다.
let vocAiResult = null;

async function loadSummary() {
  try {
    const data = await getJson(API.summary);
    view.summary = data;
    renderScorecards(data);
    renderBudget(data);
    renderRoas(data);
    renderGa4(data);
    syncSimUnit();
    syncBlockHeight();
  } catch (err) {
    syncSimUnit(true);
    root.querySelector(".kpi-legend-note").hidden = false;
    root.querySelector(".kpi-legend-note").textContent = `마케팅 성과 데이터를 불러오지 못했습니다: ${err.message}`;
  }
}

async function loadVoc() {
  try {
    const data = await getJson(API.voc);
    vocReviews = data.reviews;
    view.channels = data.channels || [];
    view.surveyComments = data.survey_comments || [];
    renderQr(data.qr);
    // AI 요약은 이 화면에서 [AI로 분석]을 눌렀을 때만 보입니다(그 전에는 요약 없이 안내만, 서버도 결과를 보관하지 않음).
    if (vocAiResult) showVocAi(vocReviews, vocAiResult);
    else renderVoc(vocReviews, { text: "기본 분류", status: "demo", meta: "문의 · 기본 분류" });
  } catch (err) {
    showError("voc-error", `VOC 데이터를 불러오지 못했습니다: ${err.message}`);
  }
}

// ---------- 블록 순서 바꾸기 (위젯) — 순서는 이 브라우저에만 저장 ----------
const ORDER_KEY = "kpi-board-order";
const DEFAULT_ORDER = ["budget", "roas", "voc", "ga4"];
let dragged = null;

function boardPanels() {
  return [...$("board").querySelectorAll(":scope > .kpi-panel")];
}

function saveOrder() {
  try {
    localStorage.setItem(ORDER_KEY, JSON.stringify(boardPanels().map((p) => p.dataset.kpiPanel)));
  } catch { /* 저장이 막힌 브라우저에서는 이번 화면에만 적용 */ }
}

function applyOrder(order) {
  const board = $("board");
  const byKey = Object.fromEntries(boardPanels().map((p) => [p.dataset.kpiPanel, p]));
  const keys = [...order.filter((k) => byKey[k]), ...DEFAULT_ORDER.filter((k) => !order.includes(k) && byKey[k])];
  keys.forEach((k) => board.append(byKey[k]));
  resizeCharts();
}

function loadOrder() {
  try {
    const saved = JSON.parse(localStorage.getItem(ORDER_KEY) || "null");
    if (Array.isArray(saved)) applyOrder(saved);
  } catch { /* 저장 값이 없거나 깨졌으면 기본 순서 */ }
}

root.addEventListener("dragstart", (event) => {
  const handle = event.target.closest?.(".kpi-drag");
  if (!handle) return;
  dragged = handle.closest(".kpi-panel");
  dragged.classList.add("is-dragging");
  event.dataTransfer.effectAllowed = "move";
  event.dataTransfer.setData("text/plain", dragged.dataset.kpiPanel);
  event.dataTransfer.setDragImage(dragged, 24, 24);
});

root.addEventListener("dragover", (event) => {
  const over = event.target.closest?.(".kpi-board > .kpi-panel");
  if (!dragged || !over) return;
  event.preventDefault();
  root.querySelectorAll(".is-drop-target").forEach((p) => p !== over && p.classList.remove("is-drop-target"));
  if (over !== dragged) over.classList.add("is-drop-target");
});

root.addEventListener("drop", (event) => {
  const over = event.target.closest?.(".kpi-board > .kpi-panel");
  if (!dragged || !over || over === dragged) return;
  event.preventDefault();
  const panels = boardPanels();
  if (panels.indexOf(dragged) < panels.indexOf(over)) over.after(dragged);
  else over.before(dragged);
  saveOrder();
  resizeCharts();
});

root.addEventListener("dragend", () => {
  dragged?.classList.remove("is-dragging");
  root.querySelectorAll(".is-drop-target").forEach((p) => p.classList.remove("is-drop-target"));
  dragged = null;
});

async function analyzeVoc(button) {
  button.disabled = true;
  button.textContent = "분석 중…";
  $("voc-summary").querySelector(".kpi-ai-rows > .kpi-note")?.remove();  // 분석 전 안내 대신 진행 문구
  $("voc-summary").querySelector(".kpi-ai-rows")?.append(el("div", { className: "kpi-ai-meta is-loading", text: "AI가 창구별 문의·설문을 분석하는 중… (최대 2분)" }));
  showError("voc-error", "");
  try {
    const data = await getJson(API.analyze, { method: "POST" });
    vocAiResult = data.ai;
    showVocAi(vocReviews, vocAiResult);
  } catch (err) {
    showError("voc-error", `${err.message}`);
  } finally {
    button.disabled = false;
    button.textContent = "AI로 분석";
  }
}

root.addEventListener("click", (event) => {
  const target = event.target.closest("[data-kpi-action]");
  const action = target?.dataset.kpiAction;
  if (action === "refresh") {
    loadSummary();
    loadVoc();
    loadSimulator();
  } else if (action === "simulate") {
    setExpanded(target.closest(".kpi-panel"));
    requestAnimationFrame(() => {
      $("sim").scrollIntoView({ block: "start", behavior: "smooth" });
      $("sim-account").focus({ preventScroll: true });
    });
  } else if (action === "sim-remove") {
    sim.items = sim.items.filter((it) => String(it.id) !== target.dataset.id);
    renderSim();
  } else if (action === "sim-type") {
    setSimType(target.dataset.type);
  } else if (action === "voc-analyze") {
    analyzeVoc(target);
  } else if (action === "currency") {
    setCurrency(target.dataset.cur);
  } else if (action === "review-channel") {
    setReviewChannel(target.dataset.channel);
  } else if (action === "voc-channel-open") {
    // 기본 화면의 창구 막대: 블록을 확대하고 그 창구를 고릅니다.
    const panel = target.closest(".kpi-panel");
    if (!panel.classList.contains("is-expanded")) setExpanded(panel);
    setReviewChannel(target.dataset.channel, { toggle: false });
  } else if (action === "review-page") {
    setReviewPage(Number(target.dataset.page));
  } else if (action === "export-menu") {
    setExportMenu(root.querySelector(".kpi-export-menu").hidden);
  } else if (action === "export-pdf") {
    setExportMenu(false);
    exportPdf();
  } else if (action === "export-xlsx") {
    setExportMenu(false);
    exportXlsx();
  } else if (action === "expand") {
    const panel = target.closest(".kpi-panel");
    setExpanded(panel.classList.contains("is-expanded") ? null : panel);
  } else if (action === "collapse") {
    setExpanded(null);
  }
});

root.addEventListener("change", (event) => {
  if (event.target.matches('[data-kpi-action="ga4-toggle"]')) setGa4Visible(event.target.checked);
  if (event.target.matches('[data-kpi="sim-media"]')) onMediaChange();
  if (event.target.matches('[data-kpi="sim-format"]')) onFormatChange();
  // 화폐를 바꾸면 불러온 KOL 단가를 그 화폐로 다시 채웁니다(단가가 없는 항목의 금액은 그대로).
  if (event.target.matches('[data-kpi="sim-unit"]')) { syncSimUnit(); syncQuote(); }
  if (event.target.matches('[data-kpi="sim-roas-pick"]')) onRoasPick();
  if (event.target.closest('[data-kpi="sim-form"]')) updateSimPreview();
  if (event.target.matches('[data-kpi-action="review-lang"]')) setReviewLang(event.target.value);
  if (event.target.matches('[data-kpi-action="review-filter"]')) setReviewFilter(event.target.value);
});

root.addEventListener("input", (event) => {
  if (event.target.matches("[data-kpi-money]")) formatMoneyInput(event.target);
  if (event.target.matches('[data-kpi="sim-account"]')) {
    if (!event.detail?.chosen) renderAccountSuggest();  // 추천에서 고른 직후에는 목록을 다시 열지 않음
    if (accountQuotes().length || accountListEntry()) applyQuote();  // 단가 · 탭 리스트가 우선
    else if (accountCreator()) applyCreator();
    else fillFormats();  // 탭에 없는 계정이면 매체 기본 형식만
  }
  if (event.target.matches('[data-kpi="sim-roas"]')) sim.roasEdited = event.target.value.trim() !== "";
  if (event.target.closest('[data-kpi="sim-form"]')) updateSimPreview();
});

root.addEventListener("submit", (event) => {
  if (!event.target.matches('[data-kpi="sim-form"]')) return;
  event.preventDefault();
  if (sim.data) addSimItem(event.target);
});

// 계정 칸 검색 추천: ↑↓ 이동 · Enter 고르기(양식 제출 막음) · Esc 닫기(확대 화면은 그대로) · 칸을 벗어나면 닫기
root.addEventListener("keydown", (event) => {
  if (!event.target.matches('[data-kpi="sim-account"]') || $("sim-accounts").hidden) return;
  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    event.preventDefault();
    moveAccountSuggest(event.key === "ArrowDown" ? 1 : -1);
  } else if (event.key === "Enter" && sim.suggestActive >= 0) {
    event.preventDefault();
    chooseAccount($("sim-accounts").children[sim.suggestActive].dataset.name);
  } else if (event.key === "Escape") {
    event.stopPropagation();
    closeAccountSuggest();
  }
});
root.addEventListener("mousedown", (event) => {
  const li = event.target.closest('[data-kpi="sim-accounts"] li');
  if (!li) return;
  event.preventDefault();  // 칸의 포커스를 유지한 채 고름
  chooseAccount(li.dataset.name);
});
root.addEventListener("focusout", (event) => {
  if (event.target.matches('[data-kpi="sim-account"]')) closeAccountSuggest();
});

document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  if (!root.querySelector(".kpi-export-menu").hidden) return setExportMenu(false);
  setExpanded(null);
});

// 내보내기 메뉴 바깥을 누르면 메뉴를 닫습니다.
document.addEventListener("click", (event) => {
  if (!event.target.closest?.(".kpi-export")) setExportMenu(false);
});

chartNotice();
loadOrder();
document.fonts?.ready.then(syncBlockHeight);  // 글꼴이 늦게 적용되면 예산 블록 높이가 바뀌므로 다시 맞춤
setGa4Visible(true);
loadSummary();
loadVoc();
loadSimulator();
