# Git hook recipe

Verified 2026-11-06 with Lefthook 2.2.2 on macOS, against the mdeval CLI with `--check`.

**Decision:** the README's pre-commit recipe runs `npx mdeval --check "**/*.md"` on every commit that stages files, with no `glob`. mdeval itself writes and stages nothing, but Markdown scripts still run with full access and can change files. When it fails, the user runs `npx mdeval "**/*.md"`, reviews and stages the updates, and commits again. CI runs the same `--check` on the committed files as the authoritative check.

## Why the hook only checks

A hook runs mdeval on the working tree, but Git commits the index. A hook can catch stale values early; it cannot prove that the index is current. Any recipe that rewrites files inside the hook also hands those files to Lefthook's staging and rollback machinery.

| Recipe | Dependent file not staged | Script prints `--all` | Partially staged file plus an unstaged edit in a dependent file | Only `package.json` staged |
| --- | --- | --- | --- | --- |
| `files=$(npx mdeval ...)` then `git add $files` (removed) | Staged | Runs `git add --all` | Stages unstaged hunks | Job runs |
| `stage_fixed: true` (rejected) | Stale value committed | Safe | Safe | Skipped by `glob` |
| `fail_on_changes: always` with a rewriting job (rejected) | Commit stops | Safe | **Unstaged edit in the dependent file is lost** | Skipped by `glob` |
| `--check`, no `glob` (chosen) | Commit stops | Safe | Commit stops; mdeval writes and stages nothing | Commit stops |

- **Default `stage_fixed` misses unstaged dependents.** It re-stages the staged files filtered by `glob`. A `files` command or `{all_files}` can list dependents, but can also stage unrelated tracked edits ([`job.go` at v2.2.2](https://github.com/evilmartians/lefthook/blob/v2.2.2/internal/run/controller/job.go#L154-L178)).
- **Rewriting under `fail_on_changes` can lose work.** With a partially staged file, Lefthook hides unstaged hunks, and on a `fail_on_changes` failure it force-checks-out every file the hook changed before restoring only the hidden hunks ([`guard.go` at v2.2.2](https://github.com/evilmartians/lefthook/blob/v2.2.2/internal/run/controller/guard.go#L90-L150)). An unstaged edit in a dependent file that mdeval rewrote is discarded. Its changeset also records an untracked directory as a constant, and Lefthook before 1.13.0 silently ignores the option.
- **A Markdown-only `glob` misses inputs.** The quick start reads `package.json`; staging only that file skipped the job, so the README version stayed stale.
- **Limit of any working-tree check:** if the dependent file is already current in the working tree but not staged, the check passes and the commit contains the old version. CI's check of the committed files covers this.
- **Partially staged files:** Lefthook hides their unstaged hunks during the job, so the hook checks their staged versions. If the check fails because of such a file, stage it fully or stash the unstaged hunks before running mdeval and committing again.
- **Prior art:** `prettier --check` in pre-commit hooks follows the same check-then-fix flow.

## Reproduce

Build the checkout under test and pack it into a new scratch directory. Replace `/path/to/mdeval` with the checkout path:

```sh
scratch=$(mktemp -d)
cd /path/to/mdeval
pnpm build
npm pack --ignore-scripts --pack-destination "$scratch"
cd "$scratch"
git init
npm init -y
LEFTHOOK=0 npm install ./mdeval-*.tgz lefthook@2.2.2
```

The tarball contains the checkout's built CLI, not the published registry version. In the scratch repository, create the hook and test files:

```sh
cat > lefthook.yml <<'EOF'
pre-commit:
  jobs:
    - name: mdeval
      run: npx mdeval --check "**/*.md"
EOF
cat > CONTACTS.md <<'EOF'
# Contacts

<!--mdeval
export const value = 'old';
-->

<!--mdeval value-->old<!--/mdeval-->
EOF
cat > TIMELINE.md <<'EOF'
# Timeline

<!--mdeval
import { value } from './CONTACTS.md';
-->

<!--mdeval value-->old<!--/mdeval-->
EOF
cat > README.md <<'EOF'
# Version

<!--mdeval
import { readFileSync } from 'node:fs';
const version = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')).version;
-->

<!--mdeval version-->1.0.0<!--/mdeval-->
EOF
printf 'node_modules/\n*.tgz\n' > .gitignore
npx lefthook install
git add .gitignore lefthook.yml package.json package-lock.json CONTACTS.md TIMELINE.md README.md
git -c user.name=Test -c user.email=test@example.invalid commit -m baseline
```

Check the dependent and partially staged file case:

```sh
python3 -c "from pathlib import Path; p = Path('CONTACTS.md'); p.write_text(p.read_text().replace(\"value = 'old'\", \"value = 'new'\"))"
git add CONTACTS.md
printf '\nUnstaged contact edit.\n' >> CONTACTS.md
printf '\nUnstaged timeline edit.\n' >> TIMELINE.md
git -c user.name=Test -c user.email=test@example.invalid commit -m test
```

The commit stops and both unstaged lines remain. Stage `CONTACTS.md` fully or stash its unstaged hunk, then run `npx mdeval "**/*.md"`, review and stage the updates, and commit again. To test a non-Markdown input after that commit, run `npm pkg set version=1.0.1`, stage only `package.json`, and commit; the hook stops and reports `README.md`.

## Re-evaluate when

- Lefthook can run a job against the index content instead of the working tree.
- mdeval can check the index directly, which would close the working-tree gap without CI.
