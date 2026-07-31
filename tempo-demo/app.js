/* Temporary: product images are hidden. Flip to false to bring them back —
   nothing else needs changing, the layouts keep their space either way. */
const HIDE_IMAGES = true;

const el = (id) => document.getElementById(id);
const money = (n) => `$ ${n.toFixed(2)}`;
const item = (id) => [...APPAREL, ...ACCESSORIES].find((i) => i.id === id);

const state = {
  phase: "boot", // boot → landing → loading → section
  route: "home",
  cart: [],
  zoom: false,
  payment: "Credit card",
  billingSame: true,
  notice: null,
  transitioning: false,
  catalog: {
    apparel: { selectedId: "sweatshirt", size: "M", qty: 1, sort: "newest", brand: null, query: "" },
    accessories: { selectedId: "clock", size: null, qty: 1, sort: "newest", brand: null, query: "" },
  },
};

/* last spec-panel values, so swapping product rolls the fields instead of cutting */
let lastSpec = {};
let lastHero = null;
let lastHeaderRoute = null;
let lastHeadSig = null;

const isCatalog = (s) => s === "apparel" || s === "accessories";
const source = (s) => (s === "apparel" ? APPAREL : ACCESSORIES);
const view = (s) => state.catalog[s];

/* display name, as the list and spec show it: "TEMPO T-SHIRT" */
const label = (i) => `${i.brand} ${i.name}`;

function visibleItems(s) {
  const v = view(s);
  let items = source(s);

  if (v.brand) items = items.filter((i) => i.brand === v.brand);

  if (v.query.trim()) {
    const q = v.query.trim().toLowerCase();
    items = items.filter((i) => label(i).toLowerCase().includes(q));
  }

  const by = {
    "price-low": (a, b) => a.price - b.price,
    "price-high": (a, b) => b.price - a.price,
    best: (a, b) => b.sales - a.sales,
    alpha: (a, b) => label(a).localeCompare(label(b)),
  }[v.sort];

  return by ? [...items].sort(by) : items; // newest === source order
}

function selected(s) {
  const v = view(s);
  return source(s).find((i) => i.id === v.selectedId) || visibleItems(s)[0] || source(s)[0];
}

/* ── navigation ────────────────────────────────────────────────── */

let nav = 0; // supersedes an in-flight navigation

/* Moving between screens shows its status line, then lands.

   LOAD_MS is deliberately long: the loading state is part of the interface, not
   a wait to be minimised. BEAT_MS covers in-view changes like re-sorting, which
   show no status line — holding those for three seconds would just be an empty
   stage with nothing explaining it. */
const LOAD_MS = 3000;
const BEAT_MS = 260;

/* Every state change runs the same way:
     1. the stage empties — its contents exit on the usual curve
     2. a beat, while the status line says what is happening
     3. the new contents enter
   Each step waits for the one before it. */
async function transitionTo({ entry, status, result, before, after }) {
  const token = ++nav;

  /* the status appears with the command, not after the exit phase — otherwise
     the list below settles twice */
  const loads = !!(entry && status);
  if (loads) setStatus(entry, status);

  before?.();
  state.transitioning = true;
  await render();
  if (token !== nav) return;

  await wait(loads ? LOAD_MS : BEAT_MS);
  if (token !== nav) return;

  after?.();
  state.transitioning = false;
  await render({ fresh: true });
  syncCursor(); // mark where we landed, however we got here

  if (entry) {
    const lines = result?.();
    if (lines && lines.length) setResult(entry, lines);
    else setStatus(entry, null);
  }
}

/* ── routes ────────────────────────────────────────────────────── */

/* The sitemap, as a tree. Each node owns the commands available *at* it —
   nothing from a parent leaks down, so the completions always describe exactly
   where you are and entering one reads as descending into it. */

/* ── routes ────────────────────────────────────────────────────── */

/* Every prompt is a single, flat destination. No branches, no sub-prompts,
   nothing to climb out of: any prompt is reachable from any other in one step.
   Sorting and filtering aren't destinations at all — they're properties of a
   view, so they live on the view's own header. */
const ROUTES = {
  home: { stage: null },
  apparel: { stage: "catalog" },
  accessories: { stage: "catalog" },
  find: { stage: "find" },
  compare: { stage: "compare" },
  faq: { stage: "faq" },
  about: { stage: "about" },
  shipping: { stage: "shipping" },
  contact: { stage: "contact" },
  cart: { stage: "cart" },
  checkout: { stage: "checkout" },
  detail: { stage: "detail" },
};

