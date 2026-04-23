// =============================================================================
// lexicon.js — Browser query engine
// =============================================================================
// Loads the pre-built index files from the languages/ folder, caches them in
// localStorage so they only download once, then handles all search and display.
// =============================================================================

// --- Configuration -----------------------------------------------------------

const LANGUAGES = [
  {
    key:           'greek',
    name:          'Greek',
    indexFiles:    ['languages/greek_index.json'],
    transliterate: transliterateGreek,
  },
  {
    // Latin is split into two files alphabetically — loaded and merged
    // transparently so search works across the full language.
    key:           'latin',
    name:          'Latin',
    indexFiles:    ['languages/latin_index_a.json', 'languages/latin_index_b.json'],
    transliterate: null,
  },
  {
    key:           'german',
    name:          'German',
    indexFiles:    ['languages/german_index.json'],
    transliterate: null,
  },
  {
    key:           'swedish',
    name:          'Swedish',
    indexFiles:    ['languages/swedish_index.json'],
    transliterate: null,
  },
];

// Bump this number any time you rebuild the index files with new kaikki data.
// The browser will detect the mismatch and re-download everything fresh.
const CACHE_VERSION = 1;

// How many results to show per language card before collapsing the rest.
const RESULTS_PER_CARD = 5;

// --- State -------------------------------------------------------------------

// Holds the loaded index objects, keyed by language key.
// e.g. { greek: { "breath": [...], "soul": [...] }, latin: {...}, ... }
const indexes = {};

// Tracks which languages are still loading.
let loadingCount = 0;
let loadErrors   = [];

// --- Boot sequence -----------------------------------------------------------
// When the page loads, start fetching all four index files in parallel.
// Show a status bar so the user knows what's happening.

document.addEventListener('DOMContentLoaded', () => {
  renderStatusBar();
  loadAllIndexes();
  setupInput();
});

// --- Status bar --------------------------------------------------------------

function renderStatusBar() {
  const results = document.getElementById('results');
  results.innerHTML = `
    <div class="status-bar" id="statusBar">
      <div class="status-label">Loading language indexes</div>
      <div class="status-langs" id="statusLangs">
        ${LANGUAGES.map(l => `
          <span class="status-lang" id="status-${l.key}" data-state="loading">
            <span class="status-dot"></span>${l.name}
          </span>
        `).join('')}
      </div>
      <div class="status-note">Indexes are cached after first load — this only happens once per language.</div>
    </div>
  `;
}

function markLangStatus(key, state) {
  // state: 'loading' | 'ready' | 'cached' | 'error'
  const el = document.getElementById(`status-${key}`);
  if (el) {
    el.dataset.state = state;
    const label = state === 'cached' ? `${getLangName(key)} (cached)`
                : state === 'ready'  ? `${getLangName(key)} (loaded)`
                : state === 'error'  ? `${getLangName(key)} (failed)`
                : getLangName(key);
    el.innerHTML = `<span class="status-dot"></span>${label}`;
  }
}

function getLangName(key) {
  return LANGUAGES.find(l => l.key === key)?.name ?? key;
}

// --- Index loading -----------------------------------------------------------

async function loadAllIndexes() {
  loadingCount = LANGUAGES.length;

  // Fire all fetches in parallel — no reason to wait for one before starting
  // the next since they're all independent files.
  await Promise.all(LANGUAGES.map(lang => loadIndex(lang)));

  if (loadErrors.length === LANGUAGES.length) {
    // Everything failed — probably running from the local filesystem without
    // a server. GitHub Pages will work fine; local file:// won't due to CORS.
    showLoadError();
    return;
  }

  // All done — replace the status bar with the search prompt.
  const statusBar = document.getElementById('statusBar');
  if (statusBar) {
    statusBar.classList.add('fade-out');
    setTimeout(() => {
      document.getElementById('results').innerHTML = '';
      document.getElementById('wordInput').focus();
    }, 400);
  }
}

async function loadIndex(lang) {
  // Check localStorage for a cached version first.
  const cacheKey   = `lexicon_v${CACHE_VERSION}_${lang.key}`;
  const cachedData = getCached(cacheKey);

  if (cachedData) {
    indexes[lang.key] = cachedData;
    markLangStatus(lang.key, 'cached');
    loadingCount--;
    return;
  }

  // Fetch all files for this language (most have one, Latin has two).
  try {
    const responses = await Promise.all(lang.indexFiles.map(f => fetch(f)));
    for (const r of responses) {
      if (!r.ok) throw new Error(`HTTP ${r.status} loading ${r.url}`);
    }

    const dataFiles = await Promise.all(responses.map(r => r.json()));

    // Validate each file.
    for (const data of dataFiles) {
      if (!data.entries || !data.index) {
        throw new Error('Index file missing entries or index fields.');
      }
    }

    // If only one file, use it directly.
    // If multiple files (Latin split), merge their indexes.
    // entries[] is the same across split files so we just use the first.
    let merged;
    if (dataFiles.length === 1) {
      merged = dataFiles[0];
    } else {
      // Merge: use entries from file A (identical in both), combine indexes.
      const combinedIndex = Object.assign({}, ...dataFiles.map(d => d.index));
      merged = { entries: dataFiles[0].entries, index: combinedIndex };
    }

    indexes[lang.key] = merged;
    markLangStatus(lang.key, 'ready');
    tryCache(cacheKey, merged);

  } catch (err) {
    console.error(`Failed to load ${lang.name} index:`, err);
    loadErrors.push(lang.key);
    markLangStatus(lang.key, 'error');
  }

  loadingCount--;
}

