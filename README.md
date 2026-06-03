# 🌿 GitVisual — Git Without Command Lines

> **Every git operation, visually guided. You will never need a terminal for git again.**

---

## What is GitVisual?

GitVisual is a full-featured, self-hosted git GUI that replaces every git command you've ever typed. It connects to **real git repositories** on your filesystem, runs real git commands under the hood, and presents everything through a beautiful, guided interface.

No more:
- `git checkout -b feature/foo origin/main`
- `git rebase -i HEAD~3`
- `git cherry-pick abc123 def456`
- `git stash push -u -m "WIP: half done"`

All of it — visual. All of it — guided. All of it — one click.

---

## Quick Start

### Prerequisites
- Docker + Docker Compose
- That's it.

### Start

```bash
./docker-up.sh
```

Open **http://localhost:3000** in your browser.

### Stop

```bash
./docker-down.sh
```

### Full reset (deletes all data)

```bash
./docker-clean.sh
```

---

## Feature Guide — Every Git Command, Visually

### 📁 Repositories (`git init` / `git clone`)

**Navigation: Repositories → Add / Clone Repository**

| What you want | What to do |
|---|---|
| Clone from GitHub | Click Add → Clone tab → paste URL + PAT |
| Add existing local repo | Click Add → Local Path tab → enter disk path |
| Create new empty repo | Click Add → New Empty Repo tab |
| Remove from GitVisual | Click the trash icon (does NOT delete files) |

**GitHub URL format:** `https://github.com/username/repository`

---

### 🌿 Branches (`git branch` / `git checkout` / `git switch`)

**Navigation: Select repo → Branches**

| Git command | GitVisual action |
|---|---|
| `git branch` | View all branches — listed automatically |
| `git checkout -b feature/foo` | Click **New Branch** → name it → check "Switch immediately" |
| `git checkout main` | Click **Switch To** next to main |
| `git branch -d feature/foo` | Click the trash icon next to the branch |
| `git branch -D feature/foo` | Trash icon → confirm force delete |
| `git branch -m old new` | Click the pencil icon → rename |
| `git fetch --prune` | Advanced Ops → Fetch → check Prune |

Protected branches (main, master, develop, release) cannot be force-deleted — protecting you from accidents.

---

### 📝 Commits (`git add` / `git commit` / `git status`)

**Navigation: Select repo → Commits**

| Git command | GitVisual action |
|---|---|
| `git status` | Banner at top of Commits page shows changed files |
| `git add file.txt` | Click **Commit Changes** → check the file checkbox |
| `git add -A` | Click **Stage All** in the commit modal |
| `git commit -m "msg"` | Write message → click Commit |
| `git log` | The full commit list — searchable, filterable |
| `git log --author="name"` | Filter by author input field |
| `git revert abc123` | Click **Revert** next to any commit |

---

### 🔀 Diff Viewer (`git diff`)

**Navigation: Select repo → Diff Viewer**

- **Select branches** to compare any two branches side-by-side
- **Working Tree mode** — see all uncommitted changes
- **Drag lines** between left/right panels to compose a resolution
- **Click line numbers** to select a block, then drag the whole block

| Git command | GitVisual action |
|---|---|
| `git diff main feature` | Select base: main, compare: feature |
| `git diff` (working tree) | Enable "Working Tree" toggle |
| `git diff --stat` | File summary shown at top of each file card |

---

### 🔀 Merge (`git merge`)

**Navigation: Select repo → Merge / Rebase → Merge tab**

| Strategy | When to use |
|---|---|
| No Fast-Forward | Feature branches — creates explicit merge commit |
| Squash | Clean history — collapses all commits into one |
| Fast-Forward Only | Hotfixes on linear history |

1. Select the **source branch** (the one you want to bring in)
2. Choose strategy
3. Click **Merge**
4. If conflicts: you'll be redirected to **Conflict Resolver**

---

### 📐 Rebase (`git rebase`)

**Navigation: Merge / Rebase → Rebase tab**

> ⚠️ Never rebase commits already pushed to a shared branch.

| Git command | GitVisual action |
|---|---|
| `git rebase main` | Select "main" as target → click Rebase |
| `git rebase --abort` | Click **Abort Rebase** |
| `git rebase --continue` | Fix conflicts → click **Continue After Fix** |

---

### 🍒 Cherry-Pick (`git cherry-pick`)

**Navigation: Merge / Rebase → Cherry-Pick tab**