const here = () => state.route;
const stageRoute = () => (state.route === "home" ? null : state.route);
const collection = () => (state.route === "accessories" ? "accessories" : "apparel");
const routePath = () => (state.route === "home" ? "mpp" : `mpp/${state.route}`);

/* The prompts, in the order the terminal lists them. The same list everywhere. */
function routeCommands() {
  const rows = MENU.map((m) =>
    cmd(m.label, {
      alias: [m.id],
      echo: m.echo,
      hidden: m.hidden,
      asks: m.asks,
      picks: picksOf(m),
      current: state.route === m.route || !!m.owns?.includes(state.route),
      run: (entry, arg) => {
        if (m.route === "find") view(collection()).query = arg || "";
        return goTo(m.route, { entry });
      },
    })
  );

  /* Checkout and Pay are actions on the cart view, not destinations — they sit
     on the stage, so this list stays identical wherever you are. */
  rows.push(cmd("Checkout", { alias: ["checkout"], hidden: true, run: (entry) => goTo("checkout", { entry }) }));
  rows.push(cmd("Pay now", { alias: ["pay"], hidden: true, run: (entry) => payNow(entry) }));

  rows.push(cmd("Help", { alias: ["help", "?"], hidden: true, run: (entry) => setResult(entry, HELP_LINES) }));
  rows.push(cmd("Clear", { alias: ["clear", "cls"], hidden: true, run: () => clearTranscript() }));
  return rows;
}

const HELP_LINES = [
  "type to filter    \u2191\u2193 choose    \u23ce run",
  "sort and filter live on the view header",
];

const cmd = (name, opts) => ({ name, ...opts });

/* A prompt can offer a choice instead of a destination. Each option carries the
   route it opens, so committing one is an ordinary command run — same echo, same
   loading state, same result line. */
function picksOf(m) {
  if (!m.picks) return null;
  return {
    prompt: m.picks.prompt,
    options: m.picks.options.map((o) => {
      const spec = MENU.find((x) => x.route === o.route) || {};
      return {
        label: o.label,
        route: o.route,
        name: spec.label || o.label,
        current: state.route === o.route,
        run: (entry) => goTo(o.route, { entry }),
      };
    }),
  };
}
/* live preview: while typing a Find query, the results follow along */
function argInput(text) {
  if (state.route !== "find") return;
  view(collection()).query = text;
  renderStage();
}

/* ── moving ────────────────────────────────────────────────────── */

/* One step, always. */
function goTo(id, { entry, status } = {}) {
  const spec = MENU.find((m) => m.route === id) || {};
  if (!ROUTES[id] || state.route === id) return;

  return transitionTo({
    entry,
    status: status || spec.loading || `opening ${id}..`,
    before: () => {
      state.phase = "loading";
      lastSpec = {};
      lastHero = null;
      if (id !== "find") view(collection()).query = "";
      if (id !== "detail") state.zoom = false;
      state.route = id;
    },
    after: () => {
      state.phase = "section";
    },
    result: () => routeResult(id),
  });
}

function routeResult(id) {
  if (id === "apparel" || id === "accessories") return [`${visibleItems(collection()).length} items found`];
  if (id === "find") return ["type to filter the catalog"];
  if (id === "compare") return ["two items side by side"];
  if (id === "detail") return [`${label(selected(collection())).toLowerCase()} — ${money(selected(collection()).price)}`];
  if (id === "checkout") {
    const n = state.cart.reduce((a, l) => a + l.qty, 0);
    return [n ? `${n} item(s) to pay — ${money(cartTotal())}` : "cart is empty"];
  }
  if (id === "cart") {
    const n = state.cart.reduce((a, l) => a + l.qty, 0);
    return [n ? `${n} item(s) \u2014 ${money(cartTotal())}` : "cart is empty"];
  }
  const spec = MENU.find((m) => m.route === id);
  return [`${(spec?.title || id).toLowerCase()} ready`];
}

function selectItem(s, id) {
  const v = view(s);
  v.selectedId = id;
  const i = source(s).find((x) => x.id === id);
  v.size = i?.sizes ? i.sizes[Math.min(2, i.sizes.length - 1)] : null;
  v.qty = 1;
}

function addLine(item, size, qty) {
  const existing = state.cart.find((l) => l.id === item.id && l.size === size);
  if (existing) existing.qty += qty;
  else state.cart.push({ id: item.id, size, qty });
  renderCartCount();
}

function payNow(entry) {
  return transitionTo({
    entry,
    status: "Payment..",
    before: () => {
      state.phase = "loading";
    },
    after: () => {
      state.cart = [];
      state.route = "home";
      state.phase = "landing";
    },
    result: () => ["payment successful \u2014 order 4F2A9C confirmed"],
  });
}

