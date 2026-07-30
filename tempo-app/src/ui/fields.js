// Figma-style property fields. No sliders anywhere: numbers live in small
// fields you can either click to type in, or DRAG to scrub — on the input
// itself or on its label. Shift while dragging = coarse (×10), Alt = fine
// (×0.1). Arrow keys nudge, Enter commits, Escape reverts.
//
// Every field exposes refresh() so panels can sync values in place (undo,
// external edits) without rebuilding DOM — a field being edited or scrubbed
// ignores refresh until it's released.

import { h, icon, showMenu, clamp, tip } from "./dom.js";

function decimalsFor(step) {
  if (step >= 1) return 0;
  if (step >= 0.1) return 1;
  if (step >= 0.01) return 2;
  return 3;
}

function roundStep(v, step) {
  const inv = 1 / step;
  return Math.round(v * inv) / inv;
}

/**
 * Drag-scrubbable number field.
 * opts: { get, set(value, live), min, max, step, unit, disabled, wide }
 * set() is called with live=true while scrubbing / arrowing and once with
 * live=false on release / commit.
 */
export function NumberField(opts) {
  const {
    get, set,
    min = -Infinity, max = Infinity,
    step = 1, unit = "",
  } = opts;
  const dec = opts.decimals ?? decimalsFor(step);
  const fmt = (v) => `${Number(v).toFixed(dec)}${unit}`;

  const input = h("input", {
    class: "num-input",
    type: "text",
    spellcheck: false,
    autocomplete: "off",
    value: fmt(get()),
  });
  // Figma-style prefix: a small icon or monogram INSIDE the field — it names
  // the value and doubles as the scrub handle
  let prefixEl = null;
  if (opts.prefix) {
    const text = opts.prefix.text ?? "";
    // word prefixes get a fixed column so values align across the grid;
    // icons and single letters stay compact like Figma's X / Y / W / H
    const long = !opts.prefix.icon && text.length > 1;
    prefixEl = h("span", { class: `field-prefix${long ? " long" : ""}` },
      opts.prefix.icon ? icon(opts.prefix.icon) : text);
    if (opts.tipText || opts.prefix.tip) tip(prefixEl, opts.prefix.tip || opts.tipText);
  }
  const el = h("div", { class: `field num${opts.wide ? " wide" : ""}${prefixEl ? " with-prefix" : ""}` },
    prefixEl, input);
  if (opts.disabled) el.classList.add("disabled");

  let editing = false;
  let scrubbing = false;

  const commitTyped = () => {
    const raw = parseFloat(input.value.replace(",", "."));
    if (Number.isFinite(raw)) {
      const v = clamp(roundStep(raw, step), min, max);
      set(v, false);
      input.value = fmt(v);
    } else {
      input.value = fmt(get());
    }
  };

  input.addEventListener("focus", () => {
    editing = true;
    input.select();
  });
  input.addEventListener("blur", () => {
    if (editing) commitTyped();
    editing = false;
    el.classList.remove("editing");
  });
  input.addEventListener("keydown", (e) => {
    e.stopPropagation();
    if (e.key === "Enter") {
      commitTyped();
      editing = false;
      input.blur();
    } else if (e.key === "Escape") {
      editing = false;
      input.value = fmt(get());
      input.blur();
    } else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      e.preventDefault();
      const dir = e.key === "ArrowUp" ? 1 : -1;
      const mag = e.shiftKey ? 10 : e.altKey ? 0.1 : 1;
      const v = clamp(roundStep(get() + dir * step * mag, step * (e.altKey ? 0.1 : 1)), min, max);
      set(v, true);
      input.value = fmt(v);
      input.select();
    }
  });

  /** Figma-style scrubbing that OWNS the pointer. pointerdown is claimed
      outright — the browser never gets to focus the input or start a text
      selection — so a drag is always a clean scrub. A click that never moves
      enters edit mode manually. The prefix scrubs even while editing;
      inside a focused input, the caret and selection stay fully native. */
  function bindScrub(surface) {
    if (opts.disabled) return;
    surface.classList.add("scrub");
    surface.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      const onPrefix = !!(e.target.closest && e.target.closest(".field-prefix"));
      const isField = surface === el;
      if (isField && editing && !onPrefix) return;   // caret work stays native

      e.preventDefault();                            // no focus, no selection
      if (editing) input.blur();                     // commit typing first
      const startX = e.clientX;
      const startVal = get();
      let started = false;
      try { surface.setPointerCapture(e.pointerId); } catch {}

      const move = (ev) => {
        const dx = ev.clientX - startX;
        if (!started) {
          if (Math.abs(dx) < 3) return;
          started = true;
          scrubbing = true;
          document.body.classList.add("scrubbing");
        }
        const mag = ev.shiftKey ? 10 : ev.altKey ? 0.1 : 1;
        const fineStep = ev.altKey ? step * 0.1 : step;
        const v = clamp(roundStep(startVal + dx * step * mag * 0.5, fineStep), min, max);
        set(v, true);
        input.value = fmt(v);
      };
      const up = () => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
        window.removeEventListener("pointercancel", up);
        try { surface.releasePointerCapture(e.pointerId); } catch {}
        document.body.classList.remove("scrubbing");
        if (started) {
          scrubbing = false;
          set(get(), false);                         // close the coalesced edit
        } else if (isField) {
          input.focus();                             // clean click → edit mode
        }
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
      window.addEventListener("pointercancel", up);
    });
  }

  bindScrub(el);

  return {
    el,
    input,
    bindScrub,
    refresh() {
      if (editing || scrubbing) return;
      input.value = fmt(get());
    },
  };
}

