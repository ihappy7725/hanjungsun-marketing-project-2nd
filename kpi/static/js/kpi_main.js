// KPI 화면 스크립트 [민지]
// type="module"로 불러오므로 전역 변수·함수가 생기지 않습니다. (README 7장)
// 차트는 Chart.js(CDN). 라이브러리를 바꾸게 되면 아래 "차트" 묶음만 고칩니다.

const root = document.querySelector(".kpi-page");
const API = {
  summary: "/kpi/api/summary",
  voc: "/kpi/api/voc",
  analyze: "/kpi/api/voc/analyze",
  simulator: "/kpi/api/simulator",
};
const charts = {};
// 화면 선택 상태: ROAS 통화(기본 원화), 리뷰 언어(기본 한국어), 감성 필터(기본 전체)
// surveyVoc: QR 설문 의견 감성·키워드 집계(서버 계산) — VOC 도넛·키워드에 리뷰와 합산
// surveyComments: 설문 주관식 의견(응답자 1명당 1줄) — 리뷰 목록에 공개 리뷰 뒤로 이어 붙임
const view = {
  currency: "KRW", summary: null,
  reviewLang: "ko", reviewFilter: "all", reviewPage: 1, reviews: [],
  surveyVoc: null, surveyComments: [],
};
const REVIEW_PAGE_SIZE = 10;

const $ = (name) => root.querySelector(`[data-kpi="${name}"]`);
const setText = (name, text) => {
  const el = $(name);
  if (el) {
    const description = /시연|데모|가상|\bdemo\b/i.test(String(text ?? ""));
    el.textContent = description ? "" : text;
    el.hidden = description || !String(text ?? "").trim();
  }
};

// ---------- 숫자 표시 ----------
const num = (n) => Number(n).toLocaleString("ko-KR");
const krwMan = (n) => `${num(Math.round(n / 10000))}만 원`;
const vnd = (n) => `${num(n)} VND`;
const pct = (n) => (n === null || n === undefined ? "—" : `${n.toFixed(1)}%`);
const signedKrw = (n) => `${n >= 0 ? "+" : "−"}${num(Math.abs(n))}원`;

// 화면에서는 '감성' 대신 '만족도'(만족 · 보통 · 불만)로 표시합니다. 데이터 값은 Positive/Neutral/Negative 그대로.
const SENTIMENT_LABEL = { Positive: "만족", Neutral: "보통", Negative: "불만" };
const PLATFORM_LABEL = { Shopee_VN: "Shopee", Instagram: "Instagram", TikTok: "TikTok", Zalo_OA: "Zalo QR", Zalo_Survey: "Zalo 설문" };
const STATUS_CLASS = { live: "is-live", fallback: "is-fallback", public_demo: "is-public", demo: "is-demo", warn: "is-warn" };

