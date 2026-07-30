// DOM primitives for the studio UI — element builder, the icon set, popover
// menus, tooltips and toasts. Motion follows the design-engineering rules the
// app is styled by: enter with ease-out under 200ms, exit faster than enter,
// scale from the trigger's origin, never from zero, transform/opacity only.

export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null) continue;
    if (k === "class") el.className = v;
    else if (k === "style" && typeof v === "object") Object.assign(el.style, v);
    else if (k.startsWith("on") && typeof v === "function")
      el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === "dataset") Object.assign(el.dataset, v);
    else if (k in el && k !== "list" && typeof v !== "string") el[k] = v;
    else el.setAttribute(k, v);
  }
  for (const c of children.flat(9)) {
    if (c == null || c === false) continue;
    el.append(c.nodeType ? c : document.createTextNode(c));
  }
  return el;
}

// ---- icons -------------------------------------------------------------------
// 16 x 16, stroke 1.5, round caps — one coherent hand-drawn set.

const P = (d, extra = "") =>
  `<svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">${extra}<path d="${d}" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const F = (inner) =>
  `<svg viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg">${inner}</svg>`;

export const ICONS = {
  play: F(`<path d="M5 3.2c0-.8.9-1.3 1.6-.9l7 4.3c.7.4.7 1.4 0 1.8l-7 4.3c-.7.4-1.6-.1-1.6-.9V3.2Z" fill="currentColor"/>`),
  pause: F(`<rect x="3.6" y="2.6" width="2.9" height="10.8" rx="1" fill="currentColor"/><rect x="9.5" y="2.6" width="2.9" height="10.8" rx="1" fill="currentColor"/>`),
  skipBack: F(`<rect x="3" y="3" width="1.8" height="10" rx="0.9" fill="currentColor"/><path d="M13 3.9c0-.8-.9-1.3-1.6-.9L6.6 7.1c-.6.4-.6 1.3 0 1.7l4.8 4.2c.7.5 1.6 0 1.6-.9V3.9Z" fill="currentColor"/>`),
  loop: P("M2.8 6.4a4.4 4.4 0 0 1 7.8-1.9l1.6 1.9M13.2 9.6a4.4 4.4 0 0 1-7.8 1.9L3.8 9.6M12.2 3.4v3h-3M3.8 12.6v-3h3"),
  plus: P("M8 3.4v9.2M3.4 8h9.2"),
  minus: P("M3.4 8h9.2"),
  fit: P("M6 2.8H4.2A1.4 1.4 0 0 0 2.8 4.2V6M10 2.8h1.8a1.4 1.4 0 0 1 1.4 1.4V6M6 13.2H4.2a1.4 1.4 0 0 1-1.4-1.4V10M10 13.2h1.8a1.4 1.4 0 0 0 1.4-1.4V10"),
  camera: P("M2.8 5.4A1.6 1.6 0 0 1 4.4 3.8h5.2a1.6 1.6 0 0 1 1.6 1.6v5.2a1.6 1.6 0 0 1-1.6 1.6H4.4a1.6 1.6 0 0 1-1.6-1.6V5.4ZM11.2 7.2l2.9-1.9a.4.4 0 0 1 .7.3v4.8a.4.4 0 0 1-.7.3l-2.9-1.9"),
  diamond: F(`<path d="M7.3 2.2a1 1 0 0 1 1.4 0l5.1 5.1a1 1 0 0 1 0 1.4l-5.1 5.1a1 1 0 0 1-1.4 0L2.2 8.7a1 1 0 0 1 0-1.4l5.1-5.1Z" fill="currentColor"/>`),
  diamondO: P("M7.3 2.6a1 1 0 0 1 1.4 0l4.7 4.7a1 1 0 0 1 0 1.4l-4.7 4.7a1 1 0 0 1-1.4 0L2.6 8.7a1 1 0 0 1 0-1.4l4.7-4.7Z"),
  trash: P("M3.2 4.4h9.6M6.4 4.4V3.2a1 1 0 0 1 1-1h1.2a1 1 0 0 1 1 1v1.2M5 4.4l.5 8a1.2 1.2 0 0 0 1.2 1.1h2.6a1.2 1.2 0 0 0 1.2-1.1l.5-8M6.7 7v3.8M9.3 7v3.8"),
  copy: P("M6 6a1.5 1.5 0 0 1 1.5-1.5h4A1.5 1.5 0 0 1 13 6v4a1.5 1.5 0 0 1-1.5 1.5h-4A1.5 1.5 0 0 1 6 10V6ZM10 4.3V4a1.5 1.5 0 0 0-1.5-1.5h-4A1.5 1.5 0 0 0 3 4v4A1.5 1.5 0 0 0 4.5 9.5H5"),
  upload: P("M8 10.2V2.9M5.2 5.6 8 2.8l2.8 2.8M2.8 10.4v1.4a1.4 1.4 0 0 0 1.4 1.4h7.6a1.4 1.4 0 0 0 1.4-1.4v-1.4"),
  download: P("M8 2.8v7.3M5.2 7.4 8 10.2l2.8-2.8M2.8 10.4v1.4a1.4 1.4 0 0 0 1.4 1.4h7.6a1.4 1.4 0 0 0 1.4-1.4v-1.4"),
  folder: P("M2.8 4.6a1.4 1.4 0 0 1 1.4-1.4h2.1c.4 0 .8.2 1 .5l.8.9h4.5a1.4 1.4 0 0 1 1.4 1.4v5.4a1.4 1.4 0 0 1-1.4 1.4H4.2a1.4 1.4 0 0 1-1.4-1.4V4.6Z"),
  file: P("M4 3.4A1.4 1.4 0 0 1 5.4 2h3.4L12 5.2v7.4a1.4 1.4 0 0 1-1.4 1.4H5.4A1.4 1.4 0 0 1 4 12.6V3.4ZM8.6 2v3.4H12"),
  x: P("M4.2 4.2l7.6 7.6M11.8 4.2l-7.6 7.6"),
  chevronDown: P("M4.2 6.2 8 10l3.8-3.8"),
  chevronRight: P("M6.2 4.2 10 8l-3.8 3.8"),
  check: P("M3.2 8.4l3 3 6.6-6.8"),
  grip: F(`<g fill="currentColor"><circle cx="6" cy="4" r="1.05"/><circle cx="10" cy="4" r="1.05"/><circle cx="6" cy="8" r="1.05"/><circle cx="10" cy="8" r="1.05"/><circle cx="6" cy="12" r="1.05"/><circle cx="10" cy="12" r="1.05"/></g>`),
  film: P("M2.8 4.2a1.4 1.4 0 0 1 1.4-1.4h7.6a1.4 1.4 0 0 1 1.4 1.4v7.6a1.4 1.4 0 0 1-1.4 1.4H4.2a1.4 1.4 0 0 1-1.4-1.4V4.2ZM5.6 2.8v10.4M10.4 2.8v10.4M2.8 5.7h2.8M2.8 8h10.4M2.8 10.3h2.8M10.4 5.7h2.8M10.4 10.3h2.8"),
  image: P("M2.8 4.2a1.4 1.4 0 0 1 1.4-1.4h7.6a1.4 1.4 0 0 1 1.4 1.4v7.6a1.4 1.4 0 0 1-1.4 1.4H4.2a1.4 1.4 0 0 1-1.4-1.4V4.2ZM3.4 11.2l3-3.1a1 1 0 0 1 1.4 0l4.6 4.5M10 9.2l1-1a1 1 0 0 1 1.4 0l.8.8", `<circle cx="6.1" cy="5.9" r="1.1" fill="currentColor"/>`),
  wave: P("M2.2 8c1.4-3.6 2.6-3.6 4 0s2.2 3.6 3.6 0 2.6-3.6 4 0"),
  type: P("M3.4 5V3.2h9.2V5M8 3.2v9.6M6 12.8h4"),
  hourglass: P("M4.4 2.8h7.2M4.4 13.2h7.2M5 2.8v1.6c0 2 3 2.6 3 3.6s-3 1.6-3 3.6v1.6M11 2.8v1.6c0 2-3 2.6-3 3.6s3 1.6 3 3.6v1.6"),
  curve: P("M2.6 12.8C6.4 12.8 9.6 3.2 13.4 3.2"),
  orderRows: P("M3 4.4h7M3 8h10M3 11.6h5"),
  steps: P("M2.8 12.6h3.4V9.2h3.4V5.8H13V2.8"),
  squiggle: P("M2.4 10.6c1.6-4.4 3-4.4 4.4-1s2.8 3.4 4.4-1 2.2-3.2 2.4-2.4"),
  amp: P("M2.4 8h11.2M5.4 8c1.2-3.4 2.4-3.4 3.6 0s2.4 3.4 3.6 0", ""),
  scatterDots: F(`<g fill="currentColor"><circle cx="7.6" cy="8.2" r="1.2"/><circle cx="3.4" cy="4.6" r="1"/><circle cx="12.4" cy="4" r="1"/><circle cx="12.8" cy="11.8" r="1"/><circle cx="3.8" cy="12.2" r="1"/></g>`),
  swirl: P("M8 8m3.8 0a3.8 3.8 0 1 1-7.6 0 5.4 5.4 0 0 1 5.4-5.4 7 7 0 0 1 4.4 1.6"),
  alignL: P("M3 3.4v9.2M6 5.6h7M6 10.4h4.4"),
  alignC: P("M8 3.4v9.2M4.5 5.6h7M5.8 10.4h4.4"),
  alignR: P("M13 3.4v9.2M6 5.6h7M8.6 10.4h4.4"),
  arrowH: P("M2.6 8h10.8M5.2 5.4 2.6 8l2.6 2.6M10.8 5.4 13.4 8l-2.6 2.6"),
  arrowV: P("M8 2.6v10.8M5.4 5.2 8 2.6l2.6 2.6M5.4 10.8 8 13.4l2.6-2.6"),
  gridCell: P("M3 3h10v10H3zM3 8h10M8 3v10"),
  speed: P("M2.6 8.6a5.4 5.4 0 0 1 10.8 0M8 8.6 10.8 5.2", `<circle cx="8" cy="8.8" r="1" fill="currentColor"/>`),
  spreadH: P("M8 3.4v9.2M5.4 5.6 3 8l2.4 2.4M10.6 5.6 13 8l-2.4 2.4"),
  box: P("M8 2.6 13.2 5.4v5.2L8 13.4 2.8 10.6V5.4L8 2.6ZM2.8 5.4 8 8.2l5.2-2.8M8 8.2v5.2"),
  wand: P("M9.4 2.8l3.8 3.8M11.3 4.7 3.4 12.6a1 1 0 0 1-1.4-1.4l7.9-7.9M10.3 1.8l.4 1.5 1.5.4-1.5.4-.4 1.5-.4-1.5-1.5-.4 1.5-.4.4-1.5"),
  eye: P("M2 8s2.2-4 6-4 6 4 6 4-2.2 4-6 4-6-4-6-4Z", `<circle cx="8" cy="8" r="1.7" stroke="currentColor" stroke-width="1.5" fill="none"/>`),
  target: P("M8 2.4v2M8 11.6v2M2.4 8h2M11.6 8h2", `<circle cx="8" cy="8" r="3.4" stroke="currentColor" stroke-width="1.5" fill="none"/><circle cx="8" cy="8" r="0.9" fill="currentColor"/>`),
  clock: P("M8 5v3.2l2 1.4", `<circle cx="8" cy="8" r="5.6" stroke="currentColor" stroke-width="1.5" fill="none"/>`),
  spinner: F(`<g fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M8 2.4A5.6 5.6 0 1 1 2.4 8" /></g>`),
};

