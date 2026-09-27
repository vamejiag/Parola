// Parola: free sources used by the lookup. No AI, no API keys.
//
// Wiktionary  - definitions, part of speech, example sentences (English Wiktionary,
//               which has the best structured data for Italian words). Free, open (CC BY-SA).
// MyMemory    - translations into Spanish, English and French, plus real sentence pairs
//               from its translation memory (a bit like Reverso Context). Free:
//               5,000 characters/day anonymously, 50,000/day if you add an email in Settings.
// Links       - WordReference, Reverso, Treccani... These sites have no free public API
//               and don't allow other pages to read their content, so they open in a new tab.

const stripHTML = html => {
  const d = new DOMParser().parseFromString(String(html || ""), "text/html");
  d.querySelectorAll("style, script, link, sup.reference").forEach(n => n.remove());
  return (d.body.textContent || "").replace(/\s+/g, " ").trim();
};

// Returns [{ pos, defs: [{ text, examples: [{ it, tr }] }] }] or [] if not found.
async function wiktionary(word, signal) {
  const tryWord = async w => {
    const res = await fetch(`https://en.wiktionary.org/api/rest_v1/page/definition/${encodeURIComponent(w)}`, { signal });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error("wiktionary " + res.status);
    const j = await res.json();
    return j.it || null; // "it" = the Italian section of the page
  };
  let sections = await tryWord(word.trim());
  if (!sections && word.trim() !== word.trim().toLowerCase()) sections = await tryWord(word.trim().toLowerCase());
  if (!sections) return [];
  return sections.map(sec => ({
    pos: sec.partOfSpeech || "",
    defs: (sec.definitions || [])
      .map(d => ({
        text: stripHTML(d.definition),
        examples: (d.parsedExamples || []).slice(0, 2).map(x => ({ it: stripHTML(x.example), tr: stripHTML(x.translation) })).filter(x => x.it)
      }))
      .filter(d => d.text)
      .slice(0, 4)
  })).filter(s => s.defs.length);
}

// Returns { main, alternatives: [..], context: [{ it, tr }] }.
async function mymemory(text, pair, signal, email) {
  const url = new URL("https://api.mymemory.translated.net/get");
  url.searchParams.set("q", text);
  url.searchParams.set("langpair", pair);
  if (email) url.searchParams.set("de", email);
  const res = await fetch(url, { signal });
  const j = await res.json();
  const main = j?.responseData?.translatedText || "";
  if (j.responseStatus == 429 || /MYMEMORY WARNING|QUOTA/i.test(main)) throw { code: "quota" };
  const matches = Array.isArray(j.matches) ? j.matches : [];
  const clean = s => String(s || "").replace(/\s+/g, " ").trim();
  const low = clean(text).toLowerCase();
  // alternatives: other translations of (almost) the same word
  const alternatives = [...new Set(matches
    .filter(m => clean(m.segment).toLowerCase().replace(/[.!?,;:]$/, "") === low)
    .map(m => clean(m.translation).replace(/[.!?,;:]$/, ""))
    .filter(t => t && t.toLowerCase() !== main.toLowerCase() && t.split(" ").length <= 5))].slice(0, 4);
  // context: longer sentences that contain the word
  const context = matches
    .filter(m => clean(m.segment).split(" ").length >= 3 && clean(m.segment).toLowerCase().includes(low))
    .map(m => ({ it: clean(m.segment), tr: clean(m.translation) }))
    .slice(0, 3);
  return { main: clean(main), alternatives, context };
}

