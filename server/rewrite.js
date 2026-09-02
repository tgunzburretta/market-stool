// Heuristic listing rewriter — no external AI call. It re-scores and reorders words the
// seller already used (title, tags, description) using well-known Etsy SEO rules
// (front-load high-signal keywords, dedupe title/tag overlap, respect the 140-char
// title limit and 13-tag/20-char tag limits) and layers in seasonal terms for the
// current month. Swap this module for a real LLM call once the heuristic is validated.

const STOPWORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'for', 'with', 'of', 'to', 'in', 'on', 'is', 'are',
  'this', 'that', 'your', 'you', 'it', 'by', 'from', 'at', 'as', 'be', 'my', 'our',
  'their', 'his', 'her', 'them', 'they', 'was', 'were', 'will', 'can', 'has', 'have',
]);

const TITLE_MAX_LEN = 140;
const TAG_MAX_LEN = 20;
const TAG_MAX_COUNT = 13;

// Month index (0 = Jan) -> seasonal/occasion terms relevant to UK Etsy & POD sellers.
const SEASONAL_KEYWORDS = [
  ['New Year', 'Winter', "Valentine's Prep"],
  ["Valentine's Day", "Galentine's", "Mother's Day Prep"],
  ["Mother's Day", 'Spring', 'Easter Prep'],
  ['Easter', 'Spring', 'Wedding Season Prep'],
  ['Wedding Season', 'Graduation', 'Summer Prep'],
  ["Father's Day", 'Summer', 'Wedding Season'],
  ['Summer', 'Beach', 'Holiday Gift Prep'],
  ['Back to School', 'Summer Sale', 'Autumn Prep'],
  ['Back to School', 'Autumn', 'Halloween Prep'],
  ['Halloween', 'Autumn', 'Christmas Prep'],
  ['Christmas', 'Black Friday', 'Winter'],
  ['Christmas', 'Boxing Day', 'New Year Prep'],
];

const FIRST_LINE_HOOKS = [
  (phrase) => `Looking for ${phrase}? You just found it.`,
  (phrase) => `Say hello to your new favourite ${phrase}.`,
  (phrase) => `Introducing a ${phrase} made to stand out.`,
  (phrase) => `Add a little magic to your day with this ${phrase}.`,
  (phrase) => `Treat yourself — or someone special — to a ${phrase} they'll love.`,
];

function seasonalKeywordsFor(date = new Date()) {
  return SEASONAL_KEYWORDS[date.getMonth()];
}

function tokenize(text) {
  return String(text || '')
    .toLowerCase()
    .match(/[a-z0-9']+/g) || [];
}

function toTitleCase(str) {
  return str
    .split(/\s+/)
    .map((w) => (w.length ? w[0].toUpperCase() + w.slice(1).toLowerCase() : w))
    .join(' ');
}

function hashStr(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0;
  return h;
}

// Ranks distinct keywords by weighted frequency: title words count most, then tags,
// then the description — mirroring how much SEO weight each field actually carries.
function rankKeywords(title, tags, description) {
  const freq = new Map();
  const add = (words, weight) => {
    for (const w of words) {
      if (STOPWORDS.has(w) || w.length < 3) continue;
      freq.set(w, (freq.get(w) || 0) + weight);
    }
  };
  add(tokenize(title), 3);
  for (const t of tags) add(tokenize(t), 2);
  add(tokenize(description), 1);
  return [...freq.entries()].sort((a, b) => b[1] - a[1]).map(([w]) => w);
}

function splitPhrases(title) {
  let parts = String(title || '')
    .split(/[|,\-–—]/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (parts.length <= 1) {
    const words = String(title || '').trim().split(/\s+/).filter(Boolean);
    parts = [];
    for (let i = 0; i < words.length; i += 3) parts.push(words.slice(i, i + 3).join(' '));
  }
  return parts.filter(Boolean);
}

function scorePhrase(phrase, ranked) {
  let score = 0;
  for (const w of tokenize(phrase)) {
    const idx = ranked.indexOf(w);
    if (idx !== -1) score += ranked.length - idx;
  }
  return score;
}

// Orders the title's existing phrases by SEO weight (highest-signal phrase first)
// instead of inventing new wording — front-loading is the single highest-leverage
// Etsy title change a seller can make.
function orderPhrases(title, ranked) {
  const phrases = splitPhrases(title).map(toTitleCase);
  const scored = phrases.map((p, i) => ({ p, i, s: scorePhrase(p, ranked) }));
  scored.sort((a, b) => b.s - a.s || a.i - b.i);
  const seen = new Set();
  const result = [];
  for (const { p } of scored) {
    const key = p.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      result.push(p);
    }
  }
  return result.length ? result : [toTitleCase(title || '')];
}

function buildTitle(orderedPhrases, topSeasonal) {
  let title = orderedPhrases.join(' | ');
  const hasSeasonal = title.toLowerCase().includes(topSeasonal.toLowerCase());
  if (!hasSeasonal) {
    const candidate = `${title} | ${topSeasonal} Gift`;
    if (candidate.length <= TITLE_MAX_LEN) title = candidate;
  }
  if (title.length > TITLE_MAX_LEN) {
    title = title.slice(0, TITLE_MAX_LEN).replace(/\s+\S*$/, '');
  }
  return title;
}

function buildTags(existingTags, ranked, seasonal) {
  const result = [];
  const seen = new Set();
  const push = (raw) => {
    if (result.length >= TAG_MAX_COUNT) return;
    const t = String(raw).trim().toLowerCase();
    if (!t || t.length > TAG_MAX_LEN || seen.has(t)) return;
    seen.add(t);
    result.push(t);
  };

  existingTags.forEach(push);
  seasonal.forEach(push);
  for (let i = 0; i < ranked.length && result.length < TAG_MAX_COUNT; i++) {
    for (let j = i + 1; j < ranked.length && result.length < TAG_MAX_COUNT; j++) {
      push(`${ranked[i]} ${ranked[j]}`);
    }
  }
  for (let i = 0; i < ranked.length && result.length < TAG_MAX_COUNT; i++) push(ranked[i]);

  return result;
}

function buildFirstLine(title, orderedPhrases, topSeasonal) {
  const mainPhrase = (orderedPhrases[0] || title || 'this piece').toLowerCase();
  const hook = FIRST_LINE_HOOKS[hashStr(title || '') % FIRST_LINE_HOOKS.length];
  return `${hook(mainPhrase)} A perfect pick for ${topSeasonal.toLowerCase()}.`;
}

function buildRewrite({ title = '', tags = [], description = '' }, date = new Date()) {
  const cleanTags = (Array.isArray(tags) ? tags : []).map((t) => String(t).trim()).filter(Boolean);
  const ranked = rankKeywords(title, cleanTags, description);
  const orderedPhrases = orderPhrases(title, ranked);
  const seasonal = seasonalKeywordsFor(date);

  return {
    title: buildTitle(orderedPhrases, seasonal[0]),
    tags: buildTags(cleanTags, ranked, seasonal),
    firstLine: buildFirstLine(title, orderedPhrases, seasonal[0]),
    seasonalKeywords: seasonal,
  };
}

module.exports = { buildRewrite, seasonalKeywordsFor };
