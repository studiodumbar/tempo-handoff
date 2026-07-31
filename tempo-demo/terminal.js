/* The rail is a terminal.

   A transcript of what has run, and a prompt with inline completion. Every
   affordance is reachable from the keyboard:

     type          filter the completions
     ↑ / ↓         move through the completions
     ⏎             run the highlighted completion
     ⇥             complete the line without running it
     ⎋             clear the line (or leave a sub-prompt)
     ⌃↑ / ⌃↓       walk command history
     ⌃L            clear the transcript

   Typing never goes through the motion sequencer — completions redraw on the
   same frame as the keystroke. Only committed output animates. */

const TERM = {
  input: "",
  cursor: 0, // caret index within input
  index: -1, // highlighted row; -1 means nothing is highlighted yet
  history: [],
  histAt: -1,
  arg: "", // the value typed into a command's own field
  pick: null, // an open choice: the command that offers it
  pickAt: 0, // highlighted option within that choice
  busy: false,
};

let termEls = {};

function initTerminal() {
  termEls = {
    body: el("terminalBody"),
    scrollback: el("scrollback"),
    transcript: el("transcript"),
    line: el("promptLine"),
    mirror: el("inputMirror"),
    list: el("suggestions"),
    input: el("promptInput"),
  };

  const input = termEls.input;

  input.addEventListener("input", () => {
    if (argOf()) {
      /* the highlighted command is asking for a value — this is that value */
      TERM.arg = input.value;
      drawArg();
      argInput(TERM.arg);
      return;
    }
    TERM.input = input.value;
    TERM.cursor = input.selectionStart ?? TERM.input.length;
    TERM.index = TERM.input ? 0 : -1;
    TERM.histAt = -1;
    if (TERM.input) TERM.pick = null; // typing is a new command, not an answer
    drawPrompt();
  });

  // keep the block caret on the real caret when moving within the line
  for (const evt of ["keyup", "click", "select"]) {
    input.addEventListener(evt, () => {
      const at = input.selectionStart ?? TERM.input.length;
      if (at === TERM.cursor) return;
      TERM.cursor = at;
      drawCaret();
    });
  }

  input.addEventListener("keydown", onKey);
  input.addEventListener("blur", () => termEls.line.classList.remove("is-live"));
  input.addEventListener("focus", () => termEls.line.classList.add("is-live"));

  /* A terminal takes what you type wherever you are. Keystrokes aimed at the
     page are routed into the line rather than dropped — but a control that has
     focus keeps its own Enter/Tab/arrows so the stage stays operable. */
  document.addEventListener("keydown", (e) => {
    if (e.target === input || e.altKey) return;
    if (e.target.matches("input, textarea, select")) return;

    const onControl = !!e.target.closest("button, a, input, select, textarea");
    const printable = e.key.length === 1 && !e.metaKey && !e.ctrlKey;
    const editing = printable || e.key === "Backspace";
    const steering = ["Enter", "Tab", "ArrowUp", "ArrowDown"].includes(e.key);
    const shortcut = (e.ctrlKey || e.metaKey) && ["ArrowUp", "ArrowDown", "l", "L"].includes(e.key);

    if (e.key === "Escape") {
      focusPrompt(); // always a way back to the line
      if (!onControl) onKey(e);
      return;
    }

    if (editing) {
      e.preventDefault();
      focusPrompt();
      if (argOf()) setArg(printable ? TERM.arg + e.key : TERM.arg.slice(0, -1));
      else setLine(printable ? TERM.input + e.key : TERM.input.slice(0, -1));
      return;
    }

    if ((steering || shortcut) && !onControl) {
      focusPrompt();
      onKey(e);
    }
  });

  // clicking anywhere in the rail returns focus to the line
  termEls.body.addEventListener("mousedown", (e) => {
    if (e.target.closest("button, a, input")) return;
    e.preventDefault();
    focusPrompt();
  });

  drawPrompt();
  focusPrompt();
}