// --- localStorage helpers ----------------------------------------------------
// These are wrapped in try/catch because localStorage can throw in private
// browsing mode or when storage quota is exceeded.

function getCached(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function tryCache(key, data) {
  try {
    localStorage.setItem(key, JSON.stringify(data));
  } catch {
    // Quota exceeded or unavailable — silently continue.
  }
}

// --- Input handling ----------------------------------------------------------

function setupInput() {
  const input = document.getElementById('wordInput');

  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      const word = input.value.trim().toLowerCase();
      if (word) search(word);
    }
  });
}

// --- Search ------------------------------------------------------------------

// Stop words must match the set in process.js so the message is accurate.
const STOP_WORDS = new Set([
  'a','an','the','of','in','on','at','to','for','and','or','but','not',
  'is','are','was','were','be','been','being','have','has','had','do',
  'does','did','with','by','from','as','that','this','it','its','also',
  'used','often','especially','usually','one','two','any','all','some',
  'more','most','such','than','then','when','which','who','what','how',
  'very','less','much','many','may','can','could','will','would',
  'should','shall','into','onto','upon','about','above','below','between',
]);

function search(word) {
  const results  = document.getElementById('results');
  const echo     = document.getElementById('queryEcho');

  // Show what was searched.
  echo.style.display = 'block';
  echo.innerHTML = `Results for <span>${escapeHtml(word)}</span>`;

  results.innerHTML = '';

  // Check if indexes are still loading.
  if (loadingCount > 0) {
    results.innerHTML = `<div class="loading">Still loading indexes, please wait</div>`;
    return;
  }

  // Check if the word was excluded from indexing.
  if (STOP_WORDS.has(word)) {
    results.innerHTML = `<div class="not-indexed">
      <span class="not-indexed-word">${escapeHtml(word)}</span>
      <span class="not-indexed-msg">not indexed — too common to be useful as a search term</span>
    </div>`;
    return;
  }

  let anyResults = false;

  LANGUAGES.forEach(lang => {
    const data = indexes[lang.key];

    // Language failed to load — show an error card.
    if (!data) {
      results.appendChild(buildErrorCard(lang.name, 'Index failed to load.'));
      return;
    }

    // Look up the exact word, then also try partial matches for flexibility.
    const matches = getMatches(data, word);

    const card = buildCard(lang, matches, word);
    results.appendChild(card);
    if (matches.length > 0) anyResults = true;
  });

  if (!anyResults) {
    const msg = document.createElement('div');
    msg.className = 'no-results';
    msg.textContent = `No results found for "${word}". Try a simpler or related word.`;
    results.appendChild(msg);
  }
}

// getMatches — looks up the word in the { entries, index } format.
// entries[] holds all entry objects. index maps keywords to position arrays.
// Tries exact match first, then falls back to prefix matches.
function getMatches(data, word) {
  const { entries, index } = data;
  const seenPositions = new Set();
  const results = [];

  // Helper — resolve positions to entry objects, deduplicated.
  function addPositions(positions) {
    for (const pos of positions) {
      if (!seenPositions.has(pos) && entries[pos]) {
        seenPositions.add(pos);
        results.push(entries[pos]);
      }
      if (results.length >= 30) return;
    }
  }

  // Exact keyword match first.
  if (Array.isArray(index[word])) {
    addPositions(index[word]);
  }

  // Prefix matches — catches "breathe", "breathing" when searching "breath".
  if (results.length < 30) {
    for (const key of Object.keys(index)) {
      if (key !== word && key.startsWith(word) && Array.isArray(index[key])) {
        addPositions(index[key]);
      }
      if (results.length >= 30) break;
    }
  }

  return results;
}

// --- Card building -----------------------------------------------------------

