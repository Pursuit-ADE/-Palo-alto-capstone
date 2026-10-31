// The codebase-steward guard hook (evaluator G-05, #64): the agent's "never push, never touch security paths" limits are
// enforced by a PreToolUse hook, not only by instruction text.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { blockReason } from '../.claude/hooks/steward-guard.mjs';

const ROOT = process.cwd();
const bash = (command: string, branch = 'steward/test') => blockReason({ tool_name: 'Bash', tool_input: { command } }, ROOT, () => branch);
const edit = (file_path: string) => blockReason({ tool_name: 'Edit', tool_input: { file_path } }, ROOT);

describe('steward guard: commands', () => {
  it.each([
    'git push origin steward/x', 'npm test && git push', 'gh pr create --fill', 'echo ok; gh api repos/x', 'git reset --hard origin/main', 'curl https://example.com', 'rm -rf node_modules', 'sudo git push',
    // PR #74 review: a push or gh call that isn't at the start of a segment.
    "bash -c 'git push'", 'git -C . push', 'FOO=1 git push', '/usr/bin/git push', 'command git push', 'npx gh pr create',
  ])(
    'blocks %s',
    (command) => {
      expect(bash(command)).toMatch(/may not run/);
    },
  );

  it.each(['npm run typecheck', 'npm test', 'git fetch origin --prune', 'git status --porcelain', 'git checkout -b steward/lint', 'git commit -m "Fix lint"', 'npx biome lint app'])(
    'allows %s',
    (command) => {
      expect(bash(command)).toBeNull();
    },
  );
});

describe('steward guard: Bash writes to protected paths (PR #74 review)', () => {
  it.each(['tee src/server/session.ts', 'echo x | tee -a src/server/session.ts', 'sed -i s/a/b/ src/server/session.ts', 'echo x > src/server/session.ts', 'echo x >> SRC/server/session.ts', 'cp /tmp/x proxy.ts', "node -e \"require('fs').writeFileSync('package.json','')\""])(
    'blocks %s',
    (command) => {
      expect(bash(command)).toMatch(/security-sensitive/);
    },
  );

  it.each(['grep -rn foo src/server 2>/dev/null', 'git diff origin/main -- drizzle/', 'cat src/server/auth.ts', 'npm run lint > lint-report.txt'])('allows %s', (command) => {
    expect(bash(command)).toBeNull();
  });
});

describe('steward guard: commits only on its own branch', () => {
  it.each(['main', 'week5', 'HEAD'])('blocks a commit on %s', (branch) => {
    expect(bash('git commit -m "Fix lint"', branch)).toMatch(/may not commit/);
  });

  it('allows a commit on a steward branch', () => {
    expect(bash('git commit -m "Fix lint"', 'steward/lint')).toBeNull();
  });
});

describe('steward guard: edits', () => {
  it.each([
    'src/server/session.ts', 'src/semantic/compile.ts', 'src/db/schema.ts', 'drizzle/0001_query_audit.sql', '.github/workflows/ci.yml', '.claude/agents/codebase-steward.md', 'registry/metrics/open_pipeline.json', '../outside.txt',
    // PR #74 review: every security-sensitive CODEOWNERS path, and case-insensitive.
    'app/auth-actions.ts', 'alerts/app/auth-actions.ts', 'alerts/src/db/client.ts', 'alerts/rules/low_usage.json', 'proxy.ts', 'alerts/proxy.ts', 'next.config.ts', 'alerts/next.config.ts',
    'package.json', 'package-lock.json', 'alerts/package.json', 'alerts/package-lock.json', 'scripts/purge.ts', 'SRC/server/session.ts', 'CLAUDE.md',
  ])(
    'blocks an edit to %s',
    (file) => {
      expect(edit(path.join(ROOT, file))).not.toBeNull();
    },
  );

  it.each(['app/page.tsx', 'docs/RUNBOOK.md', 'tests/golden.test.ts', 'alerts/app/page.tsx', 'app/globals.css'])('allows an edit to %s', (file) => {
    expect(edit(path.join(ROOT, file))).toBeNull();
  });
});

describe('steward guard: wiring', () => {
  it('is attached to the steward agent as a PreToolUse hook', () => {
    const agent = fs.readFileSync(path.join(ROOT, '.claude/agents/codebase-steward.md'), 'utf8');
    expect(agent).toMatch(/hooks:\s*\n\s*PreToolUse:/);
    expect(agent).toContain('steward-guard.mjs');
    expect(agent).toMatch(/matcher: "Bash\|Edit\|Write/);
  });

  it('exits 2 with a reason when run as a hook on a blocked call, and 0 otherwise', () => {
    const run = (input: unknown) => {
      try {
        execFileSync(process.execPath, ['.claude/hooks/steward-guard.mjs'], { input: JSON.stringify(input), cwd: ROOT, stdio: ['pipe', 'pipe', 'pipe'] });
        return 0;
      } catch (e) {
        return (e as { status: number }).status;
      }
    };
    expect(run({ tool_name: 'Bash', tool_input: { command: 'git push' } })).toBe(2);
    expect(run({ tool_name: 'Bash', tool_input: { command: 'npm test' } })).toBe(0);
  });
});
