#!/usr/bin/env node
/**
 * validate-reference-links.js
 *
 * Guards links from skills to the shared `references/` checklists.
 *
 * Those checklists live in the repo-root `references/` directory, but every
 * SKILL.md used to link them as `references/<file>.md` — a path relative to
 * the skill's own directory, which is two levels below the root. All 18 links
 * across 11 skills resolved to files that do not exist, in the repo and in
 * every plugin-install layout (~/.claude/plugins/cache/..., ~/.codex/...).
 * Agents that followed the guidance — for example using-agent-skills pointing
 * at the Definition of Done — hit a file-not-found and stalled.
 *
 * Nothing else in CI catches this: validate-artifact-paths.js is scoped to
 * spec/plan/todo artifacts and is explicitly not a general markdown linter.
 *
 * The rule enforced here: every `references/*.md` link in a SKILL.md must
 * resolve to an existing file relative to that skill's own directory. This
 * accepts both conventions in CLAUDE.md — shared checklists reached via
 * `../../references/`, and a skill's own colocated `references/` directory.
 *
 * The markdown files inside a skill's own `references/` directory get the
 * same check, with each link resolved from the file that contains it. They
 * sit one directory deeper than SKILL.md, so from there the shared checklists
 * are `../../../references/`: the same off-by-a-level mistake, one level down.
 *
 * Scope is deliberately narrow: only `references/*.md` links, only SKILL.md
 * and `skills/<name>/references/*.md` files. It is not a general markdown
 * path linter — skills legitimately mention paths that do not exist yet
 * (`tasks/todo.md`, `PERF.md`, `docs/ideas/[idea-name].md`), and those must
 * not fail the build.
 *
 * Fenced code blocks are exempt for the same reason. Text inside a fence is
 * an example, not a link an agent will follow — and this rule in particular
 * has to be documentable: the failure message below tells authors to write
 * `../../references/<file>.md` rather than `references/<file>.md`, which no
 * skill could show as an example without failing the very check explaining it.
 *
 * Exit codes: 0 = all clear, 1 = one or more unresolvable links.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { stripFencedCodeBlocks } = require('./lib/skill-lint');

const ROOT = path.resolve(__dirname, '..');
const SKILLS_DIR = path.join(ROOT, 'skills');

// Matches a link to a references/ markdown file, with any number of leading
// `../` segments: `references/x.md`, `../../references/x.md`. Anchored on a
// non-path character so `myreferences/x.md` does not match.
const REFERENCE_LINK_RE = /(?<![A-Za-z0-9._/-])((?:\.\.\/)*references\/[A-Za-z0-9._-]+\.md)/g;

// A link is resolved from the directory of the file that contains it.
function findViolations(file) {
  const violations = [];
  const baseDir = path.dirname(file);
  // Share the linter's fence rules; blanked lines preserve diagnostic positions.
  const lines = stripFencedCodeBlocks(fs.readFileSync(file, 'utf8')).split('\n');

  lines.forEach((line, i) => {
    for (const match of line.matchAll(REFERENCE_LINK_RE)) {
      const link = match[1];
      const target = path.resolve(baseDir, link);
      if (!fs.existsSync(target)) {
        violations.push({ line: i + 1, link, target });
      }
    }
  });

  return violations;
}

// The markdown files directly inside a skill's own references/ directory.
function skillReferenceFiles(skillDir) {
  const dir = path.join(skillDir, 'references');
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) return [];
  return fs.readdirSync(dir)
    .filter((name) => name.endsWith('.md'))
    .sort()
    .map((name) => path.join(dir, name))
    .filter((file) => fs.statSync(file).isFile());
}

function toPosix(file) {
  return path.relative(ROOT, file).split(path.sep).join('/');
}

function main() {
  console.log('Checking references/ links in skills...\n');

  if (!fs.existsSync(SKILLS_DIR)) {
    console.log('No skills/ directory — nothing to check.');
    return;
  }

  let checked = 0;
  let errors = 0;
  let referenceFileErrors = 0;

  const skillNames = fs.readdirSync(SKILLS_DIR).sort();
  for (const name of skillNames) {
    const skillDir = path.join(SKILLS_DIR, name);
    const skillFile = path.join(skillDir, 'SKILL.md');
    if (!fs.statSync(skillDir).isDirectory() || !fs.existsSync(skillFile)) continue;

    checked++;
    for (const file of [skillFile, ...skillReferenceFiles(skillDir)]) {
      const violations = findViolations(file);

      if (violations.length === 0) {
        console.log(`  ✓  ${toPosix(file)}`);
        continue;
      }

      console.log(`  ✗  ${toPosix(file)}`);
      for (const { line, link, target } of violations) {
        console.log(`       L${line}: ${link} — resolves to ${toPosix(target)}, which does not exist`);
        errors++;
        if (file !== skillFile) referenceFileErrors++;
      }
    }
  }

  const status = errors > 0 ? 'FAILED' : 'PASSED';
  console.log(`\n${checked} skills checked — ${errors} error(s) — ${status}`);

  if (errors > 0) {
    console.log('\nLinks to references/ are resolved from the directory of the file that contains them.');
    console.log('Shared checklists live in the repo-root references/, two levels up from a SKILL.md:');
    console.log('use `../../references/<file>.md`, not `references/<file>.md`.');
    if (referenceFileErrors > 0) {
      console.log('From a file inside skills/<name>/references/ they are three levels up:');
      console.log('use `../../../references/<file>.md`.');
    }
    process.exit(1);
  }
}

main();
