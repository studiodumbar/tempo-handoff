// The app-mode switcher — one pill on every page, so Visual ⇄ Motion feels
// like switching modes of one tool, not visiting different sites. The active
// mode is inert text; the other navigates.

import { h } from "./dom.js";

const MODES = [
  { id: "visual", label: "Visual", href: "./index.html" },
  { id: "motion", label: "Motion", href: "./editor.html" },
];

export function appNav(active) {
  return h("nav", { class: "appnav" },
    ...MODES.map((m) =>
      m.id === active
        ? h("span", { class: "appnav-btn on" }, m.label)
        : h("a", { class: "appnav-btn", href: m.href }, m.label)));
}

/** The house-style switch, sitting under the mode pills so it reads as part of
    the chrome rather than as one more setting buried in the panel. Either side
    restores the whole clean-braille look — the only difference between them is
    whether hot cells are allowed to solidify — so this doubles as the way back
    when a session of tuning has wandered.
    `get` returns true when blocks are on; `set(blocksOn)` applies. */
export function styleNav(get, set) {
  const nav = h("nav", { class: "appnav stylenav" });
  const mk = (label, on, title) => {
    const b = h("button", { class: "appnav-btn", title }, label);
    b.addEventListener("click", () => { set(on); sync(); });
    return b;
  };
  const braille = mk("Braille", false, "Clean braille — dots only, nothing solidifies");
  const blocks = mk("Braille + blocks", true, "Clean braille, and hot cells print solid blocks");
  const sync = () => {
    const on = !!get();
    braille.classList.toggle("on", !on);
    blocks.classList.toggle("on", on);
  };
  sync();
  nav.append(braille, blocks);
  nav.refresh = sync;
  return nav;
}
