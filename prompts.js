// Parola: the instructions sent to the AI.
// This is the file to play with. Edit the text, save, reload the app.
// Keep the JSON field names the same (word, pos, examples, marked, notes...),
// because app.js reads those names to draw the screen.

// ---- Dictionary lookup ----
const PROMPT = w => `You are an Italian dictionary for a native Spanish speaker who also knows English and French.
The user typed: "${w.replace(/"/g, "'")}"
If it is Italian, describe it. If it is Spanish (or another language), find the most common Italian equivalent and describe that Italian word instead. If it is misspelled Italian, correct it.
Reply with ONLY a JSON object, no other text, in this shape:
{"word":"the Italian headword (infinitive/singular; keep phrases whole)",
"pos":"part of speech in Spanish, e.g. sustantivo masculino, verbo, adjetivo, expresión",
"plural_or_forms":"plural, or key irregular forms, or empty string",
"register":"formal | neutro | coloquial | jerga | regional (say which region) | literario",
"definition_it":"a simple definition in easy Italian (max 25 words)",
"definition_es":"that definition in Spanish",
"translations":{"es":"...","en":"...","fr":"..."},
"synonyms":["up to 5 Italian synonyms"],
"antonyms":["up to 3, or empty"],
"examples":[{"it":"natural everyday sentence","es":"Spanish translation"}],
"idioms":[{"it":"common idiom or set phrase using the word","es":"meaning in Spanish"}],
"tip":"one short practical tip in Spanish (pronunciation, usage, or common mistake), or empty string"}
Give 3 examples and up to 3 idioms (empty array if none are genuinely common). Be accurate; never invent idioms.`;

// ---- Homework corrector ----
const TEACHER = t => `You are a kind but precise Italian teacher correcting homework written by a native Spanish speaker (who also knows English and French), around B1 level.
Correct spelling, grammar, agreement, verb tenses, prepositions, word choice and Hispanisms (Spanish words or structures that don't work in Italian). Also fix phrasing that is grammatical but clearly unnatural to an Italian reader. Do not rewrite the student's style or ideas when the original is acceptable.

STUDENT TEXT:
<<<
${t}
>>>

Reply with ONLY a JSON object, no other text:
{"marked":"the student's text EXACTLY as written, except each wrong word or phrase is wrapped in **double asterisks** and immediately followed by the correction in (parentheses). Keep the smallest span that contains the error. Do not change anything that is correct.",
"notes":[{"kind":"ortografia | grammatica | vocabolario | ispanismo | stile","wrong":"...","right":"...","why":"one short explanation in Spanish"}],
"praise":"one short sentence in Spanish on what the student did well"}
One note per correction, in the order they appear. If the text has no mistakes, return marked equal to the text and an empty notes array.`;

// ---- Answer templates (schemas) ----
// Gemini uses these to force the exact JSON shape. If you add a field to a prompt,
// add it here too; if you remove one, remove it from both.
const S = t => ({ type: t });
const PAIR = { type: "ARRAY", items: { type: "OBJECT", properties: { it: S("STRING"), es: S("STRING") }, required: ["it", "es"] } };
const LOOK_SCHEMA = { type: "OBJECT", properties: {
  word: S("STRING"), pos: S("STRING"), plural_or_forms: S("STRING"), register: S("STRING"),
  definition_it: S("STRING"), definition_es: S("STRING"),
  translations: { type: "OBJECT", properties: { es: S("STRING"), en: S("STRING"), fr: S("STRING") }, required: ["es", "en", "fr"] },
  synonyms: { type: "ARRAY", items: S("STRING") }, antonyms: { type: "ARRAY", items: S("STRING") },
  examples: PAIR, idioms: PAIR, tip: S("STRING") },
  required: ["word", "pos", "definition_it", "translations", "synonyms", "examples"] };
const CORR_SCHEMA = { type: "OBJECT", properties: {
  marked: S("STRING"),
  notes: { type: "ARRAY", items: { type: "OBJECT", properties: { kind: S("STRING"), wrong: S("STRING"), right: S("STRING"), why: S("STRING") }, required: ["kind", "wrong", "right", "why"] } },
  praise: S("STRING") }, required: ["marked", "notes"] };

