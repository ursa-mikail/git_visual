package git

import (
	"bufio"
	"bytes"
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/gitvisual/backend/internal/models"
)

// RunGit executes a git command in the given directory and returns stdout, stderr, error
func RunGit(dir string, args ...string) (string, string, error) {
	cmd := exec.Command("git", args...)
	cmd.Dir = dir
	// When running against a mounted home directory, git needs explicit dir pointers
	// otherwise it fails with "not a git repository" on some filesystem configurations.
	if strings.HasPrefix(dir, "/host-home/") {
		cmd.Env = append(os.Environ(),
			"GIT_DIR="+filepath.Join(dir, ".git"),
			"GIT_WORK_TREE="+dir,
		)
	}
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	err := cmd.Run()
	return strings.TrimSpace(stdout.String()), strings.TrimSpace(stderr.String()), err
}

// RunGitEnv executes git with extra env vars (e.g., for PAT auth)
func RunGitEnv(dir string, env []string, args ...string) (string, string, error) {
	cmd := exec.Command("git", args...)
	cmd.Dir = dir
	base := append(os.Environ(), env...)
	if strings.HasPrefix(dir, "/host-home/") {
		base = append(base,
			"GIT_DIR="+filepath.Join(dir, ".git"),
			"GIT_WORK_TREE="+dir,
		)
	}
	cmd.Env = base
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	err := cmd.Run()
	return strings.TrimSpace(stdout.String()), strings.TrimSpace(stderr.String()), err
}

// ActiveSSHKey is the private key file name (e.g. "id_rsa") selected by the user.
// Set by the handler layer when the user picks a key in the UI.
var ActiveSSHKey string

// sshEnv returns a GIT_SSH_COMMAND env entry using the active key (if set).
func sshEnv() string {
	base := "ssh -o StrictHostKeyChecking=accept-new -o UserKnownHostsFile=/tmp/known_hosts -o BatchMode=yes"
	if ActiveSSHKey != "" {
		base += " -i /root/.ssh/" + ActiveSSHKey
	}
	return "GIT_SSH_COMMAND=" + base
}

// SSHEnvVar is the exported form of sshEnv for use in other packages.
func SSHEnvVar() string { return sshEnv() }

// RunGitSSH executes git using the currently selected SSH key.
func RunGitSSH(dir string, args ...string) (string, string, error) {
	return RunGitEnv(dir, []string{sshEnv()}, args...)
}

// RunGitCtx executes git with a context (for timeout/cancellation).
func RunGitCtx(ctx context.Context, dir string, args ...string) (string, string, error) {
	cmd := exec.CommandContext(ctx, "git", args...)
	cmd.Dir = dir
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	err := cmd.Run()
	return strings.TrimSpace(stdout.String()), strings.TrimSpace(stderr.String()), err
}

// RunGitSSHCtx executes git with SSH env and a context.
func RunGitSSHCtx(ctx context.Context, dir string, args ...string) (string, string, error) {
	cmd := exec.CommandContext(ctx, "git", args...)
	cmd.Dir = dir
	cmd.Env = append(os.Environ(), sshEnv())
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	err := cmd.Run()
	return strings.TrimSpace(stdout.String()), strings.TrimSpace(stderr.String()), err
}

// RegisterExisting validates that a path is already a git repository on disk.
// It does NOT create or clone anything — the repo must already exist.
func RegisterExisting(path string) error {
	info, err := os.Stat(path)
	if err != nil {
		return fmt.Errorf("path does not exist: %s", path)
	}
	if !info.IsDir() {
		return fmt.Errorf("path is not a directory: %s", path)
	}
	// Accept both a bare repo and a normal .git repo
	gitDir := filepath.Join(path, ".git")
	if _, err := os.Stat(gitDir); err != nil {
		// Try bare repo (HEAD file in root)
		if _, err2 := os.Stat(filepath.Join(path, "HEAD")); err2 != nil {
			return fmt.Errorf("not a git repository (no .git folder found): %s", path)
		}
	}
	return nil
}

