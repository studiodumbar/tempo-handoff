// The app chrome — the TEMPO wordmark and the mode switch, on one row at the
// top of the panel. Visual ⇄ Motion are two modes of one tool, so the switch
// lives in the chrome and never over the canvas. The active mode is inert
// text; the other navigates.

import { h } from "./dom.js";
import { wordmark } from "./wordmark.js";

const MODES = [
  { id: "visual", label: "Visual", href: "./index.html" },
  { id: "motion", label: "Motion", href: "./editor.html" },
];

/**
 * The first tab stop on every surface: a link straight to the panel, so a
 * keyboard user is not obliged to walk the whole control list of whatever
 * comes first in the DOM to reach the controls they want. Visible only when
 * focused.
 */
export function skipLink(targetId, label) {
  return h("a", { class: "skip-link", href: `#${targetId}` }, label);
}

/** @param {string} active */
export function appNav(active) {
  return h("header", { class: "appnav" },
    wordmark(),
    h("nav", { class: "modeswitch", "aria-label": "Mode" },
      ...MODES.map((m) =>
        m.id === active
          ? h("span", { class: "mode-btn on", "aria-current": "page" }, m.label)
          : h("a", { class: "mode-btn", href: m.href }, m.label))));
}