/* ── the view's own controls: sort and filter ──────────────────── */

function stageControls(s) {
  const v = view(s);
  const bar = document.createElement("div");
  bar.className = "controls";

  const group = (key, title, options, activeId, pick) => {
    const g = document.createElement("div");
    g.className = "control-group";
    g.append(line(title, { cls: "control-label" }), line("/", { cls: "control-slash" }));

    for (const o of options) {
      const b = document.createElement("button");
      b.className = `control mask${o.id === activeId ? " is-on" : ""}`;
      b.append(Object.assign(document.createElement("span"), { className: "ink", textContent: o.label }));
      b.addEventListener("click", () => {
        if (TERM.busy) return;
        pick(o.id === activeId ? null : o.id);
      });
      g.append(b);
    }
    bar.append(g);
  };

  group("sort", "SORT", SORTS, v.sort, (id) =>
    transitionTo({
      before: () => (v.sort = id || "newest"),
    })
  );

  group(
    "filter",
    "FILTER",
    BRANDS.map((b) => ({ id: b, label: b.toUpperCase() })),
    v.brand,
    (id) =>
      transitionTo({
        before: () => (v.brand = id),
      })
  );

  return bar;
}

/* ── stage: catalog ────────────────────────────────────────────── */

function catalogStage(s) {
  const v = view(s);
  const frag = document.createDocumentFragment();
  const items = visibleItems(s);
  if (!items.some((i) => i.id === v.selectedId) && items.length) v.selectedId = items[0].id;

  const list = document.createElement("ul");
  list.className = "products";
  if (!items.length) {
    const li = document.createElement("li");
    li.append(line("No items match.", { cls: "empty" }));
    list.append(li);
  }
  for (const i of items) {
    const li = document.createElement("li");
    const active = i.id === v.selectedId;
    if (active) li.className = "is-active";
    const btn = document.createElement("button");
    btn.className = "mask";
    btn.dataset.key = `prod:${i.id}`;
    const ink = document.createElement("span");
    ink.className = "ink";
    ink.textContent = active ? `[${label(i)}]` : label(i);
    btn.append(ink);
    btn.addEventListener("click", () => {
      if (TERM.busy) return;
      const already = i.id === v.selectedId;
      selectItem(s, i.id);
      // first click previews it, a second opens its page
      if (already) goTo("detail", { status: `opening ${label(i).toLowerCase()}..` });
      else renderStage();
    });
    li.append(btn);
    list.append(li);
  }

  const sel = selected(s);
  const spec = document.createElement("div");
  spec.className = "spec";
  specRows(spec, s, sel, v);

  const hero = document.createElement("figure");
  hero.className = sel.img ? "hero" : "hero is-empty";
  hero.dataset.key = "hero";
  // a different product arrives on its own, rather than cutting in place
  if (lastHero !== null && lastHero !== sel.id) hero.classList.add("is-swapping");
  lastHero = sel.id;
  hero.innerHTML = sel.img
    ? `<img src="${sel.img}" alt="${sel.name}" />`
    : `<figcaption class="hero-empty">[ render pending ]</figcaption>`;

  frag.append(hero, list, spec);
  return frag;
}

/* NAME / PRICE / SIZE / AMOUNT / ADD TO CART — shared by the overview and the
   product page so both stay in step. */
function specRows(spec, s, sel, v) {
  const row = (key, valueNode, dataKey) => {
    const r = document.createElement("div");
    r.className = "spec-row";
    r.dataset.key = `spec:${dataKey}`;
    r.append(line(key, { cls: "spec-key" }), valueNode);
    spec.append(r);
    return r;
  };

  /* values roll over from whatever the panel showed a moment ago */
  const value = (field, text, cls = "spec-val") => {
    const wrap = document.createElement("span");
    wrap.className = `mask ${cls}`;
    const ink = document.createElement("span");
    ink.className = "ink";
    wrap.append(ink);
    if (lastSpec[field] !== undefined) ink.dataset.v = lastSpec[field];
    roll(ink, text);
    lastSpec[field] = text;
    return wrap;
  };

  row("NAME:", value("name", label(sel)), "name");
  row("PRICE:", value("price", money(sel.price)), "price");

  if (sel.sizes) {
    /* every size on one line, the chosen one bracketed — no dropdown to open */
    const sizes = document.createElement("div");
    sizes.className = "sizes";
    for (const sz of sel.sizes) {
      const b = document.createElement("button");
      const on = sz === v.size;
      b.className = `size mask${on ? " is-on" : ""}`;
      b.append(Object.assign(document.createElement("span"), { className: "ink", textContent: on ? `[${sz}]` : sz }));
      b.addEventListener("click", () => {
        v.size = sz;
        renderStage();
      });
      sizes.append(b);
    }
    row("SIZE:", sizes, "size");
  }

  row("AMOUNT:", stepper(v, "amount"), "amount");

  const actions = document.createElement("div");
  actions.className = "spec-row";
  actions.dataset.key = "spec:action";
  const add = document.createElement("button");
  add.className = "add-to-cart mask";
  const addInk = document.createElement("span");
  addInk.className = "ink";
  addInk.textContent = "[ADD TO CART]";
  addInk.dataset.v = "[ADD TO CART]";
  add.append(addInk);
  add.addEventListener("click", () => addToCart(sel, v, addInk));
  actions.append(line("", { cls: "spec-key" }), add);
  spec.append(actions);
}