export function icon(name, cls = "") {
  const s = h("span", { class: `icon ${cls}` });
  s.innerHTML = ICONS[name] || "";
  return s;
}

// ---- tooltips ------------------------------------------------------------------
// One shared bubble. First hover waits; once a tooltip has shown, adjacent
// hovers open instantly (and skip the animation) so toolbars feel quick.

let tipEl = null;
let tipTimer = 0;
let tipShownAt = 0;
let tipVisible = false;

function ensureTip() {
  if (!tipEl) {
    tipEl = h("div", { class: "tooltip" });
    document.body.append(tipEl);
  }
  return tipEl;
}

export function tip(el, text, { placement = "top" } = {}) {
  if (!text) return el;
  el.addEventListener("pointerenter", (e) => {
    if (e.pointerType === "touch") return;
    const recent = performance.now() - tipShownAt < 700;
    clearTimeout(tipTimer);
    tipTimer = setTimeout(() => showTip(el, text, placement, recent), recent ? 0 : 550);
  });
  el.addEventListener("pointerleave", hideTip);
  el.addEventListener("pointerdown", hideTip);
  return el;
}

function showTip(anchor, text, placement, instant) {
  if (!document.body.contains(anchor)) return;
  const t = ensureTip();
  t.textContent = typeof text === "function" ? text() : text;
  t.classList.toggle("instant", instant);
  t.classList.add("on");
  tipVisible = true;
  const r = anchor.getBoundingClientRect();
  const tr = t.getBoundingClientRect();
  let x = r.left + r.width / 2 - tr.width / 2;
  let y = placement === "top" ? r.top - tr.height - 7 : r.bottom + 7;
  if (y < 6) y = r.bottom + 7;
  x = Math.min(Math.max(6, x), window.innerWidth - tr.width - 6);
  t.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
}

