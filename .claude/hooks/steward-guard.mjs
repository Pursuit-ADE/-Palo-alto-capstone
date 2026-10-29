#!/usr/bin/env node
// PreToolUse guard for the codebase-steward agent only (wired in .claude/agents/codebase-steward.md), so its hard
// limits are enforced, not just written down (evaluator G-05, #64). Exit 2 blocks the call; the message goes to the agent.
// Reads the hook's JSON from stdin: { tool_name, tool_input: { command } | { file_path } }.
import { execFileSync } from 'node:child_process';
import path from 'node:path';

// Matched anywhere in the whole command, not only at the start of a segment, so `bash -c 'git push'`,
// `git -C . push`, `FOO=1 git push`, `/usr/bin/git push`, `command git push` and `npx gh pr create` are all caught
// (PR #74 review). A false positive only means the steward reports instead of running the command.
const BEFORE = String.raw`(?:^|[\s;&|(\x60'"/\\=])`;
const BLOCKED_COMMANDS = [
  [/\bgit(?:\.exe)?\b[^\n]*?\bpush\b/i, 'git push'],
  [new RegExp(`${BEFORE}gh(?:\\.exe)?(?=$|[\\s'"\\x60;&|)])`, 'i'), 'the GitHub CLI'],
  [/\bgit(?:\.exe)?\b[^\n]*?\b(?:reset\s+--hard|clean\b|branch\s+-D\b|checkout\s+--\s|restore\b|rebase\b|filter-branch\b|update-ref\b|remote\b)/i, 'a git command that discards or rewrites work, or changes remotes'],
  [new RegExp(`${BEFORE}(?:curl|wget|ssh|scp|sftp|nc|ncat|telnet|invoke-webrequest|iwr|invoke-restmethod|irm)(?:\\.exe)?(?=$|\\s)`, 'i'), 'a network command'],
  [/\bnpm\b[^\n]*?\b(?:publish|login|adduser|token)\b/i, 'publishing to npm'],
  [new RegExp(`${BEFORE}rm\\s+-[a-z]*r`, 'i'), 'recursive delete'],
];

// The security-sensitive entries of .github/CODEOWNERS (not its catch-all): the steward reports and proposes, a person
// changes them. Compared case-insensitively, so SRC/server/ on a case-insensitive disk is the same folder.
const PROTECTED_DIRS = ['src/server/', 'src/semantic/', 'src/db/', 'drizzle/', 'alerts/src/', 'alerts/rules/', 'alerts/drizzle/', 'docker/', '.github/', '.claude/', 'registry/', 'scripts/', 'onboarding/'];
const PROTECTED_FILES = ['proxy.ts', 'alerts/proxy.ts', 'next.config.ts', 'alerts/next.config.ts', 'package.json', 'package-lock.json', 'alerts/package.json', 'alerts/package-lock.json', 'security.md', 'claude.md'];
const PROTECTED_PATTERNS = [[/^app\/[^/]*actions\.ts$/, 'app/*actions.ts'], [/^alerts\/app\/[^/]*actions\.ts$/, 'alerts/app/*actions.ts']];

