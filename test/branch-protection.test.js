import { describe, it, expect } from 'vitest';
import { parseRemote, buildPayload, discoverChecks, runProtectBranch, protectionHint } from '../lib/branch-protection.js';
import { makeIo } from './helpers.js';

/** Mock process runner: `script` maps "cmd arg arg" prefixes to results; every call is recorded. */
function mockRun(script = {}) {
  const calls = [];
  const run = async (cmd, args, opts = {}) => {
    calls.push({ cmd, args, input: opts.input });
    const key = Object.keys(script).find((k) => `${cmd} ${args.join(' ')}`.startsWith(k));
    const r = key ? script[key] : { code: 1, stdout: '', stderr: 'unexpected' };
    return { code: 0, stdout: '', stderr: '', ...r };
  };
  run.calls = calls;
  return run;
}
const REMOTE = { 'git remote get-url origin': { stdout: 'git@github.com:acme/shop.git\n' } };
const GH_OK = { 'gh --version': {}, 'gh auth status': {} };

describe('parseRemote', () => {
  it.each([
    ['https://github.com/acme/shop.git', 'acme', 'shop'],
    ['https://github.com/acme/shop', 'acme', 'shop'],
    ['https://user:tok@github.com/acme/shop.git', 'acme', 'shop'],
    ['git@github.com:acme/shop.git', 'acme', 'shop'],
    ['ssh://git@github.com/acme/shop.git', 'acme', 'shop'],
    ['git@github.com:acme/my.repo.git', 'acme', 'my.repo'],
  ])('%s', (url, owner, repo) => expect(parseRemote(url)).toEqual({ owner, repo }));

  it('rejects non-GitHub and malformed remotes', () => {
    expect(parseRemote('git@gitlab.com:acme/shop.git')).toBeNull();
    expect(parseRemote('')).toBeNull();
    expect(parseRemote('/local/path')).toBeNull();
  });
});

describe('buildPayload', () => {
  it('requires strict status checks, a pull request, no force push or deletion', () => {
    expect(buildPayload({ checks: ['ci'], approvals: 0, includeAdmins: false })).toEqual({
      required_status_checks: { strict: true, contexts: ['ci'] },
      enforce_admins: false,
      required_pull_request_reviews: { required_approving_review_count: 0, dismiss_stale_reviews: true },
      restrictions: null,
      allow_force_pushes: false,
      allow_deletions: false,
    });
  });
  it('--include-admins enforces for admins; no checks means null', () => {
    const p = buildPayload({ checks: [], approvals: 2, includeAdmins: true });
    expect(p.enforce_admins).toBe(true);
    expect(p.required_status_checks).toBeNull();
    expect(p.required_pull_request_reviews.required_approving_review_count).toBe(2);
  });
});

describe('discoverChecks', () => {
  it('reads check-run names of the latest commit, deduplicated', async () => {
    const run = mockRun({ 'gh api repos/acme/shop/commits/main/check-runs': { stdout: 'ci / validate\nsecurity\nci / validate\n' } });
    expect(await discoverChecks(run, { owner: 'acme', repo: 'shop' }, 'main')).toEqual(['ci / validate', 'security']);
  });
  it('returns [] when gh fails', async () => {
    expect(await discoverChecks(mockRun({ 'gh api': { code: 1 } }), { owner: 'a', repo: 'b' }, 'main')).toEqual([]);
  });
});

describe('runProtectBranch dry run', () => {
  it('prints the exact payload, the endpoint and the click path, and calls no PUT', async () => {
    const run = mockRun({ ...REMOTE, ...GH_OK, 'gh api repos/acme/shop/commits/main/check-runs': { stdout: 'ci\n' } });
    const io = makeIo('/x', {});
    expect(await runProtectBranch([], io, { run })).toBe(0);
    expect(io.out).toContain('Dry run');
    expect(io.out).toContain('PUT repos/acme/shop/branches/main/protection');
    expect(io.out).toContain(JSON.stringify(buildPayload({ checks: ['ci'], approvals: 0, includeAdmins: false }), null, 2));
    expect(io.out).toMatch(/Settings .* Branches/);
    expect(io.out).toMatch(/--apply/);
    expect(run.calls.some((c) => c.args.includes('PUT'))).toBe(false);
  });

  it('works without gh (no discovery) and says the checks must be given', async () => {
    const run = mockRun({ ...REMOTE, 'gh --version': { code: 127 } });
    const io = makeIo('/x', {});
    expect(await runProtectBranch([], io, { run })).toBe(0);
    expect(io.out).toMatch(/--checks/);
    expect(io.out).toContain('"required_status_checks": null');
  });

  it('flags override defaults', async () => {
    const run = mockRun({ ...REMOTE, 'gh --version': { code: 127 } });
    const io = makeIo('/x', {});
    await runProtectBranch(['--branch', 'develop', '--checks', 'a,b', '--approvals', '1', '--include-admins'], io, { run });
    expect(io.out).toContain('branches/develop/protection');
    expect(io.out).toContain('"contexts": [\n      "a",\n      "b"\n    ]');
    expect(io.out).toContain('"required_approving_review_count": 1');
    expect(io.out).toContain('"enforce_admins": true');
  });

  it('rejects bad flag values and a missing remote', async () => {
    const io = makeIo('/x', {});
    expect(await runProtectBranch(['--approvals', 'x'], io, { run: mockRun(REMOTE) })).toBe(2);
    const io2 = makeIo('/x', {});
    expect(await runProtectBranch([], io2, { run: mockRun({ 'git remote get-url origin': { code: 1 } }) })).toBe(2);
    expect(io2.err).toMatch(/GitHub remote/);
  });
});