function stepper(v, field) {
  const wrap = document.createElement("div");
  wrap.className = "stepper";

  const button = (cls, label, icon, fn) => {
    const b = document.createElement("button");
    b.className = `icon-btn ${cls}`;
    b.setAttribute("aria-label", label);
    b.innerHTML = `<img src="assets/${icon}.svg" alt="" class="icon" />`;
    b.addEventListener("click", fn);
    return b;
  };

  const count = document.createElement("span");
  count.className = "qty";
  if (field && lastSpec[field] !== undefined) count.dataset.v = lastSpec[field];
  roll(count, String(v.qty));
  if (field) lastSpec[field] = String(v.qty);

  const minus = button("is-minus", "decrease amount", "minus", () => {
    if (v.qty <= 1) return;
    v.qty -= 1;
    roll(count, String(v.qty));
    if (field) lastSpec[field] = String(v.qty);
    minus.disabled = v.qty <= 1;
  });
  minus.disabled = v.qty <= 1;

  const plus = button("is-plus", "increase amount", "plus", () => {
    if (v.qty >= 99) return;
    v.qty += 1;
    roll(count, String(v.qty));
    if (field) lastSpec[field] = String(v.qty);
    minus.disabled = false;
  });

  wrap.append(minus, count, plus);
  return wrap;
}

function addToCart(sel, v, labelInk) {
  const existing = state.cart.find((l) => l.id === sel.id && l.size === v.size);
  if (existing) existing.qty += v.qty;
  else state.cart.push({ id: sel.id, size: v.size, qty: v.qty });

  renderCartCount();
  roll(labelInk, "[ADDED]");
  setTimeout(() => roll(labelInk, "[ADD TO CART]"), 1100);
}

/* ── stage: detail ─────────────────────────────────────────────── */

/* The sitemap's leaf: one item, its copy, and the product large. */
function detailStage(s) {
  const v = view(s);
  const item = selected(s);
  const frag = document.createDocumentFragment();

  const spec = document.createElement("div");
  spec.className = "detail-spec";

  const row = (key, valueNode, dataKey) => {
    const r = document.createElement("div");
    r.className = "spec-row";
    r.dataset.key = `detail:${dataKey}`;
    r.append(line(key, { cls: "spec-key" }), valueNode);
    spec.append(r);
    return r;
  };

  row("NAME:", line(label(item), { cls: "spec-val" }), "name");
  row("PRICE:", line(money(item.price), { cls: "spec-val" }), "price");
  row("DESCRIPTION:", para(describe(item), { tag: "p", cls: "detail-desc" }), "desc");

  if (item.sizes) {
    const sizes = document.createElement("div");
    sizes.className = "sizes";
    for (const sz of item.sizes) {
      const b = document.createElement("button");
      const on = sz === v.size;
      b.className = `size mask${on ? " is-on" : ""}`;
      b.append(Object.assign(document.createElement("span"), { className: "ink", textContent: on ? `[${sz}]` : sz }));
      b.addEventListener("click", () => {
        v.size = sz;
        renderStage();
      });
      sizes.append(b);
    }
    row("SIZE:", sizes, "size");
  } else {
    row("SIZE:", line("ONE SIZE", { cls: "spec-val" }), "size");
  }

  row("AMOUNT:", stepper(v, "amount"), "amount");

  const add = document.createElement("button");
  add.className = "add-to-cart mask";
  const addInk = document.createElement("span");
  addInk.className = "ink";
  addInk.textContent = "[ADD TO CART]";
  addInk.dataset.v = "[ADD TO CART]";
  add.append(addInk);
  add.addEventListener("click", () => addToCart(item, v, addInk));
  row("", add, "action");

  const art = document.createElement("figure");
  art.className = `detail-art${state.zoom ? " is-zoomed" : ""}${item.img ? "" : " is-empty"}`;
  art.dataset.key = "detail:art";
  art.innerHTML = item.img
    ? `<img src="${item.img}" alt="${label(item)}" />`
    : `<figcaption class="hero-empty">[ render pending ]</figcaption>`;

  frag.append(spec, art);
  return frag;
}

