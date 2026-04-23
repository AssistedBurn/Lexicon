// =============================================================================
// process.js — Kaikki JSONL → Lexicon Index Builder
// =============================================================================
// Run this ONCE with Docker to convert the large kaikki JSONL files into small
// indexed JSON files that the browser app can query instantly.
//
// Usage (Docker, from inside your lexicon/ folder):
//   docker run --rm -v "%cd%":/data node:20-alpine node /data/process.js
//
// Output format — each index file looks like this:
// {
//   "entries": [
//     { word, pos, ipa, etymology, glosses, forms, derived, related },
//     ...
//   ],
//   "index": {
//     "free":    [0, 14, 203],   <- positions in the entries array
//     "breath":  [1, 45],
//     ...
//   }
// }
//
// Each entry object is stored ONCE regardless of how many keywords point to it.
// This keeps file sizes small enough for GitHub Pages (under 25MB per file).
// =============================================================================

const fs       = require('fs');
const path     = require('path');
const readline = require('readline');

// --- Configuration -----------------------------------------------------------

const LANGUAGES = [
  {
    name: 'Greek',   input: 'kaikki.org-dictionary-Greek.jsonl',   output: 'greek_index.json',
    maxForms: 6, maxGlosses: 6, maxDerived: 6, maxRelated: 4, maxPerKeyword: 15,
    split: false,
  },
  {
    // Latin is split into two files alphabetically (a-m, n-z) to stay under
    // GitHub's 100MB file size limit. The browser loads both transparently.
    name: 'Latin',   input: 'kaikki.org-dictionary-Latin.jsonl',
    output: 'latin_index_a.json', outputB: 'latin_index_b.json',
    maxForms: 0, maxGlosses: 4, maxDerived: 0, maxRelated: 0, maxPerKeyword: 10,
    split: true,
  },
  {
    name: 'German',  input: 'kaikki.org-dictionary-German.jsonl',  output: 'german_index.json',
    maxForms: 4, maxGlosses: 4, maxDerived: 4, maxRelated: 3, maxPerKeyword: 10,
    split: false,
  },
  {
    name: 'Swedish', input: 'kaikki.org-dictionary-Swedish.jsonl', output: 'swedish_index.json',
    maxForms: 6, maxGlosses: 6, maxDerived: 6, maxRelated: 4, maxPerKeyword: 15,
    split: false,
  },
];

const LANGUAGES_DIR = path.join(__dirname, 'languages');
const SKIP_POS      = new Set(['character', 'symbol', 'punct', 'number']);

// -----------------------------------------------------------------------------