/* First paint: the column arrives one line at a time, top to bottom.
   Masked text slides up out of its clip line; the two elements that can't be
   clipped (the prompt row, the wordmark) rise a short distance. */
function bootCascade(step = 34) {
  if (reduced()) return;
  const rail = document.querySelector(".terminal");
  if (!rail) return;

  const order = [
    ...rail.querySelectorAll(".panel-head .label"),
    ...rail.querySelectorAll("#boot p"),
    ...rail.querySelectorAll("#suggestions .suggestion"),
    termEls.line,
    ...rail.querySelectorAll(".panel-foot .wordmark, .panel-foot #cartBtn"),
  ].filter(Boolean);

  order.forEach((node, i) => {
    const d = i * step;
    node.style.setProperty("--d", `${d}ms`);
    const cls = node.querySelector(".ink") ? "enter" : "boot-rise";
    replay(node, cls);
    setTimeout(() => node.classList.remove(cls), d + 560);
  });
}

function focusPrompt() {
  termEls.input?.focus({ preventScroll: true });
}

/* ── completions ───────────────────────────────────────────────── */

/* Only what this node of the sitemap offers — the router owns the list. */
function available() {
  return routeCommands();
}

function suggestions() {
  const q = TERM.input.trim().toLowerCase();
  /* utility commands stay out of the listing until you type for them */
  const pool = available().filter((c) => !c.hidden || q);
  if (!q) return pool;

  const scored = [];
  for (const c of pool) {
    const name = c.name.toLowerCase();
    const idx = name.indexOf(q);
    if (idx >= 0) scored.push({ c, rank: idx === 0 ? 0 : 1, idx });
    else if (c.alias?.some((a) => a.toLowerCase().startsWith(q))) scored.push({ c, rank: 2, idx: 0 });
  }
  scored.sort((a, b) => a.rank - b.rank || a.idx - b.idx);
  return scored.map((s) => s.c);
}

const highlighted = () => {
  if (TERM.index < 0) return null;
  const list = suggestions();
  return list[Math.min(TERM.index, list.length - 1)] || null;
};

/* ── keys ──────────────────────────────────────────────────────── */

function onKey(e) {
  const list = suggestions();

  // history
  if ((e.ctrlKey || e.metaKey) && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
    e.preventDefault();
    if (!TERM.history.length) return;
    const step = e.key === "ArrowUp" ? 1 : -1;
    TERM.histAt = Math.max(-1, Math.min(TERM.history.length - 1, TERM.histAt + step));
    setLine(TERM.histAt < 0 ? "" : TERM.history[TERM.history.length - 1 - TERM.histAt]);
    return;
  }

  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "l") {
    e.preventDefault();
    clearTranscript();
    return;
  }

  /* an open choice owns the keys while it is up — ⎋ leaves it */
  if (TERM.pick) {
    const opts = TERM.pick.picks.options;
    switch (e.key) {
      case "ArrowUp":
        e.preventDefault();
        // like the list above: steering picks up from nothing, at either end
        TERM.pickAt = TERM.pickAt < 0 ? opts.length - 1 : (TERM.pickAt - 1 + opts.length) % opts.length;
        drawPick();
        return;

      case "ArrowDown":
        e.preventDefault();
        TERM.pickAt = TERM.pickAt < 0 ? 0 : (TERM.pickAt + 1) % opts.length;
        drawPick();
        return;

      case "Enter":
        e.preventDefault();
        if (!TERM.busy && TERM.pickAt >= 0) commitPick();
        return;
      case "Tab":
        e.preventDefault();
        return;
      case "Escape":
        e.preventDefault();
        closePick();
        return;
    }
  }

  switch (e.key) {
    case "ArrowUp":
      e.preventDefault();
      if (TERM.arg) setArg("");
      if (!list.length) return;
      TERM.index = TERM.index < 0 ? list.length - 1 : (TERM.index - 1 + list.length) % list.length;
      drawList();
      return;

    case "ArrowDown":
      e.preventDefault();
      if (TERM.arg) setArg("");
      if (!list.length) return;
      TERM.index = TERM.index < 0 ? 0 : (TERM.index + 1) % list.length;
      drawList();
      return;

    case "Tab": {
      e.preventDefault();
      const pick = highlighted();
      if (pick) setLine(pick.name);
      return;
    }

    case "Enter": {
      e.preventDefault();
      if (TERM.busy) return;
      const typed = TERM.input.trim();
      const pick = highlighted();
      // an exact typed command wins over the highlight, like a real shell
      const exact = available().find((c) => c.name.toLowerCase() === typed.toLowerCase());
      const chosen = exact || (typed && !pick ? null : pick);
      if (!chosen) {
        if (typed) runUnknown(typed);
        return;
      }
      setLine("");
      run(chosen);
      return;
    }

    case "Escape":
      e.preventDefault();
      if (TERM.arg) setArg("");
      else if (TERM.input) setLine("");
      return;
  }
}