/* ── stage: product page + compare ─────────────────────────────── */

/* The leaf of the sitemap: one product, no list around it. */
function productStage(s) {
  const v = view(s);
  const item = selected(s);
  const frag = document.createDocumentFragment();

  const hero = document.createElement("figure");
  hero.className = item.img ? "hero" : "hero is-empty";
  hero.dataset.key = "hero";
  hero.innerHTML = item.img
    ? `<img src="${item.img}" alt="${item.name}" />`
    : `<figcaption class="hero-empty">[ render pending ]</figcaption>`;

  const spec = document.createElement("div");
  spec.className = "spec";
  specRows(spec, s, item, v);

  frag.append(hero, spec);
  return frag;
}

/* Two apparel pages side by side, per the sitemap. */
function compareStage() {
  const s = collection();
  const items = visibleItems(s);
  const left = selected(s);
  const right =
    items.find((i) => i.id === state.compareWith && i.id !== left.id) ||
    items.find((i) => i.id !== left.id) ||
    items[0];
  const frag = document.createDocumentFragment();

  for (const [i, item] of [left, right].entries()) {
    const panel = document.createElement("section");
    panel.className = "compare-panel";
    panel.dataset.key = `cmp:${item.id}`;

    const hero = document.createElement("figure");
    hero.className = item.img ? "hero" : "hero is-empty";
    hero.innerHTML = item.img
      ? `<img src="${item.img}" alt="${item.name}" />`
      : `<figcaption class="hero-empty">[ render pending ]</figcaption>`;

    const rows = document.createElement("div");
    rows.className = "compare-spec";
    rows.append(
      compareRow("NAME:", label(item)),
      compareRow("PRICE:", money(item.price)),
      compareRow("SIZES:", (item.sizes || ["ONE SIZE"]).join(" "))
    );

    /* the second panel can be swapped without leaving the route */
    if (i === 1) {
      const swap = document.createElement("button");
      swap.className = "node mask compare-swap";
      swap.append(Object.assign(document.createElement("span"), { className: "ink", textContent: "[SWAP]" }));
      swap.addEventListener("click", () => {
        const pool = items.filter((x) => x.id !== left.id);
        const next = pool[(pool.findIndex((x) => x.id === item.id) + 1) % pool.length];
        state.compareWith = next.id;
        renderStage();
      });
      rows.append(swap);
    }

    panel.append(hero, rows);
    frag.append(panel);
  }
  return frag;
}

function compareRow(key, value) {
  const row = document.createElement("div");
  row.className = "spec-row";
  row.append(line(key, { cls: "spec-key" }), line(value, { cls: "spec-val" }));
  return row;
}

/* ── stage: prose + faq ────────────────────────────────────────── */

function proseStage(blocks) {
  const wrap = document.createElement("div");
  wrap.className = "prose";
  blocks.forEach((b, i) => {
    const section = document.createElement("section");
    section.dataset.key = `prose:${i}`;
    section.append(line(b.h, { tag: "h2" }));
    for (const p of b.p) section.append(para(p));
    wrap.append(section);
  });
  return wrap;
}

function faqStage() {
  const wrap = document.createElement("div");
  wrap.className = "faq";
  FAQ_GROUPS.forEach((group, gi) => {
    const row = document.createElement("section");
    row.className = "faq-group";
    row.dataset.key = `faq:${gi}`;
    row.append(line(group.label, { tag: "h2", cls: "faq-label" }));

    const col = document.createElement("div");
    col.className = "faq-entries";
    for (const e of group.entries) {
      const entry = document.createElement("div");
      entry.className = "faq-entry";
      entry.append(line(e.q, { tag: "h3" }));
      for (const a of e.a) entry.append(para(a));
      col.append(entry);
    }
    row.append(col);
    wrap.append(row);
  });
  return wrap;
}

/* ── stage: cart / checkout / account ──────────────────────────── */

const cartTotal = () => state.cart.reduce((n, l) => n + item(l.id).price * l.qty, 0);