// Links that open in a new tab, in two groups. Verbs get conjugation tables too.
function dictionaryLinks(word, isVerb) {
  const raw = word.trim().toLowerCase();
  const w = encodeURIComponent(raw);
  const letter = raw.normalize("NFD").replace(/[\u0300-\u036f]/g, "").charAt(0).toUpperCase();
  const dashed = encodeURIComponent(raw.replace(/\s+/g, "-"));
  const dictionaries = [
    ["Treccani", `https://www.treccani.it/vocabolario/${w}/`],
    ["De Mauro", `https://dizionario.internazionale.it/parola/${w}`],
    ["Sabatini Coletti", `https://dizionari.corriere.it/dizionario_italiano/${letter}/${raw.replace(/\s+/g, "_")}.shtml`],
    ["Garzanti", `https://www.garzantilinguistica.it/ricerca/?q=${w}`],
    ["Una parola al giorno", `https://unaparolaalgiorno.it/significato/${dashed}`],
    ["Wikizionario", `https://it.wiktionary.org/wiki/${w}`]
  ];
  const context = [
    ["WordReference", `https://www.wordreference.com/ites/${w}`],
    ["Reverso Context", `https://context.reverso.net/traduccion/italiano-espanol/${w}`],
    ["Pronunciation (Forvo)", `https://forvo.com/word/${w}/#it`]
  ];
  if (isVerb) context.push(
    ["Conjugation (WordReference)", `https://www.wordreference.com/conj/itverbs.aspx?v=${w}`],
    ["Conjugation (Reverso)", `https://conjugator.reverso.net/conjugation-italian-verb-${w}.html`]
  );
  return { dictionaries, context };
}

// Does Una parola al giorno have an article on this word? true / false / null (can't tell: site blocked the check).
async function upagHasWord(word, signal) {
  try {
    const slug = encodeURIComponent(word.trim().toLowerCase().replace(/\s+/g, "-"));
    const res = await fetch(`https://unaparolaalgiorno.it/significato/${slug}`, { signal });
    if (res.status === 404) return false;
    if (!res.ok) return null;
    const html = await res.text();
    return /significato/i.test(html) && !/non (è stata )?trovat/i.test(html);
  } catch { return null; }
}

// ---- Wikizionario (Italian Wiktionary): definitions IN ITALIAN, synonyms, opposites,
// and human-made translations. Free, no key (CC BY-SA).
// Returns { sections: [{ pos, defs: [{ text, examples: [..] }] }], synonyms, antonyms, trad: { es, en, fr } }
// or null if the word has no Italian entry.
const WZ_POS = {
  "sost": "sostantivo", "agg": "aggettivo", "verb": "verbo", "avv": "avverbio", "inter": "interiezione",
  "prep": "preposizione", "cong": "congiunzione", "pronome": "pronome", "art": "articolo",
  "locuz nom": "locuzione nominale", "locuz verb": "locuzione verbale", "locuz avv": "locuzione avverbiale",
  "locuz agg": "locuzione aggettivale", "locuz prep": "locuzione prepositiva", "locuz inter": "locuzione interiettiva",
  "sost form": "forma di sostantivo", "agg form": "forma di aggettivo", "verb form": "forma verbale", "espr": "espressione"
};

