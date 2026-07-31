/* Motion primitives.
   Everything animates position only — translate, plus clip for panel reveals.
   No scale, no opacity. Expo in-out is the house curve; expo-out is used for
   hovers, which have to feel immediate.

   Every content change runs as three phases that never overlap:

     1. EXIT     outgoing lines retract into their clip boxes, bottom-up
     2. REFLOW   survivors travel to the positions the exit freed up
     3. ENTER    incoming lines reveal, staggered, into settled space

   A phase only starts once the previous one has finished, so nothing is ever
   sliding through anything else. */

const MOTION = {
  exit: 240,
  exitStagger: 20,
  flip: 360,
  enter: 400,
  stagger: 30,
  roll: 400,
  maxSteps: 10, // cap the cascade so long lists don't drag
};

const EXPO = "cubic-bezier(0.87, 0, 0.13, 1)";

const reduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/* Nothing here depends on requestAnimationFrame: a backgrounded tab pauses rAF
   but keeps timers and the animation timeline running, and a half-applied FLIP
   would strand elements off-position. */
const flush = (el) => void el.offsetWidth;

/* A single-line element that reveals by sliding up out of its own clip box. */
function line(text, { tag = "span", cls = "" } = {}) {
  const wrap = document.createElement(tag);
  wrap.className = `mask ${cls}`.trim();
  const ink = document.createElement("span");
  ink.className = "ink";
  ink.textContent = text;
  wrap.append(ink);
  return wrap;
}

/* Multi-line text can't slide out of a clip box without a long throw,
   so paragraphs rise a short distance instead. */
function para(text, { tag = "p", cls = "" } = {}) {
  const p = document.createElement(tag);
  p.className = `rise ${cls}`.trim();
  p.textContent = text;
  return p;
}

/* ── the sequencer ─────────────────────────────────────────────── */

/* One transition per container at a time. A second change queues behind the
   first rather than cutting into it. */
const queues = new WeakMap();

/* Positions as they are right now — capture before anything that shifts layout
   (showing the session header, the notice) so the reflow starts from the truth. */
function measure(root) {
  const map = new Map();
  if (!root || reduced()) return map;
  for (const el of root.querySelectorAll("[data-key]")) {
    map.set(el.dataset.key, el.getBoundingClientRect().top);
  }
  return map;
}

function transition(root, build, opts = {}) {
  if (!root) return Promise.resolve();
  const prev = queues.get(root) || Promise.resolve();
  const next = prev.then(() => runPhases(root, build, opts)).catch(() => {});
  queues.set(root, next);
  return next;
}

const steps = (n) => Math.min(Math.max(n, 0), MOTION.maxSteps);

async function runPhases(root, build, { after, stagger = MOTION.stagger, from }) {
  const incoming = document.createDocumentFragment();
  build(incoming);

  if (reduced()) {
    root.replaceChildren(incoming);
    after?.();
    return;
  }

  const nextKeys = new Set([...incoming.querySelectorAll("[data-key]")].map((e) => e.dataset.key));
  const present = [...root.querySelectorAll("[data-key]")];
  const leaving = present.filter((e) => !nextKeys.has(e.dataset.key)).reverse();

  /* 1 — EXIT: retract what is going away, from the bottom up */
  if (leaving.length) {
    leaving.forEach((e, i) => {
      e.style.setProperty("--d", `${steps(i) * MOTION.exitStagger}ms`);
      e.classList.add("exit");
    });
    await wait(MOTION.exit + steps(leaving.length - 1) * MOTION.exitStagger);
  }

  /* survivors' positions: whatever the caller captured before it touched the
     layout, otherwise measured here */
  const before = new Map();
  for (const e of present) {
    if (!nextKeys.has(e.dataset.key)) continue;
    const key = e.dataset.key;
    before.set(key, from?.has(key) ? from.get(key) : e.getBoundingClientRect().top);
  }

  /* incoming lines hold out of sight until the layout has settled */
  const arriving = [...incoming.querySelectorAll("[data-key]")].filter((e) => !before.has(e.dataset.key));
  for (const e of arriving) e.classList.add("waiting");

  root.replaceChildren(incoming);
  root.querySelector("[data-autofocus]")?.focus();
  after?.();

  /* 2 — REFLOW: survivors travel into the space the exit freed */
  let moved = 0;
  for (const el of root.querySelectorAll("[data-key]")) {
    const prevTop = before.get(el.dataset.key);
    if (prevTop === undefined) continue;
    const dy = prevTop - el.getBoundingClientRect().top;
    if (Math.abs(dy) < 0.5) continue;

    moved++;
    el.animate(
      [{ transform: `translateY(${dy}px)` }, { transform: "translateY(0)" }],
      { duration: MOTION.flip, easing: EXPO, fill: "none" }
    );
  }
  if (moved) await wait(MOTION.flip);

  /* 3 — ENTER: reveal into settled space */
  if (!arriving.length) return;

  arriving.forEach((e, i) => {
    const d = steps(i) * stagger;
    e.style.setProperty("--d", `${d}ms`);
    e.classList.remove("waiting");
    e.classList.add("enter");
    // hand transform back to the hover/selection transitions once it has played
    setTimeout(() => e.classList.remove("enter"), d + MOTION.enter + 160);
  });

  await wait(MOTION.enter + steps(arriving.length - 1) * stagger);
}

/* ── numbers and labels roll over instead of cutting ────────────── */

function roll(el, text) {
  const prev = el.dataset.v;
  el.dataset.v = text;

  if (prev === undefined || prev === text || reduced()) {
    el.textContent = text;
    return;
  }

  const num = (s) => Number(String(s).replace(/[^\d.]/g, ""));
  const down = num(text) < num(prev);

  el.classList.add("slot");
  el.style.width = `${Math.max(prev.length, text.length)}ch`;
  el.textContent = "";

  const col = document.createElement("span");
  col.className = "slot-col";
  const first = document.createElement("span");
  const second = document.createElement("span");
  first.className = second.className = "slot-line";
  first.textContent = down ? text : prev;
  second.textContent = down ? prev : text;
  col.append(first, second);
  if (down) col.classList.add("from-above");
  el.append(col);

  flush(col);
  col.classList.add("is-rolling");
  setTimeout(() => {
    el.classList.remove("slot");
    el.style.width = "";
    el.textContent = text;
  }, MOTION.roll + 60);
}

/* Re-trigger a one-shot entrance animation on an element. */
function replay(el, cls) {
  if (!el || reduced()) return;
  el.classList.remove(cls);
  void el.offsetWidth; // force reflow so the animation restarts
  el.classList.add(cls);
}