// InitRepo initializes a git repo or clones from URL.
// Clone operations get a 5-minute context timeout so they never block forever.
func InitRepo(path string, remoteURL string, pat string) error {
	if err := os.MkdirAll(path, 0755); err != nil {
		return err
	}

	if remoteURL != "" {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
		defer cancel()

		// SSH URLs (git@ or ssh://) use the active key; HTTPS uses PAT
		isSSH := strings.HasPrefix(remoteURL, "git@") || strings.HasPrefix(remoteURL, "ssh://")
		if isSSH {
			_, errStr, err := RunGitSSHCtx(ctx, filepath.Dir(path), "clone", remoteURL, filepath.Base(path))
			if err != nil {
				if ctx.Err() != nil {
					return fmt.Errorf("clone timed out after 5 minutes")
				}
				return fmt.Errorf("clone failed: %s", errStr)
			}
		} else {
			authURL := addPATToURL(remoteURL, pat)
			_, errStr, err := RunGitCtx(ctx, filepath.Dir(path), "clone", authURL, filepath.Base(path))
			if err != nil {
				if ctx.Err() != nil {
					return fmt.Errorf("clone timed out after 5 minutes")
				}
				return fmt.Errorf("clone failed: %s", errStr)
			}
		}
		return nil
	}

	_, _, err := RunGit(path, "init")
	return err
}

func addPATToURL(rawURL, pat string) string {
	if pat == "" {
		return rawURL
	}
	for _, prefix := range []string{"https://github.com/", "https://gitlab.com/"} {
		if strings.HasPrefix(rawURL, prefix) {
			return strings.Replace(rawURL, "https://", "https://"+pat+"@", 1)
		}
	}
	return rawURL
}

// GetBranches returns all local and remote branches
func GetBranches(dir string) ([]BranchInfo, error) {
	out, _, err := RunGit(dir, "-c", "core.hooksPath=/dev/null", "--no-optional-locks", "branch", "-a", "--format=%(refname:short)|%(upstream:short)|%(objectname:short)|%(subject)|%(authorname)|%(authordate:iso)")
	if err != nil {
		return nil, err
	}
	var branches []BranchInfo
	for _, line := range strings.Split(out, "\n") {
		if line == "" {
			continue
		}
		parts := strings.SplitN(line, "|", 6)
		name := parts[0]
		if strings.HasPrefix(name, "HEAD") {
			continue
		}
		b := BranchInfo{Name: name}
		if len(parts) > 1 {
			b.Upstream = parts[1]
		}
		if len(parts) > 2 {
			b.LastHash = parts[2]
		}
		if len(parts) > 3 {
			b.LastMessage = parts[3]
		}
		if len(parts) > 4 {
			b.LastAuthor = parts[4]
		}
		if len(parts) > 5 {
			b.LastDate = parts[5]
		}
		b.IsRemote = strings.HasPrefix(name, "remotes/") || strings.HasPrefix(name, "origin/")
		branches = append(branches, b)
	}
	return branches, nil
}

type BranchInfo struct {
	Name        string
	Upstream    string
	LastHash    string
	LastMessage string
	LastAuthor  string
	LastDate    string
	IsRemote    bool
}

// GetCommits returns commits for a branch with full info