/** Dropdown select — a quiet field that opens an origin-aware menu. */
export function SelectField({ get, set, options, disabled = false, prefix = null, tipText }) {
  const label = h("span", { class: "select-label" });
  const prefixEl = prefix
    ? h("span", { class: "field-prefix" }, prefix.icon ? icon(prefix.icon) : (prefix.text ?? ""))
    : null;
  const el = h("button", { class: `field select${prefixEl ? " with-prefix" : ""}`, disabled },
    prefixEl, label, icon("chevronDown", "select-chev"));
  if (tipText) tip(el, tipText);
  const current = () => options.find((o) => o.value === get());
  const sync = () => { label.textContent = current()?.label ?? "—"; };
  sync();
  el.addEventListener("click", () => {
    showMenu(
      options.map((o) => ({
        label: o.label,
        checked: o.value === get(),
        action: () => { set(o.value, false); sync(); },
      })),
      el,
      { minWidth: Math.max(132, el.getBoundingClientRect().width) },
    );
  });
  return { el, refresh: sync };
}

/** Figma-style segmented icon control (align, direction…). */
export function SegmentedField({ get, set, options }) {
  const btns = options.map((o) => {
    const b = h("button", { class: "seg-btn" }, o.icon ? icon(o.icon) : o.label);
    if (o.tip) tip(b, o.tip);
    b.addEventListener("click", () => { set(o.value, false); sync(); });
    return { b, o };
  });
  const el = h("div", { class: "seg-field" }, btns.map((x) => x.b));
  function sync() {
    const v = get();
    for (const { b, o } of btns) b.classList.toggle("on", o.value === v);
  }
  sync();
  return { el, refresh: sync };
}

/** Small toggle switch. */
export function SwitchField({ get, set }) {
  const el = h("button", { class: "switch", role: "switch" }, h("span", { class: "knob" }));
  const sync = () => el.setAttribute("aria-checked", get() ? "true" : "false");
  sync();
  el.addEventListener("click", () => { set(!get(), false); sync(); });
  return { el, refresh: sync };
}

/** Colour: swatch (opens the native picker) + hex text. */
export function ColorField({ get, set }) {
  const native = h("input", { class: "color-native", type: "color", value: get() });
  const swatch = h("button", { class: "swatch" }, native);
  const hex = h("input", {
    class: "hex-input", type: "text", spellcheck: false, value: get().replace("#", "").toUpperCase(),
  });
  const el = h("div", { class: "field color" }, swatch, hex);
  const sync = () => {
    const v = get();
    swatch.style.background = v;
    native.value = v;
    if (document.activeElement !== hex) hex.value = v.replace("#", "").toUpperCase();
  };
  sync();
  swatch.addEventListener("click", () => native.click());
  native.addEventListener("input", () => { set(native.value, true); sync(); });
  native.addEventListener("change", () => { set(native.value, false); sync(); });
  hex.addEventListener("keydown", (e) => {
    e.stopPropagation();
    if (e.key === "Enter") hex.blur();
    if (e.key === "Escape") { hex.value = get().replace("#", "").toUpperCase(); hex.blur(); }
  });
  hex.addEventListener("blur", () => {
    let v = hex.value.trim().replace("#", "");
    if (/^[0-9a-fA-F]{3}$/.test(v)) v = v.split("").map((c) => c + c).join("");
    if (/^[0-9a-fA-F]{6}$/.test(v)) set(`#${v.toLowerCase()}`, false);
    sync();
  });
  hex.addEventListener("focus", () => hex.select());
  return { el, refresh: sync };
}

