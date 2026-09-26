// Parola: app behavior (tabs, AI calls, saving words, flashcards).
// Prompts are in prompts.js, providers in config.js, design in style.css.
(() => {
  const $ = s => document.querySelector(s);
  function el(tag, attrs = {}, ...kids) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === "class") n.className = v;
      else if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
      else if (v !== false && v != null) n.setAttribute(k, v === true ? "" : v);
    }
    for (const k of kids.flat()) if (k != null && k !== false) n.append(k instanceof Node ? k : String(k));
    return n;
  }
  const toast = msg => { const t = $("#toast"); t.textContent = msg; t.classList.add("show"); clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove("show"), 1800); };
  const keyOf = w => w.trim().toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "").slice(0, 120) || "w";

  /* ---------- storage: this device ---------- */
  let words = {};            // key -> entry
  let store = null;          // {save, remove} backend
  const LS = "parola-words-v1";
  const lsLoad = () => { try { return JSON.parse(localStorage.getItem(LS) || "{}"); } catch { return {}; } };
  const lsSave = () => { try { localStorage.setItem(LS, JSON.stringify(words)); } catch {} };

  store = { save: async (k) => lsSave(), remove: async (k) => lsSave() };
  words = lsLoad();

  /* ---------- tabs ---------- */
  let tab = "look";
  document.querySelectorAll("nav.tabs button").forEach(b => b.addEventListener("click", () => {
    tab = b.dataset.tab;
    document.querySelectorAll("nav.tabs button").forEach(x => x.setAttribute("aria-selected", x === b));
    $("#view-look").hidden = tab !== "look";
    $("#view-saved").hidden = tab !== "saved";
    $("#view-correct").hidden = tab !== "correct";
    $("#view-settings").hidden = true;
    $("#view-practice").hidden = tab !== "practice";
    if (tab === "saved") renderList();
    if (tab === "practice") startDeck();
    window.scrollTo(0, 0);
  }));

  function refreshAll() {
    const n = Object.keys(words).length;
    $("#count").textContent = n ? `${n} saved` : "";
    if (tab === "saved") renderList();
    if (current) renderEntry(current);
  }

  /* ---------- lookup ---------- */
  let current = null, ctl = null, currentRun = null;

  /* ---------- AI providers ---------- */
  const SET = "parola-settings-v1";
  let settings = (() => { try { return JSON.parse(localStorage.getItem(SET) || "null"); } catch { return null; } })() || { provider: "gemini", key: "", model: "", base: "" };

  function unwrap(v, needKey) {
    if (Array.isArray(v) && v.length && typeof v[0] === "object") v = v[0];
    if (needKey && v && typeof v === "object" && !(needKey in v)) {
      const inner = Object.values(v).find(x => x && typeof x === "object" && !Array.isArray(x) && needKey in x);
      if (inner) v = inner;
    }
    return v;
  }
  function extractJSON(text, needKey) {
    const t = String(text || "").trim();
    const tries = [t];
    const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/); if (fence) tries.push(fence[1]);
    const a = t.indexOf("{"), b = t.lastIndexOf("}"); if (a >= 0 && b > a) tries.push(t.slice(a, b + 1));
    for (const x of tries) { try { const v = unwrap(JSON.parse(x), needKey); if (!needKey || (v && needKey in v)) return v; } catch {} }
    throw { code: "invalid_json", raw: t };
  }

  async function ask(prompt, signal, opts = {}) {
    const cfg = { ...PROVIDERS[settings.provider], ...settings };
    const model = settings.model || PROVIDERS[settings.provider].model;
    if (!settings.key && settings.provider !== "custom") throw { code: "no_key" };
    let res, text, usage = {};
    try {
      if (settings.provider === "gemini") {
        res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
          method: "POST", signal,
          headers: { "Content-Type": "application/json", "x-goog-api-key": settings.key },
          body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: prompt }] }], generationConfig: Object.assign({ responseMimeType: "application/json", temperature: 0.3, maxOutputTokens: 8192 }, opts.schema ? { responseSchema: opts.schema } : {}) })
        });
        const j = await res.json().catch(() => ({}));
        if (!res.ok) throw { code: res.status, message: j?.error?.message };
        const cand = j.candidates?.[0];
        text = (cand?.content?.parts || []).filter(p => !p.thought).map(p => p.text || "").join("");
        const u = j.usageMetadata || {};
        usage = { input: u.promptTokenCount, output: u.candidatesTokenCount, thinking: u.thoughtsTokenCount, total: u.totalTokenCount };
        if (!text) { addTokens(usage.total); throw { code: "empty", message: cand?.finishReason || j.promptFeedback?.blockReason || "no text", raw: JSON.stringify(j, null, 2) }; }
      } else if (settings.provider === "anthropic") {
        res = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST", signal,
          headers: { "Content-Type": "application/json", "x-api-key": settings.key, "anthropic-version": "2023-06-01", "anthropic-dangerous-direct-browser-access": "true" },
          body: JSON.stringify({ model, max_tokens: 2000, messages: [{ role: "user", content: prompt }] })
        });
        const j = await res.json().catch(() => ({}));
        if (!res.ok) throw { code: res.status, message: j?.error?.message };
        text = (j.content || []).map(c => c.text || "").join("");
        const u = j.usage || {};
        usage = { input: u.input_tokens, output: u.output_tokens, total: (u.input_tokens || 0) + (u.output_tokens || 0) };
      } else {
        const base = (settings.provider === "custom" ? (settings.base || cfg.base) : PROVIDERS[settings.provider].base).replace(/\/$/, "");
        const headers = { "Content-Type": "application/json" };
        if (settings.key) headers.Authorization = `Bearer ${settings.key}`;
        if (settings.provider === "openrouter") { headers["HTTP-Referer"] = location.origin; headers["X-Title"] = "Parola"; }
        res = await fetch(`${base}/chat/completions`, {
          method: "POST", signal, headers,
          body: JSON.stringify(Object.assign({ model, temperature: 0.3, messages: [{ role: "user", content: prompt }] },
            (settings.provider === "openai" || settings.provider === "groq") ? { response_format: { type: "json_object" } } : {}))
        });
        const j = await res.json().catch(() => ({}));
        if (!res.ok) throw { code: res.status, message: j?.error?.message };
        text = j.choices?.[0]?.message?.content || "";
        const u = j.usage || {};
        usage = { input: u.prompt_tokens, output: u.completion_tokens, thinking: u.completion_tokens_details?.reasoning_tokens, total: u.total_tokens };
      }
    } catch (e) {
      if (e?.name === "AbortError") throw { code: "cancelled" };
      if (e?.code) throw e;
      throw { code: "network" };
    }
    addTokens(usage.total);
    lastRun = { raw: text, usage, model, provider: settings.provider, cached: false };
    try { return extractJSON(text, opts.needKey); }
    catch (e) { e.usage = usage; throw e; }
  }

  /* ---------- token meter + raw answer panel ---------- */
  let lastRun = null;
  const TOK = "parola-tokens-v1";
  const today = () => new Date().toISOString().slice(0, 10);
  function tokenDay() { try { const t = JSON.parse(localStorage.getItem(TOK) || "null"); return t && t.date === today() ? t : { date: today(), total: 0, calls: 0 }; } catch { return { date: today(), total: 0, calls: 0 }; } }
  function addTokens(n) { if (!n) return; const t = tokenDay(); t.total += n; t.calls += 1; try { localStorage.setItem(TOK, JSON.stringify(t)); } catch {} showTokens(); }
  function showTokens() { const t = tokenDay(); $("#tokens").textContent = t.total ? `${fmt(t.total)} tokens today` : ""; }
  const fmt = n => (n || 0).toLocaleString();
  function rawPanel(run) {
    if (!run) return null;
    const u = run.usage || {};
    const summary = run.cached ? "Raw AI answer, from cache: 0 tokens" : `Raw AI answer: ${fmt(u.total)} tokens`;
    const parts = run.cached ? ["Loaded from this device, no tokens spent."] : [
      `Input ${fmt(u.input)}`, `output ${fmt(u.output)}`, u.thinking ? `thinking ${fmt(u.thinking)}` : null
    ].filter(Boolean);
    const day = tokenDay();
    let pretty = String(run.raw || "");
    try { pretty = JSON.stringify(JSON.parse(pretty), null, 2); } catch {}
    return el("details", { class: "raw" },
      el("summary", {}, summary),
      el("p", { class: "rawmeta" }, parts.join(", ") + (run.cached ? "" : ".")),
      el("p", { class: "rawmeta" }, `Model: ${run.model || "unknown"}. Today: ${fmt(day.total)} tokens in ${day.calls} request${day.calls === 1 ? "" : "s"}.`),
      el("pre", {}, pretty));
  }

  // cache lookups for a day to save your quota
  const CACHE = "parola-cache-v1";
  const cacheGet = k => { try { const c = JSON.parse(localStorage.getItem(CACHE) || "{}")[k]; return c && Date.now() - c.t < 86400000 ? c.v : null; } catch { return null; } };
  const cachePut = (k, v) => { try { const c = JSON.parse(localStorage.getItem(CACHE) || "{}"); c[k] = { t: Date.now(), v }; const ks = Object.keys(c); if (ks.length > 200) delete c[ks[0]]; localStorage.setItem(CACHE, JSON.stringify(c)); } catch {} };

  function errMsg(e, what) {
    if (e?.code === "no_key") return "Add your API key in Settings first.";
    if (e?.code === 401 || e?.code === 403) return "The provider rejected your API key. Check it in Settings.";
    if (e?.code === 404) return "The provider doesn't recognise that model name. Change it in Settings.";
    if (e?.code === 429) return "You've reached your provider's limit for now. Wait a minute (or until tomorrow for daily limits) and try again.";
    if (e?.code === "invalid_json") return `The ${what} came back in an unexpected shape. Try again, or pick a stronger model in Settings.`;
    if (e?.code === "empty") return `The AI sent back an empty answer (${e.message}). Try again, or pick another model in Settings.`;
    if (e?.code === "network") return "Couldn't reach the provider. Check your connection (and the base URL, for custom servers).";
    return `The ${what} didn't finish${e?.message ? ": " + e.message : "."}`;
  }

  ["in bocca al lupo", "magari", "burro", "sbrigarsi"].forEach(w =>
    $("#tries").append(el("button", { class: "chip", type: "button", onclick: () => { $("#q").value = w; lookup(w); } }, w)));

  $("#form").addEventListener("submit", e => { e.preventDefault(); const w = $("#q").value.trim(); if (w) lookup(w); });

  const rawBox = e => e?.raw ? rawPanel({ raw: e.raw, usage: e.usage || {}, model: settings.model, cached: false }) : null;


  async function lookup(w) {
    const out = $("#out");
    out.replaceChildren();
    ctl?.abort(); ctl = new AbortController();
    $("#go").disabled = true;
    const status = el("p", { class: "status" }, "Looking it up…");
    out.append(status);
    try {
      const ck = "look:" + w.toLowerCase();
      const hit = cacheGet(ck);
      let data;
      if (hit) {
        data = hit.data || hit;
        currentRun = { ...(hit.run || { raw: JSON.stringify(data), model: "" }), cached: true };
      } else {
        data = await ask(PROMPT(w), ctl.signal, { schema: LOOK_SCHEMA, needKey: "word" });
        currentRun = lastRun;
      }
      if (!data || typeof data.word !== "string") throw { code: "invalid_json", raw: JSON.stringify(data) };
      if (!hit) cachePut(ck, { data, run: { raw: currentRun.raw, usage: currentRun.usage, model: currentRun.model } });
      current = normalize(data);
      renderEntry(current);
    } catch (e) {
      if (e?.code === "cancelled") return;
      out.replaceChildren(el("p", { class: "status err" }, errMsg(e, "lookup") + " Meanwhile, you can open it here:"), extLinks(w, looksVerb({ word: w })), rawBox(e));
    } finally { $("#go").disabled = false; }
  }

  function normalize(d) {
    const arr = a => Array.isArray(a) ? a : [];
    const s = v => typeof v === "string" ? v : "";
    return {
      word: s(d.word).trim(), pos: s(d.pos), forms: s(d.plural_or_forms), register: s(d.register),
      definition_it: s(d.definition_it), definition_es: s(d.definition_es),
      translations: { es: s(d.translations?.es), en: s(d.translations?.en), fr: s(d.translations?.fr) },
      synonyms: arr(d.synonyms).map(String).slice(0, 6), antonyms: arr(d.antonyms).map(String).slice(0, 4),
      examples: arr(d.examples).filter(x => x && x.it).slice(0, 4).map(x => ({ it: s(x.it), es: s(x.es) })),
      idioms: arr(d.idioms).filter(x => x && x.it).slice(0, 4).map(x => ({ it: s(x.it), es: s(x.es) })),
      tip: s(d.tip)
    };
  }

  function extLinks(word, isVerb) {
    const w = encodeURIComponent(word.trim().toLowerCase());
    const links = [
      ["WordReference", `https://www.wordreference.com/ites/${w}`],
      ["Reverso Context", `https://context.reverso.net/traduccion/italiano-espanol/${w}`]
    ];
    if (isVerb) links.push(
      ["Conjugation (WordReference)", `https://www.wordreference.com/conj/itverbs.aspx?v=${w}`],
      ["Conjugation (Reverso)", `https://conjugator.reverso.net/conjugation-italian-verb-${w}.html`]
    );
    return el("div", { class: "ext" }, links.map(([t, u]) => el("a", { href: u, target: "_blank", rel: "noopener noreferrer" }, t)));
  }
  const looksVerb = d => /verb/i.test(d.pos || "") || /(are|ere|ire|rsi|rre)$/.test((d.word || "").trim());

  function wordLinks(list) {
    const p = el("p", { style: "margin:0" });
    list.forEach((w, i) => {
      if (i) p.append(", ");
      p.append(el("button", { class: "link", type: "button", onclick: () => { $("#q").value = w; lookup(w); window.scrollTo(0, 0); } }, w));
    });
    return p;
  }

  function entryBody(d) {
    const frag = document.createDocumentFragment();
    frag.append(
      el("p", { class: "def" }, d.definition_it),
      d.definition_es ? el("p", { class: "def-es" }, d.definition_es) : null,
      el("div", { class: "sec" }, el("h3", {}, "Translations"),
        el("div", { class: "tr" },
          el("b", {}, "ES"), el("span", {}, d.translations.es),
          el("b", {}, "EN"), el("span", {}, d.translations.en),
          el("b", {}, "FR"), el("span", {}, d.translations.fr))),
      d.synonyms.length ? el("div", { class: "sec" }, el("h3", {}, "Synonyms"), wordLinks(d.synonyms)) : null,
      d.antonyms.length ? el("div", { class: "sec" }, el("h3", {}, "Opposites"), wordLinks(d.antonyms)) : null,
      d.examples.length ? el("div", { class: "sec" }, el("h3", {}, "In a sentence"),
        d.examples.map(x => el("div", { class: "ex" }, el("div", { class: "it" }, x.it), el("div", { class: "es" }, x.es)))) : null,
      d.idioms.length ? el("div", { class: "sec" }, el("h3", {}, "Common expressions"),
        d.idioms.map(x => el("div", { class: "idiom" }, el("div", { class: "it" }, x.it), el("div", { class: "es" }, x.es)))) : null,
      d.tip ? el("div", { class: "sec" }, el("h3", {}, "Tip"), el("p", { style: "margin:0" }, d.tip)) : null,
      el("div", { class: "sec" }, el("h3", {}, "More context"), extLinks(d.word, /verb/i.test(d.pos || "")))
    );
    return frag;
  }

  function renderEntry(d) {
    const k = keyOf(d.word);
    const saved = !!words[k];
    const saveBtn = el("button", { class: saved ? "btn ghost" : "btn lemon", type: "button", onclick: () => saved ? unsave(k) : save(d) }, saved ? "Saved ✓" : "Save");
    const card = el("article", { class: "entry" },
      el("div", { class: "head" },
        el("div", {},
          el("h2", { class: "word" }, d.word),
          el("div", { class: "meta" }, [d.pos, d.forms].filter(Boolean).join(", "),
            d.register ? el("span", { class: "reg" }, d.register) : null)),
        saveBtn),
      entryBody(d),
      rawPanel(currentRun));
    $("#out").replaceChildren(card);
  }

  async function save(d) {
    const k = keyOf(d.word);
    words[k] = { ...d, savedAt: Date.now(), box: 0, due: 0 };
    refreshAll(); toast("Saved to your notebook");
    try { await store.save(k); } catch { toast("Saved on this device only"); }
  }
  async function unsave(k) {
    delete words[k]; refreshAll(); toast("Removed");
    try { await store.remove(k); } catch {}
  }

  /* ---------- homework corrector ---------- */
  const DRAFT = "parola-draft-v1";
  const essay = $("#essay");
  try { essay.value = localStorage.getItem(DRAFT) || ""; } catch {}
  const updWc = () => { const n = (essay.value.trim().match(/\S+/g) || []).length; $("#wc").textContent = n ? `${n} words` : ""; };
  let draftT;
  essay.addEventListener("input", () => { updWc(); clearTimeout(draftT); draftT = setTimeout(() => { try { localStorage.setItem(DRAFT, essay.value); } catch {} }, 600); });
  updWc();
  $("#clear").addEventListener("click", () => { essay.value = ""; updWc(); $("#corr").replaceChildren(); try { localStorage.removeItem(DRAFT); } catch {} essay.focus(); });


  function renderMarked(str) {
    const p = el("p", { class: "marked" });
    // **wrong** (fix)  -> highlighted wrong + green fix
    const re = /\*\*(.+?)\*\*(\s*\(([^)]*)\))?/g;
    let last = 0, m;
    while ((m = re.exec(str))) {
      p.append(str.slice(last, m.index));
      p.append(el("strong", {}, m[1]));
      if (m[2]) p.append(" ", el("span", { class: "fix" }, `(${m[3]})`));
      last = re.lastIndex;
    }
    p.append(str.slice(last));
    return p;
  }

  let cctl = null;
  $("#check").addEventListener("click", async () => {
    const t = essay.value.trim();
    const out = $("#corr");
    if (!t) { essay.focus(); return; }
    if (t.length > 12000) { out.replaceChildren(el("p", { class: "status err" }, "That text is very long. Correct it in parts of about 1,500 words.")); return; }
    cctl?.abort(); cctl = new AbortController();
    $("#check").disabled = true;
    out.replaceChildren(el("p", { class: "status" }, "Your teacher is reading…"));
    try {
      const d = await ask(TEACHER(t), cctl.signal, { schema: CORR_SCHEMA, needKey: "marked" });
      const notes = Array.isArray(d?.notes) ? d.notes.filter(n => n && n.wrong) : [];
      const card = el("article", { class: "entry" },
        el("div", { class: "head" }, el("h2", { class: "word", style: "font-size:2rem" }, notes.length ? `${notes.length} correction${notes.length === 1 ? "" : "s"}` : "Perfetto!")),
        d?.praise ? el("p", { class: "praise meta" }, String(d.praise)) : null,
        el("div", { class: "sec" }, el("h3", {}, "Your text, corrected"), renderMarked(String(d?.marked || t))),
        notes.length ? el("div", { class: "sec" }, el("h3", {}, "Why"),
          notes.map(n => el("div", { class: "note" },
            el("span", { class: "kind" }, String(n.kind || "")),
            el("div", { class: "pair" }, el("s", {}, String(n.wrong)), " → ", el("span", {}, String(n.right || ""))),
            el("div", { class: "why" }, String(n.why || ""))))) : null,
        rawPanel(lastRun));
      out.replaceChildren(card);
    } catch (e) {
      if (e?.code === "cancelled") return;
      out.replaceChildren(el("p", { class: "status err" }, errMsg(e, "correction")), rawBox(e));
    } finally { $("#check").disabled = false; }
  });

  /* ---------- saved list ---------- */
  let openKey = null;
  $("#filter").addEventListener("input", renderList);
  function renderList() {
    const list = $("#list");
    const f = $("#filter").value.trim().toLowerCase();
    const items = Object.entries(words).sort((a, b) => (b[1].savedAt || 0) - (a[1].savedAt || 0))
      .filter(([, w]) => !f || w.word.toLowerCase().includes(f) || (w.translations?.es || "").toLowerCase().includes(f));
    list.replaceChildren();
    if (!Object.keys(words).length) {
      list.append(el("div", { class: "empty" }, el("div", { class: "big" }, "Your notebook is empty"),
        "Look up a word and tap Save to keep it here."));
      return;
    }
    if (!items.length) { list.append(el("div", { class: "empty" }, "No saved words match that.")); return; }
    for (const [k, w] of items) {
      const dots = el("div", { class: "dots", "aria-label": `Learned ${Math.min(w.box || 0, 4)} of 4` },
        [0, 1, 2, 3].map(i => el("span", { class: i < (w.box || 0) ? "on" : "" })));
      list.append(el("div", { class: "row" },
        el("button", { class: "grow", type: "button", "aria-expanded": openKey === k, onclick: () => { openKey = openKey === k ? null : k; renderList(); } },
          el("div", { class: "w" }, w.word), el("div", { class: "t" }, w.translations?.es || "")),
        dots,
        el("button", { class: "x", type: "button", "aria-label": `Remove ${w.word}`, onclick: () => unsave(k) }, "×")));
      if (openKey === k) {
        const card = el("article", { class: "entry", style: "margin:0 0 12px" });
        card.append(el("div", { class: "meta" }, [w.pos, w.forms].filter(Boolean).join(", "), w.register ? el("span", { class: "reg" }, w.register) : null), entryBody(w));
        list.append(card);
      }
    }
  }

  /* ---------- practice (simple spaced repetition) ---------- */
  const GAPS = [0, 1, 3, 7, 16]; // days until next review for each box
  let mode = "it", queue = [], idx = 0, revealed = false, done = 0;
  document.querySelectorAll(".modes button").forEach(b => b.addEventListener("click", () => {
    mode = b.dataset.mode;
    document.querySelectorAll(".modes button").forEach(x => x.setAttribute("aria-pressed", x === b));
    startDeck();
  }));

  function startDeck() {
    const now = Date.now();
    const all = Object.entries(words);
    let due = all.filter(([, w]) => (w.due || 0) <= now);
    if (!due.length) due = all; // nothing due: allow free review
    queue = due.sort((a, b) => (a[1].box || 0) - (b[1].box || 0) || Math.random() - .5).map(([k]) => k).slice(0, 20);
    idx = 0; done = 0; revealed = false;
    renderCard();
  }

  function renderCard() {
    const deck = $("#deck");
    deck.replaceChildren();
    if (!Object.keys(words).length) {
      deck.append(el("div", { class: "empty" }, el("div", { class: "big" }, "Nothing to practice yet"), "Save a few words first, then come back here."));
      return;
    }
    if (idx >= queue.length) {
      deck.append(el("div", { class: "empty" }, el("div", { class: "big" }, "Bravo!"),
        `You reviewed ${done} word${done === 1 ? "" : "s"}.`, el("div", { style: "margin-top:16px" },
          el("button", { class: "btn", type: "button", onclick: startDeck }, "Practice again"))));
      return;
    }
    const k = queue[idx], w = words[k];
    if (!w) { idx++; return renderCard(); }
    const front = mode === "it" ? w.word : (w.translations?.es || w.word);
    const card = el("div", { class: "flash" },
      el("div", { class: "q" }, front),
      el("div", { class: "sub" }, mode === "it" ? "What does it mean?" : "How do you say it in Italian?"));
    if (revealed) {
      const ex = w.examples?.[0];
      card.append(el("div", { class: "a" },
        el("div", { class: "main" }, mode === "it" ? (w.translations?.es || "") : w.word),
        el("div", { class: "sub", style: "margin-top:4px" }, w.definition_it || ""),
        ex ? el("div", { class: "ex" }, el("div", { class: "it" }, ex.it), el("div", { class: "es" }, ex.es)) : null));
    }
    deck.append(card);
    deck.append(revealed
      ? el("div", { class: "acts" },
          el("button", { class: "btn ghost", type: "button", onclick: () => grade(k, false) }, "Review again"),
          el("button", { class: "btn lemon", type: "button", onclick: () => grade(k, true) }, "I knew it"))
      : el("div", { class: "acts" }, el("button", { class: "btn", type: "button", onclick: () => { revealed = true; renderCard(); } }, "Show answer")));
    deck.append(el("div", { class: "progress" }, `${idx + 1} of ${queue.length}`));
  }

  async function grade(k, knew) {
    const w = words[k];
    if (w) {
      w.box = knew ? Math.min((w.box || 0) + 1, 4) : 0;
      w.due = Date.now() + GAPS[w.box] * 86400000;
      if (!knew) queue.push(k); // see it again this session
      try { await store.save(k); } catch {}
    }
    done++; idx++; revealed = false; renderCard();
  }

  /* ---------- settings ---------- */
  function fillSettings() {
    $("#prov").value = settings.provider;
    $("#key").value = settings.key || "";
    $("#model").value = settings.model || PROVIDERS[settings.provider].model;
    $("#base").value = settings.base || PROVIDERS.custom.base;
    $("#baseWrap").hidden = settings.provider !== "custom";
    $("#provHelp").innerHTML = PROVIDERS[settings.provider].help; // static, trusted text
    $("#testOut").textContent = "";
  }
  const readForm = () => ({ provider: $("#prov").value, key: $("#key").value.trim(), model: $("#model").value.trim(), base: $("#base").value.trim() });
  $("#prov").addEventListener("change", () => {
    const p = $("#prov").value;
    $("#model").value = PROVIDERS[p].model;
    $("#baseWrap").hidden = p !== "custom";
    $("#provHelp").innerHTML = PROVIDERS[p].help;
  });
  $("#gear").addEventListener("click", () => {
    ["look", "correct", "saved", "practice"].forEach(v => $("#view-" + v).hidden = true);
    document.querySelectorAll("nav.tabs button").forEach(x => x.setAttribute("aria-selected", "false"));
    $("#view-settings").hidden = false; tab = "settings"; fillSettings(); window.scrollTo(0, 0);
  });
  $("#saveSet").addEventListener("click", () => {
    settings = readForm();
    try { localStorage.setItem(SET, JSON.stringify(settings)); toast("Settings saved"); } catch { toast("Couldn't save settings on this device"); }
  });
  $("#test").addEventListener("click", async () => {
    const prev = settings; settings = readForm();
    const out = $("#testOut"); out.className = "grow"; out.textContent = "Testing…";
    try {
      const r = await ask('Reply with only this JSON: {"ok":true}', undefined, { needKey: "ok" });
      out.textContent = (r?.ok ? "Connected ✓" : "Connected, but the reply looked odd.") + (lastRun?.usage?.total ? ` (${fmt(lastRun.usage.total)} tokens)` : "");
      out.classList.add("ok");
    } catch (e) { out.textContent = errMsg(e, "test"); out.classList.add("err"); }
    finally { settings = prev; }
  });

  async function listModels(cfg) {
    let url, headers = {};
    if (cfg.provider === "gemini") { url = "https://generativelanguage.googleapis.com/v1beta/models?pageSize=200"; headers["x-goog-api-key"] = cfg.key; }
    else if (cfg.provider === "anthropic") { url = "https://api.anthropic.com/v1/models?limit=100"; headers = { "x-api-key": cfg.key, "anthropic-version": "2023-06-01", "anthropic-dangerous-direct-browser-access": "true" }; }
    else {
      const base = (cfg.provider === "custom" ? (cfg.base || PROVIDERS.custom.base) : PROVIDERS[cfg.provider].base).replace(/\/$/, "");
      url = base + "/models"; if (cfg.key) headers.Authorization = `Bearer ${cfg.key}`;
    }
    let res;
    try { res = await fetch(url, { headers }); } catch { throw { code: "network" }; }
    const j = await res.json().catch(() => ({}));
    if (!res.ok) throw { code: res.status, message: j?.error?.message };
    if (cfg.provider === "gemini")
      return (j.models || []).filter(m => (m.supportedGenerationMethods || []).includes("generateContent"))
        .map(m => ({ id: m.name.replace(/^models\//, ""), label: m.displayName || "" }))
        .filter(m => !/embed|tts|image|audio|live|veo|imagen|aqa/i.test(m.id));
    return (j.data || []).map(m => ({ id: m.id, label: m.display_name || m.name || "" }));
  }
  $("#findModels").addEventListener("click", async () => {
    const cfg = readForm(), help = $("#modelHelp");
    if (!cfg.key && cfg.provider !== "custom") { help.textContent = "Paste your API key first."; return; }
    help.textContent = "Asking your provider…";
    try {
      const ms = await listModels(cfg);
      const dl = $("#modelList"); dl.replaceChildren(...ms.map(m => el("option", { value: m.id }, m.label)));
      help.textContent = ms.length ? `Found ${ms.length} models. Tap the Model field to pick one, then Test.` : "No models found for this key.";
      if (ms.length && !ms.some(m => m.id === $("#model").value)) { const flash = ms.find(m => /flash/i.test(m.id) && !/lite/i.test(m.id)) || ms[0]; $("#model").value = flash.id; }
    } catch (e) { help.textContent = errMsg(e, "model list"); }
  });

  /* ---------- export / import ---------- */
  $("#export").addEventListener("click", () => {
    const blob = new Blob([JSON.stringify({ app: "parola", version: 1, exported: new Date().toISOString(), words }, null, 2)], { type: "application/json" });
    const a = el("a", { href: URL.createObjectURL(blob), download: `parola-words-${new Date().toISOString().slice(0, 10)}.json` });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  });
  $("#import").addEventListener("click", () => $("#importFile").click());
  $("#importFile").addEventListener("change", async e => {
    const f = e.target.files?.[0]; if (!f) return;
    try {
      const data = JSON.parse(await f.text());
      const incoming = data.words || data;
      let n = 0;
      for (const [k, w] of Object.entries(incoming)) {
        if (!w || typeof w.word !== "string") continue;
        const old = words[k];
        if (!old || (w.due || 0) > (old.due || 0)) { words[k] = w; n++; }
      }
      lsSave(); refreshAll(); toast(`Imported ${n} word${n === 1 ? "" : "s"}`);
    } catch { toast("That file isn't a Parola export"); }
    e.target.value = "";
  });

  if (!settings.key && settings.provider !== "custom") setTimeout(() => toast("Add your API key in Settings to start"), 600);
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});

  showTokens();
  refreshAll();
})();