async function processLanguage(lang) {
  const inputPath  = path.join(LANGUAGES_DIR, lang.input);
  const outputPath = path.join(LANGUAGES_DIR, lang.output);

  if (!fs.existsSync(inputPath)) {
    console.warn(`  [SKIP] File not found: ${inputPath}`);
    return;
  }

  console.log(`\n[${lang.name}] Reading ${lang.input}...`);

  // entries[] — master list of clean entry objects, each stored exactly once.
  const entries    = [];
  // entryIndex — maps "word__pos" to its position in entries[].
  const entryIndex = Object.create(null);
  // index — maps English keywords to arrays of positions in entries[].
  const index      = Object.create(null);

  // Destructure per-language limits for convenience.
  const { maxForms, maxGlosses, maxDerived, maxRelated, maxPerKeyword } = lang;

  const rl = readline.createInterface({
    input:     fs.createReadStream(inputPath, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  });

  let lineCount    = 0;
  let indexedCount = 0;
  let skipCount    = 0;

  for await (const line of rl) {
    if (!line.trim()) continue;
    lineCount++;

    if (lineCount % 100000 === 0) {
      console.log(`  ...${lineCount.toLocaleString()} lines, ${entries.length.toLocaleString()} entries, ${indexedCount.toLocaleString()} keyword mappings`);
    }

    let entry;
    try { entry = JSON.parse(line); }
    catch { skipCount++; continue; }

    if (!entry.pos || SKIP_POS.has(entry.pos))                          { skipCount++; continue; }
    if (!Array.isArray(entry.senses) || entry.senses.length === 0)      { skipCount++; continue; }

    // Collect glosses
    const allGlosses = [];
    for (const sense of entry.senses) {
      if (!Array.isArray(sense.glosses)) continue;
      for (const gloss of sense.glosses) {
        if (typeof gloss === 'string' && gloss.trim()) allGlosses.push(gloss.trim());
      }
    }
    if (allGlosses.length === 0) { skipCount++; continue; }

    // IPA
    let ipa = null;
    if (Array.isArray(entry.sounds)) {
      const s = entry.sounds.find(s => s.ipa);
      if (s) ipa = s.ipa;
    }

    // Forms — skip entirely if maxForms is 0 (e.g. Latin).
    let forms = [];
    if (maxForms > 0 && Array.isArray(entry.forms)) {
      forms = entry.forms
        .filter(f =>
          f.form && typeof f.form === 'string' &&
          Array.isArray(f.tags) &&
          !f.tags.includes('inflection-template') &&
          !f.tags.includes('table-tags') &&
          !(/^[a-z]+-[a-z]+$/.test(f.form) && !f.form.includes(' '))
        )
        .slice(0, maxForms)
        .map(f => ({ form: f.form, tags: f.tags.filter(t => t !== 'canonical').slice(0, 3) }));
    }

    // Derived — skip if maxDerived is 0.
    let derived = [];
    if (maxDerived > 0 && Array.isArray(entry.derived)) {
      derived = entry.derived
        .map(d => d.word)
        .filter(w => typeof w === 'string' && w.trim() && w.length < 40)
        .slice(0, maxDerived);
    }

    // Related — skip if maxRelated is 0.
    let related = [];
    if (maxRelated > 0 && Array.isArray(entry.related)) {
      related = entry.related
        .map(r => r.word)
        .filter(w => typeof w === 'string' && w.trim() && w.length < 40)
        .slice(0, maxRelated);
    }

    // Etymology — truncate long ones.
    let etymology = null;
    if (entry.etymology_text) {
      etymology = entry.etymology_text.length > 400
        ? entry.etymology_text.slice(0, 400) + '...'
        : entry.etymology_text;
    }

    const cleanEntry = {
      word:      entry.word,
      pos:       entry.pos,
      ipa:       ipa,
      etymology: etymology,
      glosses:   allGlosses.slice(0, maxGlosses),
      forms:     forms,
      derived:   derived,
      related:   related,
    };

    // Get or create position in entries[].
    const entryKey = entry.word + '__' + entry.pos;
    let entryPos;

    if (entryKey in entryIndex) {
      entryPos = entryIndex[entryKey];
    } else {
      entryPos = entries.length;
      entries.push(cleanEntry);
      entryIndex[entryKey] = entryPos;
    }

    // Add position to keyword index.
    const keywords = extractKeywords(allGlosses);
    for (const keyword of keywords) {
      if (!Array.isArray(index[keyword])) index[keyword] = [];
      if (!index[keyword].includes(entryPos) && index[keyword].length < maxPerKeyword) {
        index[keyword].push(entryPos);
        indexedCount++;
      }
    }
  }

  console.log(`  Done. ${lineCount.toLocaleString()} lines, ${entries.length.toLocaleString()} unique entries, ${indexedCount.toLocaleString()} keyword mappings, ${skipCount.toLocaleString()} skipped.`);

  if (lang.split) {
    await writeSplit(lang, entries, index);
  } else {
    await writeIndex(path.join(LANGUAGES_DIR, lang.output), entries, index);
  }
}

// Write a single index file.
async function writeIndex(outputPath, entries, index) {
  console.log(`  Writing ${path.basename(outputPath)}...`);
  const ws = fs.createWriteStream(outputPath, { encoding: 'utf8' });

  ws.write('{"entries":[');
  for (let i = 0; i < entries.length; i++) {
    ws.write(JSON.stringify(entries[i]));
    if (i < entries.length - 1) ws.write(',');
  }
  ws.write('],"index":{');
  const keys = Object.keys(index);
  for (let i = 0; i < keys.length; i++) {
    ws.write(JSON.stringify(keys[i]) + ':' + JSON.stringify(index[keys[i]]));
    if (i < keys.length - 1) ws.write(',');
  }
  ws.write('}}');

  await new Promise((resolve, reject) => {
    ws.end();
    ws.on('finish', resolve);
    ws.on('error', reject);
  });

  const fileSizeKB = Math.round(fs.statSync(outputPath).size / 1024);
  console.log(`  Saved. File size: ${fileSizeKB.toLocaleString()} KB`);
}

// Write two split index files for large languages (e.g. Latin).
// Each file gets ONLY the entries it actually needs — no duplication.
// Positions are re-numbered from 0 within each file.
async function writeSplit(lang, entries, index) {
  const outputPathA = path.join(LANGUAGES_DIR, lang.output);
  const outputPathB = path.join(LANGUAGES_DIR, lang.outputB);

  const keysA = Object.keys(index).filter(k => k < 'n');
  const keysB = Object.keys(index).filter(k => k >= 'n');

  console.log(`  Writing ${lang.output} (a-m, ${keysA.length.toLocaleString()} keywords)...`);
  await writeIndexSubset(outputPathA, entries, index, keysA);

  console.log(`  Writing ${lang.outputB} (n-z, ${keysB.length.toLocaleString()} keywords)...`);
  await writeIndexSubset(outputPathB, entries, index, keysB);
}

async function writeIndexSubset(outputPath, entries, index, keys) {
  // Collect only the entry positions actually referenced by these keys.
  const neededPositions = new Set();
  for (const k of keys) {
    for (const pos of index[k]) neededPositions.add(pos);
  }

  // Build a compact entries array with only needed entries,
  // and a remapping from old position to new position.
  const positionMap  = Object.create(null); // oldPos -> newPos
  const subEntries   = [];
  for (const oldPos of neededPositions) {
    positionMap[oldPos] = subEntries.length;
    subEntries.push(entries[oldPos]);
  }

  // Rebuild the index with remapped positions.
  const subIndex = Object.create(null);
  for (const k of keys) {
    subIndex[k] = index[k].map(oldPos => positionMap[oldPos]);
  }

  // Write the file.
  const ws = fs.createWriteStream(outputPath, { encoding: 'utf8' });
  ws.write('{"entries":[');
  for (let i = 0; i < subEntries.length; i++) {
    ws.write(JSON.stringify(subEntries[i]));
    if (i < subEntries.length - 1) ws.write(',');
  }
  ws.write('],"index":{');
  for (let i = 0; i < keys.length; i++) {
    ws.write(JSON.stringify(keys[i]) + ':' + JSON.stringify(subIndex[keys[i]]));
    if (i < keys.length - 1) ws.write(',');
  }
  ws.write('}}');

  await new Promise((resolve, reject) => {
    ws.end();
    ws.on('finish', resolve);
    ws.on('error', reject);
  });

  const fileSizeMB = (fs.statSync(outputPath).size / 1024 / 1024).toFixed(2);
  console.log(`  Saved ${path.basename(outputPath)}: ${fileSizeMB} MB, ${subEntries.length.toLocaleString()} entries`);
}

// -----------------------------------------------------------------------------
// extractKeywords
// -----------------------------------------------------------------------------

const STOP_WORDS = new Set([
  'a','an','the','of','in','on','at','to','for','and','or','but','not',
  'is','are','was','were','be','been','being','have','has','had','do',
  'does','did','with','by','from','as','that','this','it','its','also',
  'used','often','especially','usually','one','two','any','all','some',
  'more','most','such','than','then','when','which','who','what','how',
  'very','less','much','many','may','can','could','will','would',
  'should','shall','into','onto','upon','about','above','below','between',
]);

function extractKeywords(glosses) {
  const keywords = new Set();
  for (const gloss of glosses) {
    const words = gloss
      .toLowerCase()
      .split(/[^a-z'\-]+/)
      .map(w => w.replace(/^[\-']+|[\-']+$/g, ''))
      .filter(w => w.length >= 3 && !STOP_WORDS.has(w));
    for (const word of words) keywords.add(word);
  }
  return keywords;
}

// -----------------------------------------------------------------------------
// Main
// -----------------------------------------------------------------------------

async function main() {
  console.log('='.repeat(60));
  console.log('Lexicon Index Builder');
  console.log('='.repeat(60));
  console.log(`Languages directory: ${LANGUAGES_DIR}`);
  console.log(`Processing ${LANGUAGES.length} languages...\n`);

  const startTime = Date.now();
  for (const lang of LANGUAGES) await processLanguage(lang);

  const elapsed = Math.round((Date.now() - startTime) / 1000);
  console.log('\n' + '='.repeat(60));
  console.log(`All done in ${elapsed}s.`);
  console.log('Push the index files to GitHub Pages and you are done.');
  console.log('='.repeat(60));
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});