function setArg(text) {
  TERM.arg = text;
  termEls.input.value = text;
  drawArg();
  argInput(text);
}

function setLine(text) {
  TERM.input = text;
  TERM.cursor = text.length;
  TERM.index = text ? 0 : -1;
  if (text) TERM.pick = null;
  termEls.input.value = text;
  termEls.input.setSelectionRange(text.length, text.length);
  drawPrompt();
}

/* ── drawing ───────────────────────────────────────────────────── */

/* The highlighted command may take an argument of its own — Find Items does,
   and asks for it in the rail under the list. */
const argOf = () => highlighted()?.asks || null;

function drawPrompt() {
  drawCaret();
  drawList();
  drawArg();
  drawPick();
}

/* ── a choice, asked in the rail ────────────────────────────────── */

/* View merch is not a destination — it asks which collection, and the answer is
   the command that runs. The block opens under the list and takes the keys. */
function openPick(cmd) {
  if (TERM.pick?.name === cmd.name) return closePick(); // clicking it again puts it away
  TERM.pick = cmd;
  TERM.pickAt = -1; // nothing highlighted until you hover or steer
  /* the prompt the choice belongs to takes the cursor, so the block is anchored */
  TERM.index = suggestions().findIndex((c) => c.name === cmd.name);
  drawList();
  drawPick({ fresh: true });
}

function closePick() {
  TERM.pick = null;
  drawPick();
}

function commitPick() {
  const opt = TERM.pick?.picks.options[TERM.pickAt];
  if (!opt) return;
  closePick();
  if (opt.current) return; // already there — the answer is a no-op
  run({ name: opt.name, run: opt.run });
}

function drawPick(opts = {}) {
  const box = el("pickBlock");
  if (!box) return;

  const spec = TERM.pick?.picks;
  box.hidden = !spec;
  if (!spec) {
    box.textContent = "";
    return;
  }

  /* rebuilt only on open — moving through the options must not replay the reveal */
  if (opts.fresh || !box.firstChild) {
    box.textContent = "";
    const ask = document.createElement("p");
    ask.className = "pick-ask mask";
    const ink = document.createElement("span");
    ink.className = "ink accent";
    ink.textContent = spec.prompt;
    ask.append(ink);

    const list = document.createElement("ul");
    list.className = "pick-list";
    spec.options.forEach((o, i) => {
      const row = document.createElement("li");
      row.className = "pick-row";
      const btn = document.createElement("button");
      btn.className = "node mask";
      btn.tabIndex = -1;
      btn.append(Object.assign(document.createElement("span"), { className: "ink" }));
      btn.addEventListener("mousedown", (e) => e.preventDefault());
      btn.addEventListener("click", () => {
        if (TERM.busy) return;
        TERM.pickAt = i;
        commitPick();
        focusPrompt();
      });
      row.append(btn);
      list.append(row);
    });

    box.append(ask, list);
    cascadePick(box);
  }

  [...box.querySelectorAll(".pick-row")].forEach((row, i) => {
    const label = spec.options[i].label;
    row.classList.toggle("is-active", i === TERM.pickAt);
    const ink = row.querySelector(".ink");
    const text = i === TERM.pickAt ? `[${label}]` : label;
    if (ink.textContent !== text) ink.textContent = text;
  });
}