export function hideTip() {
  clearTimeout(tipTimer);
  if (tipVisible) tipShownAt = performance.now();
  tipVisible = false;
  if (tipEl) tipEl.classList.remove("on");
}

// ---- popover menus ----------------------------------------------------------------

let openMenu = null;

export function closeMenus() {
  if (openMenu) { openMenu.close(); openMenu = null; }
}

/**
 * items: {label, icon?, hint?, danger?, checked?, disabled?, action}
 *        or "-" for a separator.
 * anchor: element (drops below, origin-aware) or {x, y} (context menu).
 */
export function showMenu(items, anchor, { minWidth = 148, align = "left" } = {}) {
  closeMenus();
  hideTip();
  const menu = h("div", { class: "menu", role: "menu" });
  const list = [];
  for (const it of items) {
    if (it === "-") { menu.append(h("div", { class: "menu-sep" })); continue; }
    const row = h(
      "button",
      { class: `menu-item${it.danger ? " danger" : ""}`, disabled: !!it.disabled },
      it.checked !== undefined
        ? h("span", { class: "menu-check" }, it.checked ? icon("check") : "")
        : (it.icon ? icon(it.icon) : h("span", { class: "menu-check" })),
      h("span", { class: "menu-label" }, it.label),
      it.hint ? h("span", { class: "menu-hint" }, it.hint) : null,
    );
    row.addEventListener("click", () => { closeMenus(); it.action?.(); });
    menu.append(row);
    if (!it.disabled) list.push(row);
  }
  menu.style.minWidth = `${minWidth}px`;
  document.body.append(menu);

  // a list taller than the viewport scrolls inside itself rather than
  // overflowing off-screen (the target dropdown can hold many entries)
  const MARGIN = 8;
  const maxH = window.innerHeight - MARGIN * 2;
  if (menu.offsetHeight > maxH) {
    menu.style.maxHeight = `${maxH}px`;
    menu.style.overflowY = "auto";
  }

  const mr = menu.getBoundingClientRect();
  let x, y, originY = "top", originX = "left";
  if (anchor instanceof Element) {
    const r = anchor.getBoundingClientRect();
    x = align === "right" ? r.right - mr.width : r.left;
    y = r.bottom + 5;
    if (y + mr.height > window.innerHeight - MARGIN) { y = r.top - mr.height - 5; originY = "bottom"; }
    if (align === "right") originX = "right";
  } else {
    x = anchor.x; y = anchor.y;
    if (y + mr.height > window.innerHeight - MARGIN) { y -= mr.height; originY = "bottom"; }
    if (x + mr.width > window.innerWidth - MARGIN) { x -= mr.width; originX = "right"; }
  }
  x = Math.min(Math.max(MARGIN, x), window.innerWidth - mr.width - MARGIN);
  y = Math.min(Math.max(MARGIN, y), window.innerHeight - mr.height - MARGIN);
  menu.style.left = `${Math.round(x)}px`;
  menu.style.top = `${Math.round(y)}px`;
  menu.style.transformOrigin = `${originY} ${originX}`;
  requestAnimationFrame(() => menu.classList.add("on"));

  let hot = -1;
  const move = (d) => {
    if (!list.length) return;
    hot = (hot + d + list.length) % list.length;
    list[hot].focus();
  };
  const onKey = (e) => {
    if (e.key === "Escape") { e.stopPropagation(); closeMenus(); }
    else if (e.key === "ArrowDown") { e.preventDefault(); move(1); }
    else if (e.key === "ArrowUp") { e.preventDefault(); move(-1); }
  };
  const onDown = (e) => {
    if (!menu.contains(e.target)) closeMenus();
  };
  window.addEventListener("keydown", onKey, true);
  window.addEventListener("pointerdown", onDown, true);
  window.addEventListener("blur", closeMenus);

  openMenu = {
    close() {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("blur", closeMenus);
      menu.classList.remove("on");
      setTimeout(() => menu.remove(), 120);
    },
  };
  return openMenu;
}