function buildCard(lang, matches, searchWord) {
  const card = document.createElement('div');
  card.className = 'lang-card';

  // Header
  const label = document.createElement('div');
  label.className = 'lang-label';
  label.textContent = lang.name;
  card.appendChild(label);

  if (matches.length === 0) {
    const none = document.createElement('div');
    none.className = 'note';
    none.textContent = 'No results found.';
    card.appendChild(none);
    return card;
  }

  // Render up to RESULTS_PER_CARD entries, then a "show more" toggle.
  const visible = matches.slice(0, RESULTS_PER_CARD);
  const hidden  = matches.slice(RESULTS_PER_CARD);

  visible.forEach(entry => {
    card.appendChild(buildEntry(entry, lang));
  });

  if (hidden.length > 0) {
    // Hidden entries wrapped in a collapsible container.
    const moreWrap = document.createElement('div');
    moreWrap.className = 'more-entries';
    moreWrap.style.display = 'none';
    hidden.forEach(entry => {
      moreWrap.appendChild(buildEntry(entry, lang));
    });
    card.appendChild(moreWrap);

    const toggle = document.createElement('button');
    toggle.className = 'show-more-btn';
    toggle.textContent = `+ ${hidden.length} more`;
    toggle.addEventListener('click', () => {
      const isOpen = moreWrap.style.display !== 'none';
      moreWrap.style.display = isOpen ? 'none' : 'block';
      toggle.textContent = isOpen ? `+ ${hidden.length} more` : '− show less';
    });
    card.appendChild(toggle);
  }

  return card;
}

function buildEntry(entry, lang) {
  const wrap = document.createElement('div');
  wrap.className = 'entry';

  // --- Word + POS ---
  const wordRow = document.createElement('div');
  wordRow.className = 'word-row';

  const nativeWord = document.createElement('span');
  nativeWord.className = 'native-word';
  nativeWord.textContent = entry.word;
  wordRow.appendChild(nativeWord);

  if (entry.pos) {
    const pos = document.createElement('span');
    pos.className = 'pos-tag';
    pos.textContent = entry.pos;
    wordRow.appendChild(pos);
  }

  wrap.appendChild(wordRow);

  // --- Transliteration ---
  if (lang.transliterate) {
    const romanized = lang.transliterate(entry.word);
    if (romanized !== entry.word) {
      const translit = document.createElement('div');
      translit.className = 'transliteration';
      translit.textContent = romanized;
      wrap.appendChild(translit);
    }
  }

  // --- IPA ---
  if (entry.ipa) {
    const ipa = document.createElement('div');
    ipa.className = 'ipa';
    ipa.textContent = entry.ipa;
    wrap.appendChild(ipa);
  }

  // --- Glosses ---
  if (entry.glosses && entry.glosses.length > 0) {
    const glossWrap = document.createElement('div');
    glossWrap.className = 'glosses';

    const glossLabel = document.createElement('strong');
    glossLabel.textContent = 'Meanings';
    glossWrap.appendChild(glossLabel);

    const glossList = document.createElement('ul');
    entry.glosses.slice(0, 6).forEach(g => {
      const li = document.createElement('li');
      li.textContent = g;
      glossList.appendChild(li);
    });
    glossWrap.appendChild(glossList);
    wrap.appendChild(glossWrap);
  }

  // --- Etymology ---
  if (entry.etymology) {
    const etym = document.createElement('div');
    etym.className = 'etymology';
    const etymLabel = document.createElement('strong');
    etymLabel.textContent = 'Etymology';
    etym.appendChild(etymLabel);
    const etymText = document.createElement('p');
    // Trim long etymologies to keep the card readable.
    const text = entry.etymology.length > 300
      ? entry.etymology.slice(0, 300) + '…'
      : entry.etymology;
    etymText.textContent = text;
    etym.appendChild(etymText);
    wrap.appendChild(etym);
  }

  // --- Forms ---
  if (entry.forms && entry.forms.length > 0) {
    const formsWrap = document.createElement('div');
    formsWrap.className = 'forms';

    const formsLabel = document.createElement('strong');
    formsLabel.textContent = 'Forms';
    formsWrap.appendChild(formsLabel);

    const formsList = document.createElement('div');
    formsList.className = 'forms-list';

    entry.forms.slice(0, 8).forEach(f => {
      const chip = document.createElement('span');
      chip.className = 'form-chip';
      // Show the form word, with its grammatical tags underneath if present.
      chip.innerHTML = `<span class="form-word">${escapeHtml(f.form)}</span>`
        + (f.tags && f.tags.length > 0
          ? `<span class="form-tags">${f.tags.join(', ')}</span>`
          : '');
      formsList.appendChild(chip);
    });

    formsWrap.appendChild(formsList);
    wrap.appendChild(formsWrap);
  }

  // --- Derived words ---
  if (entry.derived && entry.derived.length > 0) {
    const derivedWrap = document.createElement('div');
    derivedWrap.className = 'derived';
    const derivedLabel = document.createElement('strong');
    derivedLabel.textContent = 'Derived';
    derivedWrap.appendChild(derivedLabel);
    const derivedText = document.createElement('p');
    derivedText.textContent = entry.derived.join(', ');
    derivedWrap.appendChild(derivedText);
    wrap.appendChild(derivedWrap);
  }

  // --- Related words ---
  if (entry.related && entry.related.length > 0) {
    const relatedWrap = document.createElement('div');
    relatedWrap.className = 'related';
    const relatedLabel = document.createElement('strong');
    relatedLabel.textContent = 'Related';
    relatedWrap.appendChild(relatedLabel);
    const relatedText = document.createElement('p');
    relatedText.textContent = entry.related.join(', ');
    relatedWrap.appendChild(relatedText);
    wrap.appendChild(relatedWrap);
  }

  return wrap;
}

