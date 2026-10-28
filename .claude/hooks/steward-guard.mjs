#!/usr/bin/env node
// PreToolUse guard for the codebase-steward agent only (wired in .claude/agents/codebase-steward.md), so its hard
// limits are enforced, not just written down (evaluator G-05, #64). Exit 2 blocks the call; the message goes to the agent.
// Reads the hook's JSON from stdin: { tool_name, tool_input: { command } | { file_path } }.
import path from 'node:path';

// Commands the steward must never run: anything that reaches GitHub or another host, or destroys local work.
const BLOCKED_COMMANDS = [
  [/^git\s+push\b/, 'git push'],
  [/^gh\b/, 'the GitHub CLI'],
  [/^git\s+(reset\s+--hard|clean\b|branch\s+-D\b|checkout\s+--\s|restore\b|rebase\b|filter-branch\b|update-ref\b)/, 'a git command that discards or rewrites work'],
  [/^git\s+remote\b/, 'changing git remotes'],
  [/^(curl|wget|ssh|scp|nc|ncat)\b/, 'a network command'],
  [/^npm\s+(publish|login|adduser|token)\b/, 'publishing to npm'],
  [/^rm\s+-[a-z]*r/, 'recursive delete'],
];

// Security-sensitive paths (CLAUDE.md, .github/CODEOWNERS): the steward reports and proposes, it doesn't edit them.
const PROTECTED = ['src/server/', 'src/semantic/', 'src/db/', 'drizzle/', 'alerts/src/server/', 'alerts/drizzle/', 'docker/', '.github/', '.claude/', 'registry/'];

/** The reason a call is blocked, or null if it may run. Exported for tests. */
export function blockReason(input, projectDir = process.cwd()) {
  const tool = input?.tool_name;
  const args = input?.tool_input ?? {};
  if (tool === 'Bash') {
    // Every command in a chain counts: `npm test && git push` is a push.
    const parts = String(args.command ?? '').split(/&&|\|\||;|\||\n|\$\(|`/).map((p) => p.trim().replace(/^(sudo|env\s+\S+=\S+)\s+/, ''));
    for (const part of parts) for (const [re, what] of BLOCKED_COMMANDS) if (re.test(part)) return `The steward may not run ${what}. Report it for the owner instead.`;
    return null;
  }
  if (tool === 'Edit' || tool === 'Write' || tool === 'MultiEdit' || tool === 'NotebookEdit') {
    const file = String(args.file_path ?? args.notebook_path ?? '');
    const rel = path.relative(projectDir, path.resolve(projectDir, file)).split(path.sep).join('/');
    if (rel.startsWith('..') || path.isAbsolute(rel)) return 'The steward may only edit files inside this repository.';
    const hit = PROTECTED.find((p) => rel === p.slice(0, -1) || rel.startsWith(p));
    if (hit) return `${rel} is security-sensitive (${hit}). Report the problem and propose the fix; a person makes the change.`;
    return null;
  }
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