function cartStage() {
  const wrap = document.createElement("div");
  wrap.className = "cart";

  if (!state.cart.length) {
    const empty = document.createElement("div");
    empty.dataset.key = "cart:empty";
    empty.append(line("Cart is empty.", { cls: "cart-empty" }));
    wrap.append(empty);
  }

  for (const l of state.cart) {
    const i = item(l.id);
    const row = document.createElement("div");
    row.className = "cart-row";
    row.dataset.key = `cart:${l.id}:${l.size}`;

    row.append(line(l.size ? `${label(i)} (${l.size})` : label(i), { cls: "cart-name" }));

    const qty = document.createElement("div");
    qty.className = "cart-qty";

    const minus = document.createElement("button");
    minus.className = "node mask is-minus";
    minus.setAttribute("aria-label", `remove one ${i.name}`);
    minus.append(Object.assign(document.createElement("span"), { className: "ink", textContent: "-" }));

    const count = document.createElement("span");
    count.className = "qty";
    count.dataset.v = `[${l.qty}]`;
    count.textContent = `[${l.qty}]`;

    const plus = document.createElement("button");
    plus.className = "node mask is-plus";
    plus.setAttribute("aria-label", `add one ${i.name}`);
    plus.append(Object.assign(document.createElement("span"), { className: "ink", textContent: "+" }));

    const price = line(money(i.price * l.qty), { cls: "cart-price" });
    price.querySelector(".ink").dataset.v = money(i.price * l.qty);

    const sync = () => {
      roll(count, `[${l.qty}]`);
      roll(price.querySelector(".ink"), money(i.price * l.qty));
      const totalInk = el("cartTotal");
      if (totalInk) roll(totalInk, money(cartTotal()));
      renderCartCount();
    };

    minus.addEventListener("click", () => {
      l.qty -= 1;
      if (l.qty < 1) {
        state.cart = state.cart.filter((x) => x !== l);
        renderCartCount();
        renderStage();
        return;
      }
      sync();
    });

    plus.addEventListener("click", () => {
      if (l.qty >= 99) return;
      l.qty += 1;
      sync();
    });

    qty.append(minus, count, plus);
    row.append(qty, price);
    wrap.append(row);
  }

  const total = document.createElement("div");
  total.className = "cart-row cart-total";
  total.dataset.key = "cart:total";
  const totalValue = line(money(cartTotal()), { cls: "cart-price" });
  const totalInk = totalValue.querySelector(".ink");
  totalInk.id = "cartTotal";
  totalInk.dataset.v = money(cartTotal());
  total.append(line("Total", { cls: "cart-name" }), document.createElement("span"), totalValue);
  wrap.append(total);

  const actions = document.createElement("div");
  actions.className = "cart-row cart-actions";
  actions.dataset.key = "cart:actions";

  const shop = document.createElement("button");
  shop.className = "node mask";
  shop.append(Object.assign(document.createElement("span"), { className: "ink", textContent: "[continue SHOPPING]" }));
  shop.addEventListener("click", () => {
    if (!TERM.busy) goTo("apparel");
  });

  const checkout = document.createElement("button");
  checkout.className = "add-to-cart mask";
  checkout.append(Object.assign(document.createElement("span"), { className: "ink", textContent: "[Checkout]" }));
  checkout.disabled = !state.cart.length;
  checkout.addEventListener("click", () => {
    if (!TERM.busy) goTo("checkout");
  });

  actions.append(shop, document.createElement("span"), checkout);
  wrap.append(actions);
  return wrap;
}

/* Cart on the left, the form on the right — the Checkout frame. */
function checkoutStage() {
  const frag = document.createDocumentFragment();

  const left = document.createElement("section");
  left.className = "checkout-cart";
  left.dataset.key = "co:cart";
  left.append(panelHead("Cart"));

  const lines_ = document.createElement("div");
  lines_.className = "co-lines";
  for (const l of state.cart) {
    const i = item(l.id);
    const row = document.createElement("div");
    row.className = "co-line";
    row.append(line(label(i), { cls: "co-name" }));

    const qty = document.createElement("div");
    qty.className = "cart-qty";
    const step = (text, delta, aria) => {
      const b = document.createElement("button");
      b.className = "node mask";
      b.setAttribute("aria-label", aria);
      b.append(Object.assign(document.createElement("span"), { className: "ink", textContent: text }));
      b.addEventListener("click", () => {
        l.qty += delta;
        if (l.qty < 1) state.cart = state.cart.filter((x) => x !== l);
        renderCartCount();
        renderStage();
      });
      return b;
    };
    qty.append(step("-", -1, `one fewer ${i.name}`), line(`[${l.qty}]`, { cls: "qty" }), step("+", 1, `one more ${i.name}`));

    row.append(qty, line(money(i.price * l.qty), { cls: "co-price" }));
    lines_.append(row);
  }
  if (!state.cart.length) lines_.append(line("Cart is empty.", { cls: "cart-empty" }));

  const total = document.createElement("div");
  total.className = "co-line co-total";
  total.append(line("Total", { cls: "co-name" }), document.createElement("span"), line(money(cartTotal()), { cls: "co-price" }));

  left.append(lines_, total);

  const right = document.createElement("section");
  right.className = "checkout-form";
  right.dataset.key = "co:form";
  right.append(panelHead("Checkout"));
  right.append(checkoutForm());

  frag.append(left, right);
  return frag;
}