// DiscoverRepos walks a root directory (up to maxDepth levels) and returns
// every git repository found — useful for auto-importing local repos.
func DiscoverRepos(root string, maxDepth int) ([]DiscoveredRepo, error) {
	var results []DiscoveredRepo
	var walk func(dir string, depth int)
	walk = func(dir string, depth int) {
		if depth > maxDepth {
			return
		}
		gitDir := filepath.Join(dir, ".git")
		if _, err := os.Stat(gitDir); err == nil {
			// Found a git repo — collect metadata
			remote, _, _ := RunGit(dir, "--no-optional-locks", "config", "remote.origin.url")
			branch, _, _ := RunGit(dir, "--no-optional-locks", "rev-parse", "--abbrev-ref", "HEAD")
			if branch == "HEAD" || branch == "" {
				branch = "main"
			}
			results = append(results, DiscoveredRepo{
				Name:      filepath.Base(dir),
				Path:      dir,
				RemoteURL: strings.TrimSpace(remote),
				Branch:    strings.TrimSpace(branch),
			})
			return // don't recurse into nested git repos
		}
		entries, err := os.ReadDir(dir)
		if err != nil {
			return
		}
		for _, e := range entries {
			if !e.IsDir() || strings.HasPrefix(e.Name(), ".") || e.Name() == "node_modules" || e.Name() == "vendor" {
				continue
			}
			walk(filepath.Join(dir, e.Name()), depth+1)
		}
	}
	walk(root, 0)
	if results == nil {
		results = []DiscoveredRepo{}
	}
	return results, nil
}

type DiscoveredRepo struct {
	Name      string `json:"name"`
	Path      string `json:"path"`
	RemoteURL string `json:"remote_url"`
	Branch    string `json:"branch"`
}

// RefInfo describes a single ref entry returned to the diff picker.
type RefInfo struct {
	Label string `json:"label"`
	Ref   string `json:"ref"`
	Kind  string `json:"kind"` // "branch", "tag", "commit"
}

// GetRefs returns all local branches, remote-tracking branches, tags, and
// recent commits so the diff picker can compare any two refs.
func GetRefs(dir string) ([]RefInfo, error) {
	var refs []RefInfo
	seen := map[string]bool{}

	// Branches (local + remote)
	out, _, err := RunGit(dir, "--no-optional-locks", "branch", "-a", "--format=%(refname:short)")
	if err == nil {
		for _, line := range strings.Split(strings.TrimSpace(out), "\n") {
			line = strings.TrimSpace(line)
			if line == "" || strings.Contains(line, " -> ") || line == "HEAD" {
				continue
			}
			if !seen[line] {
				seen[line] = true
				refs = append(refs, RefInfo{Label: line, Ref: line, Kind: "branch"})
			}
		}
	}

	// Tags
	tagOut, _, _ := RunGit(dir, "tag")
	for _, t := range strings.Split(strings.TrimSpace(tagOut), "\n") {
		t = strings.TrimSpace(t)
		if t != "" && !seen[t] {
			seen[t] = true
			refs = append(refs, RefInfo{Label: t, Ref: t, Kind: "tag"})
		}
	}

	// Recent commits (short hash + message, up to 50)
	logOut, _, _ := RunGit(dir, "--no-optional-locks", "log", "--all", "--format=%h|%s|%ai", "-50")
	for _, line := range strings.Split(strings.TrimSpace(logOut), "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		parts := strings.SplitN(line, "|", 3)
		if len(parts) < 2 {
			continue
		}
		hash := parts[0]
		msg := parts[1]
		date := ""
		if len(parts) == 3 {
			// just keep YYYY-MM-DD
			if len(parts[2]) >= 10 {
				date = " · " + parts[2][:10]
			}
		}
		label := hash + "  " + msg + date
		if len(label) > 80 {
			label = label[:80] + "…"
		}
		if !seen[hash] {
			seen[hash] = true
			refs = append(refs, RefInfo{Label: label, Ref: hash, Kind: "commit"})
		}
	}

	if refs == nil {
		refs = []RefInfo{}
	}
	return refs, nil
}