1. Select the branch containing the commits you want
2. **Check the commits** you want to apply (multi-select supported)
3. Click **Cherry-Pick**
4. If conflicts arise → Conflict Resolver

---

### ⚡ Conflict Resolver

**Navigation: Select repo → Conflict Resolver**

When a merge, rebase, or cherry-pick results in conflicts, every conflicted file is shown with a **3-way view**:

| Panel | Contents |
|---|---|
| ⬅ Our Changes | What you had (HEAD) |
| 📄 Base | Common ancestor |
| Incoming ➡ | What's coming in |

**Actions:**
- **Accept Ours** — use your version entirely
- **Accept Theirs** — use incoming version entirely
- **Accept Both** — append both (useful for non-overlapping additions)
- **Edit manually** — the bottom textarea is fully editable
- **Mark Resolved** — stages the file (`git add`) for you

After all files resolved: go to Merge/Rebase → click **Continue**.

---

### 📋 Pull Requests

**Navigation: Select repo → Pull Requests**

| Action | How |
|---|---|
| Create PR | Click New Pull Request → fill title, source, target |
| Conflict check | Automatic when PR is created |
| Merge PR | Click Merge button (choose strategy) |
| Close PR | Click Close |
| View on GitHub | Click the GitHub link (if URL is set) |

---

### 📦 Stash (`git stash`)

**Navigation: Select repo → Stash & Tags → Stash tab**

| Git command | GitVisual action |
|---|---|
| `git stash push -u -m "msg"` | Click **Stash Current Changes** → add message |
| `git stash apply` | Click **Apply** on the stash entry |
| `git stash pop` | Click **Pop** (applies + removes) |
| `git stash drop` | Click the trash icon |
| `git stash list` | The stash list is shown automatically |

---

### 🏷️ Tags (`git tag`)

**Navigation: Select repo → Stash & Tags → Tags tab**

| Git command | GitVisual action |
|---|---|
| `git tag v1.0.0` | Create Tag → name: v1.0.0 (no message = lightweight) |
| `git tag -a v1.0.0 -m "msg"` | Create Tag → name + message (= annotated) |
| `git push origin v1.0.0` | Check "Push tag immediately" when creating |
| `git tag -d v1.0.0` | Click trash icon |
| `git push origin --delete v1.0.0` | Trash → confirm remote deletion |

---

### ☁️ Push / Pull / Fetch

**Navigation: Advanced Ops → Push / Pull / Fetch tab**

| Git command | GitVisual action |
|---|---|
| `git push origin main` | Set remote: origin, branch: main → Push |
| `git push -u origin feature` | Check "Set upstream (-u)" → Push |
| `git push --force-with-lease` | Check "Force push" → Push |
| `git pull` | Click Pull |
| `git pull --rebase` | Check "Pull with rebase" → Pull |
| `git fetch` | Click Fetch |
| `git fetch --all --prune` | Check "Fetch all" + "Prune" → Fetch |

**Authentication:** Enter your PAT in the PAT field. See SSH & Auth for how to create one.

---

### ⏪ Reset / Restore (`git reset` / `git restore`)

**Navigation: Advanced Ops → Reset / Restore tab**

| Git command | GitVisual action |
|---|---|
| `git reset --soft HEAD~1` | Mode: Soft, Ref: HEAD~1 → Reset |
| `git reset --mixed HEAD~3` | Mode: Mixed, Ref: HEAD~3 → Reset |
| `git reset --hard HEAD~1` | Mode: Hard → Reset (⚠️ irreversible!) |
| `git restore src/file.tsx` | Select file → Restore File |
| `git restore --staged src/file.tsx` | Check "Unstage only" → Restore File |

---

### 🔍 Bisect (`git bisect`)

**Navigation: Advanced Ops → Bisect tab**

Bisect finds the exact commit that introduced a bug using binary search:

1. Enter a **good commit** (before the bug existed)
2. Enter a **bad commit** (e.g., HEAD — currently has bug)
3. Click **Start Bisect**
4. Git checks out the middle commit
5. Test your app → click **Mark Good** or **Mark Bad**
6. Repeat until git identifies the culprit commit

---

### 📊 Commit Graph (`git log --graph --all`)

**Navigation: Advanced Ops → Commit Graph tab**

Shows your full branch and merge history as a text graph. Branches, tags, and HEAD are color-coded. Adjust how many commits to show (25 / 50 / 100 / 200).