function panelHead(text) {
  const h = document.createElement("div");
  h.className = "co-head";
  const dot = document.createElement("span");
  dot.className = "dot";
  h.append(dot, line(text, { cls: "label" }));
  return h;
}

function checkoutForm() {
  const form = document.createElement("div");
  form.className = "co-form";

  const field = (f) => {
    const wrap = document.createElement("label");
    wrap.className = "co-field";
    const input = document.createElement(f.kind === "select" ? "div" : "input");
    if (f.kind === "select") {
      input.className = "co-input is-select";
      input.textContent = f.label;
    } else {
      input.className = "co-input";
      input.type = "text";
      input.placeholder = f.label;
      input.autocomplete = "off";
      input.setAttribute("aria-label", f.label);
    }
    wrap.append(input);
    return wrap;
  };

  for (const block of CHECKOUT_FORM) {
    const sec = document.createElement("div");
    sec.className = "co-section";
    sec.append(line(block.section, { tag: "h3", cls: "co-section-title" }));

    for (const row of block.fields || []) {
      const r = document.createElement("div");
      r.className = "co-row";
      for (const f of row) r.append(field(f));
      sec.append(r);
    }

    for (const opt of block.options || []) {
      const o = document.createElement("div");
      o.className = `co-option${state.payment === opt.label ? " is-on" : ""}`;

      const pick = document.createElement("button");
      pick.className = "co-radio";
      pick.append(Object.assign(document.createElement("span"), { className: "radio" }), line(opt.label, { cls: "co-radio-label" }));
      pick.addEventListener("click", () => {
        state.payment = opt.label;
        renderStage();
      });
      o.append(pick);

      if (state.payment === opt.label && opt.fields) {
        for (const row of opt.fields) {
          const r = document.createElement("div");
          r.className = "co-row";
          for (const f of row) r.append(field(f));
          o.append(r);
        }
        if (opt.toggle) {
          const t = document.createElement("div");
          t.className = "co-toggle";
          t.append(line(opt.toggle.label, { cls: "co-toggle-label" }));
          for (const choice of opt.toggle.choices) {
            const b = document.createElement("button");
            const on = state.billingSame === (choice === "Yes");
            b.className = `size mask${on ? " is-on" : ""}`;
            b.append(Object.assign(document.createElement("span"), { className: "ink", textContent: on ? `[${choice}]` : choice }));
            b.addEventListener("click", () => {
              state.billingSame = choice === "Yes";
              renderStage();
            });
            t.append(b);
          }
          o.append(t);
        }
      }
      sec.append(o);
    }

    if (block.note) sec.append(para(block.note, { tag: "p", cls: "co-note" }));
    form.append(sec);
  }

  const pay = document.createElement("button");
  pay.className = "add-to-cart mask co-pay";
  pay.append(Object.assign(document.createElement("span"), { className: "ink", textContent: "[Pay now]" }));
  pay.addEventListener("click", () => {
    if (!TERM.busy) payNow();
  });
  form.append(pay);

  return form;
}

function wipStage(title) {
  const wrap = document.createElement("div");
  wrap.className = "wip";
  const p = line(`${title} [WIP]`, { tag: "p", cls: "wip-title" });
  p.dataset.key = "wip:title";
  wrap.append(p);
  return wrap;
}

/* ── render ────────────────────────────────────────────────────── */