func GetCommits(dir, branch string, limit, offset int) ([]CommitInfo, error) {
	args := []string{"--no-optional-locks", "log", "--format=%H|%h|%s|%an|%ae|%ai|%P", "--no-walk=unsorted"}
	// Use all branches if none specified
	if branch != "" {
		args = append(args, branch)
	} else {
		args = append(args, "--all")
	}
	args = append(args, fmt.Sprintf("-%d", limit+offset))

	out, _, err := RunGit(dir, args...)
	if err != nil {
		return nil, err
	}

	var commits []CommitInfo
	for _, line := range strings.Split(out, "\n") {
		line = strings.TrimSpace(line)
		if line == "" || strings.Count(line, "|") < 5 {
			continue
		}
		parts := strings.SplitN(line, "|", 7)
		t, _ := time.Parse("2006-01-02 15:04:05 -0700", parts[5])
		c := CommitInfo{
			Hash:        parts[0],
			ShortHash:   parts[1],
			Message:     parts[2],
			AuthorName:  parts[3],
			AuthorEmail: parts[4],
			CommittedAt: t,
		}
		if len(parts) > 6 {
			c.ParentHash = parts[6]
		}
		commits = append(commits, c)
	}

	if offset >= len(commits) {
		return []CommitInfo{}, nil
	}
	end := offset + limit
	if end > len(commits) {
		end = len(commits)
	}
	return commits[offset:end], nil
}

func parseStatLine(line string, c *CommitInfo) {
	parts := strings.Fields(line)
	for i, p := range parts {
		n, _ := strconv.Atoi(p)
		if i+1 < len(parts) {
			switch {
			case strings.Contains(parts[i+1], "changed"):
				c.FilesChanged = n
			case strings.Contains(parts[i+1], "insertion"):
				c.Insertions = n
			case strings.Contains(parts[i+1], "deletion"):
				c.Deletions = n
			}
		}
	}
}

type CommitInfo struct {
	Hash        string
	ShortHash   string
	Message     string
	AuthorName  string
	AuthorEmail string
	ParentHash  string
	CommittedAt time.Time
	FilesChanged int
	Insertions   int
	Deletions    int
}

