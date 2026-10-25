// 공통 사이드바. 국가 표시(Vietnam Market)는 안내용이며 데이터 요청을 변경하지 않습니다.
const app = document.querySelector('[data-app]');
const shell = document.querySelector('[data-ui-shell]');
if (app && shell) {
  const toggle = shell.querySelector('[data-sidebar-toggle]');
  const backdrop = app.querySelector('[data-sidebar-backdrop]');
  const narrow = matchMedia('(max-width: 900px)');
  const storageKey = 'hjs-sidebar-collapsed';
  let messages = { collapse_sidebar: '사이드바 접기', expand_sidebar: '사이드바 펼치기' };
  let collapsed = narrow.matches;
  try {
    const saved = localStorage.getItem(storageKey);
    if (saved === 'true' || saved === 'false') collapsed = saved === 'true';
  } catch { /* 저장소를 사용할 수 없어도 토글은 동작합니다. */ }
  const render = () => {
    app.dataset.sidebar = collapsed ? 'collapsed' : 'expanded';
    toggle.setAttribute('aria-expanded', String(!collapsed));
    const label = messages[collapsed ? 'expand_sidebar' : 'collapse_sidebar'];
    toggle.setAttribute('aria-label', label);
    toggle.title = label;
    backdrop.hidden = collapsed || !narrow.matches;
  };
  const setCollapsed = (value) => {
    collapsed = value;
    render();
    try { localStorage.setItem(storageKey, String(collapsed)); } catch { /* 선택은 현재 화면에 적용됩니다. */ }
  };
  toggle.addEventListener('click', () => setCollapsed(!collapsed));
  backdrop.addEventListener('click', () => { setCollapsed(true); toggle.focus(); });
  shell.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !collapsed) { setCollapsed(true); toggle.focus(); }
  });
  narrow.addEventListener('change', () => {
    if (narrow.matches) collapsed = true;
    render();
  });
  render();

  // 계정 설정 창: 테마는 이 브라우저에 저장하고, 언어는 ?lang= 값을 바꿔 다시 불러옵니다.
  const dialog = app.querySelector('[data-settings-dialog]');
  const themeKey = 'hjs-theme';
  app.querySelector('[data-settings-open]').addEventListener('click', () => {
    const current = document.documentElement.dataset.theme;
    dialog.querySelectorAll('[data-theme-input]').forEach((input) => { input.checked = input.value === current; });
    dialog.showModal();
  });
  dialog.addEventListener('click', (event) => { if (event.target === dialog) dialog.close(); });
  dialog.addEventListener('change', (event) => {
    const input = event.target;
    if (input.matches('[data-theme-input]')) {
      document.documentElement.dataset.theme = input.value;
      try { localStorage.setItem(themeKey, input.value); } catch { /* 선택은 현재 화면에 적용됩니다. */ }
    } else if (input.matches('[data-lang-input]')) {
      const url = new URL(location.href);
      url.searchParams.set('lang', input.value);
      location.assign(url);
    }
  });

  // 국가 표시를 누르면 다른 국가는 추후 지원 예정이라는 안내창을 가운데에 띄웁니다.
  const marketDialog = app.querySelector('[data-market-dialog]');
  shell.querySelector('[data-market-open]').addEventListener('click', () => marketDialog.showModal());
  marketDialog.addEventListener('click', (event) => { if (event.target === marketDialog) marketDialog.close(); });

  try {
    const response = await fetch(shell.dataset.localeUrl);
    if (!response.ok) throw new Error('Locale unavailable');
    messages = { ...messages, ...await response.json() };
    [shell, dialog, marketDialog].forEach((root) => root.querySelectorAll('[data-ui-text]').forEach((node) => {
      const text = messages[node.dataset.uiText];
      if (typeof text === 'string') node.textContent = text;
    }));
    app.querySelectorAll('[data-ui-label]').forEach((node) => {
      const text = messages[node.dataset.uiLabel];
      if (typeof text === 'string') {
        node.setAttribute('aria-label', text);
        if (node.tagName === 'A' || node.hasAttribute('title')) node.title = text;
      }
    });
    shell.lang = document.documentElement.dataset.uiLang;
    dialog.lang = shell.lang;
    marketDialog.lang = shell.lang;
    render();
  } catch { /* 번역 요청 실패 시 한국어 메뉴와 토글을 유지합니다. */ }
}
