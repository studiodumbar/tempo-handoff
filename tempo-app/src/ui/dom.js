// DOM primitives for the studio UI — element builder, the icon set, popover
// menus, tooltips and toasts. Motion follows the design-engineering rules the
// app is styled by: enter with ease-out under 200ms, exit faster than enter,
// scale from the trigger's origin, never from zero, transform/opacity only.

import { ICONS } from "./icons.js";

export { ICONS };

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

/**
 * An icon is decorative by default — the control wrapping it carries the
 * accessible name, so the glyph is hidden from assistive tech to avoid a
 * duplicate reading. Pass `label` only when the icon is the whole meaning and
 * nothing around it names it.
 */
export function icon(name, cls = "", label = null) {
  const glyph = ICONS[name];
  if (!glyph) throw new Error(`icon: no glyph named "${name}"`);
  const s = h("span", {
    class: cls ? `icon ${cls}` : "icon",
    "aria-hidden": label ? null : "true",
    role: label ? "img" : null,
    "aria-label": label,
  });
  s.innerHTML = glyph;
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
  const returnFocus = document.activeElement;
  const menu = h("div", { class: "menu", role: "menu", tabindex: "-1" });
  const list = [];
  for (const it of items) {
    if (it === "-") {
      menu.append(h("div", { class: "menu-sep", role: "separator" }));
      continue;
    }
    // checkable entries are radio-like: they report which one is current
    const role = it.checked !== undefined ? "menuitemradio" : "menuitem";
    const row = h(
      "button",
      {
        class: `menu-item${it.danger ? " danger" : ""}`,
        role,
        disabled: !!it.disabled,
        tabindex: "-1",
        "aria-checked": it.checked !== undefined ? String(!!it.checked) : null,
        "aria-disabled": it.disabled ? "true" : null,
      },
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

  // Focus enters the menu on open, so Escape and arrows have somewhere to
  // land and a screen reader announces the list rather than the page behind it.
  menu.focus({ preventScroll: true });

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
    else if (e.key === "Home") { e.preventDefault(); hot = -1; move(1); }
    else if (e.key === "End") { e.preventDefault(); hot = 0; move(-1); }
    else if (e.key === "Tab") { e.preventDefault(); move(e.shiftKey ? -1 : 1); }
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
      setTimeout(() => menu.remove(), 140);
      // hand focus back to whatever opened the menu — otherwise the tab
      // sequence restarts at the top of the document on every dismissal
      if (returnFocus && document.contains(returnFocus)) {
        returnFocus.focus({ preventScroll: true });
      }
    },
  };
  return openMenu;
}

// ---- toasts -------------------------------------------------------------------------

let toastWrap = null;
const toasts = [];

export function toast(msg, { kind = "info", duration = 2600 } = {}) {
  if (!toastWrap) {
    // polite live region: results and errors are read out without stealing
    // focus from whatever the user is doing
    toastWrap = h("div", { class: "toasts", role: "status", "aria-live": "polite" });
    document.body.append(toastWrap);
  }
  const el = h("div", { class: `toast ${kind}` },
    kind === "busy" ? icon("spinner", "spin") : kind === "error" ? icon("alert") : null,
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