function cleanWikitext(t) {
  let s = String(t || "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<ref[^>]*\/>/g, "").replace(/<ref[\s\S]*?<\/ref>/g, "")
    .replace(/<[^>]+>/g, "");
  // labels like {{Term|diritto|it}} -> (diritto)
  s = s.replace(/\{\{Term\|([^|}]+)[^}]*\}\}/gi, "($1) ");
  // remove any other templates, innermost first
  for (let i = 0; i < 6 && /\{\{[^{}]*\}\}/.test(s); i++) s = s.replace(/\{\{[^{}]*\}\}/g, "");
  s = s.replace(/\[\[(?:File|Immagine|Image|Categoria|Category):[^\]]*\]\]/gi, "")
    .replace(/\[\[[^\]|]*\|([^\]]+)\]\]/g, "$1")
    .replace(/\[\[([^\]]+)\]\]/g, "$1")
    .replace(/'{2,}/g, "")
    .replace(/\s+/g, " ").replace(/\s+([,.;:])/g, "$1").replace(/\(\s*\)/g, "").trim();
  return s.replace(/^[,;:\s]+/, "");
}
const wikiLinks = line => [...String(line).matchAll(/\[\[([^\]|#]+)(?:\|[^\]]*)?\]\]/g)].map(m => m[1].trim());

async function wikizionario(word, signal) {
  const api = async params => {
    const url = new URL("https://it.wiktionary.org/w/api.php");
    Object.entries({ ...params, format: "json", formatversion: "2", origin: "*" }).forEach(([k, v]) => url.searchParams.set(k, v));
    const res = await fetch(url, { signal });
    if (!res.ok) throw new Error("HTTP " + res.status);
    return res.json();
  };
  const tryWord = async w => {
    // 1) raw wiki code
    const q = await api({ action: "query", prop: "revisions", rvprop: "content", rvslots: "main", titles: w, redirects: "1" });
    const page = q?.query?.pages?.[0];
    if (!page || page.missing) return { status: "none" };
    const parsed = parseWikizionario(page.revisions?.[0]?.slots?.main?.content || "");
    if (parsed?.sections.length) return { status: "ok", data: parsed, via: "wikitext" };
    // 2) the rendered page, as a fallback when the wiki code has an unexpected format
    const r = await api({ action: "parse", page: page.title || w, prop: "text", redirects: "1" });
    const fromHtml = parseWikizionarioHTML(r?.parse?.text || "");
    if (fromHtml?.sections.length) {
      if (parsed) { fromHtml.trad = parsed.trad; if (!fromHtml.synonyms.length) fromHtml.synonyms = parsed.synonyms; }
      return { status: "ok", data: fromHtml, via: "page" };
    }
    return parsed ? { status: "ok", data: parsed, via: "wikitext" } : { status: "none", note: "page found, no Italian entry" };
  };
  const w = word.trim();
  let r = await tryWord(w);
  if (r.status !== "ok" && w !== w.toLowerCase()) r = await tryWord(w.toLowerCase());
  // reflexive verbs (sbrigarsi, accorgersi, pentirsi...) usually live under the base verb
  const base = baseVerb(w.toLowerCase());
  if (r.status !== "ok" && base) { const b = await tryWord(base); if (b.status === "ok") r = { ...b, base }; }
  return r;
}

// sbrigarsi -> sbrigare, accorgersi -> accorgere, pentirsi -> pentire, tradursi -> tradurre, porsi -> porre
function baseVerb(w) {
  const m = w.match(/^(.+?)(ar|er|ir|ur|or)(si|mi|ti|ci|vi|sene|sela)$/);
  if (!m || /\s/.test(w)) return null;
  const tail = { ar: "are", er: "ere", ir: "ire", ur: "urre", or: "orre" }[m[2]];
  return m[1] + tail;
}

const WZ_POS_HTML = /^(sostantivo|verbo|aggettivo|avverbio|interiezione|preposizione|congiunzione|pronome|articolo|locuzione|espressione|forma)/i;
function parseWikizionarioHTML(html) {
  const doc = new DOMParser().parseFromString(String(html || ""), "text/html");
  doc.querySelectorAll("style, script").forEach(n => n.remove());
  const root = doc.querySelector(".mw-parser-output") || doc.body;
  const out = { sections: [], synonyms: [], antonyms: [], trad: { es: "", en: "", fr: "" } };
  const headingOf = n => {
    const h = /^H[1-6]$/.test(n.tagName) ? n : (n.classList?.contains("mw-heading") ? n.querySelector("h1,h2,h3,h4,h5,h6") : null);
    return h ? { level: +h.tagName[1], text: (h.textContent || "").replace(/\[.*?\]/g, "").trim() } : null;
  };
  let inIt = false, cur = null, mode = null;
  for (const n of root.children) {
    const h = headingOf(n);
    if (h) {
      if (h.level <= 2) { if (inIt) break; inIt = /italiano/i.test(h.text); continue; }
      if (!inIt) continue;
      if (WZ_POS_HTML.test(h.text)) { cur = { pos: h.text.toLowerCase(), defs: [] }; out.sections.push(cur); mode = "pos"; }
      else { mode = /sinonimi/i.test(h.text) ? "sin" : /contrari/i.test(h.text) ? "ant" : "other"; }
      continue;
    }
    if (!inIt) continue;
    if (mode === "pos" && cur && n.tagName === "OL") {
      for (const li of n.children) {
        if (li.tagName !== "LI") continue;
        const c = li.cloneNode(true);
        const examples = [...c.querySelectorAll("dl, ul")].map(x => x.textContent.replace(/\s+/g, " ").trim()).filter(Boolean);
        c.querySelectorAll("dl, ul, sup, style, script").forEach(x => x.remove());
        const text = c.textContent.replace(/\s+/g, " ").trim();
        if (text) cur.defs.push({ text, examples: examples.slice(0, 2) });
      }
    } else if ((mode === "sin" || mode === "ant") && /^(UL|P|DL)$/.test(n.tagName)) {
      const list = mode === "sin" ? out.synonyms : out.antonyms;
      n.querySelectorAll("a").forEach(a => { const t = a.textContent.trim(); if (t && !/^\(/.test(t)) list.push(t); });
    }
  }
  out.sections = out.sections.map(s => ({ ...s, defs: s.defs.slice(0, 5) })).filter(s => s.defs.length);
  const uniq = a => [...new Set(a)].filter(x => x && x.length < 40).slice(0, 8);
  out.synonyms = uniq(out.synonyms); out.antonyms = uniq(out.antonyms);
  return out;
}

function parseWikizionario(text) {
  const lines = String(text || "").split("\n");
  const start = lines.findIndex(l => /^==\s*\{\{\s*-it-\s*\}\}\s*==/.test(l.trim()) || /^==\s*italiano\s*==$/i.test(l.trim()));
  if (start < 0) return null;
  const out = { sections: [], synonyms: [], antonyms: [], trad: { es: [], en: [], fr: [] } };
  let mode = null, cur = null;
  for (let i = start + 1; i < lines.length; i++) {
    const l = lines[i].trim();
    if (/^==[^=].*==$/.test(l) && !/^===/.test(l)) break;       // next language
    const h = l.replace(/^=+\s*|\s*=+$/g, "").match(/^\{\{\s*-([a-z ]+)-\s*(?:\|[^}]*)?\}\}/i);  // section header
    if (h) {
      const name = h[1].toLowerCase();
      if (WZ_POS[name]) { cur = { pos: WZ_POS[name], defs: [] }; out.sections.push(cur); mode = "pos"; }
      else mode = { sin: "sin", ant: "ant", trad: "trad" }[name] || "other";
      continue;
    }
    if (mode === "pos" && cur) {
      if (/^#[*:]/.test(l)) { const ex = cleanWikitext(l.replace(/^#[*:]+/, "")); if (ex && cur.defs.length) cur.defs[cur.defs.length - 1].examples.push(ex); }
      else if (/^#/.test(l)) { const d = cleanWikitext(l.replace(/^#+/, "")); if (d) cur.defs.push({ text: d, examples: [] }); }
    } else if (mode === "sin" && /^[*:]/.test(l)) out.synonyms.push(...wikiLinks(l));
    else if (mode === "ant" && /^[*:]/.test(l)) out.antonyms.push(...wikiLinks(l));
    else if (mode === "trad") {
      const m = l.match(/^:?\*\s*\{\{(es|en|fr)\}\}\s*:\s*(.+)$/i);
      if (m) { const t = cleanWikitext(m[2]); if (t) out.trad[m[1].toLowerCase()].push(t); }
    }
  }
  out.sections = out.sections.map(s => ({ ...s, defs: s.defs.slice(0, 5).map(d => ({ ...d, examples: d.examples.slice(0, 2) })) })).filter(s => s.defs.length);
  const uniq = a => [...new Set(a)].filter(x => x && x.length < 40).slice(0, 8);
  out.synonyms = uniq(out.synonyms); out.antonyms = uniq(out.antonyms);
  for (const k of ["es", "en", "fr"]) out.trad[k] = [...new Set(out.trad[k])].slice(0, 3).join("; ");
  return out.sections.length || out.trad.es || out.trad.en ? out : null;
}

// ---- Una parola al giorno (unaparolaalgiorno.it): today's word, if the site lets us read it.
// Words there are CC BY-NC-SA 4.0: fine for personal use with credit.
// The site has no API; if the browser blocks reading it, this returns null and the app uses words.js.
async function upagToday() {
  try {
    const res = await fetch("https://unaparolaalgiorno.it/", { signal: AbortSignal.timeout(6000) });
    if (!res.ok) return null;
    const html = await res.text();
    const at = html.search(/parola del giorno/i);
    const m = html.slice(at >= 0 ? at : 0).match(/\/significato\/([a-z0-9\u00e0-\u00fa'-]+)/i);
    if (!m) return null;
    const slug = m[1];
    return { word: decodeURIComponent(slug).replace(/-/g, " "), url: `https://unaparolaalgiorno.it/significato/${slug}` };
  } catch { return null; }
}