/** Plain text field (project name, clip name). */
export function TextField({ get, set, placeholder = "" }) {
  const input = h("input", {
    class: "text-input", type: "text", spellcheck: false, placeholder, value: get(),
  });
  input.addEventListener("keydown", (e) => {
    e.stopPropagation();
    if (e.key === "Enter") input.blur();
    if (e.key === "Escape") { input.value = get(); input.blur(); }
  });
  input.addEventListener("blur", () => {
    const v = input.value.trim();
    if (v && v !== get()) set(v, false);
    else input.value = get();
  });
  input.addEventListener("focus", () => input.select());
  return {
    el: input,
    refresh() { if (document.activeElement !== input) input.value = get(); },
  };
}

// ---- layout builders -----------------------------------------------------------

/** One property row: fixed label column + field. The label doubles as the
    scrub surface for number fields. */
export function row(labelText, field, { tipText, labelScrub = true } = {}) {
  const label = h("span", { class: "row-label" }, labelText);
  if (field.bindScrub && labelScrub) field.bindScrub(label);
  const r = h("div", { class: "prop-row" }, label, field.el);
  if (tipText) tip(label, tipText);
  return r;
}

/** Two fields sharing one row (e.g. W / H). */
export function rowPair(labelText, fieldA, fieldB, opts = {}) {
  const label = h("span", { class: "row-label" }, labelText);
  if (fieldA.bindScrub && opts.scrubA !== false) fieldA.bindScrub(label);
  return h("div", { class: "prop-row pair" }, label,
    h("div", { class: "pair-fields" }, fieldA.el, fieldB.el));
}

/** Two compact fields side by side — the Figma property grid. */
export function grid2(...fields) {
  return h("div", { class: "prop-grid" },
    ...fields.map((f) => (f == null ? h("span") : (f.el ?? f))));
}

const secState = (id) => {
  try { return localStorage.getItem(`hf.sec.${id}`); } catch { return null; }
};

/**
 * A section with a clickable header. Collapsible by default; open/closed is
 * remembered per section id. Pass collapsed: true for advanced sections that
 * should start closed.
 */
export function section(title, children, { actions = [], id = null, collapsed = false } = {}) {
  const key = id || title.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  const saved = secState(key);
  const open = saved != null ? saved === "1" : !collapsed;

  const chev = icon("chevronDown", "section-chev");
  const head = h("div", { class: "section-head" },
    h("span", { class: "section-title" }, title),
    h("span", { class: "section-actions" }, ...actions),
    chev);
  const body = h("div", { class: "section-body" },
    h("div", { class: "section-inner" }, ...children));
  const el = h("div", { class: `section${open ? "" : " closed"}` }, head, body);

  head.addEventListener("click", (e) => {
    if (e.target.closest(".section-actions")) return;
    const nowOpen = el.classList.toggle("closed");
    try { localStorage.setItem(`hf.sec.${key}`, nowOpen ? "0" : "1"); } catch {}
  });
  return el;
}

export function button(label, { variant = "ghost", iconName, onClick, title, wide } = {}) {
  const b = h("button", { class: `btn ${variant}${wide ? " wide" : ""}` },
    iconName ? icon(iconName) : null,
    label ? h("span", {}, label) : null);
  if (onClick) b.addEventListener("click", onClick);
  if (title) tip(b, title);
  return b;
}

export function iconButton(iconName, { onClick, title, toggled, cls = "" } = {}) {
  const b = h("button", { class: `icon-btn ${cls}` }, icon(iconName));
  if (onClick) b.addEventListener("click", onClick);
  if (title) tip(b, title);
  if (toggled) b.classList.add("on");
  return b;
}
