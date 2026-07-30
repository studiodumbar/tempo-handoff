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
 * items: {label, icon?, hint?, sub?, danger?, checked?, disabled?, action}
 *        "-" for a separator, or {heading} for a group title.
 * anchor: element (drops below, origin-aware) or {x, y} (context menu).
 * opts.search: a filter field at the top. Pass it when the list can grow past
 *   roughly a screenful — a hundred entries with no way to narrow them is a
 *   list you scroll, not a list you choose from.
 */
export function showMenu(items, anchor, { minWidth = 148, align = "left", search = false, placeholder = "Search" } = {}) {
  closeMenus();
  hideTip();
  const returnFocus = document.activeElement;
  const menu = h("div", { class: "menu", role: "menu", tabindex: "-1" });
  const list = [];
  // the highlighted row, declared up here because the filter resets it and
  // the filter runs during setup
  let hot = -1;
  const scroller = h("div", { class: search ? "menu-scroll" : "menu-plain" });
  const rowsFor = [];          // [{ el, text, kind }] for filtering

  let searchInput = null;
  let emptyState = null;
  if (search) {
    searchInput = h("input", {
      class: "menu-search-input", type: "text", spellcheck: false,
      autocomplete: "off", placeholder, "aria-label": placeholder,
    });
    menu.append(h("div", { class: "menu-search" }, icon("search"), searchInput));
    emptyState = h("div", { class: "menu-empty" }, "No matches");
    emptyState.hidden = true;
  }

  for (const it of items) {
    if (it === "-") {
      const sep = h("div", { class: "menu-sep", role: "separator" });
      scroller.append(sep);
      rowsFor.push({ el: sep, kind: "sep" });
      continue;
    }
    if (it.heading) {
      const head = h("div", { class: "menu-heading" }, it.heading);
      scroller.append(head);
      rowsFor.push({ el: head, kind: "heading" });
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
      it.sub ? h("span", { class: "menu-sub" }, it.sub) : null,
      it.hint ? h("span", { class: "menu-hint" }, it.hint) : null,
    );
    row.addEventListener("click", () => { closeMenus(); it.action?.(); });
    scroller.append(row);
    rowsFor.push({ el: row, kind: "item", text: `${it.label} ${it.sub || ""}`.toLowerCase() });
    if (!it.disabled) list.push(row);
  }
  menu.append(scroller);
  if (emptyState) scroller.append(emptyState);
  menu.style.minWidth = `${minWidth}px`;
  document.body.append(menu);

  if (searchInput) {
    const filter = () => {
      const q = searchInput.value.trim().toLowerCase();
      let shown = 0;
      // a heading survives only if something under it does
      let pendingHeads = [];
      for (const r of rowsFor) {
        if (r.kind !== "item") { r.el.hidden = true; pendingHeads.push(r); continue; }
        const hit = !q || r.text.includes(q);
        r.el.hidden = !hit;
        if (hit) {
          shown++;
          for (const hRow of pendingHeads) hRow.el.hidden = false;
          pendingHeads = [];
        }
      }
      emptyState.hidden = shown > 0;
      list.length = 0;
      for (const r of rowsFor) if (r.kind === "item" && !r.el.hidden) list.push(r.el);
      hot = -1;
    };
    searchInput.addEventListener("input", filter);
    filter();
  }

  // a list taller than the viewport scrolls inside itself rather than
  // overflowing off-screen (the source picker can hold a hundred entries)
  const MARGIN = 8;
  const maxH = Math.min(420, window.innerHeight - MARGIN * 2);
  if (menu.offsetHeight > maxH) {
    menu.style.maxHeight = `${maxH}px`;
    if (search) scroller.style.overflowY = "auto";
    else menu.style.overflowY = "auto";
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
  (searchInput || menu).focus({ preventScroll: true });

  const move = (d) => {
    if (!list.length) return;
    hot = (hot + d + list.length) % list.length;
    list[hot].focus();
    list[hot].scrollIntoView({ block: "nearest" });
  };
  const onKey = (e) => {
    if (e.key === "Escape") { e.stopPropagation(); closeMenus(); }
    else if (e.key === "ArrowDown") { e.preventDefault(); move(1); }
    else if (e.key === "ArrowUp") { e.preventDefault(); move(-1); }
    else if (e.key === "Home") { e.preventDefault(); hot = -1; move(1); }
    else if (e.key === "End") { e.preventDefault(); hot = 0; move(-1); }
    else if (e.key === "Tab") { e.preventDefault(); move(e.shiftKey ? -1 : 1); }
    else if (e.key === "Enter" && document.activeElement === searchInput) {
      // Enter in the filter takes the first match — the common case is
      // "type three letters, press Enter"
      e.preventDefault();
      list[0]?.click();
    } else if (searchInput && document.activeElement !== searchInput
               && e.key.length === 1 && !e.metaKey && !e.ctrlKey) {
      searchInput.focus();   // typing anywhere in the menu goes to the filter
    }
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

// ---- confirm ---------------------------------------------------------------------------
// A destructive action states what it will destroy and waits. Escape and the
// backdrop both cancel; focus moves into the card and returns to the trigger.

let openConfirm = null;

/**
 * @param {{title: string, body?: string, confirmLabel: string, danger?: boolean}} opts
 * @returns {Promise<boolean>} true if confirmed
 */
export function confirmAction({ title, body, confirmLabel, danger = true }) {
  openConfirm?.cancel();
  const returnFocus = document.activeElement;

  return new Promise((resolve) => {
    const card = h("div", {
      class: "confirm-card", role: "alertdialog", "aria-modal": "true",
      "aria-label": title, tabindex: "-1",
    });
    const cancelBtn = h("button", { class: "btn subtle", type: "button" }, "Cancel");
    const goBtn = h("button", {
      class: `btn ${danger ? "danger" : "primary"}`, type: "button",
    }, confirmLabel);

    card.append(
      h("div", { class: "confirm-title" }, title),
      body ? h("div", { class: "confirm-body" }, body) : null,
      h("div", { class: "confirm-actions" }, cancelBtn, goBtn),
    );
    const veil = h("div", { class: "confirm-veil" }, card);
    document.body.append(veil);
    requestAnimationFrame(() => veil.classList.add("on"));
    goBtn.focus({ preventScroll: true });

    const done = (result) => {
      if (openConfirm !== api) return;
      openConfirm = null;
      window.removeEventListener("keydown", onKey, true);
      veil.classList.remove("on");
      setTimeout(() => veil.remove(), 140);
      if (returnFocus && document.contains(returnFocus)) {
        returnFocus.focus({ preventScroll: true });
      }
      resolve(result);
    };
    const onKey = (e) => {
      if (e.key === "Escape") { e.stopPropagation(); done(false); }
      else if (e.key === "Tab") {
        // two buttons, so the trap is just "stay between these two"
        e.preventDefault();
        (document.activeElement === goBtn ? cancelBtn : goBtn).focus();
      }
    };
    const api = { cancel: () => done(false) };
    openConfirm = api;

    window.addEventListener("keydown", onKey, true);
    veil.addEventListener("pointerdown", (e) => { if (e.target === veil) done(false); });
    cancelBtn.addEventListener("click", () => done(false));
    goBtn.addEventListener("click", () => done(true));
  });
}

// ---- keyboard shortcut sheet ------------------------------------------------------------

let openSheet = null;

/** groups: [{ title, keys: [[combo, what], …] }] */
export function showShortcuts(groups) {
  if (openSheet) { openSheet.close(); return; }
  const returnFocus = document.activeElement;
  const card = h("div", {
    class: "sheet-card", role: "dialog", "aria-modal": "true",
    "aria-label": "Keyboard shortcuts", tabindex: "-1",
  });
  const closeBtn = h("button", {
    class: "icon-btn sheet-close", type: "button", "aria-label": "Close",
  }, icon("x"));
  card.append(
    h("div", { class: "sheet-head" }, h("span", { class: "sheet-title" }, "Shortcuts"), closeBtn),
    h("div", { class: "sheet-grid" },
      ...groups.map((g) => h("div", { class: "sheet-group" },
        h("div", { class: "sheet-group-title" }, g.title),
        ...g.keys.map(([combo, what]) => h("div", { class: "sheet-row" },
          h("span", { class: "sheet-what" }, what),
          h("span", { class: "sheet-keys" },
            ...combo.split(" ").map((k) => h("kbd", { class: "kbd" }, k))))))),
    ),
  );
  const veil = h("div", { class: "confirm-veil sheet-veil" }, card);
  document.body.append(veil);
  requestAnimationFrame(() => veil.classList.add("on"));
  card.focus({ preventScroll: true });

  const close = () => {
    openSheet = null;
    window.removeEventListener("keydown", onKey, true);
    veil.classList.remove("on");
    setTimeout(() => veil.remove(), 140);
    if (returnFocus && document.contains(returnFocus)) {
      returnFocus.focus({ preventScroll: true });
    }
  };
  const onKey = (e) => {
    if (e.key === "Escape" || e.key === "?") { e.stopPropagation(); e.preventDefault(); close(); }
  };
  window.addEventListener("keydown", onKey, true);
  veil.addEventListener("pointerdown", (e) => { if (e.target === veil) close(); });
  closeBtn.addEventListener("click", close);
  openSheet = { close };
}

// ---- misc ----------------------------------------------------------------------------

export function clamp(v, lo, hi) {
  return Math.min(hi, Math.max(lo, v));
}

export const isMac = navigator.platform.toUpperCase().includes("MAC");
export const modKey = (e) => (isMac ? e.metaKey : e.ctrlKey);