function renderStage({ fresh = false, keepFocus = false } = {}) {
  const body = el("stageBody");
  const at = stageRoute();
  const spec = MENU.find((m) => m.route === at);
  const title =
    at === "detail"
      ? collection() === "apparel" ? "Apparel Detail" : "Accessory Detail"
      : spec?.title || ROUTE_TITLES[at] || "";
  roll(el("stageLabel").querySelector(".ink"), title);

  /* Sort + filter belong to the view, so they ride in its header. It is only
     rebuilt when its contents would actually differ — otherwise the arrival
     cascade would be torn down and restarted by the very next render. */
  const head = el("stageControls");
  const v = at === "detail" || at === "apparel" || at === "accessories" || at === "find" ? view(collection()) : null;
  const sig = JSON.stringify([at, v?.sort, v?.brand, state.zoom]);

  if (sig !== lastHeadSig) {
    lastHeadSig = sig;
    const caret = head.querySelector(".find-field input")?.selectionStart;
    head.textContent = "";

    if (at === "detail") {
      /* the frame's zoom affordance, top right of the view */
      const z = document.createElement("button");
      z.className = "control-label mask";
      z.append(Object.assign(document.createElement("span"), { className: "ink", textContent: state.zoom ? "[Zoom in print]" : "Zoom in print" }));
      z.addEventListener("click", () => {
        state.zoom = !state.zoom;
        renderStage();
      });
      head.append(z);
    } else if (at === "apparel" || at === "accessories" || at === "find") {
      head.append(stageControls(collection()));
      const field = head.querySelector(".find-field input");
      if (field && at === "find") {
        field.focus();
        if (caret != null) field.setSelectionRange(caret, caret);
      }
    }

    /* the top nav arrives when you pick a view — once, in sequence */
    if (at && at !== lastHeaderRoute) cascadeHeader();
  }
  lastHeaderRoute = at;

  let variant = "";

  return transition(
    body,
    (frag) => {
      // the stage is empty while a view is loading
      if (state.phase !== "section" || state.transitioning) return;

      switch (at) {
        case "apparel":
        case "accessories":
        case "find":
          variant = "is-catalog";
          frag.append(catalogStage(collection()));
          break;
        case "detail":
          variant = "is-detail";
          frag.append(detailStage(collection()));
          break;
        case "compare":
          variant = "is-compare";
          frag.append(compareStage());
          break;
        case "faq":
          variant = "is-doc";
          frag.append(faqStage());
          break;
        case "about":
          variant = "is-doc";
          frag.append(proseStage(ABOUT));
          break;
        case "shipping":
          variant = "is-doc";
          frag.append(proseStage(SHIPPING));
          break;
        case "contact":
          variant = "is-doc";
          frag.append(proseStage(CONTACT));
          break;
        case "cart":
          variant = "is-doc";
          frag.append(cartStage());
          break;
        case "checkout":
          variant = "is-checkout";
          frag.append(checkoutStage());
          break;
        case "account":
          frag.append(wipStage("Account"));
          break;
      }
    },
    {
      // the layout mode swaps with the content, never under the outgoing screen
      after: () => {
        body.className = `stage-body ${variant}`.trim();
      },
      stagger: fresh ? 40 : 30,
    }
  );
}

/* The header arrives one element at a time, left to right: the mark, the view's
   name, then SORT and FILTER with their options. */
function cascadeHeader(step = 26) {
  if (reduced()) return;
  const header = document.querySelector(".stage .panel-head");
  if (!header) return;

  const order = [header.querySelector(".dot"), ...header.querySelectorAll(".mask")].filter(Boolean);
  order.forEach((node, i) => {
    const d = i * step;
    node.style.setProperty("--d", `${d}ms`);
    const cls = node.querySelector(".ink") ? "enter" : "boot-rise";
    replay(node, cls);
    setTimeout(() => node.classList.remove(cls), d + 560);
  });
}

function renderCartCount() {
  roll(el("cartCount"), String(state.cart.reduce((n, l) => n + l.qty, 0)));
}

function render(opts = {}) {
  const app = el("app");
  app.classList.toggle("no-images", HIDE_IMAGES);
  app.classList.toggle("is-booting", state.phase === "boot");
  app.classList.toggle("is-landing", state.phase === "landing");
  if (state.phase === "boot") return Promise.resolve();

  /* What the rail shows depends on where you are:
       home     banner + question + prompts
       loading  the running command and its status, nothing else
       loaded   the command, its result, then question + prompts   */
  const loading = state.phase === "loading";
  el("boot").hidden = state.phase !== "landing";
  el("ask").hidden = loading;
  el("suggestions").hidden = loading;

  renderCartCount();
  drawList(); // completions depend on which section is open
  return renderStage(opts);
}

/* ── global handlers ───────────────────────────────────────────── */

document.addEventListener("click", () => {
  document.querySelectorAll(".size-menu").forEach((m) => (m.hidden = true));
  document.querySelectorAll(".size-toggle").forEach((t) => t.setAttribute("aria-expanded", "false"));
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") document.querySelectorAll(".size-menu").forEach((m) => (m.hidden = true));
});

el("cartBtn").addEventListener("click", () => {
  if (TERM.busy) return;
  goTo("cart");
});

/* ── boot ──────────────────────────────────────────────────────── */
initTerminal();
render();

/* a beat on a blank frame, then the column arrives */
(async () => {
  await wait(420);
  state.phase = "landing";
  await render({ fresh: true });
  bootCascade();
})();