// ---------- 디자인 변수 ----------
// .kpi-page에서 읽어야 KPI 안에서만 정의한 변수(--kpi-pink)까지 함께 읽힙니다.
const cssVar = (name) => getComputedStyle(root).getPropertyValue(name).trim();
// 차트 색: 공통 톤(남색·청록·갈색·살구) 안에서 서로 잘 구분되는 진한 색을 씁니다. (base.css 변수 + KPI 전용 분홍)
const palette = () => ({
  ink: cssVar("--ink"),         // 예산: 플랫폼 광고비(검정)
  pink: cssVar("--kpi-pink"),   // 예산: 인플루언서 예상(분홍, kpi_main.css에서 정의)
  ivory: cssVar("--beige"),     // 예산: 잔여 가용 예산(아이보리)
  coral: cssVar("--kpi-coral"), // VOC: 불만(코랄, kpi_main.css에서 정의)
  light: cssVar("--gold"),      // VOC: 2위 이하 키워드(연한 갈색)
  muted: cssVar("--muted"),
  line: cssVar("--line"),
  lineStrong: cssVar("--line-strong"),
  strong: cssVar("--navy"),   // 가장 큰 몫(플랫폼 광고비)
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
  // 예산 색: 녹색 · 분홍 · 검정 · 아이보리 (검정은 가장 작은 몫인 인플루언서 예상에만 써서 눈에 덜 무겁게)
  const parts = [
    ["플랫폼 광고비", b.platform_krw, p.good],
    ["인플루언서 집행", b.influencer_paid_krw, p.pink],
    ["인플루언서 예상", b.influencer_expected_krw, p.ink],
    ["잔여 가용 예산", remaining, p.ivory],
  ];
  doughnut("budget", parts.map((x) => x[0]), parts.map((x) => x[1]), parts.map((x) => x[2]));
  setText("remaining-pct", pct(b.remaining_percent));

  const rows = parts.map(([label, value, color]) => {
    const swatch = el("span", { className: "kpi-swatch" });
    swatch.style.background = color;
    return el("div", {}, [el("dt", {}, [swatch, document.createTextNode(label)]), el("dd", { text: krwMan(value) })]);
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
      ? `${link.error} — 협찬비는 시연 값으로 표시합니다.`
      : link.total === 0
        ? "인플루언서 탭 단가 데이터: 아직 없음 — 협찬비는 시연 값으로 표시합니다."
        : `인플루언서 탭 단가 ${link.total}건 연동(견적 ${link.counts.quote} · 계약 ${link.counts.contract}). 예산 반영 기준은 확정 전이라 협찬비는 시연 값입니다.`,
  );
  setText("budget-meta", `출처: 시연 값 · 기간: ${data.campaign_month} · 범위: 베트남 전체 이벤트 · 단위: 원(기준 환율 ${data.fx.base_rate.toFixed(2)}원/100 VND)`);

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
  setText("ga4-ctr", pct(g.shopee_ctr_percent));
  setText("ga4-ctr-sub", `${num(g.shopee_clicks)}회 이동`);
  setText("ga4-pamphlet", num(g.pamphlet_sessions));
  setText(
    "ga4-proxy",
    g.purchase_rate_percent != null ? `대체 지표(데모): 구매 전환율 ${pct(g.purchase_rate_percent)} — 데모 스토어 값, 쇼피 이동 클릭률을 대신 참고` : "",
  );
  setText("ga4-note", g.note);
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
  fillRows("ga4-channel-rows", g.channels.map((c) => [
    c.channel,
    num(c.sessions),
    pct((c.sessions / g.sessions) * 100),
    c.engaged_sessions == null ? "—" : num(c.engaged_sessions),
    pct(c.engagement_rate_percent),
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
    setText("ga4-meta", "출처: 시연 값(인플루언서 탭 공개 함수에 클릭·전환 항목 추가 필요) · 범위: 베트남 · 표본: 크리에이터 5명");
  }
  resizeCharts();
}

// ---------- VOC ----------
function renderVoc(stats, reviews, source) {
  const p = palette();
  // 리뷰(글) 감성 + QR 설문 응답자 감성(평균 4점↑ 긍정 / 3점대 중립 / 3점↓ 부정)을 합산합니다.
  const sv = view.surveyVoc;
  const keys = ["Positive", "Neutral", "Negative"];
  const counts = Object.fromEntries(keys.map((k) => [k, (stats.sentiment_counts[k] || 0) + (sv?.sentiment_counts[k] || 0)]));
  const reviewTotal = stats.sample_size ?? reviews.length;
  const sampleTitle = sv ? `리뷰 ${num(reviewTotal)} + 설문 ${num(sv.respondents)}` : `리뷰 ${num(reviewTotal)}`;
  doughnut("sentiment", keys.map((k) => `${SENTIMENT_LABEL[k]} ${num(counts[k])}`), keys.map((k) => counts[k]), [p.good, p.lineStrong, p.coral], { cutout: "58%", legend: true, title: sampleTitle });
  if (charts.sentiment) {
    // 도넛 조각을 누르면 그 감성 리뷰만 봅니다(같은 조각을 다시 누르면 전체).
    // 리뷰 목록은 확대 화면에 있으므로, 기본 화면에서 누르면 블록을 확대한 뒤 거릅니다.
    charts.sentiment.options.onClick = (_e, els) => {
      if (!els.length) return;
      const key = keys.at(els[0].index);
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

  // 키워드: 리뷰 토픽 언급 + 설문에서 2점 이하로 답한 문항 토픽(불만)
  const keywordCounts = {};
  stats.top_keywords.forEach((k) => { keywordCounts[k.keyword] = (keywordCounts[k.keyword] || 0) + k.count; });
  Object.entries(sv?.keyword_counts || {}).forEach(([k, n]) => { keywordCounts[k] = (keywordCounts[k] || 0) + n; });
  const topKeywords = Object.entries(keywordCounts).sort((a, b) => b[1] - a[1]).slice(0, 5);
  drawChart("keywords", {
    type: "bar",
    data: {
      labels: topKeywords.map(([k]) => k),
      // 1위 키워드만 진한 갈색, 나머지는 연한 색으로 눈에 띄는 순서를 만듭니다.
      datasets: [{ label: "언급 수", data: topKeywords.map(([, n]) => n), backgroundColor: topKeywords.map((_, i) => (i === 0 ? p.mid : p.light)), maxBarThickness: 14 }],
    },
    options: {
      indexAxis: "y",
      maintainAspectRatio: false,
      layout: { padding: { right: 36 } },  // 막대 끝 숫자 자리
      scales: {
        x: { display: false, beginAtZero: true },  // 눈금 대신 막대 끝에 숫자 표시
        y: { grid: { display: false }, ticks: { autoSkip: false, color: p.muted } },  // 키워드 이름을 건너뛰지 않고 모두 표시
      },
      plugins: { legend: { display: false }, title: { display: true, text: "핵심 키워드 Top 5", align: "start", padding: { top: 0, bottom: 4 } } },
    },
    plugins: [barValueLabels],
  });

  view.reviews = [...reviews, ...view.surveyComments];
  renderReviewList();

  setStatus("voc-source", source.text, source.status, source.title || "");
  const platforms = [...new Set(reviews.map((r) => PLATFORM_LABEL[r.platform] || r.platform))].join("·");
  setText("voc-meta", `출처: ${source.meta} · 수집처: ${platforms} · 표본: ${sampleTitle}건 · 범위: 베트남`);
}

// 리뷰 목록(확대 화면): 언어(한국어 / 베트남어 / 둘 다) · 감성 드롭다운 · 10건씩 페이지 넘김
function renderReviewList() {
  // 만족도는 박스 없이 작은 글씨로: 만족 녹색 · 보통 회색 · 불만 붉은색
  const mood = (text, tone) => el("span", { text, className: `kpi-mood kpi-mood-${tone}` });
  const tone = { Positive: "good", Neutral: "mid", Negative: "bad" };
  const list = view.reviewFilter === "all" ? view.reviews : view.reviews.filter((r) => r.sentiment === view.reviewFilter);
  const label = view.reviewFilter === "all" ? "전체" : SENTIMENT_LABEL[view.reviewFilter];
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
      el("span", { text: PLATFORM_LABEL[r.platform] || r.platform }),
      r.sentiment ? mood(SENTIMENT_LABEL[r.sentiment], tone[r.sentiment]) : mood("미분류", "mid"),
      el("span", { text: r.keyword_tag || "" }),
    ]);
    const ko = el("p", { className: "kpi-review-ko", text: r.translated_kr || r.raw_text_vn });
    const vi = el("p", { className: "kpi-review-vi", text: r.raw_text_vn });
    vi.lang = "vi";
    const body = view.reviewLang === "ko" ? [ko] : view.reviewLang === "vi" ? [vi] : [ko, vi];
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
  const strip = $("qr-strip");
  const step = (label, value) => el("span", {}, [document.createTextNode(`${label} `), el("b", { text: value })]);
  const arrow = () => el("span", { text: "→", className: "kpi-arrow" });
  strip.replaceChildren(
    step("팜플렛 QR 스캔", num(qr.qr_scans)),
    arrow(),
    step("Zalo 친구 추가", num(qr.zalo_follows)),
    arrow(),
    step("설문 응답", `${num(qr.survey_responses)} (${pct(qr.response_rate_percent)})`),
    ...(qr.survey.overall_avg != null ? [el("span", { text: "·", className: "kpi-arrow" }), step("만족도 평균", `${qr.survey.overall_avg.toFixed(1)} / 5`)] : []),
  );
  strip.title = `배포 팜플렛 ${num(qr.pamphlets)}장 · 스캔율 ${pct(qr.scan_rate_percent)} · 친구 추가율 ${pct(qr.follow_rate_percent)}`;

  view.surveyVoc = qr.survey.voc || null;

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
  renderVoc({ ...ai, sample_size: merged.length }, merged, {
    text: "OpenAI 분석 · 검수 전",
    status: "live",
    title: `${ai.model} · ${ai.analyzed_at} · AI 번역·분류는 사람이 검수하기 전 결과입니다.`,
    meta: `OpenAI ${ai.model} 분석(${ai.analyzed_at}, 검수 전) · 원문은 시연 리뷰`,
  });
  // 'AI 요약' 제목을 첫 문장 앞에 붙이고, 문장마다 줄을 나눠 짧게 읽히도록 표시합니다.
  const summary = (ai.summary_kr || "").trim().replace(/([.!?。])\s+/g, "$1\n");
  const box = $("voc-summary");
  box.replaceChildren(el("strong", { text: "AI 요약 · 검수 전 " }), document.createTextNode(summary || "요약이 비어 있습니다."));
  box.hidden = false;
}

// ---------- 집행 시뮬레이션 (화면에서만 계산, 저장하지 않음) ----------
// 단일 입력 폼: 집행 유형(KOL 협찬 / 공식 매체 광고)에 따라 입력 칸·매체 목록·예상 ROAS 기본값이 바뀝니다.
// 상태는 sim 하나에 모읍니다: 서버 데이터 · 집행 유형 · ROAS 직접 수정 여부 · 집행 예정 목록.
const sim = { data: null, type: "kol", roasEdited: false, items: [], nextId: 1 };
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
const toKrw = (amount, unit) => (unit === "KRW" ? Math.round(amount) : Math.round((amount * sim.data.base_rate) / 100));
const toVnd = (amount, unit) => (unit === "VND" ? Math.round(amount) : Math.round((amount * 100) / sim.data.base_rate));
const estRevenue = (cost, roas) => (roas == null ? null : Math.round((cost * roas) / 100));

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

// 예상 ROAS 기본값: 사용자가 직접 고치지 않았을 때만 채웁니다.
function fillDefaultRoas() {
  const m = currentMedia();
  const roas = m ? simRoas(m.roasFrom) : null;
  const label = m && sim.data?.channels.find((c) => c.channel === m.roasFrom)?.label;
  if (!sim.roasEdited) simForm().elements.roas.value = roas == null ? "" : String(roas);
  setText(
    "sim-roas-help",
    roas == null ? "실적이 없는 매체입니다. 예상 ROAS를 입력하면 예상 매출을 계산합니다." : `기본값: ${label} 실적 ${pct(roas)} (직접 수정 가능)`,
  );
}

function renderSimOptions() {
  const d = sim.data;
  const inf = d.influencers;
  const list = d.influencer_list || [];
  // 계정 자동완성: 인플루언서 탭 리스트(단가가 없어도 표시) + 단가 목록. 보조 글씨는 대표 매체 · 팔로워 · 상태 · 단가
  const names = [...new Set([...list.map((x) => x.influencer), ...inf.options.map((o) => o.influencer)])];
  $("sim-accounts").replaceChildren(...names.map((name) => {
    const entry = list.find((x) => x.influencer === name);
    const quotes = inf.options.filter((o) => o.influencer === name);
    const parts = entry ? [entry.platform, entry.followers != null ? `팔로워 ${followersText(entry.followers)}` : "", entry.status_label] : [];
    parts.push(quotes.length
      ? quotes.map((o) => `${o.platform} ${o.content_format} ${o.price_type_label} ${krwMan(toKrw(o.amount_vnd, "VND"))}`).join(" / ")
      : "단가 미등록");
    const opt = el("option");
    opt.value = name;
    opt.label = parts.filter(Boolean).join(" · ");
    return opt;
  }));
  setText("sim-rate-help", `1원 ≈ ${(100 / d.base_rate).toFixed(1)} VND (편성 기준 환율 ${d.base_rate.toFixed(2)}원/100 VND)`);
  setText(
    "sim-source",
    `KOL 자동완성: ${list.length ? `인플루언서 탭 리스트 ${num(list.length)}명 · ` : ""}${inf.note}${inf.status === "demo" ? " · 시연" : ""}`,
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

const followersText = (n) => (n >= 10000 ? `${(n / 10000).toFixed(1).replace(/\.0$/, "")}만` : num(n));

function applyQuote() {
  const f = simForm().elements;
  const quotes = accountQuotes();
  const entry = accountListEntry();
  if (!quotes.length) {
    // 리스트에는 있지만 단가가 없는 인플루언서: 대표 매체만 맞추고 예산은 직접 입력
    if (entry && SIM_MEDIA.kol.some((m) => m.value === entry.platform)) f.media.value = entry.platform;
    onMediaChange();
    const info = entry ? [entry.platform, entry.followers != null ? `팔로워 ${followersText(entry.followers)}` : "", entry.status_label].filter(Boolean).join(" · ") : "";
    return setText("sim-quote-help", entry ? `인플루언서 탭 리스트: ${info} · 단가 미등록 — 집행 예산을 직접 입력해 주세요.` : "");
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
  if (!q) {
    if (!accountQuotes().length && accountListEntry()) return;  // 리스트만 있는 계정: applyQuote의 '단가 미등록' 안내 유지
    return setText("sim-quote-help", accountQuotes().length ? "이 매체·형식의 단가는 인플루언서 탭에 없습니다. 집행 예산을 직접 입력해 주세요." : "");
  }
  f.amount.value = (f.unit.value === "KRW" ? toKrw(q.amount_vnd, "VND") : q.amount_vnd).toLocaleString("en-US");
  setText("sim-quote-help", `인플루언서 탭 ${q.price_type_label} ${num(q.amount_vnd)} VND (약 ${krwMan(toKrw(q.amount_vnd, "VND"))}) 불러옴`);
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
        it.roas == null ? "—" : pct(it.roas),
        it.revenue_krw == null ? "—" : krwMan(it.revenue_krw),
        remove,
      ]);
    });
    subtotalRows.push(rows.length);
    rows.push([`${SIM_TYPE_LABEL[type]} 소계`, `${list.length}건`, "", cost(sumOf(list, "cost_krw"), sumOf(list, "cost_vnd")), "", krwMan(sumOf(list, "revenue_krw")), ""]);
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

  const revenue = sumOf(sim.items, "revenue_krw");
  if (sim.items.length && after < 0) {
    const box = $("sim-summary");
    box.replaceChildren(
      warning(`예산 초과 ${krwMan(-after)} — 항목을 줄이거나 예산 조정이 필요합니다.`),
      document.createTextNode(` (참고 예상 매출 ${krwMan(revenue)}, 예상 ROAS 기준)`),
    );
    box.hidden = false;
    return;
  }
  setText(
    "sim-summary",
    !sim.items.length
      ? "항목을 추가하면 집행 후 남는 예산을 바로 계산합니다."
      : `집행 후 총 예산의 ${pct((after / total) * 100)}가 남습니다. 참고 예상 매출 ${krwMan(revenue)} (예상 ROAS 기준)`,
  );
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
  const roasText = f.roas.value.trim();
  const roas = roasText === "" ? null : Number(roasText.replace(/[^\d.]/g, ""));
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
  f.formatName.value = "";
  f.amount.value = "";
  if (custom) f.mediaName.value = "";
  setText("sim-quote-help", "");
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

// ---------- 블록 확대 ----------
function resizeCharts() {
  requestAnimationFrame(() => Object.values(charts).forEach((c) => c.resize()));
}

// 4개 블록 높이를 예산 블록(기본 화면) 높이에 맞춥니다. 넘치는 내용은 블록 안에서 스크롤합니다.
function syncBlockHeight() {
  const board = $("board");
  const budget = board.querySelector('[data-kpi-panel="budget"]');
  if (!budget || budget.classList.contains("is-expanded")) return;
  board.classList.remove("is-synced");
  board.style.setProperty("--kpi-block-h", `${Math.ceil(budget.getBoundingClientRect().height)}px`);
  board.classList.add("is-synced");
  resizeCharts();
}

let syncFrame = 0;
window.addEventListener("resize", () => {
  cancelAnimationFrame(syncFrame);
  syncFrame = requestAnimationFrame(syncBlockHeight);
});

function setExpanded(panel) {
  root.querySelectorAll(".kpi-panel.is-expanded").forEach((p) => p.classList.remove("is-expanded"));
  if (panel) panel.classList.add("is-expanded");
  root.querySelector(".kpi-backdrop").hidden = !panel;
  if (!panel) syncBlockHeight();
  root.querySelectorAll(".kpi-expand").forEach((btn) => {
    const open = btn.closest(".kpi-panel") === panel;
    btn.setAttribute("aria-label", open ? "원래 크기로" : "블록 확대");
    btn.title = open ? "닫기 (Esc)" : "확대";
  });
  resizeCharts();
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

async function loadSummary() {
  try {
    const data = await getJson(API.summary);
    view.summary = data;
    renderScorecards(data);
    renderBudget(data);
    renderRoas(data);
    renderGa4(data);
    syncBlockHeight();
  } catch (err) {
    root.querySelector(".kpi-legend-note").hidden = false;
    root.querySelector(".kpi-legend-note").textContent = `KPI 데이터를 불러오지 못했습니다: ${err.message}`;
  }
}

async function loadVoc() {
  try {
    const data = await getJson(API.voc);
    vocReviews = data.reviews;
    view.surveyComments = data.survey_comments || [];
    renderQr(data.qr);
    if (data.ai) showVocAi(vocReviews, data.ai);
    else renderVoc(data, vocReviews, { text: "시연 분류", status: "demo", meta: "시연 리뷰·시연 분류" });
    // 기본값: 베트남어 리뷰를 AI가 한국어로 다듬어 보여 줍니다. 키가 있으면 처음 한 번 자동 실행(서버가 결과 보관).
    if (!data.ai && data.ai_available && !vocAutoTried) {
      vocAutoTried = true;
      setText("voc-summary", "AI가 베트남어 리뷰를 한국어로 다듬는 중…");
      analyzeVoc(root.querySelector('[data-kpi-action="voc-analyze"]'));
    }
  } catch (err) {
    showError("voc-error", `VOC 데이터를 불러오지 못했습니다: ${err.message}`);
  }
}

let vocAutoTried = false;

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
  showError("voc-error", "");
  try {
    const data = await getJson(API.analyze, { method: "POST" });
    showVocAi(vocReviews, data.ai);
  } catch (err) {
    showError("voc-error", `${err.message}`);
    setText("voc-summary", "");
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
  } else if (action === "review-page") {
    setReviewPage(Number(target.dataset.page));
  } else if (action === "reset-order") {
    applyOrder(DEFAULT_ORDER);
    saveOrder();
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
  if (event.target.matches('[data-kpi="sim-unit"]')) syncQuote();
  if (event.target.matches('[data-kpi-action="review-lang"]')) setReviewLang(event.target.value);
  if (event.target.matches('[data-kpi-action="review-filter"]')) setReviewFilter(event.target.value);
});

root.addEventListener("input", (event) => {
  if (event.target.matches("[data-kpi-money]")) formatMoneyInput(event.target);
  if (event.target.matches('[data-kpi="sim-account"]')) {
    if (accountQuotes().length || accountListEntry()) applyQuote();
    else { fillFormats(); setText("sim-quote-help", ""); }  // 탭에 없는 계정이면 매체 기본 형식만
  }
  if (event.target.matches('[data-kpi="sim-roas"]')) sim.roasEdited = event.target.value.trim() !== "";
});

root.addEventListener("submit", (event) => {
  if (!event.target.matches('[data-kpi="sim-form"]')) return;
  event.preventDefault();
  if (sim.data) addSimItem(event.target);
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") setExpanded(null);
});

chartNotice();
loadOrder();
document.fonts?.ready.then(syncBlockHeight);  // 글꼴이 늦게 적용되면 예산 블록 높이가 바뀌므로 다시 맞춤
setGa4Visible(true);
loadSummary();
loadVoc();
loadSimulator();