// isCommitHash returns true when s looks like a short or full git commit hash
// (7–40 hex characters, no slashes).
func isCommitHash(s string) bool {
	if len(s) < 7 || len(s) > 40 || strings.ContainsAny(s, "/ ") {
		return false
	}
	for _, c := range s {
		if !((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f') || (c >= 'A' && c <= 'F')) {
			return false
		}
	}
	return true
}

// GetDiff returns a parsed diff between base and compare refs.
// Handles branches, remote-tracking refs, tags, and commit hashes.
// Strategy:
//   - commit vs commit  → git diff <base> <compare>  (diff-index style)
//   - branch vs branch  → git diff <base>...<compare> (three-dot: base from merge-base,
//     so diverged branches show their real differences)
//   - single ref        → git diff <ref>^..<ref>       (what that ref introduced vs its parent)
func GetDiff(dir, base, compare string) ([]models.DiffFile, error) {
	var args []string

	switch {
	case base != "" && compare != "":
		// Three-dot diff works for any pair of refs including commits.
		// It shows changes reachable from compare but not from the merge-base,
		// which is almost always what users want when comparing two branches.
		// For two commit hashes it degrades gracefully to a plain diff.
		args = []string{"--no-optional-locks", "diff", "--unified=5", base + "..." + compare}
	case base != "":
		// Show what 'base' introduced: diff against its first parent.
		if isCommitHash(base) {
			args = []string{"--no-optional-locks", "diff", "--unified=5", base + "^", base}
		} else {
			args = []string{"--no-optional-locks", "diff", "--unified=5", base + "^..HEAD"}
		}
	case compare != "":
		if isCommitHash(compare) {
			args = []string{"--no-optional-locks", "diff", "--unified=5", compare + "^", compare}
		} else {
			args = []string{"--no-optional-locks", "diff", "--unified=5", compare + "^..HEAD"}
		}
	default:
		args = []string{"--no-optional-locks", "diff", "--unified=5", "HEAD"}
	}

	out, errStr, err := RunGit(dir, args...)
	if err != nil && out == "" {
		if errStr != "" {
			return nil, fmt.Errorf("%s", errStr)
		}
		return nil, err
	}

	return parseDiff(out), nil
}

// GetWorkingDiff returns uncommitted changes
func GetWorkingDiff(dir string) ([]models.DiffFile, error) {
	out, _, _ := RunGit(dir, "--no-optional-locks", "diff", "--unified=5")
	staged, _, _ := RunGit(dir, "--no-optional-locks", "diff", "--cached", "--unified=5")
	return parseDiff(out + "\n" + staged), nil
}

// ParseDiffPublic exposes parseDiff for use by handlers that run git diff directly.
func ParseDiffPublic(raw string) []models.DiffFile {
	return parseDiff(raw)
}

func parseDiff(raw string) []models.DiffFile {
	var files []models.DiffFile
	var cur *models.DiffFile
	var oldLine, newLine int

	// Use a large-buffer scanner so minified/generated files don't silently truncate.
	scanner := bufio.NewScanner(strings.NewReader(raw))
	scanner.Buffer(make([]byte, 1024*1024), 4*1024*1024)
	for scanner.Scan() {
		line := scanner.Text()

		if strings.HasPrefix(line, "diff --git") {
			if cur != nil {
				files = append(files, *cur)
			}
			cur = &models.DiffFile{}
			parts := strings.Fields(line)
			if len(parts) >= 4 {
				cur.Path = strings.TrimPrefix(parts[3], "b/")
				cur.OldPath = strings.TrimPrefix(parts[2], "a/")
			}
			continue
		}
		if cur == nil {
			continue
		}
		if strings.HasPrefix(line, "Binary files") {
			cur.IsBinary = true
			continue
		}
		if strings.HasPrefix(line, "--- ") || strings.HasPrefix(line, "+++ ") {
			continue
		}
		if strings.HasPrefix(line, "@@") {
			// Parse hunk header: @@ -oldStart,oldCount +newStart,newCount @@
			var oldStart, newStart int
			fmt.Sscanf(line, "@@ -%d", &oldStart)
			// find the +
			if idx := strings.Index(line, "+"); idx >= 0 {
				fmt.Sscanf(line[idx:], "+%d", &newStart)
			}
			oldLine = oldStart
			newLine = newStart
			cur.Lines = append(cur.Lines, models.DiffLine{
				Content: line,
				Type:    "header",
			})
			continue
		}
		switch {
		case strings.HasPrefix(line, "+"):
			cur.Additions++
			l := newLine
			cur.Lines = append(cur.Lines, models.DiffLine{
				Content:    line[1:],
				Type:       "added",
				LineNumNew: &l,
			})
			newLine++
		case strings.HasPrefix(line, "-"):
			cur.Deletions++
			l := oldLine
			cur.Lines = append(cur.Lines, models.DiffLine{
				Content:    line[1:],
				Type:       "removed",
				LineNumOld: &l,
			})
			oldLine++
		default:
			lo := oldLine
			ln := newLine
			cur.Lines = append(cur.Lines, models.DiffLine{
				Content:    line,
				Type:       "context",
				LineNumOld: &lo,
				LineNumNew: &ln,
			})
			oldLine++
			newLine++
		}
	}
	if cur != nil {
		files = append(files, *cur)
	}
	return files
}

// Merge merges sourceBranch into targetBranch
func Merge(dir, sourceBranch, strategy string) (string, bool, error) {
	args := []string{"merge"}
	switch strategy {
	case "squash":
		args = append(args, "--squash")
	case "no-ff":
		args = append(args, "--no-ff")
	case "ff-only":
		args = append(args, "--ff-only")
	default:
		args = append(args, "--no-ff")
	}
	args = append(args, sourceBranch)

	out, errStr, err := RunGit(dir, args...)
	if err != nil {
		combined := out + "\n" + errStr
		hasConflicts := strings.Contains(combined, "CONFLICT") || strings.Contains(combined, "conflict")
		return combined, hasConflicts, err
	}
	return out, false, nil
}

// GetConflicts returns conflicting files and their content
func GetConflicts(dir string) ([]models.ConflictFile, error) {
	out, _, _ := RunGit(dir, "diff", "--name-only", "--diff-filter=U")
	var conflicts []models.ConflictFile
	for _, path := range strings.Split(strings.TrimSpace(out), "\n") {
		if path == "" {
			continue
		}
		content, err := os.ReadFile(filepath.Join(dir, path))
		if err != nil {
			continue
		}
		cf := parseConflictFile(path, string(content))
		conflicts = append(conflicts, cf)
	}
	return conflicts, nil
}

func parseConflictFile(path, content string) models.ConflictFile {
	cf := models.ConflictFile{Path: path, Status: "conflict"}
	lines := strings.Split(content, "\n")
	var section int // 0=base 1=ours 2=theirs
	for _, line := range lines {
		switch {
		case strings.HasPrefix(line, "<<<<<<< "):
			section = 1
		case line == "=======":
			section = 2
		case strings.HasPrefix(line, ">>>>>>> "):
			section = 0
		default:
			switch section {
			case 1:
				cf.OurLines = append(cf.OurLines, line)
			case 2:
				cf.TheirLines = append(cf.TheirLines, line)
			default:
				cf.BaseLines = append(cf.BaseLines, line)
			}
		}
	}
	return cf
}

// CherryPick picks one or more commits
func CherryPick(dir string, hashes []string) (string, bool, error) {
	args := append([]string{"cherry-pick"}, hashes...)
	out, errStr, err := RunGit(dir, args...)
	if err != nil {
		hasConflicts := strings.Contains(out+errStr, "CONFLICT")
		return out + "\n" + errStr, hasConflicts, err
	}
	return out, false, nil
}

// Rebase rebases current branch onto target
func Rebase(dir, onto string, interactive bool) (string, error) {
	args := []string{"rebase"}
	if interactive {
		// Can't do truly interactive in headless mode; use --onto
		args = append(args, "--onto", onto)
	} else {
		args = append(args, onto)
	}
	out, errStr, err := RunGit(dir, args...)
	if err != nil {
		return out + "\n" + errStr, err
	}
	return out, nil
}

// GetBlame returns blame info for a file
func GetBlame(dir, filePath, ref string) ([]BlameInfo, error) {
	args := []string{"blame", "--line-porcelain"}
	if ref != "" {
		args = append(args, ref)
	}
	args = append(args, "--", filePath)
	out, _, err := RunGit(dir, args...)
	if err != nil {
		return nil, err
	}
	return parseBlame(out), nil
}

type BlameInfo struct {
	Hash      string `json:"hash"`
	Author    string `json:"author"`
	Email     string `json:"email"`
	Date      string `json:"date"`
	LineNum   int    `json:"line_num"`
	Content   string `json:"content"`
}

func parseBlame(raw string) []BlameInfo {
	var result []BlameInfo
	var cur BlameInfo
	lineNum := 0
	for _, line := range strings.Split(raw, "\n") {
		if len(line) == 40 && !strings.Contains(line, " ") {
			// hash line
			cur = BlameInfo{Hash: line[:8]}
		} else if strings.HasPrefix(line, "author ") {
			cur.Author = strings.TrimPrefix(line, "author ")
		} else if strings.HasPrefix(line, "author-mail ") {
			cur.Email = strings.Trim(strings.TrimPrefix(line, "author-mail "), "<>")
		} else if strings.HasPrefix(line, "author-time ") {
			t, _ := strconv.ParseInt(strings.TrimPrefix(line, "author-time "), 10, 64)
			cur.Date = time.Unix(t, 0).Format("2006-01-02")
		} else if strings.HasPrefix(line, "\t") {
			lineNum++
			cur.LineNum = lineNum
			cur.Content = line[1:]
			result = append(result, cur)
		}
	}
	return result
}

// GetLog returns the reflog
func GetReflog(dir string, limit int) ([]string, error) {
	out, _, err := RunGit(dir, "reflog", fmt.Sprintf("-%d", limit), "--format=%h %gd %s")
	if err != nil {
		return nil, err
	}
	var lines []string
	for _, l := range strings.Split(out, "\n") {
		if l != "" {
			lines = append(lines, l)
		}
	}
	return lines, nil
}

// GetStatus returns working tree status
func GetStatus(dir string) ([]FileStatus, error) {
	out, _, err := RunGit(dir, "--no-optional-locks", "status", "--porcelain", "-u")
	if err != nil {
		return nil, err
	}
	var files []FileStatus
	for _, line := range strings.Split(out, "\n") {
		if len(line) < 4 {
			continue
		}
		files = append(files, FileStatus{
			Index:   string(line[0]),
			Working: string(line[1]),
			Path:    strings.TrimSpace(line[3:]),
		})
	}
	return files, nil
}

type FileStatus struct {
	Index   string `json:"index"`
	Working string `json:"working"`
	Path    string `json:"path"`
}

// ApplyStash pops or applies a stash
func ApplyStash(dir string, pop bool) (string, error) {
	args := []string{"stash"}
	if pop {
		args = append(args, "pop")
	} else {
		args = append(args, "apply")
	}
	out, errStr, err := RunGit(dir, args...)
	if err != nil {
		return out + "\n" + errStr, err
	}
	return out, nil
}

// GetFileTree returns the file tree at HEAD or a ref
func GetFileTree(dir, ref string) ([]FileEntry, error) {
	if ref == "" {
		ref = "HEAD"
	}
	out, _, err := RunGit(dir, "ls-tree", "-r", "--name-only", ref)
	if err != nil {
		return nil, err
	}
	var files []FileEntry
	for _, f := range strings.Split(out, "\n") {
		if f != "" {
			files = append(files, FileEntry{Path: f})
		}
	}
	return files, nil
}

type FileEntry struct {
	Path string `json:"path"`
}

// GetFileContent returns file content at a ref
func GetFileContent(dir, ref, path string) (string, error) {
	out, _, err := RunGit(dir, "show", ref+":"+path)
	return out, err
}

// GetCurrentBranch returns active branch name
func GetCurrentBranch(dir string) (string, error) {
	out, _, err := RunGit(dir, "--no-optional-locks", "rev-parse", "--abbrev-ref", "HEAD")
	return out, err
}

// GetRemotes returns all remotes
func GetRemotes(dir string) ([]RemoteInfo, error) {
	out, _, err := RunGit(dir, "remote", "-v")
	if err != nil {
		return nil, err
	}
	seen := map[string]bool{}
	var remotes []RemoteInfo
	for _, line := range strings.Split(out, "\n") {
		parts := strings.Fields(line)
		if len(parts) < 2 {
			continue
		}
		name := parts[0]
		if seen[name] {
			continue
		}
		seen[name] = true
		remotes = append(remotes, RemoteInfo{Name: name, URL: parts[1]})
	}
	return remotes, nil
}

type RemoteInfo struct {
	Name string `json:"name"`
	URL  string `json:"url"`
}

// BisectStart starts a bisect session
func BisectStart(dir, good, bad string) (string, error) {
	RunGit(dir, "bisect", "reset")
	RunGit(dir, "bisect", "start")
	out1, _, _ := RunGit(dir, "bisect", "bad", bad)
	out2, _, err := RunGit(dir, "bisect", "good", good)
	return out1 + "\n" + out2, err
}

// ResolveConflict writes resolved content to file and stages it
func ResolveConflict(dir, path, content string) error {
	fullPath := filepath.Join(dir, path)
	if err := os.WriteFile(fullPath, []byte(content), 0644); err != nil {
		return err
	}
	_, _, err := RunGit(dir, "add", path)
	return err
}

// GetGraphLog returns commit graph as text
func GetGraphLog(dir string, limit int) (string, error) {
	out, _, err := RunGit(dir, "log", "--graph", "--oneline", "--decorate", "--all", fmt.Sprintf("-%d", limit))
	return out, err
}

// SubmoduleList returns submodules
func SubmoduleList(dir string) ([]string, error) {
	out, _, err := RunGit(dir, "submodule", "status")
	if err != nil {
		return nil, err
	}
	var mods []string
	for _, l := range strings.Split(out, "\n") {
		if l != "" {
			mods = append(mods, strings.TrimSpace(l))
		}
	}
	return mods, nil
}