// A Bash command that names a protected path and can write: tee, an in-place edit, a file command, git
// apply/checkout/restore, or an interpreter running inline code (PR #74 review: `tee`, `sed -i` and `>`). Redirections
// are checked by their target, so `grep foo src/server 2>/dev/null` still only reads.
const REDIRECT = /\d*>>?\s*(?!&)['"]?([^\s'";&|<>()]+)/g;
const WRITES = /(?:\btee\b|\bsed\b[^\n]*\s-i|\bperl\b[^\n]*\s-[a-z]*i|\b(?:cp|mv|rm|touch|truncate|install|ln|chmod|chown|dd|patch|unzip|tar)\b|\bgit\b[^\n]*\b(?:apply|am|checkout|restore|mv|rm|stash)\b|\b(?:node|python3?|ruby|perl|deno|bun|tsx|powershell|pwsh)\b[^\n]*\s-(?:e|c|p|command)\b|\b(?:set-content|add-content|out-file|new-item|remove-item|copy-item|move-item)\b)/i;

/** The protected rule a repo-relative path falls under, or null. */
export function protectedRule(rel) {
  const p = rel.replace(/\\/g, '/').replace(/^\.\//, '').toLowerCase();
  const dir = PROTECTED_DIRS.find((d) => p === d.slice(0, -1) || p.startsWith(d));
  if (dir) return dir;
  if (PROTECTED_FILES.includes(p)) return p;
  const hit = PROTECTED_PATTERNS.find(([re]) => re.test(p));
  return hit ? hit[1] : null;
}

function relativeToRepo(file, projectDir) {
  return path.relative(projectDir, path.resolve(projectDir, file)).split(path.sep).join('/');
}

function currentBranch(projectDir) {
  try {
    return execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: projectDir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return '';
  }
}

const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);
const ASK_A_PERSON = 'Report the problem and propose the fix; a person makes the change.';

/** The first repo path among `candidates` that is protected, with its rule. */
function firstProtected(candidates, projectDir) {
  for (const c of candidates) {
    const rel = relativeToRepo(c, projectDir);
    const rule = rel.startsWith('..') ? null : protectedRule(rel);
    if (rule) return { rel, rule };
  }
  return null;
}

/** Bash: blocked commands anywhere in the line, commits on main or week*, and writes to protected paths. */
function bashBlockReason(command, projectDir, branch) {
  for (const [re, what] of BLOCKED_COMMANDS) if (re.test(command)) return `The steward may not run ${what}. Report it for the owner instead.`;
  // Never commit on main or a week branch: the steward works on its own steward/<topic> branch.
  if (/\bgit\b[^\n]*?\bcommit\b/i.test(command)) {
    const b = branch();
    if (!b || /^(main|master|week[\w.-]*|HEAD)$/i.test(b)) return `The steward may not commit on "${b || 'an unknown branch'}". Create steward/<topic> first.`;
  }
  const redirected = firstProtected([...command.matchAll(REDIRECT)].map((m) => m[1]), projectDir);
  if (redirected) return `This command writes to ${redirected.rel}, which is security-sensitive (${redirected.rule}). ${ASK_A_PERSON}`;
  const named = WRITES.test(command) ? firstProtected(command.split(/[\s'"\x60;&|<>()=]+/).filter(Boolean), projectDir) : null;
  if (named) return `This command can change ${named.rel}, which is security-sensitive (${named.rule}). ${ASK_A_PERSON}`;
  return null;
}

/** Edit tools: only inside the repository, and never on a protected path. */
function editBlockReason(file, projectDir) {
  const rel = relativeToRepo(file, projectDir);
  if (rel.startsWith('..') || path.isAbsolute(rel)) return 'The steward may only edit files inside this repository.';
  const rule = protectedRule(rel);
  return rule ? `${rel} is security-sensitive (${rule}). ${ASK_A_PERSON}` : null;
}

/** The reason a call is blocked, or null if it may run. Exported for tests; `branch` is injectable for them. */
export function blockReason(input, projectDir = process.cwd(), branch = () => currentBranch(projectDir)) {
  const args = input?.tool_input ?? {};
  if (input?.tool_name === 'Bash') return bashBlockReason(String(args.command ?? ''), projectDir, branch);
  if (EDIT_TOOLS.has(input?.tool_name)) return editBlockReason(String(args.file_path ?? args.notebook_path ?? ''), projectDir);
  return null;
}

// Run as a hook (node .claude/hooks/steward-guard.mjs), not when a test imports blockReason.
if (process.argv[1]?.endsWith('steward-guard.mjs')) {
  let raw = '';
  process.stdin.on('data', (c) => { raw += c; });
  process.stdin.on('end', () => {
    let input;
    try {
      input = JSON.parse(raw || '{}');
    } catch {
      process.stderr.write('steward-guard: unreadable hook input, blocking to be safe.\n');
      process.exit(2);
    }
    const reason = blockReason(input, process.env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd());
    if (reason) {
      process.stderr.write(`${reason}\n`);
      process.exit(2);
    }
    process.exit(0);
  });
}
