// Smart file mergers for non-destructive upgrades of customized configurations.
// Preserves project-specific implementations while adding missing central standards.
import YAML from 'yaml';
import { normalize } from './templates.js';

/**
 * Merge a customized GitHub Actions workflow with the central standards template.
 * Preserves custom jobs (like Firebase emulator runners or Docker steps) while
 * injecting missing standards jobs (like the `security` job with Semgrep & Gitleaks).
 *
 * @param {string} existingYaml
 * @param {string} templateYaml
 * @returns {string} Merged workflow YAML preserving comments
 */
export function mergeYamlWorkflow(existingYaml, templateYaml) {
  let doc;
  try {
    doc = YAML.parseDocument(existingYaml);
  } catch {
    return templateYaml;
  }

  if (!doc.contents || !YAML.isMap(doc.contents)) {
    return templateYaml;
  }

  const tmpl = YAML.parse(templateYaml);
  if (!tmpl || !tmpl.jobs) return existingYaml;

  let jobs = doc.get('jobs');
  if (!jobs || !YAML.isMap(jobs)) {
    doc.set('jobs', tmpl.jobs);
    return doc.toString();
  }

  const existingJobKeys = jobs.items ? jobs.items.map((pair) => pair.key?.value ?? String(pair.key)) : [];
  const hasCustomCiJobs = existingJobKeys.some((k) => k !== 'security');

  for (const [jobName, jobConfig] of Object.entries(tmpl.jobs)) {
    if (!jobs.has(jobName)) {
      if (jobName === 'ci' && hasCustomCiJobs) {
        // User already has custom CI jobs (e.g. validate, test, build); keep theirs instead of duplicating with generic ci-node.yml
        continue;
      }
      jobs.set(jobName, jobConfig);
    }
  }

  return doc.toString();
}

/**
 * Merge a customized Markdown document (like a Pull Request template) with the central template.
 * Preserves custom checklist items and sections, while injecting missing standard
 * sections (like TDD Verification) and missing check items.
 *
 * @param {string} existingMd
 * @param {string} templateMd
 * @returns {string} Merged Markdown content
 */
export function mergeMarkdownSections(existingMd, templateMd) {
  const existingSections = parseSections(existingMd);
  const tmplSections = parseSections(templateMd);

  for (const tSec of tmplSections) {
    if (!tSec.heading) continue;

    const existingMatch = existingSections.find(
      (s) => s.heading && s.heading.trim().toLowerCase() === tSec.heading.trim().toLowerCase()
    );

    if (!existingMatch) {
      existingSections.push({
        heading: tSec.heading,
        lines: [...tSec.lines],
      });
    } else {
      const existingItems = new Set(
        existingMatch.lines
          .map((l) => l.trim())
          .filter((l) => l.startsWith('- [ ]') || l.startsWith('- [x]'))
      );

      for (const line of tSec.lines) {
        const trimmed = line.trim();
        if ((trimmed.startsWith('- [ ]') || trimmed.startsWith('- [x]')) && !existingItems.has(trimmed)) {
          existingMatch.lines.push(line);
          existingItems.add(trimmed);
        }
      }
    }
  }

  return reconstructSections(existingSections);
}

/**
 * Merge a customized JSON file (like .lintstagedrc.json) with template JSON.
 * Preserves existing keys and values; adds missing keys from template.
 *
 * @param {string} existingJson
 * @param {string} templateJson
 * @returns {string}
 */
export function mergeJson(existingJson, templateJson) {
  let existingObj;
  let templateObj;
  try {
    existingObj = JSON.parse(existingJson);
    templateObj = JSON.parse(templateJson);
  } catch {
    return existingJson;
  }
  if (typeof existingObj !== 'object' || existingObj === null || Array.isArray(existingObj)) return existingJson;
  if (typeof templateObj !== 'object' || templateObj === null || Array.isArray(templateObj)) return existingJson;

  let changed = false;
  const merged = { ...existingObj };
  for (const [key, val] of Object.entries(templateObj)) {
    if (!(key in merged)) {
      merged[key] = val;
      changed = true;
    }
  }
  return changed ? `${JSON.stringify(merged, null, 2)}\n` : existingJson;
}

/**
 * Route a file to its appropriate merger based on file extension.
 * @param {string} rel
 * @param {string} existingContent
 * @param {string} templateContent
 * @returns {{ canMerge: boolean, mergedContent: string, hasChanges: boolean }}
 */
export function mergeTemplateFile(rel, existingContent, templateContent) {
  let mergedContent = existingContent;
  let canMerge = false;

  if (rel.endsWith('.yml') || rel.endsWith('.yaml')) {
    canMerge = true;
    mergedContent = mergeYamlWorkflow(existingContent, templateContent);
  } else if (rel.endsWith('.md')) {
    canMerge = true;
    mergedContent = mergeMarkdownSections(existingContent, templateContent);
  } else if (rel.endsWith('.json')) {
    canMerge = true;
    mergedContent = mergeJson(existingContent, templateContent);
  }

  const hasChanges = normalize(mergedContent).trim() !== normalize(existingContent).trim();
  return { canMerge, mergedContent, hasChanges };
}

/**
 * @param {string} text
 * @returns {{ heading: string | null, lines: string[] }[]}
 */
function parseSections(text) {
  const rawLines = text.split(/\r?\n/);
  const sections = [];
  let currentHeading = null;
  let currentLines = [];

  for (const line of rawLines) {
    if (line.startsWith('## ')) {
      if (currentHeading !== null || currentLines.length > 0) {
        sections.push({ heading: currentHeading, lines: currentLines });
      }
      currentHeading = line;
      currentLines = [];
    } else {
      currentLines.push(line);
    }
  }

  if (currentHeading !== null || currentLines.length > 0) {
    sections.push({ heading: currentHeading, lines: currentLines });
  }

  return sections;
}

/**
 * @param {{ heading: string | null, lines: string[] }[]} sections
 * @returns {string}
 */
function reconstructSections(sections) {
  const parts = [];
  for (const sec of sections) {
    if (sec.heading) {
      parts.push(sec.heading);
    }
    if (sec.lines.length > 0) {
      parts.push(sec.lines.join('\n'));
    }
  }
  return parts.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
}