/* the question, then its options — the same line-at-a-time reveal as the rail */
function cascadePick(box, step = 34) {
  if (reduced()) return;
  [...box.querySelectorAll(".mask")].forEach((node, i) => {
    const d = i * step;
    node.style.setProperty("--d", `${d}ms`);
    replay(node, "enter");
    setTimeout(() => node.classList.remove("enter"), d + 560);
  });
}

function drawArg() {
  const box = el("argLine");
  if (!box) return;
  const asks = argOf();
  box.hidden = !asks;
  if (!asks) return;

  box.textContent = "";
  const key = document.createElement("span");
  key.className = "arg-key accent";
  key.textContent = asks;
  const val = document.createElement("span");
  val.className = "arg-val";
  const typed = document.createElement("span");
  typed.textContent = TERM.arg;
  const caret = document.createElement("span");
  caret.className = "caret";
  caret.textContent = " ";
  val.append(typed, caret);
  box.append(key, val);
}

function drawCaret() {
  const line = termEls.line;
  const typing = TERM.input.length > 0;

  /* One command line, always. Idle it is the last thing run (in the
     transcript); the moment you type, your line takes its place. */
  line.hidden = !typing;
  termEls.transcript.hidden = typing;
  if (!typing) return;

  const text = TERM.input;
  const at = Math.min(TERM.cursor, text.length);
  const before = text.slice(0, at);
  const under = text[at] ?? " ";
  const after = text.slice(at + 1);

  termEls.mirror.textContent = "";
  const pre = document.createElement("span");
  pre.textContent = before;
  const caret = document.createElement("span");
  caret.className = "caret";
  caret.textContent = under;
  const post = document.createElement("span");
  post.textContent = after;
  termEls.mirror.append(pre, caret, post);
}

function drawList() {
  const list = suggestions();
  if (TERM.index >= list.length) TERM.index = list.length ? 0 : -1;

  const box = termEls.list;
  const previous = new Map();
  for (const el of box.children) previous.set(el.dataset.name, el);

  box.textContent = "";

  const filtering = !!TERM.input.trim();

  list.forEach((cmd, i) => {
    const active = i === TERM.index;
    const row = previous.get(cmd.name) || document.createElement("li");
    row.dataset.name = cmd.name;
    row.className = [
      "suggestion",
      active ? "is-active" : "",
      cmd.branch ? "is-branch" : "",
      cmd.onPath ? "on-path" : "",
    ]
      .filter(Boolean)
      .join(" ");
    // searching flattens the tree — matches are absolute, wherever they live
    row.style.setProperty("--depth", filtering ? 0 : cmd.depth || 0);

    if (!row.firstChild) {
      const btn = document.createElement("button");
      btn.className = "node mask";
      btn.tabIndex = -1;
      const ink = document.createElement("span");
      ink.className = "ink";
      btn.append(ink);
      btn.addEventListener("mousedown", (e) => e.preventDefault());
      row.append(btn);
    }

    const ink = row.querySelector(".ink");
    const suffix = cmd.branch ? "/" : "";
    const base = `${cmd.name}${suffix}`;
    const label = active ? `[${base}]` : base;
    if (ink.textContent !== label) ink.textContent = label;
    row.querySelector("button").onclick = () => {
      if (TERM.busy) return;
      setLine("");
      run(cmd);
      focusPrompt();
    };

    box.append(row);
  });

  revealActive();

  if (!list.length && TERM.input.trim()) {
    const empty = document.createElement("li");
    empty.className = "suggestion is-empty";
    empty.textContent = `no command matches "${TERM.input.trim()}"`;
    box.append(empty);
  }
}

