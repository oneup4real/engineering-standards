// Architecture checks that need more than an import graph: server-only markers, guarded server actions,
// a shrinking allow-list of direct DB writes, and sets (e.g. roles) that must match across files.
// Every checker is pure over the file system and returns Violation[]; arch/suite.js turns them into tests.
import fs from 'node:fs';
import path from 'node:path';

/** @typedef {{ file: string, line?: number, message: string }} Violation */

const SOURCE_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'];
const SKIP_DIRS = new Set(['node_modules', '.next', '.git', 'dist', 'build', 'coverage']);
const TEST_FILE = /\.(test|spec)\.[cm]?[jt]sx?$/;

/**
 * Every file under `dir` must `import 'server-only'`, so server code can never be bundled for the browser.
 * @param {{ root: string, dir?: string }} opts
 * @returns {Violation[]}
 */
export function checkServerOnly({ root, dir = 'src/server' }) {
  return sourceFiles(root, [dir], [])
    .filter((file) => !/import\s+['"]server-only['"]/.test(read(root, file)))
    .map((file) => ({ file, message: `missing import 'server-only'` }));
}

/**
 * Files in `dirs` must not import modules matching any of `patterns` (substring or regex source).
 * @param {{ root: string, dirs: string[], exclude?: string[], patterns: string[] }} opts
 * @returns {Violation[]}
 */
export function checkForbiddenImports({ root, dirs, exclude = [], patterns }) {
  const regexes = patterns.map((p) => new RegExp(p));
  /** @type {Violation[]} */
  const violations = [];
  for (const file of sourceFiles(root, dirs, exclude)) {
    read(root, file).split('\n').forEach((text, i) => {
      const specifier = text.match(/(?:from\s+|import\s*\(\s*|require\s*\(\s*|^\s*import\s+)['"]([^'"]+)['"]/)?.[1];
      if (specifier && regexes.some((r) => r.test(specifier))) {
        violations.push({ file, line: i + 1, message: `forbidden import "${specifier}"` });
      }
    });
  }
  return violations;
}

/**
 * Every exported function in server-action files must call a guard (e.g. requireAuth) in its body,
 * carry a `// @public-action: <reason>` comment, or be listed in the gaps file.
 * @param {{ root: string, actionsDir?: string, guardPattern: string, publicMarker?: string, gapsFile?: string }} opts
 * @returns {Violation[]}
 */
export function checkActionGuards({ root, actionsDir = 'src/app/actions', guardPattern, publicMarker = '@public-action', gapsFile }) {
  const guard = new RegExp(`\\b(${guardPattern})\\s*\\(`);
  /** @type {Record<string, Record<string, string>>} */
  const gaps = gapsFile ? readJson(root, gapsFile, {}) : {};
  /** @type {Violation[]} */
  const violations = [];

  for (const file of sourceFiles(root, [actionsDir], [])) {
    const original = read(root, file);
    const code = stripStringsAndComments(original);
    if (!/^\s*['"]use server['"]/m.test(original)) {
      violations.push({ file, message: `missing 'use server' directive` });
    }
    for (const fn of exportedFunctions(code)) {
      const body = code.slice(fn.bodyStart, fn.bodyEnd);
      if (guard.test(body)) continue;
      if (precedingComments(original, fn.index).includes(`${publicMarker}:`)) continue;
      if (gaps[file]?.[fn.name]) continue;
      violations.push({
        file,
        line: lineOf(original, fn.index),
        message: `exported action "${fn.name}" has no guard call (${guardPattern}) and no "// ${publicMarker}: <reason>" comment`,
      });
    }
  }
  return violations;
}

/**
 * Counts calls matching `callPattern` per file and compares with the allow-list (a ratchet that may only shrink).
 * @param {{ root: string, dirs: string[], exclude?: string[], callPattern: string, allowlistFile: string }} opts
 * @returns {Violation[]}
 */
export function checkCallRatchet({ root, dirs, exclude = [], callPattern, allowlistFile }) {
  const call = new RegExp(`\\b(${callPattern})\\s*\\(`, 'g');
  /** @type {Record<string, number>} */
  const allowed = readJson(root, allowlistFile, {});
  /** @type {Violation[]} */
  const violations = [];
  /** @type {Set<string>} */
  const seen = new Set();

  for (const file of sourceFiles(root, dirs, exclude)) {
    const count = (stripStringsAndComments(read(root, file)).match(call) ?? []).length;
    const limit = allowed[file] ?? 0;
    seen.add(file);
    if (count > limit) {
      violations.push({ file, message: `${count} direct call(s) matching ${callPattern}, allowed ${limit}. Move the writes behind a server action.` });
    } else if (count < limit) {
      violations.push({ file, message: `only ${count} call(s) left but ${limit} allowed: shrink the entry in ${allowlistFile} to ${count}.` });
    }
  }
  for (const [file, limit] of Object.entries(allowed)) {
    if (!seen.has(file) && limit > 0) {
      violations.push({ file, message: `file no longer has calls (or was removed): delete its entry from ${allowlistFile}.` });
    }
  }
  return violations;
}

/**
 * All sources must contain exactly the same values. The first source is the reference.
 * @param {{ label: string, values: string[] }[]} sources
 * @returns {Violation[]}
 */
export function checkSetsInSync(sources) {
  const [reference, ...others] = sources;
  if (!reference) return [];
  const ref = new Set(reference.values);
  /** @type {Violation[]} */
  const violations = [];
  for (const source of others) {
    const values = new Set(source.values);
    const missing = [...ref].filter((v) => !values.has(v));
    const unknown = [...values].filter((v) => !ref.has(v));
    if (missing.length) violations.push({ file: source.label, message: `${source.label} is missing: ${missing.join(', ')} (present in ${reference.label})` });
    if (unknown.length) violations.push({ file: source.label, message: `${source.label} has unknown: ${unknown.join(', ')} (not in ${reference.label})` });
  }
  return violations;
}

// --- helpers ---------------------------------------------------------------------------------

const REGEX_PRECEDERS = new Set(['(', ',', '=', ':', '[', '!', '&', '|', '?', '{', '}', ';', '+', '-', '*', '%', '~', '^']);
const REGEX_KEYWORDS = /(?:^|[^\w$])(?:return|typeof|case|in|of|new|delete|void|throw|yield|await)$/;

/**
 * Replaces the contents of strings, comments and regex literals with spaces, keeping offsets and newlines,
 * so that pattern checks only see real code. Template literal `${…}` parts stay code.
 * Quote and regex scanning stop at a newline, so a stray apostrophe (e.g. in JSX text) blanks one line at most.
 * @param {string} code
 */
export function stripStringsAndComments(code) {
  const out = code.split('');
  const blank = (/** @type {number} */ from, /** @type {number} */ to) => {
    for (let k = from; k < to; k++) if (out[k] !== '\n') out[k] = ' ';
  };
  /** @type {number[]} brace depth inside each open template interpolation */
  const templateStack = [];
  let i = 0;
  let lastSignificant = '';

  /** Scans template text from i (just after ` or }) to the closing ` or the next ${. */
  const scanTemplate = () => {
    let j = i;
    while (j < code.length && code[j] !== '`' && !(code[j] === '$' && code[j + 1] === '{')) j += code[j] === '\\' ? 2 : 1;
    blank(i, j);
    if (code[j] === '`') {
      i = j + 1;
      lastSignificant = '`';
    } else if (j < code.length) {
      templateStack.push(0);
      i = j + 2;
      lastSignificant = '{';
    } else {
      i = j;
    }
  };

  while (i < code.length) {
    const c = code[i];
    const next = code[i + 1];
    if (c === '/' && next === '/') {
      const end = code.indexOf('\n', i);
      const stop = end === -1 ? code.length : end;
      blank(i, stop);
      i = stop;
    } else if (c === '/' && next === '*') {
      const end = code.indexOf('*/', i + 2);
      const stop = end === -1 ? code.length : end + 2;
      blank(i, stop);
      i = stop;
    } else if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < code.length && code[j] !== c && code[j] !== '\n') j += code[j] === '\\' ? 2 : 1;
      blank(i + 1, Math.min(j, code.length));
      i = code[j] === c ? j + 1 : j;
      lastSignificant = c;
    } else if (c === '`') {
      i += 1;
      scanTemplate();
    } else if (c === '/' && (lastSignificant === '' || REGEX_PRECEDERS.has(lastSignificant) || REGEX_KEYWORDS.test(code.slice(Math.max(0, i - 8), i).trimEnd()))) {
      let j = i + 1;
      let inClass = false;
      while (j < code.length && code[j] !== '\n' && (inClass || code[j] !== '/')) {
        if (code[j] === '\\') j += 1;
        else if (code[j] === '[') inClass = true;
        else if (code[j] === ']') inClass = false;
        j += 1;
      }
      if (code[j] === '/') {
        blank(i + 1, j);
        i = j + 1;
        lastSignificant = '/';
      } else {
        i += 1; // not a regex after all (e.g. division at line end)
        lastSignificant = '/';
      }
    } else if (templateStack.length > 0 && (c === '{' || c === '}')) {
      const top = templateStack.length - 1;
      if (c === '{') templateStack[top] += 1;
      else if (templateStack[top] === 0) {
        templateStack.pop();
        i += 1;
        scanTemplate();
        continue;
      } else templateStack[top] -= 1;
      lastSignificant = c;
      i += 1;
    } else {
      if (!/\s/.test(c)) lastSignificant = /[\w$]/.test(c) ? 'w' : c;
      i += 1;
    }
  }
  return out.join('');
}

/**
 * @param {string} code code with strings and comments stripped
 * @returns {{ name: string, index: number, bodyStart: number, bodyEnd: number }[]}
 */
function exportedFunctions(code) {
  const found = [];
  const add = (/** @type {string} */ name, /** @type {number} */ index, /** @type {number} */ bodyStart) => {
    if (bodyStart === -1) return;
    const bodyEnd = code[bodyStart] === '{' ? matchBrace(code, bodyStart) : endOfExpression(code, bodyStart);
    found.push({ name, index, bodyStart, bodyEnd });
  };
  const ID = '[A-Za-z0-9_$]+';
  // export [default] [async] function [name](
  for (const m of code.matchAll(new RegExp(`export\\s+(default\\s+)?(?:async\\s+)?function\\s*\\*?\\s*(${ID})?\\s*[(<]`, 'g'))) {
    add(m[2] ?? 'default', m.index, findBodyBrace(code, code.indexOf('(', m.index)));
  }
  // export const name = [async] function [name](
  for (const m of code.matchAll(new RegExp(`export\\s+const\\s+(${ID})\\s*(?::[^=]+)?=\\s*(?:async\\s+)?function\\b[^(]*\\(`, 'g'))) {
    add(m[1], m.index, findBodyBrace(code, m.index + m[0].length - 1));
  }
  // export const name = [async] (args) => …
  for (const m of code.matchAll(new RegExp(`export\\s+const\\s+(${ID})\\s*(?::[^=]+)?=\\s*(?:async\\s*)?(?:\\([^)]*\\)|${ID})\\s*(?::[^=]+)?=>`, 'g'))) {
    add(m[1], m.index, skipSpaces(code, m.index + m[0].length));
  }
  // export const name = [async] (args with nested parens/types) => …
  for (const m of code.matchAll(new RegExp(`export\\s+const\\s+(${ID})\\s*(?::[^=]+)?=\\s*(?:async\\s*)?\\(`, 'g'))) {
    const parenStart = m.index + m[0].length - 1;
    const bodyStart = findArrowBody(code, parenStart);
    if (bodyStart !== -1) add(m[1], m.index, bodyStart);
  }
  return found.sort((x, y) => x.index - y.index);
}

/** @param {string} code @param {number} parenStart */
function findBodyBrace(code, parenStart) {
  let i = parenStart;
  let depth = 0;
  for (; i < code.length; i++) {
    if (code[i] === '(') depth++;
    else if (code[i] === ')' && --depth === 0) break;
  }
  let angle = 0;
  for (i += 1; i < code.length; i++) {
    const c = code[i];
    if (c === '<') angle++;
    else if (c === '>') angle = Math.max(0, angle - 1);
    else if (c === '{' && angle === 0) return i;
  }
  return -1;
}

/** @param {string} code @param {number} start */
function matchBrace(code, start) {
  let depth = 0;
  for (let i = start; i < code.length; i++) {
    if (code[i] === '{') depth++;
    else if (code[i] === '}' && --depth === 0) return i + 1;
  }
  return code.length;
}

/** @param {string} code @param {number} start */
function endOfExpression(code, start) {
  const end = code.indexOf(';', start);
  return end === -1 ? code.length : end;
}

/** @param {string} code @param {number} i */
function skipSpaces(code, i) {
  while (i < code.length && /\s/.test(code[i])) i++;
  return i;
}

/** Comment lines directly above `index` (blank lines allowed in between). */
function precedingComments(/** @type {string} */ code, /** @type {number} */ index) {
  const lines = code.slice(0, index).split('\n');
  lines.pop();
  const comments = [];
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();
    if (line === '') continue;
    if (line.startsWith('//') || line.startsWith('*') || line.startsWith('/*')) comments.unshift(line);
    else break;
  }
  return comments.join('\n');
}

/** @param {string} code @param {number} index */
function lineOf(code, index) {
  return code.slice(0, index).split('\n').length;
}

/**
 * @param {string} root
 * @param {string[]} dirs repo-relative directories
 * @param {string[]} exclude repo-relative path prefixes to skip
 * @returns {string[]} repo-relative POSIX paths, sorted
 */
function sourceFiles(root, dirs, exclude) {
  /** @type {string[]} */
  const files = [];
  const walk = (/** @type {string} */ rel) => {
    const abs = path.join(root, rel);
    if (!fs.existsSync(abs)) return;
    for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
      const childRel = path.posix.join(rel, entry.name);
      if (exclude.some((prefix) => childRel.startsWith(prefix) || `${childRel}/`.startsWith(prefix))) continue;
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) walk(childRel);
      } else if (SOURCE_EXTENSIONS.includes(path.extname(entry.name)) && !TEST_FILE.test(entry.name)) {
        files.push(childRel);
      }
    }
  };
  for (const dir of dirs) walk(dir.replace(/\/$/, ''));
  return [...new Set(files)].sort();
}

/** @param {string} root @param {string} rel */
function read(root, rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

/**
 * @template T
 * @param {string} root @param {string} rel @param {T} fallback
 * @returns {T}
 */
function readJson(root, rel, fallback) {
  const abs = path.join(root, rel);
  if (!fs.existsSync(abs)) return fallback;
  try {
    return JSON.parse(fs.readFileSync(abs, 'utf8'));
  } catch (error) {
    throw new Error(`Could not parse ${rel}: ${/** @type {Error} */ (error).message}`, { cause: error });
  }
}

/** @param {string} code @param {number} parenStart */
function findArrowBody(code, parenStart) {
  let depth = 0;
  let i = parenStart;
  for (; i < code.length; i++) {
    if (code[i] === '(') depth++;
    else if (code[i] === ')' && --depth === 0) break;
  }
  if (i >= code.length) return -1;
  const arrowIdx = code.indexOf('=>', i);
  if (arrowIdx === -1 || arrowIdx > i + 200) return -1;
  return skipSpaces(code, arrowIdx + 2);
}