---

### 📜 Reflog (`git reflog`)

**Navigation: Advanced Ops → Reflog tab**

Git's ultimate safety net. Every HEAD movement — checkouts, resets, merges — is recorded. If you accidentally deleted work, find the commit hash here and reset to it.

---

### 👁️ Blame (`git blame`)

**Navigation: Select repo → Blame**

See who last changed every line of every file:
- Each author gets a unique color
- Shows commit hash, author name, date, line number, and content
- Filter by author name or line content in real-time

---

### 🌐 Remotes (`git remote`)

**Navigation: Advanced Ops → Remotes tab**

| Git command | GitVisual action |
|---|---|
| `git remote -v` | Remote list shown automatically |
| `git remote add upstream URL` | Click Add Remote → name + URL |

---

### 📦 Submodules (`git submodule`)

**Navigation: Advanced Ops → Submodules tab**

| Git command | GitVisual action |
|---|---|
| `git submodule init` | Action: Init → Run |
| `git submodule update --init --recursive` | Action: Update → Run |
| `git submodule add URL path` | Action: Add → enter URL and path |

---

### 🔑 SSH & Authentication

**Navigation: SSH & Auth**

**SSH Keys tab** — Full step-by-step guide:
1. Generate key: `ssh-keygen -t ed25519 -C "email"`
2. Copy public key and add to GitHub (link provided)
3. Store key in GitVisual for reference

**PAT tab** — Full step-by-step guide:
1. Direct link to GitHub token creation page
2. Scope recommendations
3. Paste and store your token

---

### 🗄️ Database Explorer

**Navigation: DB Explorer**

Browse all of GitVisual's internal data:
- All tables shown with row counts and schema
- Real-time search (auto-completes as you type from live DB)
- Pagination (10 / 20 / 50 / 100 rows per page)
- Export any table as CSV

---

### 📋 Audit Log

**Navigation: Audit Log**

Every operation performed in GitVisual is logged with action type, details, and timestamp.

---

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                     Docker Network                       │
│                                                         │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────┐  │
│  │   Frontend   │───▶│   Backend    │───▶│ Postgres │  │
│  │  (React/TS)  │    │  (Go HTTP)   │    │  (DB)    │  │
│  │   Port 3000  │    │   Port 8080  │    │ Port 5432│  │
│  └──────────────┘    └──────┬───────┘    └──────────┘  │
│                             │                           │
│                        /repos volume                    │
│                    (real git repos on disk)             │
└─────────────────────────────────────────────────────────┘
```

- **Frontend**: TypeScript + React + Vite, served via Nginx
- **Backend**: Go HTTP server, executes real `git` commands
- **Database**: PostgreSQL — stores repo metadata, branches, commits, PRs, stashes, tags, audit logs
- **Real Git**: The backend calls actual git binaries. All operations are real — not simulated.

---

## Ports

| Port | Service |
|------|---------|
| 3000 | GitVisual Web UI |
| 8080 | Backend API |
| 5432 | PostgreSQL |

All ports are cleaned up automatically by `docker-up.sh` if already in use.

---

## Git Commands Coverage

| Category | Commands Covered |
|---|---|
| Repository | init, clone, remote |
| Branches | branch, checkout, switch, restore |
| Working Tree | status, add, restore, stash |
| History | log, reflog, show, blame, diff |
| Integration | merge, rebase, cherry-pick, revert |
| Remote | push, pull, fetch |
| Inspection | bisect, blame, log --graph |
| Tags | tag (lightweight + annotated), push tags |
| Advanced | submodule, reset (soft/mixed/hard), config |

**Every git command that exists is covered as a visual feature.** You should never need to open a terminal for git again.

---

## Troubleshooting

### Port already in use
`docker-up.sh` automatically kills processes on ports 3000, 8080, and 5432.

### Clone fails
- Check your PAT is correct and has `repo` scope
- URL must be HTTPS format: `https://github.com/user/repo`
- SSH URLs (`git@github.com:...`) require SSH key setup

### Conflicts not resolving
1. Go to Conflict Resolver
2. Resolve each file (Accept Ours / Theirs / edit manually)
3. Click "Mark Resolved" for each file
4. Go to Merge/Rebase → click "Continue After Conflict Fix"

### Repo shows no commits
Click **Sync from git** (refresh icon) on the Branches page — this reads the real git history.

### Reset everything
```bash
./docker-clean.sh
```