/* history stays pinned to its newest line; the docked prompt needs no scrolling */
function scrollToPrompt() {
  const sb = termEls.scrollback;
  if (sb) sb.scrollTop = sb.scrollHeight;
}

/* After moving through the tree the cursor should sit where you landed, so the
   bracket means "you are here" as well as "this is selected". */
function syncCursor() {
  const list = suggestions();
  TERM.index = list.findIndex((c) => c.current); // -1 at home: nothing to mark
  drawList();
}

function revealActive() {
  termEls.list?.querySelector(".suggestion.is-active")?.scrollIntoView({ block: "nearest" });
}

/* ── transcript ────────────────────────────────────────────────── */

function echo(command) {
  /* one command at a time: the rail shows what is running, not a history */
  termEls.transcript.textContent = "";
  termEls.transcript.hidden = false;

  const entry = document.createElement("div");
  entry.className = "entry";

  const cmd = document.createElement("p");
  cmd.className = "entry-cmd mask";
  const ink = document.createElement("span");
  ink.className = "ink";
  ink.textContent = `> ${command}`;
  cmd.append(ink);
  entry.append(cmd);

  termEls.transcript.append(entry);
  replay(cmd, "enter");
  scrollToPrompt();
  return entry;
}

let spin = null;

function setStatus(entry, text) {
  clearInterval(spin);
  let row = entry.querySelector(".entry-status");

  if (!text) {
    row?.remove();
    return;
  }
  if (!row) {
    row = document.createElement("p");
    row.className = "entry-status";
    row.innerHTML = `<span class="spin"></span><span class="mask"><span class="ink"></span></span>`;
    entry.append(row);
    replay(row.querySelector(".mask"), "enter");
  }
  row.querySelector(".ink").textContent = text;

  const frames = ["|", "/", "-", "\\"];
  let i = 0;
  const dot = row.querySelector(".spin");
  dot.textContent = frames[0];
  spin = setInterval(() => {
    dot.textContent = frames[++i % frames.length];
  }, 90);

  scrollToPrompt();
}

function setResult(entry, lines, tone = "") {
  setStatus(entry, null);
  const out = document.createElement("div");
  out.className = `entry-out ${tone}`.trim();
  for (const l of lines) out.append(line(l));
  entry.append(out);

  [...out.children].forEach((child, i) => {
    child.style.setProperty("--d", `${Math.min(i, 8) * 30}ms`);
    child.classList.add("enter");
    setTimeout(() => child.classList.remove("enter"), 700 + i * 30);
  });

  scrollToPrompt();
}

function clearTranscript() {
  termEls.transcript.textContent = "";
  scrollToPrompt();
}

/* ── running ───────────────────────────────────────────────────── */

async function run(cmd) {
  /* some prompts ask before they go anywhere */
  if (cmd.picks) return openPick(cmd);
  closePick();

  TERM.history.push(cmd.name);
  TERM.histAt = -1;

  const entry = echo(cmd.echo || cmd.name);
  TERM.busy = true;
  termEls.line.classList.add("is-busy");
  drawList();

  try {
    await cmd.run(entry, TERM.arg);
  } catch (err) {
    setResult(entry, [String(err && err.message ? err.message : err)], "is-error");
  }

  TERM.busy = false;
  termEls.line.classList.remove("is-busy");
  TERM.arg = "";
  termEls.input.value = "";
  drawPrompt();
  focusPrompt();
}

function runUnknown(text) {
  const entry = echo(text);
  setResult(entry, [`command not found: ${text}`, "type to filter, ↑↓ to choose, ⏎ to run"], "is-error");
  setLine("");
}