function buildErrorCard(langName, message) {
  const card = document.createElement('div');
  card.className = 'lang-card';
  card.innerHTML = `
    <div class="lang-label">${escapeHtml(langName)}</div>
    <div class="note error-note">${escapeHtml(message)}</div>
  `;
  return card;
}

// --- Transliteration ---------------------------------------------------------

function transliterateGreek(text) {
  // Maps modern Greek Unicode characters to their Latin equivalents.
  const map = {
    'α':'a',  'β':'v',  'γ':'g',  'δ':'d',  'ε':'e',  'ζ':'z',
    'η':'i',  'θ':'th', 'ι':'i',  'κ':'k',  'λ':'l',  'μ':'m',
    'ν':'n',  'ξ':'x',  'ο':'o',  'π':'p',  'ρ':'r',  'σ':'s',
    'ς':'s',  'τ':'t',  'υ':'y',  'φ':'f',  'χ':'ch', 'ψ':'ps',
    'ω':'o',
    // Uppercase
    'Α':'A',  'Β':'V',  'Γ':'G',  'Δ':'D',  'Ε':'E',  'Ζ':'Z',
    'Η':'I',  'Θ':'Th', 'Ι':'I',  'Κ':'K',  'Λ':'L',  'Μ':'M',
    'Ν':'N',  'Ξ':'X',  'Ο':'O',  'Π':'P',  'Ρ':'R',  'Σ':'S',
    'Τ':'T',  'Υ':'Y',  'Φ':'F',  'Χ':'Ch', 'Ψ':'Ps', 'Ω':'O',
    // Accented / polytonic
    'ά':'a', 'έ':'e', 'ή':'i', 'ί':'i', 'ό':'o', 'ύ':'y', 'ώ':'o',
    'ϊ':'i', 'ϋ':'y', 'ΐ':'i', 'ΰ':'y',
    'ἀ':'a', 'ἁ':'a', 'ἂ':'a', 'ἃ':'a', 'ἄ':'a', 'ἅ':'a',
    'ἐ':'e', 'ἑ':'e', 'ἒ':'e', 'ἓ':'e', 'ἔ':'e', 'ἕ':'e',
    'ἠ':'i', 'ἡ':'i', 'ἢ':'i', 'ἣ':'i', 'ἤ':'i', 'ἥ':'i',
    'ἰ':'i', 'ἱ':'i', 'ἲ':'i', 'ἳ':'i', 'ἴ':'i', 'ἵ':'i',
    'ὀ':'o', 'ὁ':'o', 'ὂ':'o', 'ὃ':'o', 'ὄ':'o', 'ὅ':'o',
    'ὐ':'y', 'ὑ':'y', 'ὒ':'y', 'ὓ':'y', 'ὔ':'y', 'ὕ':'y',
    'ὠ':'o', 'ὡ':'o', 'ὢ':'o', 'ὣ':'o', 'ὤ':'o', 'ὥ':'o',
    'ὰ':'a', 'ὲ':'e', 'ὴ':'i', 'ὶ':'i', 'ὸ':'o', 'ὺ':'y', 'ὼ':'o',
    'ᾰ':'a', 'ᾱ':'a', 'ᾳ':'a', 'ῃ':'i', 'ῳ':'o',
  };
  return text.split('').map(c => map[c] ?? c).join('');
}

// --- Utility -----------------------------------------------------------------

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function showLoadError() {
  document.getElementById('results').innerHTML = `
    <div class="load-error">
      <p><strong>Could not load language indexes.</strong></p>
      <p>If you are opening this file directly from your computer (file://),
      the browser blocks loading local JSON files for security reasons.</p>
      <p>This will work correctly once deployed to GitHub Pages.
      To test locally, run a simple local server:</p>
      <code>docker run --rm -p 8080:80 -v "%cd%":/usr/share/nginx/html nginx</code>
      <p>Then open <strong>http://localhost:8080/lexicon_main.html</strong></p>
    </div>
  `;
}