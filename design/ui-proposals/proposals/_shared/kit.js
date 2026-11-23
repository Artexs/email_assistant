// Shared mockup kit: icons, a hash router, the light/dark switch and the review toolbar.
// A proposal calls KIT.start({ screens: { login: () => html, ... }, after?: (id) => void }).
// URL: index.html#approvals · ?theme=dark forces dark · ?shot=1 hides the toolbar (for screenshots).
(function () {
  const P = {
    check: '<path d="M20 6 9 17l-5-5"/>',
    x: '<path d="M18 6 6 18M6 6l12 12"/>',
    eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',
    activity: '<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>',
    users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',
    filter: '<path d="M3 6h18M7 12h10M10 18h4"/>',
    inbox: '<path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11Z"/>',
    chart: '<path d="M3 3v18h18"/><path d="M7 16v-4M12 16V8M17 16v-7"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z"/>',
    alert: '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4M12 17h.01"/>',
    reply: '<path d="M9 17 4 12l5-5"/><path d="M20 18v-2a4 4 0 0 0-4-4H4"/>',
    info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/>',
    bell: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>',
    ban: '<circle cx="12" cy="12" r="10"/><path d="m4.9 4.9 14.2 14.2"/>',
    help: '<circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3M12 17h.01"/>',
    undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>',
    pencil: '<path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/>',
    send: '<path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/>',
    clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
    search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/>',
    moon: '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>',
    chevron: '<path d="m9 18 6-6-6-6"/>',
    chevronDown: '<path d="m6 9 6 6 6-6"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    mail: '<rect width="20" height="16" x="2" y="4" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/>',
    shield: '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1Z"/>',
    sparkle: '<path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2 2M16 16l2 2M6 18l2-2M16 8l2-2"/>',
    home: '<path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/><path d="M9 22V12h6v10"/>',
    pause: '<rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/>',
    key: '<circle cx="7.5" cy="15.5" r="5.5"/><path d="m21 2-9.6 9.6M15.5 7.5l3 3L22 7l-3-3"/>',
    menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
    lock: '<rect width="18" height="11" x="3" y="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
    more: '<circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/>',
    arrowLeft: '<path d="m12 19-7-7 7-7M19 12H5"/>',
    telegram: '<path d="m22 3-20 8 7 2 2 7 4-5 5 4Z"/><path d="m9 13 13-10"/>',
  };
  const icon = (name, size = 18, extra = "") =>
    `<svg class="i i-${name}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" ${extra}>${P[name] || ""}</svg>`;
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  const nl = (s) => esc(s).replace(/\n/g, "<br>");
  const cat = (id) => window.DATA.categories[id] || { label: id, icon: "help" };
  const initials = (name) => name.split(/\s+/).filter((w) => /^[A-ZĄĆĘŁŃÓŚŹŻ]/.test(w)).slice(0, 2).map((w) => w[0]).join("");

  const params = new URLSearchParams(location.search);
  const shot = params.has("shot");
  function theme() {
    const forced = params.get("theme") || (!shot && localStorage.getItem("mock-theme"));
    if (forced) return forced;
    return matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  function applyTheme() { document.documentElement.dataset.theme = theme(); }
  applyTheme();
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", applyTheme);

  const SCREEN_LABELS = { today: "Home", login: "Sign in", onboarding: "Onboarding", approvals: "Approvals", empty: "Empty state", review: "Review", report: "Report", activity: "Activity", delegations: "Delegations", rules: "Rules", mailboxes: "Mailboxes", settings: "Settings", stats: "Stats" };

  function start(opts) {
    const ids = Object.keys(opts.screens);
    const root = document.getElementById("app");
    function go() {
      const id = location.hash.slice(1) || opts.home || ids[0];
      const fn = opts.screens[id] || opts.screens[ids[0]];
      root.innerHTML = fn();
      document.body.dataset.screen = id;
      window.scrollTo(0, 0);
      if (opts.after) opts.after(id);
      bar(id);
    }
    function bar(active) {
      if (shot) return;
      let el = document.getElementById("mock-bar");
      if (!el) {
        el = document.createElement("div"); el.id = "mock-bar";
        el.setAttribute("style", "position:fixed;left:50%;bottom:14px;transform:translateX(-50%);z-index:9999;display:flex;gap:4px;padding:5px;border-radius:12px;background:#111c;backdrop-filter:blur(8px);font:12px/1 system-ui,sans-serif;box-shadow:0 6px 24px #0005;max-width:96vw;overflow-x:auto");
        document.body.append(el);
      }
      const b = (label, on, attrs) => `<button ${attrs} style="all:unset;cursor:pointer;padding:7px 10px;border-radius:8px;color:${on ? "#111" : "#eee"};background:${on ? "#fff" : "transparent"};white-space:nowrap">${label}</button>`;
      el.innerHTML = `<a href="../../index.html" style="all:unset;cursor:pointer;padding:7px 10px;color:#aaa">← Gallery</a>` +
        ids.map((id) => b(SCREEN_LABELS[id] || id, id === active, `data-go="${id}"`)).join("") +
        b(document.documentElement.dataset.theme === "dark" ? "☀ Light" : "☾ Dark", false, "data-theme-toggle");
      el.querySelectorAll("[data-go]").forEach((x) => (x.onclick = () => (location.hash = x.dataset.go)));
      el.querySelector("[data-theme-toggle]").onclick = () => {
        localStorage.setItem("mock-theme", document.documentElement.dataset.theme === "dark" ? "light" : "dark");
        applyTheme(); bar(active);
      };
    }
    // Links inside a mockup: any element with data-go switches the screen.
    document.addEventListener("click", (e) => {
      const t = e.target.closest("[data-go]");
      if (t && !t.closest("#mock-bar")) { e.preventDefault(); location.hash = t.dataset.go; }
    });
    addEventListener("hashchange", go);
    go();
  }
  window.KIT = { icon, esc, nl, cat, initials, start, shot };
})();
