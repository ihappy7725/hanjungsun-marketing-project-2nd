// 공통 레이아웃 스크립트 [PM1 상준만 수정]
// 사이드바 시계: 한국 시간(기준) + 베트남 시간(보조) — README 7장 시간대
(() => {
  const clocks = document.querySelectorAll("[data-clock]");
  const tick = () => {
    const now = new Date();
    clocks.forEach((el) => {
      el.textContent = new Intl.DateTimeFormat("ko-KR", {
        timeZone: el.dataset.clock,
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      }).format(now);
    });
  };
  tick();
  setInterval(tick, 30000);
})();