// ---- toasts -------------------------------------------------------------------------

let toastWrap = null;
const toasts = [];

export function toast(msg, { kind = "info", duration = 2600 } = {}) {
  if (!toastWrap) {
    toastWrap = h("div", { class: "toasts" });
    document.body.append(toastWrap);
  }
  const el = h("div", { class: `toast ${kind}` },
    kind === "busy" ? icon("spinner", "spin") : null,
    h("span", {}, msg));
  toastWrap.append(el);
  toasts.push(el);
  while (toasts.length > 3) dismissToast(toasts[0]);
  requestAnimationFrame(() => el.classList.add("on"));
  let timer = 0;
  if (duration > 0) timer = setTimeout(() => dismissToast(el), duration);
  return {
    el,
    update(text) { el.lastChild.textContent = text; },
    dismiss() { clearTimeout(timer); dismissToast(el); },
  };
}

function dismissToast(el) {
  const i = toasts.indexOf(el);
  if (i >= 0) toasts.splice(i, 1);
  el.classList.remove("on");
  el.classList.add("off");
  setTimeout(() => el.remove(), 180);
}

// ---- misc ----------------------------------------------------------------------------

export function clamp(v, lo, hi) {
  return Math.min(hi, Math.max(lo, v));
}

export const isMac = navigator.platform.toUpperCase().includes("MAC");
export const modKey = (e) => (isMac ? e.metaKey : e.ctrlKey);