describe('runProtectBranch --apply', () => {
  it('calls gh api -X PUT with the payload on stdin', async () => {
    const run = mockRun({ ...REMOTE, ...GH_OK, 'gh api -X PUT': {} });
    const io = makeIo('/x', {});
    expect(await runProtectBranch(['--apply', '--checks', 'ci'], io, { run })).toBe(0);
    const put = run.calls.find((c) => c.args.includes('-X'));
    expect(put.cmd).toBe('gh');
    expect(put.args).toEqual(['api', '-X', 'PUT', 'repos/acme/shop/branches/main/protection', '--input', '-']);
    expect(JSON.parse(put.input)).toEqual(buildPayload({ checks: ['ci'], approvals: 0, includeAdmins: false }));
    expect(io.out).toMatch(/Applied/);
  });

  it('fails clearly when gh is missing', async () => {
    const io = makeIo('/x', {});
    const run = mockRun({ ...REMOTE, 'gh --version': { code: 127 } });
    expect(await runProtectBranch(['--apply'], io, { run })).toBe(2);
    expect(io.err).toMatch(/GitHub CLI.*not installed/);
    expect(run.calls.some((c) => c.args.includes('-X'))).toBe(false);
  });

  it('fails clearly when gh is not authenticated', async () => {
    const io = makeIo('/x', {});
    const run = mockRun({ ...REMOTE, 'gh --version': {}, 'gh auth status': { code: 1 } });
    expect(await runProtectBranch(['--apply'], io, { run })).toBe(2);
    expect(io.err).toMatch(/gh auth login/);
  });

  it('explains the limits when GitHub refuses', async () => {
    const io = makeIo('/x', {});
    const run = mockRun({ ...REMOTE, ...GH_OK, 'gh api -X PUT': { code: 1, stderr: 'HTTP 403: Upgrade to GitHub Pro' } });
    expect(await runProtectBranch(['--apply', '--checks', 'ci'], io, { run })).toBe(1);
    expect(io.err).toContain('HTTP 403');
    expect(io.err).toMatch(/admin rights/i);
    expect(io.err).toMatch(/paid/i);
  });
});

describe('protectionHint (doctor)', () => {
  const api = (r) => ({ ...REMOTE, ...GH_OK, 'gh api repos/acme/shop --jq': { stdout: 'main\n' }, 'gh api repos/acme/shop/branches/main/protection': r });
  const protectedJson = (o) => ({ stdout: JSON.stringify(o) });

  it('is silent in CI and without a GitHub remote, and never calls gh then', async () => {
    const run = mockRun(api({ code: 1, stderr: 'HTTP 404' }));
    expect(await protectionHint({ run, ci: true })).toBeNull();
    expect(run.calls).toEqual([]);
    expect(await protectionHint({ run: mockRun({ 'git remote get-url origin': { code: 1 } }), ci: false })).toBeNull();
    expect(await protectionHint({ run: mockRun({ 'git remote get-url origin': { stdout: 'git@gitlab.com:a/b.git' } }), ci: false })).toBeNull();
  });

  it('gives the manual instruction when gh is unavailable', async () => {
    const h = await protectionHint({ run: mockRun({ ...REMOTE, 'gh --version': { code: 127 } }), ci: false });
    expect(h.id).toBe('branch-protection');
    expect(h.message).toMatch(/protect-branch/);
    expect(h.message).toMatch(/Settings/);
  });

  it('hints when the default branch has no protection (404)', async () => {
    const h = await protectionHint({ run: mockRun(api({ code: 1, stderr: 'Branch not protected (HTTP 404)' })), ci: false });
    expect(h.message).toMatch(/not protected/);
  });

  it('hints when no pull request or no status checks are required', async () => {
    const noPr = await protectionHint({ run: mockRun(api(protectedJson({ required_status_checks: { contexts: ['ci'] } }))), ci: false });
    expect(noPr.message).toMatch(/pull request/);
    const noChecks = await protectionHint({ run: mockRun(api(protectedJson({ required_pull_request_reviews: {}, required_status_checks: { contexts: [], checks: [] } }))), ci: false });
    expect(noChecks.message).toMatch(/status check/);
  });

  it('is silent when PRs and checks are required', async () => {
    const ok = protectedJson({ required_pull_request_reviews: {}, required_status_checks: { contexts: ['ci'] } });
    expect(await protectionHint({ run: mockRun(api(ok)), ci: false })).toBeNull();
  });

  it('stays silent when the query fails for another reason (no admin rights)', async () => {
    expect(await protectionHint({ run: mockRun(api({ code: 1, stderr: 'HTTP 403' })), ci: false })).toBeNull();
  });
});
