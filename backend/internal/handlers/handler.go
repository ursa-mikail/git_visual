package handlers

import (
	"bytes"
	"database/sql"
	"encoding/csv"
	"encoding/json"
	"fmt"
	"math"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/gitvisual/backend/internal/db"
	"github.com/gitvisual/backend/internal/git"
	"github.com/gitvisual/backend/internal/models"
)

type sseClient struct{ ch chan string }

type Handler struct {
	db      *db.DB
	mu      sync.Mutex
	clients map[*sseClient]struct{}
}

func newHandler(database *db.DB) *Handler {
	return &Handler{db: database, clients: make(map[*sseClient]struct{})}
}

func (h *Handler) emit(event string, data interface{}) {
	b, _ := json.Marshal(map[string]interface{}{"event": event, "data": data})
	msg := "data: " + string(b) + "\n\n"
	h.mu.Lock()
	defer h.mu.Unlock()
	for c := range h.clients {
		select {
		case c.ch <- msg:
		default:
		}
	}
}

func (h *Handler) sse(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "SSE not supported", 500)
		return
	}
	c := &sseClient{ch: make(chan string, 32)}
	h.mu.Lock()
	h.clients[c] = struct{}{}
	h.mu.Unlock()
	defer func() {
		h.mu.Lock()
		delete(h.clients, c)
		h.mu.Unlock()
	}()
	ticker := time.NewTicker(20 * time.Second)
	defer ticker.Stop()
	for {
		select {
		case msg := <-c.ch:
			fmt.Fprint(w, msg)
			flusher.Flush()
		case <-ticker.C:
			fmt.Fprintf(w, ": ping\n\n")
			flusher.Flush()
		case <-r.Context().Done():
			return
		}
	}
}

func writeJSON(w http.ResponseWriter, status int, v interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}
func readJSON(r *http.Request, v interface{}) error { return json.NewDecoder(r.Body).Decode(v) }
func errJSON(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}
func queryInt(r *http.Request, key string, def int) int {
	v := r.URL.Query().Get(key)
	if v == "" {
		return def
	}
	n, err := strconv.Atoi(v)
	if err != nil || n < 1 {
		return def
	}
	return n
}
func (h *Handler) logAudit(repoID, action string, details map[string]interface{}) {
	b, _ := json.Marshal(details)
	repoIDVal := sql.NullString{String: repoID, Valid: repoID != ""}
	h.db.Exec(`INSERT INTO audit_log (repo_id,action,details) VALUES ($1,$2,$3)`, repoIDVal, action, string(b))
}

func pathSegments(r *http.Request) []string {
	parts := strings.Split(strings.Trim(r.URL.Path, "/"), "/")
	var segs []string
	for _, p := range parts {
		if p != "" {
			segs = append(segs, p)
		}
	}
	return segs
}

// getRepoPath fetches the filesystem path for a repo ID
func (h *Handler) getRepoPath(id string) (string, error) {
	var path string
	err := h.db.QueryRow(`SELECT path FROM repositories WHERE id=$1`, id).Scan(&path)
	if err != nil {
		return "", err
	}
	return translateToHostHome(path), nil
}

// translateToHostHome rewrites a Mac/Linux home-directory path to the
// /host-home mount point the container exposes.
// Examples:
//
//	/Users/alice/dev/myrepo   → /host-home/dev/myrepo
//	/home/alice/dev/myrepo    → /host-home/dev/myrepo
//	/host-home/dev/myrepo     → /host-home/dev/myrepo  (already translated)
//	/repos/myrepo             → /repos/myrepo           (container-native, unchanged)
func translateToHostHome(p string) string {
	if strings.HasPrefix(p, "/host-home/") || strings.HasPrefix(p, "/repos/") {
		return p // already in container form
	}
	// Strip /Users/<name> or /home/<name> prefix
	for _, prefix := range []string{"/Users/", "/home/"} {
		if strings.HasPrefix(p, prefix) {
			rest := p[len(prefix):]
			// rest is now "<username>/..."; drop the username segment
			slash := strings.Index(rest, "/")
			if slash >= 0 {
				return "/host-home" + rest[slash:]
			}
			// Path was exactly /Users/<username> — map to /host-home
			return "/host-home"
		}
	}
	return p
}

// isGitRepo returns true if dir is a git repository (normal or bare).
func isGitRepo(dir string) bool {
	if dir == "" {
		return false
	}
	// Normal repo: has .git subdirectory
	if _, err := os.Stat(filepath.Join(dir, ".git")); err == nil {
		return true
	}
	// Bare repo: has HEAD file directly in dir
	if _, err := os.Stat(filepath.Join(dir, "HEAD")); err == nil {
		return true
	}
	return false
}

// ── REPOS ────────────────────────────────────────────────────────────────────

func (h *Handler) repos(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		h.listRepos(w, r)
	case http.MethodPost:
		h.createRepo(w, r)
	default:
		errJSON(w, 405, "method not allowed")
	}
}

func (h *Handler) listRepos(w http.ResponseWriter, r *http.Request) {
	search := r.URL.Query().Get("search")
	var rows *sql.Rows
	var err error
	if search != "" {
		rows, err = h.db.Query(
			`SELECT id,name,path,remote_url,github_url,default_branch,description,is_initialized,created_at,updated_at
			 FROM repositories WHERE name ILIKE $1 OR COALESCE(description,'') ILIKE $1
			 ORDER BY updated_at DESC`, "%"+search+"%")
	} else {
		rows, err = h.db.Query(
			`SELECT id,name,path,remote_url,github_url,default_branch,description,is_initialized,created_at,updated_at
			 FROM repositories ORDER BY updated_at DESC`)
	}
	if err != nil {
		errJSON(w, 500, err.Error())
		return
	}
	defer rows.Close()
	var repos []models.Repository
	for rows.Next() {
		var repo models.Repository
		rows.Scan(&repo.ID, &repo.Name, &repo.Path, &repo.RemoteURL, &repo.GithubURL,
			&repo.DefaultBranch, &repo.Description, &repo.IsInitialized, &repo.CreatedAt, &repo.UpdatedAt)
		repos = append(repos, repo)
	}
	if repos == nil {
		repos = []models.Repository{}
	}
	writeJSON(w, 200, repos)
}

func (h *Handler) createRepo(w http.ResponseWriter, r *http.Request) {
	var input struct {
		Name        string `json:"name"`
		Path        string `json:"path"`
		RemoteURL   string `json:"remote_url"`
		GithubURL   string `json:"github_url"`
		Description string `json:"description"`
		PAT         string `json:"pat"`
		Init        bool   `json:"init"`
		// Mode: "local" = register existing path, "clone" = git clone, "new" = git init
		Mode string `json:"mode"`
	}
	if err := readJSON(r, &input); err != nil || input.Name == "" {
		errJSON(w, 400, "name required")
		return
	}

	// Derive mode from legacy Init field if not explicitly set
	if input.Mode == "" {
		if input.Init && input.RemoteURL != "" {
			input.Mode = "clone"
		} else if input.Init {
			input.Mode = "new"
		} else {
			input.Mode = "local"
		}
	}

	// Set default path based on mode
	if input.Path == "" {
		if input.Mode == "local" {
			errJSON(w, 400, "local path is required when adding an existing repository")
			return
		}
		input.Path = filepath.Join("/repos", input.Name)
	}

	// Translate host paths to the /host-home mount point.
	// The container mounts ${HOME} as /host-home, so paths like
	// /Users/alice/project or /home/alice/project become /host-home/project.
	// This lets users paste their real Mac/Linux path without knowing the mapping.
	// Translate for every mode so the stored path is always the container path.
	input.Path = translateToHostHome(input.Path)

	isInitialized := false

	switch input.Mode {
	case "local":
		// Validate the path exists and is a git repo — no cloning or init
		if err := git.RegisterExisting(input.Path); err != nil {
			// Give a helpful hint if the original path looks like a home dir path
			translated := translateToHostHome(input.Path)
			if translated != input.Path {
				errJSON(w, 400, err.Error()+fmt.Sprintf(" (tried as %s)", translated))
			} else {
				errJSON(w, 400, err.Error())
			}
			return
		}
		isInitialized = true

	case "clone":
		if input.RemoteURL == "" {
			errJSON(w, 400, "remote URL is required for cloning")
			return
		}
		// Clone is async: insert the row immediately as not-yet-initialized,
		// respond to the client, then clone+sync in the background.
		// This prevents the HTTP request from hanging for the full clone duration.

	case "new":
		if err := git.InitRepo(input.Path, "", ""); err != nil {
			errJSON(w, 500, "git init failed: "+err.Error())
			return
		}
		isInitialized = true
	}

	// Detect default branch from the real git repo (only for local/new — clone hasn't run yet)
	defaultBranch := "main"
	if isInitialized {
		if b, err := git.GetCurrentBranch(input.Path); err == nil && b != "" && b != "HEAD" {
			defaultBranch = b
		}
	}

	var repo models.Repository
	err := h.db.QueryRow(
		`INSERT INTO repositories (name,path,remote_url,github_url,description,is_initialized,default_branch)
		 VALUES ($1,$2,NULLIF($3,''),NULLIF($4,''),NULLIF($5,''),$6,$7)
		 RETURNING id,name,path,remote_url,github_url,default_branch,description,is_initialized,created_at,updated_at`,
		input.Name, input.Path, input.RemoteURL, input.GithubURL, input.Description, isInitialized, defaultBranch,
	).Scan(&repo.ID, &repo.Name, &repo.Path, &repo.RemoteURL, &repo.GithubURL,
		&repo.DefaultBranch, &repo.Description, &repo.IsInitialized, &repo.CreatedAt, &repo.UpdatedAt)
	if err != nil {
		errJSON(w, 500, err.Error())
		return
	}

	h.logAudit(repo.ID, "repo.create", map[string]interface{}{"name": repo.Name})
	h.emit("repo.created", repo)
	writeJSON(w, 201, repo)

	// Background work: clone (if needed) then sync branches+commits.
	// Responding before this keeps the UI snappy regardless of repo size.
	if input.Mode == "clone" {
		repoID := repo.ID
		clonePath := input.Path
		remoteURL := input.RemoteURL
		pat := input.PAT
		go func() {
			if err := git.InitRepo(clonePath, remoteURL, pat); err != nil {
				h.emit("repo.clone_failed", map[string]string{"id": repoID, "error": err.Error()})
				h.db.Exec(`UPDATE repositories SET description=CONCAT('Clone failed: ',$2) WHERE id=$1`, repoID, err.Error())
				return
			}
			branch := "main"
			if b, err := git.GetCurrentBranch(clonePath); err == nil && b != "" && b != "HEAD" {
				branch = b
			}
			h.db.Exec(`UPDATE repositories SET is_initialized=true, default_branch=$2 WHERE id=$1`, repoID, branch)
			h.syncBranchesFromGit(repoID, clonePath)
			h.syncCommitsFromGit(repoID, clonePath, branch)
			h.emit("repo.synced", map[string]string{"id": repoID})
		}()
	} else if isInitialized {
		// local / new: sync in background too
		repoID := repo.ID
		repoPath := input.Path
		branch := defaultBranch
		go func() {
			h.syncBranchesFromGit(repoID, repoPath)
			h.syncCommitsFromGit(repoID, repoPath, branch)
			h.emit("repo.synced", map[string]string{"id": repoID})
		}()
	}
}

func (h *Handler) syncBranchesFromGit(repoID, dir string) {
	branches, err := git.GetBranches(dir)
	if err != nil {
		return
	}
	for _, b := range branches {
		name := b.Name
		if strings.HasPrefix(name, "remotes/") {
			name = strings.TrimPrefix(name, "remotes/")
		}
		h.db.Exec(
			`INSERT INTO branches (repo_id,name,is_remote,last_commit_hash,last_commit_message,last_commit_author)
			 VALUES ($1,$2,$3,NULLIF($4,''),NULLIF($5,''),NULLIF($6,''))
			 ON CONFLICT (repo_id,name) DO UPDATE SET last_commit_hash=EXCLUDED.last_commit_hash,last_commit_message=EXCLUDED.last_commit_message`,
			repoID, name, b.IsRemote, b.LastHash, b.LastMessage, b.LastAuthor)
	}
}

func (h *Handler) syncCommitsFromGit(repoID, dir, branch string) {
	commits, err := git.GetCommits(dir, branch, 100, 0)
	if err != nil {
		return
	}
	for _, c := range commits {
		authorName := sql.NullString{String: c.AuthorName, Valid: c.AuthorName != ""}
		authorEmail := sql.NullString{String: c.AuthorEmail, Valid: c.AuthorEmail != ""}
		parentHash := sql.NullString{String: c.ParentHash, Valid: c.ParentHash != ""}
		h.db.Exec(
			`INSERT INTO commits (repo_id,hash,short_hash,message,author_name,author_email,branch_name,parent_hash,files_changed,insertions,deletions,committed_at)
			 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
			 ON CONFLICT (repo_id,hash) DO NOTHING`,
			repoID, c.Hash, c.ShortHash, c.Message, authorName, authorEmail, branch, parentHash,
			c.FilesChanged, c.Insertions, c.Deletions, c.CommittedAt)
	}
}

// discoverRepos scans /host-home for git repos the user hasn't registered yet
func (h *Handler) discoverRepos(w http.ResponseWriter, r *http.Request) {
	root := "/host-home"
	if _, err := os.Stat(root); err != nil {
		// host-home not mounted; fall back gracefully
		writeJSON(w, 200, []git.DiscoveredRepo{})
		return
	}
	found, _ := git.DiscoverRepos(root, 5)

	// Filter out repos already registered (by path)
	rows, err := h.db.Query(`SELECT path FROM repositories`)
	known := map[string]bool{}
	if err == nil {
		defer rows.Close()
		for rows.Next() {
			var p string
			rows.Scan(&p)
			known[p] = true
			// also index the mac-style path
			if strings.HasPrefix(p, "/host-home/") {
				known["/Users/"+strings.TrimPrefix(p, "/host-home/")] = true
			}
		}
	}
	var unregistered []git.DiscoveredRepo
	for _, d := range found {
		if !known[d.Path] && !known[translateToHostHome(d.Path)] {
			unregistered = append(unregistered, d)
		}
	}
	if unregistered == nil {
		unregistered = []git.DiscoveredRepo{}
	}
	writeJSON(w, 200, unregistered)
}

// bulkImportRepos registers multiple discovered repos in one request
func (h *Handler) bulkImportRepos(w http.ResponseWriter, r *http.Request) {
	var repos []struct {
		Name string `json:"name"`
		Path string `json:"path"`
		RemoteURL string `json:"remote_url"`
		Branch string `json:"branch"`
	}
	if err := readJSON(r, &repos); err != nil || len(repos) == 0 {
		errJSON(w, 400, "repos array required")
		return
	}
	imported := 0
	for _, rep := range repos {
		containerPath := translateToHostHome(rep.Path)
		if err := git.RegisterExisting(containerPath); err != nil {
			continue // skip invalid
		}
		branch := rep.Branch
		if branch == "" {
			branch = "main"
		}
		var repoID string
		err := h.db.QueryRow(
			`INSERT INTO repositories (name,path,remote_url,github_url,description,is_initialized,default_branch)
			 VALUES ($1,$2,NULLIF($3,''),NULLIF($3,''),NULL,true,$4)
			 ON CONFLICT (path) DO NOTHING
			 RETURNING id`,
			rep.Name, containerPath, rep.RemoteURL, branch,
		).Scan(&repoID)
		if err == nil && repoID != "" {
			imported++
			rid := repoID
			cp := containerPath
			br := branch
			go func() {
				h.syncBranchesFromGit(rid, cp)
				h.syncCommitsFromGit(rid, cp, br)
				h.emit("repo.synced", map[string]string{"id": rid})
			}()
		}
	}
	writeJSON(w, 200, map[string]int{"imported": imported})
}

func (h *Handler) reposSub(w http.ResponseWriter, r *http.Request) {
	segs := pathSegments(r)
	// segs: [0]=api [1]=repos [2]=repoID or special [3]=sub-resource
	if len(segs) < 3 {
		errJSON(w, 404, "not found")
		return
	}
	// Special non-UUID routes
	if segs[2] == "discover" && r.Method == http.MethodGet {
		h.discoverRepos(w, r)
		return
	}
	if segs[2] == "bulk-import" && r.Method == http.MethodPost {
		h.bulkImportRepos(w, r)
		return
	}
	repoID := segs[2]
	if len(segs) == 3 {
		switch r.Method {
		case http.MethodGet:
			h.getRepo(w, r, repoID)
		case http.MethodPut:
			h.updateRepo(w, r, repoID)
		case http.MethodDelete:
			h.deleteRepo(w, r, repoID)
		default:
			errJSON(w, 405, "method not allowed")
		}
		return
	}
	switch segs[3] {
	case "branches":
		h.handleBranches(w, r, repoID, segs[4:])
	case "commits":
		h.handleCommits(w, r, repoID, segs[4:])
	case "prs":
		h.handlePRs(w, r, repoID, segs[4:])
	case "refs":
		h.getRefs(w, r, repoID)
	case "all-refs":
		h.getAllRefs(w, r, repoID)
	case "ref-tree":
		h.getRefTree(w, r, repoID)
	case "cross-ref-tree":
		h.getCrossRefTree(w, r, repoID)
	case "diff":
		h.getDiff(w, r, repoID)
	case "diff-debug":
		h.getDiffDebug(w, r, repoID)
	case "cross-diff":
		h.getCrossDiff(w, r, repoID)
	case "working-diff":
		h.getWorkingDiff(w, r, repoID)
	case "stashes":
		h.handleStashes(w, r, repoID, segs[4:])
	case "tags":
		h.handleTags(w, r, repoID, segs[4:])
	case "cherry-pick":
		h.handleCherryPick(w, r, repoID)
	case "merge":
		h.mergeBranches(w, r, repoID)
	case "rebase":
		h.rebaseBranch(w, r, repoID)
	case "push":
		h.pushRepo(w, r, repoID)
	case "pull":
		h.pullRepo(w, r, repoID)
	case "fetch":
		h.fetchRepo(w, r, repoID)
	case "bisect":
		h.bisect(w, r, repoID)
	case "blame":
		h.blame(w, r, repoID)
	case "status":
		h.getStatus(w, r, repoID)
	case "log-graph":
		h.getLogGraph(w, r, repoID)
	case "reflog":
		h.getReflog(w, r, repoID)
	case "remotes":
		h.handleRemotes(w, r, repoID)
	case "files":
		h.handleFiles(w, r, repoID, segs[4:])
	case "conflicts":
		h.handleConflicts(w, r, repoID, segs[4:])
	case "config":
		h.handleGitConfig(w, r, repoID)
	case "reset":
		h.resetRepo(w, r, repoID)
	case "restore":
		h.restoreFile(w, r, repoID)
	case "submodules":
		h.handleSubmodules(w, r, repoID)
	case "sync":
		h.syncRepo(w, r, repoID)
	case "commit":
		h.createCommit(w, r, repoID)
	case "stage":
		h.stageFiles(w, r, repoID)
	default:
		errJSON(w, 404, "not found")
	}
}

func (h *Handler) getRepo(w http.ResponseWriter, r *http.Request, id string) {
	var repo models.Repository
	err := h.db.QueryRow(
		`SELECT id,name,path,remote_url,github_url,default_branch,description,is_initialized,created_at,updated_at
		 FROM repositories WHERE id=$1`, id,
	).Scan(&repo.ID, &repo.Name, &repo.Path, &repo.RemoteURL, &repo.GithubURL,
		&repo.DefaultBranch, &repo.Description, &repo.IsInitialized, &repo.CreatedAt, &repo.UpdatedAt)
	if err != nil {
		errJSON(w, 404, "repo not found")
		return
	}
	writeJSON(w, 200, repo)
}

func (h *Handler) updateRepo(w http.ResponseWriter, r *http.Request, id string) {
	var input struct {
		Name        string `json:"name"`
		Description string `json:"description"`
		RemoteURL   string `json:"remote_url"`
		GithubURL   string `json:"github_url"`
	}
	if err := readJSON(r, &input); err != nil {
		errJSON(w, 400, "bad request")
		return
	}
	_, err := h.db.Exec(
		`UPDATE repositories SET name=COALESCE(NULLIF($1,''),name), description=NULLIF($2,''),
		 remote_url=NULLIF($3,''), github_url=NULLIF($4,''), updated_at=NOW() WHERE id=$5`,
		input.Name, input.Description, input.RemoteURL, input.GithubURL, id)
	if err != nil {
		errJSON(w, 500, err.Error())
		return
	}
	h.logAudit(id, "repo.update", map[string]interface{}{"name": input.Name})
	h.getRepo(w, r, id)
}

func (h *Handler) deleteRepo(w http.ResponseWriter, r *http.Request, id string) {
	h.db.Exec(`DELETE FROM repositories WHERE id=$1`, id)
	h.logAudit(id, "repo.delete", nil)
	h.emit("repo.deleted", map[string]string{"id": id})
	w.WriteHeader(204)
}

// ── BRANCHES ─────────────────────────────────────────────────────────────────

func (h *Handler) handleBranches(w http.ResponseWriter, r *http.Request, repoID string, segs []string) {
	if len(segs) == 0 {
		switch r.Method {
		case http.MethodGet:
			h.listBranches(w, r, repoID)
		case http.MethodPost:
			h.createBranch(w, r, repoID)
		}
		return
	}
	branchID := segs[0]
	if len(segs) == 1 {
		switch r.Method {
		case http.MethodDelete:
			h.deleteBranch(w, r, repoID, branchID)
		case http.MethodPut:
			h.renameBranch(w, r, repoID, branchID)
		case http.MethodPost:
			h.checkoutBranch(w, r, repoID, branchID)
		}
		return
	}
	if segs[1] == "checkout" {
		h.checkoutBranch(w, r, repoID, branchID)
	}
}

func (h *Handler) listBranches(w http.ResponseWriter, r *http.Request, repoID string) {
	// Try real git first
	dir, err := h.getRepoPath(repoID)
	if err == nil && dir != "" {
		if isGitRepo(dir) {
			h.syncBranchesFromGit(repoID, dir)
		}
	}

	search := r.URL.Query().Get("search")
	var rows *sql.Rows
	if search != "" {
		rows, err = h.db.Query(
			`SELECT id,repo_id,name,is_protected,is_remote,upstream,last_commit_hash,last_commit_message,last_commit_author,last_commit_at,created_at
			 FROM branches WHERE repo_id=$1 AND name ILIKE $2 ORDER BY name`,
			repoID, "%"+search+"%")
	} else {
		rows, err = h.db.Query(
			`SELECT id,repo_id,name,is_protected,is_remote,upstream,last_commit_hash,last_commit_message,last_commit_author,last_commit_at,created_at
			 FROM branches WHERE repo_id=$1 ORDER BY is_remote,name`,
			repoID)
	}
	if err != nil {
		errJSON(w, 500, err.Error())
		return
	}
	defer rows.Close()
	var branches []models.Branch
	for rows.Next() {
		var b models.Branch
		rows.Scan(&b.ID, &b.RepoID, &b.Name, &b.IsProtected, &b.IsRemote, &b.Upstream,
			&b.LastCommitHash, &b.LastCommitMessage, &b.LastCommitAuthor, &b.LastCommitAt, &b.CreatedAt)
		branches = append(branches, b)
	}
	if branches == nil {
		branches = []models.Branch{}
	}
	writeJSON(w, 200, branches)
}

func (h *Handler) createBranch(w http.ResponseWriter, r *http.Request, repoID string) {
	var input struct {
		Name       string `json:"name"`
		From       string `json:"from"`
		Checkout   bool   `json:"checkout"`
	}
	if err := readJSON(r, &input); err != nil || input.Name == "" {
		errJSON(w, 400, "name required")
		return
	}
	if input.From == "" {
		input.From = "HEAD"
	}

	// Real git
	dir, err := h.getRepoPath(repoID)
	if err == nil {
		if isGitRepo(dir) {
			if input.Checkout {
				_, errStr, gitErr := git.RunGit(dir, "checkout", "-b", input.Name, input.From)
				if gitErr != nil {
					errJSON(w, 400, "git error: "+errStr)
					return
				}
			} else {
				_, errStr, gitErr := git.RunGit(dir, "branch", input.Name, input.From)
				if gitErr != nil {
					errJSON(w, 400, "git error: "+errStr)
					return
				}
			}
		}
	}

	var b models.Branch
	qErr := h.db.QueryRow(
		`INSERT INTO branches (repo_id,name) VALUES ($1,$2)
		 RETURNING id,repo_id,name,is_protected,is_remote,upstream,last_commit_hash,last_commit_message,last_commit_author,last_commit_at,created_at`,
		repoID, input.Name,
	).Scan(&b.ID, &b.RepoID, &b.Name, &b.IsProtected, &b.IsRemote, &b.Upstream,
		&b.LastCommitHash, &b.LastCommitMessage, &b.LastCommitAuthor, &b.LastCommitAt, &b.CreatedAt)
	if qErr != nil {
		// may already exist
		errJSON(w, 500, qErr.Error())
		return
	}
	h.logAudit(repoID, "branch.create", map[string]interface{}{"name": input.Name, "from": input.From})
	h.emit("branch.created", b)
	writeJSON(w, 201, b)
}

func (h *Handler) deleteBranch(w http.ResponseWriter, r *http.Request, repoID, branchID string) {
	var name string
	var force bool
	if r.URL.Query().Get("force") == "true" {
		force = true
	}
	h.db.QueryRow(`SELECT name FROM branches WHERE id=$1`, branchID).Scan(&name)

	// Real git
	dir, err := h.getRepoPath(repoID)
	if err == nil {
		if isGitRepo(dir) {
			flag := "-d"
			if force {
				flag = "-D"
			}
			_, errStr, gitErr := git.RunGit(dir, "branch", flag, name)
			if gitErr != nil {
				errJSON(w, 400, "git error: "+errStr)
				return
			}
		}
	}

	h.db.Exec(`DELETE FROM branches WHERE id=$1`, branchID)
	h.logAudit(repoID, "branch.delete", map[string]interface{}{"name": name})
	h.emit("branch.deleted", map[string]string{"id": branchID})
	w.WriteHeader(204)
}

func (h *Handler) renameBranch(w http.ResponseWriter, r *http.Request, repoID, branchID string) {
	var input struct {
		Name string `json:"name"`
	}
	readJSON(r, &input)
	var oldName string
	h.db.QueryRow(`SELECT name FROM branches WHERE id=$1`, branchID).Scan(&oldName)

	dir, err := h.getRepoPath(repoID)
	if err == nil {
		if isGitRepo(dir) {
			_, errStr, gitErr := git.RunGit(dir, "branch", "-m", oldName, input.Name)
			if gitErr != nil {
				errJSON(w, 400, errStr)
				return
			}
		}
	}

	h.db.Exec(`UPDATE branches SET name=$1 WHERE id=$2`, input.Name, branchID)
	h.logAudit(repoID, "branch.rename", map[string]interface{}{"from": oldName, "to": input.Name})
	writeJSON(w, 200, map[string]string{"name": input.Name})
}

func (h *Handler) checkoutBranch(w http.ResponseWriter, r *http.Request, repoID, branchID string) {
	var name string
	h.db.QueryRow(`SELECT name FROM branches WHERE id=$1`, branchID).Scan(&name)

	dir, err := h.getRepoPath(repoID)
	if err == nil {
		if isGitRepo(dir) {
			_, errStr, gitErr := git.RunGit(dir, "checkout", name)
			if gitErr != nil {
				errJSON(w, 400, "checkout failed: "+errStr)
				return
			}
		}
	}

	h.logAudit(repoID, "branch.checkout", map[string]interface{}{"name": name})
	writeJSON(w, 200, map[string]string{"branch": name, "message": "Switched to branch: " + name})
}

// ── COMMITS ──────────────────────────────────────────────────────────────────

func (h *Handler) handleCommits(w http.ResponseWriter, r *http.Request, repoID string, segs []string) {
	if len(segs) == 0 {
		switch r.Method {
		case http.MethodGet:
			h.listCommits(w, r, repoID)
		}
		return
	}
	commitID := segs[0]
	if len(segs) >= 2 && segs[1] == "revert" {
		h.revertCommit(w, r, repoID, commitID)
		return
	}
	h.getCommit(w, r, repoID, commitID)
}

func (h *Handler) listCommits(w http.ResponseWriter, r *http.Request, repoID string) {
	page := queryInt(r, "page", 1)
	pageSize := queryInt(r, "page_size", 20)
	branch := r.URL.Query().Get("branch")
	search := r.URL.Query().Get("search")
	author := r.URL.Query().Get("author")
	offset := (page - 1) * pageSize

	// Sync from real git
	dir, err := h.getRepoPath(repoID)
	if err == nil {
		if isGitRepo(dir) {
			h.syncCommitsFromGit(repoID, dir, branch)
		}
	}

	conditions := []string{"repo_id=$1"}
	args := []interface{}{repoID}
	i := 2
	if branch != "" {
		conditions = append(conditions, fmt.Sprintf("branch_name=$%d", i))
		args = append(args, branch)
		i++
	}
	if search != "" {
		conditions = append(conditions, fmt.Sprintf("(message ILIKE $%d OR short_hash ILIKE $%d)", i, i))
		args = append(args, "%"+search+"%")
		i++
	}
	if author != "" {
		conditions = append(conditions, fmt.Sprintf("author_name ILIKE $%d", i))
		args = append(args, "%"+author+"%")
		i++
	}
	where := "WHERE " + strings.Join(conditions, " AND ")

	var total int64
	h.db.QueryRow(fmt.Sprintf(`SELECT COUNT(*) FROM commits %s`, where), args...).Scan(&total)

	args = append(args, pageSize, offset)
	rows, err := h.db.Query(fmt.Sprintf(
		`SELECT id,repo_id,hash,short_hash,message,author_name,author_email,branch_name,parent_hash,files_changed,insertions,deletions,committed_at,created_at
		 FROM commits %s ORDER BY committed_at DESC LIMIT $%d OFFSET $%d`, where, i, i+1), args...)
	if err != nil {
		errJSON(w, 500, err.Error())
		return
	}
	defer rows.Close()
	var commits []models.Commit
	for rows.Next() {
		var c models.Commit
		rows.Scan(&c.ID, &c.RepoID, &c.Hash, &c.ShortHash, &c.Message,
			&c.AuthorName, &c.AuthorEmail, &c.BranchName, &c.ParentHash,
			&c.FilesChanged, &c.Insertions, &c.Deletions, &c.CommittedAt, &c.CreatedAt)
		commits = append(commits, c)
	}
	if commits == nil {
		commits = []models.Commit{}
	}
	writeJSON(w, 200, models.PaginatedResult{
		Data:       commits,
		Total:      total,
		Page:       page,
		PageSize:   pageSize,
		TotalPages: int(math.Ceil(float64(total) / float64(pageSize))),
	})
}

func (h *Handler) getCommit(w http.ResponseWriter, r *http.Request, repoID, commitID string) {
	var c models.Commit
	err := h.db.QueryRow(
		`SELECT id,repo_id,hash,short_hash,message,author_name,author_email,branch_name,parent_hash,files_changed,insertions,deletions,committed_at,created_at
		 FROM commits WHERE id=$1 AND repo_id=$2`, commitID, repoID,
	).Scan(&c.ID, &c.RepoID, &c.Hash, &c.ShortHash, &c.Message,
		&c.AuthorName, &c.AuthorEmail, &c.BranchName, &c.ParentHash,
		&c.FilesChanged, &c.Insertions, &c.Deletions, &c.CommittedAt, &c.CreatedAt)
	if err != nil {
		errJSON(w, 404, "commit not found")
		return
	}
	writeJSON(w, 200, c)
}

func (h *Handler) createCommit(w http.ResponseWriter, r *http.Request, repoID string) {
	var input struct {
		Message string   `json:"message"`
		Files   []string `json:"files"`
		All     bool     `json:"all"`
	}
	if err := readJSON(r, &input); err != nil || input.Message == "" {
		errJSON(w, 400, "message required")
		return
	}
	dir, err := h.getRepoPath(repoID)
	if err != nil {
		errJSON(w, 404, "repo not found")
		return
	}
	if isGitRepo(dir) {
		if input.All {
			git.RunGit(dir, "add", "-A")
		} else if len(input.Files) > 0 {
			args := append([]string{"add"}, input.Files...)
			git.RunGit(dir, args...)
		}
		_, errStr, gitErr := git.RunGit(dir, "commit", "-m", input.Message)
		if gitErr != nil {
			errJSON(w, 400, "commit failed: "+errStr)
			return
		}
		h.syncCommitsFromGit(repoID, dir, "")
	}
	h.logAudit(repoID, "commit.create", map[string]interface{}{"message": input.Message})
	writeJSON(w, 201, map[string]string{"message": "committed: " + input.Message})
}

func (h *Handler) stageFiles(w http.ResponseWriter, r *http.Request, repoID string) {
	var input struct {
		Files     []string `json:"files"`
		Unstage   bool     `json:"unstage"`
		All       bool     `json:"all"`
	}
	readJSON(r, &input)
	dir, err := h.getRepoPath(repoID)
	if err != nil {
		errJSON(w, 404, "repo not found")
		return
	}
	if isGitRepo(dir) {
		if input.Unstage {
			if input.All {
				git.RunGit(dir, "reset", "HEAD")
			} else {
				args := append([]string{"reset", "HEAD", "--"}, input.Files...)
				git.RunGit(dir, args...)
			}
		} else {
			if input.All {
				git.RunGit(dir, "add", "-A")
			} else {
				args := append([]string{"add"}, input.Files...)
				git.RunGit(dir, args...)
			}
		}
	}
	writeJSON(w, 200, map[string]string{"message": "done"})
}

func (h *Handler) revertCommit(w http.ResponseWriter, r *http.Request, repoID, commitID string) {
	var hash string
	h.db.QueryRow(`SELECT hash FROM commits WHERE id=$1`, commitID).Scan(&hash)

	dir, err := h.getRepoPath(repoID)
	if err != nil {
		errJSON(w, 404, "not found")
		return
	}
	if isGitRepo(dir) {
		_, errStr, gitErr := git.RunGit(dir, "revert", "--no-edit", hash)
		if gitErr != nil {
			errJSON(w, 400, "revert failed: "+errStr)
			return
		}
		h.syncCommitsFromGit(repoID, dir, "")
	}
	h.logAudit(repoID, "commit.revert", map[string]interface{}{"hash": hash})
	writeJSON(w, 200, map[string]string{"message": "reverted " + hash})
}

// ── DIFF ─────────────────────────────────────────────────────────────────────

// getRefTree returns all file paths in a given ref (defaults to HEAD).
// Query params: ref
func (h *Handler) getRefTree(w http.ResponseWriter, r *http.Request, repoID string) {
	ref := r.URL.Query().Get("ref")
	dir, err := h.getRepoPath(repoID)
	if err != nil {
		errJSON(w, 404, "not found")
		return
	}
	if ref == "" {
		ref = "HEAD"
	}
	files, err := git.GetFileTree(dir, ref)
	if err != nil {
		errJSON(w, 500, err.Error())
		return
	}
	if files == nil {
		files = []git.FileEntry{}
	}
	writeJSON(w, 200, files)
}

// getCrossRefTree returns all file paths in a ref from possibly another repo.
// Query params: ref, repo_id (optional, defaults to this repo)
func (h *Handler) getCrossRefTree(w http.ResponseWriter, r *http.Request, repoID string) {
	ref := r.URL.Query().Get("ref")
	targetRepoID := r.URL.Query().Get("repo_id")
	if targetRepoID == "" {
		targetRepoID = repoID
	}

	dir, err := h.getRepoPath(targetRepoID)
	if err != nil {
		errJSON(w, 404, "repo not found")
		return
	}

	if ref == "" {
		ref = "HEAD"
	}

	// If cross-repo: we need to resolve the ref via the temp remote that getCrossDiff
	// set up, OR just read from the target repo's directory directly (simpler and correct).
	files, err := git.GetFileTree(dir, ref)
	if err != nil {
		// Try common branch names as fallback
		files, err = git.GetFileTree(dir, "HEAD")
		if err != nil {
			errJSON(w, 500, "cannot list files for ref: "+err.Error())
			return
		}
	}
	if files == nil {
		files = []git.FileEntry{}
	}
	writeJSON(w, 200, files)
}


func (h *Handler) getRefs(w http.ResponseWriter, r *http.Request, repoID string) {
	dir, err := h.getRepoPath(repoID)
	if err != nil {
		errJSON(w, 404, "not found")
		return
	}
	refs, _ := git.GetRefs(dir)
	if refs == nil {
		refs = []git.RefInfo{}
	}
	writeJSON(w, 200, refs)
}

// getDiffDebug returns the raw git diff output for troubleshooting.
func (h *Handler) getDiffDebug(w http.ResponseWriter, r *http.Request, repoID string) {
	base := r.URL.Query().Get("base")
	compare := r.URL.Query().Get("compare")

	dir, err := h.getRepoPath(repoID)
	if err != nil {
		errJSON(w, 404, "not found")
		return
	}

	// Run multiple strategies and return all results
	results := map[string]interface{}{}

	runs := []struct{ label, arg string }{
		{"two_dot", base + ".." + compare},
		{"three_dot", base + "..." + compare},
		{"plain_base", base},
		{"plain_compare", compare},
	}
	if base == "" || compare == "" {
		runs = runs[2:]
	}

	for _, run := range runs {
		out, errStr, err := git.RunGit(dir, "--no-optional-locks", "diff", "--stat", run.arg)
		results[run.label] = map[string]interface{}{
			"arg":    run.arg,
			"output": out,
			"stderr": errStr,
			"error":  fmt.Sprintf("%v", err),
		}
	}

	// Also show what refs resolve to
	baseRev, _, _ := git.RunGit(dir, "rev-parse", "--short", base)
	cmpRev, _, _ := git.RunGit(dir, "rev-parse", "--short", compare)
	results["resolved"] = map[string]string{
		"base_hash":    strings.TrimSpace(baseRev),
		"compare_hash": strings.TrimSpace(cmpRev),
	}

	writeJSON(w, 200, results)
}


func (h *Handler) getDiff(w http.ResponseWriter, r *http.Request, repoID string) {
	base := r.URL.Query().Get("base")
	compare := r.URL.Query().Get("compare")

	dir, err := h.getRepoPath(repoID)
	if err != nil {
		errJSON(w, 404, "not found")
		return
	}

	var files []models.DiffFile
	if isGitRepo(dir) {
		files, err = git.GetDiff(dir, base, compare)
		if err != nil {
			errJSON(w, 500, err.Error())
			return
		}
	}
	if files == nil {
		files = []models.DiffFile{}
	}
	writeJSON(w, 200, files)
}

// getAllRefs returns refs for this repo plus refs from all other registered repos,
// prefixed with "repo:<id>:" so the frontend can do cross-repo diffs.
func (h *Handler) getAllRefs(w http.ResponseWriter, r *http.Request, repoID string) {
	type RefEntry struct {
		Label  string `json:"label"`
		RepoID string `json:"repo_id"`
		Ref    string `json:"ref"`
		Kind   string `json:"kind"`
	}
	var result []RefEntry

	// Own refs first
	if dir, err := h.getRepoPath(repoID); err == nil {
		if refs, _ := git.GetRefs(dir); refs != nil {
			for _, ri := range refs {
				result = append(result, RefEntry{Label: ri.Label, RepoID: repoID, Ref: ri.Ref, Kind: ri.Kind})
			}
		}
	}

	// Other repos
	rows, err := h.db.Query(`SELECT id, name, path FROM repositories WHERE id != $1 AND is_initialized = true`, repoID)
	if err == nil {
		defer rows.Close()
		for rows.Next() {
			var rid, rname, rpath string
			rows.Scan(&rid, &rname, &rpath)
			if refs, _ := git.GetRefs(rpath); refs != nil {
				for _, ri := range refs {
					result = append(result, RefEntry{
						Label:  rname + "/" + ri.Label,
						RepoID: rid,
						Ref:    ri.Ref,
						Kind:   ri.Kind,
					})
				}
			}
		}
	}
	if result == nil {
		result = []RefEntry{}
	}
	writeJSON(w, 200, result)
}

// getCrossDiff diffs base ref (in this repo) against compare ref (possibly another repo).
// Query params: base, compare, compare_repo_id (optional — defaults to same repo).
func (h *Handler) getCrossDiff(w http.ResponseWriter, r *http.Request, repoID string) {
	base := r.URL.Query().Get("base")
	compare := r.URL.Query().Get("compare")
	compareRepoID := r.URL.Query().Get("compare_repo_id")
	baseRepoID := r.URL.Query().Get("base_repo_id")

	if compareRepoID == "" {
		compareRepoID = repoID
	}
	if baseRepoID == "" {
		baseRepoID = repoID
	}

	// Use the page's current repo as the "staging" repo for object fetching.
	// Its object store will hold fetched objects from both sides.
	stagingDir, err := h.getRepoPath(repoID)
	if err != nil {
		errJSON(w, 404, "staging repo not found")
		return
	}

	// Same-repo fast path
	if baseRepoID == repoID && compareRepoID == repoID {
		files, err := git.GetDiff(stagingDir, base, compare)
		if err != nil {
			errJSON(w, 500, err.Error())
			return
		}
		if files == nil {
			files = []models.DiffFile{}
		}
		writeJSON(w, 200, files)
		return
	}

	// Cross-repo strategy:
	// Always use stagingDir (current page's repo) as the git object store.
	// Fetch both sides into it as named remotes, resolve to hashes, diff.
	// This avoids mutating the source repos.

	// ── Setup base remote (if base is from a different repo) ─────────────────
	baseHash := ""
	if baseRepoID != repoID {
		baseSrcDir, berr := h.getRepoPath(baseRepoID)
		if berr != nil {
			errJSON(w, 404, "base repo not found")
			return
		}
		bRid := baseRepoID
		if len(bRid) > 8 { bRid = bRid[:8] }
		bRemote := "tmp_base_" + bRid
		defer git.RunGit(stagingDir, "remote", "remove", bRemote)
		git.RunGit(stagingDir, "remote", "remove", bRemote)
		git.RunGit(stagingDir, "remote", "add", bRemote, baseSrcDir)
		git.RunGit(stagingDir, "fetch", bRemote)
		// Resolve base ref via remote-tracking name, then plain, then src repo
		for _, candidate := range []string{bRemote + "/" + base, base} {
			if out, _, e := git.RunGit(stagingDir, "rev-parse", "--verify", candidate); e == nil {
				if h := strings.TrimSpace(out); h != "" { baseHash = h; break }
			}
		}
		if baseHash == "" {
			if out, _, e := git.RunGit(baseSrcDir, "rev-parse", "--verify", base); e == nil {
				baseHash = strings.TrimSpace(out)
				git.RunGit(stagingDir, "fetch", bRemote, baseHash)
			}
		}
	} else {
		// Base is in stagingDir itself
		ref := base
		if ref == "" { ref = "HEAD" }
		if out, _, e := git.RunGit(stagingDir, "rev-parse", "--verify", ref); e == nil {
			baseHash = strings.TrimSpace(out)
		}
	}

	// ── Setup compare remote ──────────────────────────────────────────────────
	compareDir, cerr := h.getRepoPath(compareRepoID)
	if cerr != nil {
		errJSON(w, 404, "compare repo not found")
		return
	}
	cRid := compareRepoID
	if len(cRid) > 8 { cRid = cRid[:8] }
	cRemote := "tmp_cmp_" + cRid
	defer git.RunGit(stagingDir, "remote", "remove", cRemote)
	git.RunGit(stagingDir, "remote", "remove", cRemote)
	git.RunGit(stagingDir, "remote", "add", cRemote, compareDir)
	git.RunGit(stagingDir, "fetch", cRemote)

	cmpHash := ""
	cmpRef := compare
	if cmpRef == "" { cmpRef = "HEAD" }
	for _, candidate := range []string{cRemote + "/" + cmpRef, cmpRef} {
		if out, _, e := git.RunGit(stagingDir, "rev-parse", "--verify", candidate); e == nil {
			if h := strings.TrimSpace(out); h != "" { cmpHash = h; break }
		}
	}
	if cmpHash == "" {
		if out, _, e := git.RunGit(compareDir, "rev-parse", "--verify", cmpRef); e == nil {
			cmpHash = strings.TrimSpace(out)
			git.RunGit(stagingDir, "fetch", cRemote, cmpHash)
		}
	}

	// ── Validate ──────────────────────────────────────────────────────────────
	if baseHash == "" {
		errJSON(w, 400, fmt.Sprintf("cannot resolve base ref %q", base))
		return
	}
	if cmpHash == "" {
		errJSON(w, 400, fmt.Sprintf("cannot resolve compare ref %q", compare))
		return
	}

	// ── Diff ──────────────────────────────────────────────────────────────────
	diffOut, diffErrStr, diffErr := git.RunGit(stagingDir, "--no-optional-locks", "diff", "--unified=5", baseHash+".."+cmpHash)
	if diffErr != nil && strings.TrimSpace(diffOut) == "" {
		errJSON(w, 500, "diff failed: "+diffErrStr)
		return
	}

	files := git.ParseDiffPublic(diffOut)
	if files == nil {
		files = []models.DiffFile{}
	}
	writeJSON(w, 200, files)
}

func (h *Handler) getWorkingDiff(w http.ResponseWriter, r *http.Request, repoID string) {
	dir, err := h.getRepoPath(repoID)
	if err != nil {
		errJSON(w, 404, "not found")
		return
	}
	files, _ := git.GetWorkingDiff(dir)
	if files == nil {
		files = []models.DiffFile{}
	}
	writeJSON(w, 200, files)
}

// ── MERGE/REBASE/CHERRY-PICK ─────────────────────────────────────────────────

func (h *Handler) mergeBranches(w http.ResponseWriter, r *http.Request, repoID string) {
	var input struct {
		Source   string `json:"source"`
		Strategy string `json:"strategy"`
		Message  string `json:"message"`
	}
	if err := readJSON(r, &input); err != nil || input.Source == "" {
		errJSON(w, 400, "source branch required")
		return
	}

	dir, err := h.getRepoPath(repoID)
	if err != nil {
		errJSON(w, 404, "not found")
		return
	}

	var output string
	var hasConflicts bool
	if isGitRepo(dir) {
		output, hasConflicts, err = git.Merge(dir, input.Source, input.Strategy)
		if hasConflicts {
			conflicts, _ := git.GetConflicts(dir)
			writeJSON(w, 409, map[string]interface{}{
				"has_conflicts": true,
				"conflicts":     conflicts,
				"output":        output,
			})
			return
		}
		if err != nil {
			errJSON(w, 400, output)
			return
		}
		h.syncCommitsFromGit(repoID, dir, "")
		h.syncBranchesFromGit(repoID, dir)
	}

	h.logAudit(repoID, "merge", map[string]interface{}{"source": input.Source, "strategy": input.Strategy})
	h.emit("repo.updated", map[string]string{"id": repoID})
	writeJSON(w, 200, map[string]interface{}{
		"message":       "merged " + input.Source,
		"output":        output,
		"has_conflicts": false,
	})
}

func (h *Handler) rebaseBranch(w http.ResponseWriter, r *http.Request, repoID string) {
	var input struct {
		Onto        string `json:"onto"`
		Interactive bool   `json:"interactive"`
		Abort       bool   `json:"abort"`
		Continue    bool   `json:"continue_rebase"`
	}
	readJSON(r, &input)
	dir, err := h.getRepoPath(repoID)
	if err != nil {
		errJSON(w, 404, "not found")
		return
	}
	if isGitRepo(dir) {
		if input.Abort {
			git.RunGit(dir, "rebase", "--abort")
			writeJSON(w, 200, map[string]string{"message": "rebase aborted"})
			return
		}
		if input.Continue {
			out, errStr, gitErr := git.RunGit(dir, "rebase", "--continue")
			if gitErr != nil {
				errJSON(w, 400, out+"\n"+errStr)
				return
			}
			writeJSON(w, 200, map[string]string{"message": out})
			return
		}
		out, gitErr := git.Rebase(dir, input.Onto, input.Interactive)
		if gitErr != nil {
			errJSON(w, 400, out)
			return
		}
		h.syncCommitsFromGit(repoID, dir, "")
		writeJSON(w, 200, map[string]string{"message": out})
	}
}

func (h *Handler) handleCherryPick(w http.ResponseWriter, r *http.Request, repoID string) {
	var input struct {
		Hashes   []string `json:"hashes"`
		Abort    bool     `json:"abort"`
		Continue bool     `json:"continue_pick"`
	}
	readJSON(r, &input)
	dir, err := h.getRepoPath(repoID)
	if err != nil {
		errJSON(w, 404, "not found")
		return
	}
	if isGitRepo(dir) {
		if input.Abort {
			git.RunGit(dir, "cherry-pick", "--abort")
			writeJSON(w, 200, map[string]string{"message": "cherry-pick aborted"})
			return
		}
		if input.Continue {
			out, errStr, gitErr := git.RunGit(dir, "cherry-pick", "--continue")
			if gitErr != nil {
				errJSON(w, 400, out+"\n"+errStr)
				return
			}
			writeJSON(w, 200, map[string]string{"message": out})
			return
		}
		out, hasConflicts, gitErr := git.CherryPick(dir, input.Hashes)
		if hasConflicts {
			conflicts, _ := git.GetConflicts(dir)
			writeJSON(w, 409, map[string]interface{}{
				"has_conflicts": true,
				"conflicts":     conflicts,
				"output":        out,
			})
			return
		}
		if gitErr != nil {
			errJSON(w, 400, out)
			return
		}
		h.syncCommitsFromGit(repoID, dir, "")
		h.logAudit(repoID, "cherry-pick", map[string]interface{}{"hashes": input.Hashes})
		writeJSON(w, 200, map[string]string{"message": "cherry-picked: " + strings.Join(input.Hashes, ", ")})
	}
}

// ── PUSH/PULL/FETCH ──────────────────────────────────────────────────────────

func (h *Handler) pushRepo(w http.ResponseWriter, r *http.Request, repoID string) {
	var input struct {
		Remote  string `json:"remote"`
		Branch  string `json:"branch"`
		Force   bool   `json:"force"`
		PAT     string `json:"pat"`
		SetUpstream bool `json:"set_upstream"`
	}
	readJSON(r, &input)
	if input.Remote == "" {
		input.Remote = "origin"
	}
	dir, err := h.getRepoPath(repoID)
	if err != nil {
		errJSON(w, 404, "not found")
		return
	}
	args := []string{"push", input.Remote}
	if input.Branch != "" {
		args = append(args, input.Branch)
	}
	if input.Force {
		args = append(args, "--force-with-lease")
	}
	if input.SetUpstream {
		args = append(args, "--set-upstream")
	}

	// Always include SSH env so git@ remotes work; merge with any PAT env vars
	env := []string{git.SSHEnvVar()}
	if input.PAT != "" {
		env = append(env, "GIT_ASKPASS=echo", "GIT_TERMINAL_PROMPT=0")
	}
	out, errStr, gitErr := git.RunGitEnv(dir, env, args...)
	if gitErr != nil {
		errJSON(w, 400, "push failed: "+errStr+"\n"+out)
		return
	}
	h.logAudit(repoID, "push", map[string]interface{}{"remote": input.Remote, "branch": input.Branch})
	writeJSON(w, 200, map[string]string{"message": out + "\n" + errStr})
}

func (h *Handler) pullRepo(w http.ResponseWriter, r *http.Request, repoID string) {
	var input struct {
		Remote   string `json:"remote"`
		Branch   string `json:"branch"`
		Rebase   bool   `json:"rebase"`
		PAT      string `json:"pat"`
	}
	readJSON(r, &input)
	if input.Remote == "" {
		input.Remote = "origin"
	}
	dir, err := h.getRepoPath(repoID)
	if err != nil {
		errJSON(w, 404, "not found")
		return
	}
	args := []string{"pull", input.Remote}
	if input.Branch != "" {
		args = append(args, input.Branch)
	}
	if input.Rebase {
		args = append(args, "--rebase")
	}
	out, errStr, gitErr := git.RunGitSSH(dir, args...)
	if gitErr != nil {
		hasConflicts := strings.Contains(out+errStr, "CONFLICT")
		if hasConflicts {
			conflicts, _ := git.GetConflicts(dir)
			writeJSON(w, 409, map[string]interface{}{
				"has_conflicts": true,
				"conflicts":     conflicts,
				"output":        out + "\n" + errStr,
			})
			return
		}
		errJSON(w, 400, "pull failed: "+errStr)
		return
	}
	h.syncCommitsFromGit(repoID, dir, "")
	h.syncBranchesFromGit(repoID, dir)
	h.logAudit(repoID, "pull", map[string]interface{}{"remote": input.Remote})
	writeJSON(w, 200, map[string]string{"message": out})
}

func (h *Handler) fetchRepo(w http.ResponseWriter, r *http.Request, repoID string) {
	var input struct {
		Remote string `json:"remote"`
		Prune  bool   `json:"prune"`
		All    bool   `json:"all"`
	}
	readJSON(r, &input)
	if input.Remote == "" {
		input.Remote = "origin"
	}
	dir, err := h.getRepoPath(repoID)
	if err != nil {
		errJSON(w, 404, "not found")
		return
	}
	args := []string{"fetch"}
	if input.All {
		args = append(args, "--all")
	} else {
		args = append(args, input.Remote)
	}
	if input.Prune {
		args = append(args, "--prune")
	}
	out, errStr, gitErr := git.RunGitSSH(dir, args...)
	if gitErr != nil {
		errJSON(w, 400, "fetch failed: "+errStr)
		return
	}
	h.syncBranchesFromGit(repoID, dir)
	writeJSON(w, 200, map[string]string{"message": out + "\n" + errStr})
}

// ── STATUS/LOG/REFLOG ────────────────────────────────────────────────────────

func (h *Handler) getStatus(w http.ResponseWriter, r *http.Request, repoID string) {
	dir, err := h.getRepoPath(repoID)
	if err != nil {
		errJSON(w, 404, "not found")
		return
	}
	statuses, gitErr := git.GetStatus(dir)
	if gitErr != nil {
		errJSON(w, 500, gitErr.Error())
		return
	}
	if statuses == nil {
		statuses = []git.FileStatus{}
	}
	writeJSON(w, 200, statuses)
}

func (h *Handler) getLogGraph(w http.ResponseWriter, r *http.Request, repoID string) {
	limit := queryInt(r, "limit", 50)
	dir, err := h.getRepoPath(repoID)
	if err != nil {
		errJSON(w, 404, "not found")
		return
	}
	out, gitErr := git.GetGraphLog(dir, limit)
	if gitErr != nil {
		errJSON(w, 500, gitErr.Error())
		return
	}
	writeJSON(w, 200, map[string]string{"graph": out})
}

func (h *Handler) getReflog(w http.ResponseWriter, r *http.Request, repoID string) {
	limit := queryInt(r, "limit", 50)
	dir, err := h.getRepoPath(repoID)
	if err != nil {
		errJSON(w, 404, "not found")
		return
	}
	lines, gitErr := git.GetReflog(dir, limit)
	if gitErr != nil {
		errJSON(w, 500, gitErr.Error())
		return
	}
	if lines == nil {
		lines = []string{}
	}
	writeJSON(w, 200, lines)
}

// ── RESET/RESTORE ────────────────────────────────────────────────────────────

func (h *Handler) resetRepo(w http.ResponseWriter, r *http.Request, repoID string) {
	var input struct {
		Mode string `json:"mode"` // soft | mixed | hard
		Ref  string `json:"ref"`
	}
	readJSON(r, &input)
	if input.Mode == "" {
		input.Mode = "mixed"
	}
	if input.Ref == "" {
		input.Ref = "HEAD"
	}
	dir, err := h.getRepoPath(repoID)
	if err != nil {
		errJSON(w, 404, "not found")
		return
	}
	out, errStr, gitErr := git.RunGit(dir, "reset", "--"+input.Mode, input.Ref)
	if gitErr != nil {
		errJSON(w, 400, "reset failed: "+errStr)
		return
	}
	h.syncCommitsFromGit(repoID, dir, "")
	h.logAudit(repoID, "reset", map[string]interface{}{"mode": input.Mode, "ref": input.Ref})
	writeJSON(w, 200, map[string]string{"message": out})
}

func (h *Handler) restoreFile(w http.ResponseWriter, r *http.Request, repoID string) {
	var input struct {
		Path   string `json:"path"`
		Staged bool   `json:"staged"`
	}
	readJSON(r, &input)
	dir, err := h.getRepoPath(repoID)
	if err != nil {
		errJSON(w, 404, "not found")
		return
	}
	args := []string{"restore"}
	if input.Staged {
		args = append(args, "--staged")
	}
	args = append(args, input.Path)
	_, errStr, gitErr := git.RunGit(dir, args...)
	if gitErr != nil {
		errJSON(w, 400, "restore failed: "+errStr)
		return
	}
	writeJSON(w, 200, map[string]string{"message": "restored " + input.Path})
}

// ── CONFLICTS ────────────────────────────────────────────────────────────────

func (h *Handler) handleConflicts(w http.ResponseWriter, r *http.Request, repoID string, segs []string) {
	dir, err := h.getRepoPath(repoID)
	if err != nil {
		errJSON(w, 404, "not found")
		return
	}
	if r.Method == http.MethodGet {
		conflicts, _ := git.GetConflicts(dir)
		if conflicts == nil {
			conflicts = []models.ConflictFile{}
		}
		writeJSON(w, 200, conflicts)
		return
	}
	// POST = resolve
	var input struct {
		Path    string `json:"path"`
		Content string `json:"content"`
	}
	readJSON(r, &input)
	if err := git.ResolveConflict(dir, input.Path, input.Content); err != nil {
		errJSON(w, 500, err.Error())
		return
	}
	writeJSON(w, 200, map[string]string{"message": "resolved " + input.Path})
}

// ── BLAME ────────────────────────────────────────────────────────────────────

func (h *Handler) blame(w http.ResponseWriter, r *http.Request, repoID string) {
	filePath := r.URL.Query().Get("file")
	ref := r.URL.Query().Get("ref")
	if filePath == "" {
		errJSON(w, 400, "file parameter required")
		return
	}
	dir, err := h.getRepoPath(repoID)
	if err != nil {
		errJSON(w, 404, "not found")
		return
	}
	blame, gitErr := git.GetBlame(dir, filePath, ref)
	if gitErr != nil {
		errJSON(w, 500, gitErr.Error())
		return
	}
	if blame == nil {
		blame = []git.BlameInfo{}
	}
	writeJSON(w, 200, blame)
}

// ── BISECT ───────────────────────────────────────────────────────────────────

func (h *Handler) bisect(w http.ResponseWriter, r *http.Request, repoID string) {
	var input struct {
		Action string `json:"action"` // start | good | bad | reset | skip
		Good   string `json:"good"`
		Bad    string `json:"bad"`
	}
	readJSON(r, &input)
	dir, err := h.getRepoPath(repoID)
	if err != nil {
		errJSON(w, 404, "not found")
		return
	}
	var out string
	switch input.Action {
	case "start":
		out, err = git.BisectStart(dir, input.Good, input.Bad)
	case "good":
		o, _, e := git.RunGit(dir, "bisect", "good")
		out, err = o, e
	case "bad":
		o, _, e := git.RunGit(dir, "bisect", "bad")
		out, err = o, e
	case "skip":
		o, _, e := git.RunGit(dir, "bisect", "skip")
		out, err = o, e
	case "reset":
		o, _, e := git.RunGit(dir, "bisect", "reset")
		out, err = o, e
	default:
		errJSON(w, 400, "unknown action")
		return
	}
	if err != nil {
		errJSON(w, 400, out)
		return
	}
	writeJSON(w, 200, map[string]string{"output": out})
}

// ── STASHES ──────────────────────────────────────────────────────────────────

func (h *Handler) handleStashes(w http.ResponseWriter, r *http.Request, repoID string, segs []string) {
	if len(segs) == 0 {
		switch r.Method {
		case http.MethodGet:
			h.listStashes(w, r, repoID)
		case http.MethodPost:
			h.createStash(w, r, repoID)
		}
		return
	}
	stashID := segs[0]
	if len(segs) >= 2 {
		switch segs[1] {
		case "apply":
			h.applyStash(w, r, repoID, stashID, false)
		case "pop":
			h.applyStash(w, r, repoID, stashID, true)
		case "drop":
			h.dropStash(w, r, repoID, stashID)
		}
	} else if r.Method == http.MethodDelete {
		h.dropStash(w, r, repoID, stashID)
	}
}

func (h *Handler) listStashes(w http.ResponseWriter, r *http.Request, repoID string) {
	// Sync from git
	dir, _ := h.getRepoPath(repoID)
	if dir != "" {
		if isGitRepo(dir) {
			out, _, _ := git.RunGit(dir, "stash", "list", "--format=%H|%s|%ai")
			h.db.Exec(`DELETE FROM stashes WHERE repo_id=$1`, repoID)
			for _, line := range strings.Split(out, "\n") {
				if line == "" {
					continue
				}
				parts := strings.SplitN(line, "|", 3)
				msg := ""
				if len(parts) > 1 {
					msg = parts[1]
				}
				h.db.Exec(`INSERT INTO stashes (repo_id,message) VALUES ($1,$2)`, repoID, msg)
			}
		}
	}

	rows, err := h.db.Query(
		`SELECT id,repo_id,message,author,branch_name,created_at FROM stashes WHERE repo_id=$1 ORDER BY created_at DESC`,
		repoID)
	if err != nil {
		errJSON(w, 500, err.Error())
		return
	}
	defer rows.Close()
	var stashes []models.Stash
	for rows.Next() {
		var s models.Stash
		rows.Scan(&s.ID, &s.RepoID, &s.Message, &s.Author, &s.BranchName, &s.CreatedAt)
		stashes = append(stashes, s)
	}
	if stashes == nil {
		stashes = []models.Stash{}
	}
	writeJSON(w, 200, stashes)
}

func (h *Handler) createStash(w http.ResponseWriter, r *http.Request, repoID string) {
	var input struct {
		Message      string `json:"message"`
		IncludeUntracked bool `json:"include_untracked"`
	}
	readJSON(r, &input)
	dir, err := h.getRepoPath(repoID)
	if err != nil {
		errJSON(w, 404, "not found")
		return
	}
	args := []string{"stash", "push"}
	if input.Message != "" {
		args = append(args, "-m", input.Message)
	}
	if input.IncludeUntracked {
		args = append(args, "-u")
	}
	out, errStr, gitErr := git.RunGit(dir, args...)
	if gitErr != nil {
		errJSON(w, 400, "stash failed: "+errStr)
		return
	}
	msg := input.Message
	if msg == "" {
		msg = strings.TrimPrefix(out, "Saved working directory and index state ")
	}
	var s models.Stash
	h.db.QueryRow(
		`INSERT INTO stashes (repo_id,message) VALUES ($1,$2) RETURNING id,repo_id,message,author,branch_name,created_at`,
		repoID, msg).Scan(&s.ID, &s.RepoID, &s.Message, &s.Author, &s.BranchName, &s.CreatedAt)
	h.logAudit(repoID, "stash.create", map[string]interface{}{"message": msg})
	writeJSON(w, 201, s)
}

func (h *Handler) applyStash(w http.ResponseWriter, r *http.Request, repoID, stashID string, pop bool) {
	dir, err := h.getRepoPath(repoID)
	if err != nil {
		errJSON(w, 404, "not found")
		return
	}
	out, applyErr := git.ApplyStash(dir, pop)
	if applyErr != nil {
		errJSON(w, 400, out)
		return
	}
	if pop {
		h.db.Exec(`DELETE FROM stashes WHERE id=$1`, stashID)
	}
	writeJSON(w, 200, map[string]string{"message": out})
}

func (h *Handler) dropStash(w http.ResponseWriter, r *http.Request, repoID, stashID string) {
	dir, _ := h.getRepoPath(repoID)
	if dir != "" {
		git.RunGit(dir, "stash", "drop")
	}
	h.db.Exec(`DELETE FROM stashes WHERE id=$1`, stashID)
	w.WriteHeader(204)
}

// ── TAGS ─────────────────────────────────────────────────────────────────────

func (h *Handler) handleTags(w http.ResponseWriter, r *http.Request, repoID string, segs []string) {
	if len(segs) == 0 {
		switch r.Method {
		case http.MethodGet:
			h.listTags(w, r, repoID)
		case http.MethodPost:
			h.createTag(w, r, repoID)
		}
		return
	}
	tagID := segs[0]
	if r.Method == http.MethodDelete {
		h.deleteTag(w, r, repoID, tagID)
	}
}

func (h *Handler) listTags(w http.ResponseWriter, r *http.Request, repoID string) {
	dir, _ := h.getRepoPath(repoID)
	if dir != "" {
		if isGitRepo(dir) {
			out, _, _ := git.RunGit(dir, "tag", "-l", "--sort=-version:refname", "--format=%(refname:short)|%(objecttype)|%(subject)|%(objectname:short)")
			for _, line := range strings.Split(out, "\n") {
				if line == "" {
					continue
				}
				parts := strings.SplitN(line, "|", 4)
				name := parts[0]
				isAnnotated := len(parts) > 1 && parts[1] == "tag"
				msg := ""
				if len(parts) > 2 {
					msg = parts[2]
				}
				h.db.Exec(
					`INSERT INTO tags (repo_id,name,is_annotated,message) VALUES ($1,$2,$3,NULLIF($4,''))
					 ON CONFLICT (repo_id,name) DO UPDATE SET is_annotated=EXCLUDED.is_annotated`,
					repoID, name, isAnnotated, msg)
			}
		}
	}
	rows, err := h.db.Query(
		`SELECT id,repo_id,name,commit_hash,message,is_annotated,created_at FROM tags WHERE repo_id=$1 ORDER BY created_at DESC`,
		repoID)
	if err != nil {
		errJSON(w, 500, err.Error())
		return
	}
	defer rows.Close()
	var tags []models.Tag
	for rows.Next() {
		var t models.Tag
		rows.Scan(&t.ID, &t.RepoID, &t.Name, &t.CommitHash, &t.Message, &t.IsAnnotated, &t.CreatedAt)
		tags = append(tags, t)
	}
	if tags == nil {
		tags = []models.Tag{}
	}
	writeJSON(w, 200, tags)
}

func (h *Handler) createTag(w http.ResponseWriter, r *http.Request, repoID string) {
	var input struct {
		Name       string `json:"name"`
		CommitHash string `json:"commit_hash"`
		Message    string `json:"message"`
		Push       bool   `json:"push"`
	}
	if err := readJSON(r, &input); err != nil || input.Name == "" {
		errJSON(w, 400, "name required")
		return
	}
	dir, _ := h.getRepoPath(repoID)
	if dir != "" {
		if isGitRepo(dir) {
			args := []string{"tag"}
			if input.Message != "" {
				args = append(args, "-a", input.Name, "-m", input.Message)
			} else {
				args = append(args, input.Name)
			}
			if input.CommitHash != "" {
				args = append(args, input.CommitHash)
			}
			_, errStr, gitErr := git.RunGit(dir, args...)
			if gitErr != nil {
				errJSON(w, 400, "tag failed: "+errStr)
				return
			}
			if input.Push {
				git.RunGit(dir, "push", "origin", input.Name)
			}
		}
	}
	var t models.Tag
	h.db.QueryRow(
		`INSERT INTO tags (repo_id,name,commit_hash,message,is_annotated) VALUES ($1,$2,NULLIF($3,''),NULLIF($4,''),$5)
		 RETURNING id,repo_id,name,commit_hash,message,is_annotated,created_at`,
		repoID, input.Name, input.CommitHash, input.Message, input.Message != "",
	).Scan(&t.ID, &t.RepoID, &t.Name, &t.CommitHash, &t.Message, &t.IsAnnotated, &t.CreatedAt)
	h.logAudit(repoID, "tag.create", map[string]interface{}{"name": input.Name})
	writeJSON(w, 201, t)
}

func (h *Handler) deleteTag(w http.ResponseWriter, r *http.Request, repoID, tagID string) {
	var name string
	h.db.QueryRow(`SELECT name FROM tags WHERE id=$1`, tagID).Scan(&name)
	dir, _ := h.getRepoPath(repoID)
	if dir != "" {
		git.RunGit(dir, "tag", "-d", name)
		if r.URL.Query().Get("remote") == "true" {
			git.RunGit(dir, "push", "origin", "--delete", name)
		}
	}
	h.db.Exec(`DELETE FROM tags WHERE id=$1`, tagID)
	w.WriteHeader(204)
}

// ── PULL REQUESTS ────────────────────────────────────────────────────────────

func (h *Handler) handlePRs(w http.ResponseWriter, r *http.Request, repoID string, segs []string) {
	if len(segs) == 0 {
		switch r.Method {
		case http.MethodGet:
			h.listPRs(w, r, repoID)
		case http.MethodPost:
			h.createPR(w, r, repoID)
		}
		return
	}
	prID := segs[0]
	if len(segs) >= 2 && segs[1] == "merge" {
		h.mergePR(w, r, repoID, prID)
		return
	}
	switch r.Method {
	case http.MethodGet:
		h.getPR(w, r, repoID, prID)
	case http.MethodPut:
		h.updatePR(w, r, repoID, prID)
	case http.MethodDelete:
		h.closePR(w, r, repoID, prID)
	}
}

func (h *Handler) listPRs(w http.ResponseWriter, r *http.Request, repoID string) {
	status := r.URL.Query().Get("status")
	args := []interface{}{repoID}
	cond := "repo_id=$1"
	if status != "" {
		cond += " AND status=$2"
		args = append(args, status)
	}
	rows, err := h.db.Query(
		`SELECT id,repo_id,title,description,source_branch,target_branch,status,author,reviewers,has_conflicts,github_pr_url,created_at,updated_at,merged_at
		 FROM pull_requests WHERE `+cond+` ORDER BY created_at DESC`, args...)
	if err != nil {
		errJSON(w, 500, err.Error())
		return
	}
	defer rows.Close()
	var prs []models.PullRequest
	for rows.Next() {
		var pr models.PullRequest
		var reviewersJSON string
		rows.Scan(&pr.ID, &pr.RepoID, &pr.Title, &pr.Description, &pr.SourceBranch, &pr.TargetBranch,
			&pr.Status, &pr.Author, &reviewersJSON, &pr.HasConflicts, &pr.GithubPRURL,
			&pr.CreatedAt, &pr.UpdatedAt, &pr.MergedAt)
		json.Unmarshal([]byte(reviewersJSON), &pr.Reviewers)
		prs = append(prs, pr)
	}
	if prs == nil {
		prs = []models.PullRequest{}
	}
	writeJSON(w, 200, prs)
}

func (h *Handler) createPR(w http.ResponseWriter, r *http.Request, repoID string) {
	var input struct {
		Title        string   `json:"title"`
		Description  string   `json:"description"`
		SourceBranch string   `json:"source_branch"`
		TargetBranch string   `json:"target_branch"`
		Author       string   `json:"author"`
		Reviewers    []string `json:"reviewers"`
	}
	if err := readJSON(r, &input); err != nil || input.Title == "" || input.SourceBranch == "" {
		errJSON(w, 400, "title and source_branch required")
		return
	}
	if input.TargetBranch == "" {
		input.TargetBranch = "main"
	}
	reviewersJSON, _ := json.Marshal(input.Reviewers)

	// Check for merge conflicts by doing a dry-run merge
	hasConflicts := false
	dir, _ := h.getRepoPath(repoID)
	if dir != "" {
		if isGitRepo(dir) {
			// Use merge-tree to check conflicts without modifying working tree
			out, _, _ := git.RunGit(dir, "merge-tree", "HEAD", input.SourceBranch)
			if strings.Contains(out, "<<<<<") {
				hasConflicts = true
			}
		}
	}

	var pr models.PullRequest
	var reviewersStr string
	err := h.db.QueryRow(
		`INSERT INTO pull_requests (repo_id,title,description,source_branch,target_branch,author,reviewers,has_conflicts)
		 VALUES ($1,$2,NULLIF($3,''),$4,$5,NULLIF($6,''),$7,$8)
		 RETURNING id,repo_id,title,description,source_branch,target_branch,status,author,reviewers,has_conflicts,github_pr_url,created_at,updated_at,merged_at`,
		repoID, input.Title, input.Description, input.SourceBranch, input.TargetBranch,
		input.Author, string(reviewersJSON), hasConflicts,
	).Scan(&pr.ID, &pr.RepoID, &pr.Title, &pr.Description, &pr.SourceBranch, &pr.TargetBranch,
		&pr.Status, &pr.Author, &reviewersStr, &pr.HasConflicts, &pr.GithubPRURL,
		&pr.CreatedAt, &pr.UpdatedAt, &pr.MergedAt)
	if err != nil {
		errJSON(w, 500, err.Error())
		return
	}
	json.Unmarshal([]byte(reviewersStr), &pr.Reviewers)
	h.logAudit(repoID, "pr.create", map[string]interface{}{"title": pr.Title})
	h.emit("pr.created", pr)
	writeJSON(w, 201, pr)
}

func (h *Handler) getPR(w http.ResponseWriter, r *http.Request, repoID, prID string) {
	var pr models.PullRequest
	var reviewersStr string
	err := h.db.QueryRow(
		`SELECT id,repo_id,title,description,source_branch,target_branch,status,author,reviewers,has_conflicts,github_pr_url,created_at,updated_at,merged_at
		 FROM pull_requests WHERE id=$1 AND repo_id=$2`, prID, repoID,
	).Scan(&pr.ID, &pr.RepoID, &pr.Title, &pr.Description, &pr.SourceBranch, &pr.TargetBranch,
		&pr.Status, &pr.Author, &reviewersStr, &pr.HasConflicts, &pr.GithubPRURL,
		&pr.CreatedAt, &pr.UpdatedAt, &pr.MergedAt)
	if err != nil {
		errJSON(w, 404, "PR not found")
		return
	}
	json.Unmarshal([]byte(reviewersStr), &pr.Reviewers)
	writeJSON(w, 200, pr)
}

func (h *Handler) updatePR(w http.ResponseWriter, r *http.Request, repoID, prID string) {
	var input struct {
		Status    string `json:"status"`
		Reviewers []string `json:"reviewers"`
	}
	readJSON(r, &input)
	rev, _ := json.Marshal(input.Reviewers)
	h.db.Exec(`UPDATE pull_requests SET status=COALESCE(NULLIF($1,''),status), reviewers=$2, updated_at=NOW() WHERE id=$3`,
		input.Status, string(rev), prID)
	h.getPR(w, r, repoID, prID)
}

func (h *Handler) mergePR(w http.ResponseWriter, r *http.Request, repoID, prID string) {
	var pr models.PullRequest
	var reviewersStr string
	h.db.QueryRow(
		`SELECT id,repo_id,title,description,source_branch,target_branch,status,author,reviewers,has_conflicts,github_pr_url,created_at,updated_at,merged_at
		 FROM pull_requests WHERE id=$1`, prID,
	).Scan(&pr.ID, &pr.RepoID, &pr.Title, &pr.Description, &pr.SourceBranch, &pr.TargetBranch,
		&pr.Status, &pr.Author, &reviewersStr, &pr.HasConflicts, &pr.GithubPRURL,
		&pr.CreatedAt, &pr.UpdatedAt, &pr.MergedAt)

	var input struct {
		Strategy string `json:"strategy"`
	}
	readJSON(r, &input)

	dir, _ := h.getRepoPath(repoID)
	if dir != "" {
		if isGitRepo(dir) {
			git.RunGit(dir, "checkout", pr.TargetBranch)
			out, hasConflicts, err := git.Merge(dir, pr.SourceBranch, input.Strategy)
			if hasConflicts {
				h.db.Exec(`UPDATE pull_requests SET has_conflicts=true WHERE id=$1`, prID)
				conflicts, _ := git.GetConflicts(dir)
				writeJSON(w, 409, map[string]interface{}{
					"has_conflicts": true,
					"conflicts":     conflicts,
					"output":        out,
				})
				return
			}
			if err != nil {
				errJSON(w, 400, out)
				return
			}
		}
	}

	now := time.Now()
	h.db.Exec(`UPDATE pull_requests SET status='merged',merged_at=$1,updated_at=NOW() WHERE id=$2`, now, prID)
	h.logAudit(repoID, "pr.merge", map[string]interface{}{"pr_id": prID, "source": pr.SourceBranch})
	h.emit("pr.merged", map[string]string{"id": prID})
	writeJSON(w, 200, map[string]string{"message": "PR merged"})
}

func (h *Handler) closePR(w http.ResponseWriter, r *http.Request, repoID, prID string) {
	h.db.Exec(`UPDATE pull_requests SET status='closed',updated_at=NOW() WHERE id=$1`, prID)
	h.logAudit(repoID, "pr.close", map[string]interface{}{"pr_id": prID})
	w.WriteHeader(204)
}

// ── SSH KEYS ─────────────────────────────────────────────────────────────────

func (h *Handler) sshKeys(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		rows, _ := h.db.Query(`SELECT id,name,public_key,fingerprint,is_active,created_at FROM ssh_keys ORDER BY created_at DESC`)
		defer rows.Close()
		var keys []models.SSHKey
		for rows.Next() {
			var k models.SSHKey
			rows.Scan(&k.ID, &k.Name, &k.PublicKey, &k.Fingerprint, &k.IsActive, &k.CreatedAt)
			keys = append(keys, k)
		}
		if keys == nil {
			keys = []models.SSHKey{}
		}
		writeJSON(w, 200, keys)
	case http.MethodPost:
		var input struct {
			Name      string `json:"name"`
			PublicKey string `json:"public_key"`
		}
		if err := readJSON(r, &input); err != nil || input.Name == "" || input.PublicKey == "" {
			errJSON(w, 400, "name and public_key required")
			return
		}
		var k models.SSHKey
		h.db.QueryRow(
			`INSERT INTO ssh_keys (name,public_key) VALUES ($1,$2) RETURNING id,name,public_key,fingerprint,is_active,created_at`,
			input.Name, input.PublicKey,
		).Scan(&k.ID, &k.Name, &k.PublicKey, &k.Fingerprint, &k.IsActive, &k.CreatedAt)
		h.logAudit("", "ssh.add", map[string]interface{}{"name": k.Name})
		writeJSON(w, 201, k)
	}
}

// ── GIT CONFIG ───────────────────────────────────────────────────────────────

func (h *Handler) handleGitConfig(w http.ResponseWriter, r *http.Request, repoID string) {
	dir, err := h.getRepoPath(repoID)
	if err != nil {
		errJSON(w, 404, "not found")
		return
	}
	if r.Method == http.MethodGet {
		name, _, _ := git.RunGit(dir, "config", "user.name")
		email, _, _ := git.RunGit(dir, "config", "user.email")
		writeJSON(w, 200, map[string]string{"user_name": name, "user_email": email})
		return
	}
	var input models.GitConfig
	readJSON(r, &input)
	if input.UserName != "" {
		git.RunGit(dir, "config", "user.name", input.UserName)
	}
	if input.UserEmail != "" {
		git.RunGit(dir, "config", "user.email", input.UserEmail)
	}
	writeJSON(w, 200, map[string]string{"message": "config updated"})
}

// ── GLOBAL CONFIG / PAT ──────────────────────────────────────────────────────

func (h *Handler) globalConfig(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodGet {
		name, _, _ := git.RunGit("/", "config", "--global", "user.name")
		email, _, _ := git.RunGit("/", "config", "--global", "user.email")
		writeJSON(w, 200, map[string]string{"user_name": name, "user_email": email})
		return
	}
	var input models.GitConfig
	readJSON(r, &input)
	if input.UserName != "" {
		git.RunGit("/", "config", "--global", "user.name", input.UserName)
	}
	if input.UserEmail != "" {
		git.RunGit("/", "config", "--global", "user.email", input.UserEmail)
	}
	if input.PAT != "" {
		// Store PAT in credential helper
		git.RunGit("/", "config", "--global", "credential.helper", "store")
		h.db.Exec(`INSERT INTO app_config (key,value) VALUES ('github_pat',$1) ON CONFLICT (key) DO UPDATE SET value=$1`, input.PAT)
	}
	writeJSON(w, 200, map[string]string{"message": "global config updated"})
}

// ── REMOTES ──────────────────────────────────────────────────────────────────

func (h *Handler) handleRemotes(w http.ResponseWriter, r *http.Request, repoID string) {
	dir, err := h.getRepoPath(repoID)
	if err != nil {
		errJSON(w, 404, "not found")
		return
	}
	if r.Method == http.MethodGet {
		remotes, _ := git.GetRemotes(dir)
		if remotes == nil {
			remotes = []git.RemoteInfo{}
		}
		writeJSON(w, 200, remotes)
		return
	}
	// POST = add remote
	var input struct {
		Name string `json:"name"`
		URL  string `json:"url"`
	}
	readJSON(r, &input)
	_, errStr, gitErr := git.RunGit(dir, "remote", "add", input.Name, input.URL)
	if gitErr != nil {
		errJSON(w, 400, errStr)
		return
	}
	writeJSON(w, 201, map[string]string{"message": "remote added"})
}

// ── FILES ────────────────────────────────────────────────────────────────────

func (h *Handler) handleFiles(w http.ResponseWriter, r *http.Request, repoID string, segs []string) {
	dir, err := h.getRepoPath(repoID)
	if err != nil {
		errJSON(w, 404, "not found")
		return
	}
	ref := r.URL.Query().Get("ref")
	if ref == "" {
		ref = "HEAD"
	}
	if len(segs) == 0 {
		files, _ := git.GetFileTree(dir, ref)
		if files == nil {
			files = []git.FileEntry{}
		}
		writeJSON(w, 200, files)
		return
	}
	// Get file content
	path := strings.Join(segs, "/")
	content, err := git.GetFileContent(dir, ref, path)
	if err != nil {
		errJSON(w, 404, "file not found")
		return
	}
	writeJSON(w, 200, map[string]string{"path": path, "content": content})
}

// ── SUBMODULES ───────────────────────────────────────────────────────────────

func (h *Handler) handleSubmodules(w http.ResponseWriter, r *http.Request, repoID string) {
	dir, err := h.getRepoPath(repoID)
	if err != nil {
		errJSON(w, 404, "not found")
		return
	}
	if r.Method == http.MethodGet {
		mods, _ := git.SubmoduleList(dir)
		if mods == nil {
			mods = []string{}
		}
		writeJSON(w, 200, mods)
		return
	}
	var input struct {
		Action string `json:"action"` // add | update | init
		URL    string `json:"url"`
		Path   string `json:"path"`
	}
	readJSON(r, &input)
	var out, errStr string
	var gitErr error
	switch input.Action {
	case "add":
		_, errStr, gitErr = git.RunGit(dir, "submodule", "add", input.URL, input.Path)
	case "update":
		_, errStr, gitErr = git.RunGit(dir, "submodule", "update", "--init", "--recursive")
	case "init":
		_, errStr, gitErr = git.RunGit(dir, "submodule", "init")
	}
	if gitErr != nil {
		errJSON(w, 400, out+"\n"+errStr)
		return
	}
	writeJSON(w, 200, map[string]string{"message": "done"})
}

// ── SYNC (refresh from real git) ─────────────────────────────────────────────

func (h *Handler) syncRepo(w http.ResponseWriter, r *http.Request, repoID string) {
	dir, err := h.getRepoPath(repoID)
	if err != nil {
		errJSON(w, 404, "not found")
		return
	}
	if !isGitRepo(dir) {
		// Give a useful error message showing the translated path
		errJSON(w, 400, fmt.Sprintf("not a git repository at %s — check that your home directory is mounted in docker-compose.yml as /host-home", dir))
		return
	}
	h.db.Exec(`UPDATE repositories SET is_initialized=true, updated_at=NOW() WHERE id=$1`, repoID)

	// Sync branches and surface any errors
	branches, branchErr := git.GetBranches(dir)
	if branchErr != nil {
		errJSON(w, 500, "git branch failed: "+branchErr.Error())
		return
	}
	for _, b := range branches {
		name := strings.TrimPrefix(b.Name, "remotes/")
		h.db.Exec(
			`INSERT INTO branches (repo_id,name,is_remote,last_commit_hash,last_commit_message,last_commit_author)
			 VALUES ($1,$2,$3,NULLIF($4,''),NULLIF($5,''),NULLIF($6,''))
			 ON CONFLICT (repo_id,name) DO UPDATE SET last_commit_hash=EXCLUDED.last_commit_hash,last_commit_message=EXCLUDED.last_commit_message`,
			repoID, name, b.IsRemote, b.LastHash, b.LastMessage, b.LastAuthor)
	}

	commits, commitErr := git.GetCommits(dir, "", 200, 0)
	if commitErr != nil {
		// Non-fatal — empty repo is fine
		commits = nil
	}
	for _, c := range commits {
		h.db.Exec(
			`INSERT INTO commits (repo_id,hash,short_hash,message,author_name,author_email,branch_name,parent_hash,files_changed,insertions,deletions,committed_at)
			 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
			 ON CONFLICT (repo_id,hash) DO NOTHING`,
			repoID, c.Hash, c.ShortHash, c.Message,
			sql.NullString{String: c.AuthorName, Valid: c.AuthorName != ""},
			sql.NullString{String: c.AuthorEmail, Valid: c.AuthorEmail != ""},
			"", sql.NullString{String: c.ParentHash, Valid: c.ParentHash != ""},
			c.FilesChanged, c.Insertions, c.Deletions, c.CommittedAt)
	}

	h.emit("repo.synced", map[string]string{"id": repoID})
	writeJSON(w, 200, map[string]interface{}{
		"message":  "synced",
		"branches": len(branches),
		"commits":  len(commits),
		"path":     dir,
	})
}

// ── SCHEMA / DB EXPLORER ─────────────────────────────────────────────────────

func (h *Handler) schema(w http.ResponseWriter, r *http.Request) {
	rows, err := h.db.Query(`
		SELECT t.table_name,
		       c.column_name,
		       c.data_type,
		       c.is_nullable,
		       (SELECT COUNT(*) FROM information_schema.columns c2 WHERE c2.table_name=t.table_name AND c2.table_schema='public')
		FROM information_schema.tables t
		JOIN information_schema.columns c ON c.table_name=t.table_name AND c.table_schema='public'
		WHERE t.table_schema='public' AND t.table_type='BASE TABLE'
		ORDER BY t.table_name,c.ordinal_position`)
	if err != nil {
		errJSON(w, 500, err.Error())
		return
	}
	defer rows.Close()

	tableMap := map[string]*models.TableSchema{}
	var tableOrder []string
	for rows.Next() {
		var tname, cname, dtype, nullable string
		var _ int
	var blankCol int
		rows.Scan(&tname, &cname, &dtype, &nullable, &blankCol)
		if _, ok := tableMap[tname]; !ok {
			tableMap[tname] = &models.TableSchema{TableName: tname}
			tableOrder = append(tableOrder, tname)
		}
		tableMap[tname].Columns = append(tableMap[tname].Columns, models.ColumnInfo{
			Name: cname, DataType: dtype, Nullable: nullable,
		})
	}

	// Get row counts
	for name, ts := range tableMap {
		h.db.QueryRow(fmt.Sprintf(`SELECT COUNT(*) FROM %q`, name)).Scan(&ts.RowCount)
	}

	var result []models.TableSchema
	for _, name := range tableOrder {
		result = append(result, *tableMap[name])
	}
	if result == nil {
		result = []models.TableSchema{}
	}
	writeJSON(w, 200, result)
}

func (h *Handler) tableData(w http.ResponseWriter, r *http.Request) {
	table := r.URL.Query().Get("table")
	if table == "" {
		errJSON(w, 400, "table required")
		return
	}
	page := queryInt(r, "page", 1)
	pageSize := queryInt(r, "page_size", 20)
	search := r.URL.Query().Get("search")
	offset := (page - 1) * pageSize

	// Safety: only allow known tables
	allowed := map[string]bool{
		"repositories": true, "branches": true, "commits": true,
		"pull_requests": true, "ssh_keys": true, "stashes": true,
		"tags": true, "audit_log": true, "app_config": true,
	}
	if !allowed[table] {
		errJSON(w, 400, "unknown table")
		return
	}

	var total int64
	h.db.QueryRow(fmt.Sprintf(`SELECT COUNT(*) FROM %q`, table)).Scan(&total)

	var rows *sql.Rows
	var err error
	if search != "" {
		// Cast all columns to text for search
		rows, err = h.db.Query(fmt.Sprintf(
			`SELECT * FROM %q WHERE CAST(to_json(%q.*) AS text) ILIKE $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
			table, table), "%"+search+"%", pageSize, offset)
	} else {
		rows, err = h.db.Query(fmt.Sprintf(`SELECT * FROM %q ORDER BY created_at DESC LIMIT $1 OFFSET $2`, table), pageSize, offset)
	}
	if err != nil {
		errJSON(w, 500, err.Error())
		return
	}
	defer rows.Close()

	cols, _ := rows.Columns()
	var data []map[string]interface{}
	for rows.Next() {
		vals := make([]interface{}, len(cols))
		ptrs := make([]interface{}, len(cols))
		for i := range vals {
			ptrs[i] = &vals[i]
		}
		rows.Scan(ptrs...)
		row := map[string]interface{}{}
		for i, col := range cols {
			v := vals[i]
			if b, ok := v.([]byte); ok {
				v = string(b)
			}
			row[col] = v
		}
		data = append(data, row)
	}
	if data == nil {
		data = []map[string]interface{}{}
	}
	writeJSON(w, 200, models.PaginatedResult{
		Data:       data,
		Total:      total,
		Page:       page,
		PageSize:   pageSize,
		TotalPages: int(math.Ceil(float64(total) / float64(pageSize))),
	})
}

func (h *Handler) exportCSV(w http.ResponseWriter, r *http.Request) {
	table := r.URL.Query().Get("table")
	allowed := map[string]bool{
		"repositories": true, "branches": true, "commits": true,
		"pull_requests": true, "ssh_keys": true, "stashes": true,
		"tags": true, "audit_log": true,
	}
	if !allowed[table] {
		errJSON(w, 400, "unknown table")
		return
	}
	rows, err := h.db.Query(fmt.Sprintf(`SELECT * FROM %q ORDER BY created_at DESC`, table))
	if err != nil {
		errJSON(w, 500, err.Error())
		return
	}
	defer rows.Close()
	cols, _ := rows.Columns()
	w.Header().Set("Content-Type", "text/csv")
	w.Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename=%s.csv", table))
	cw := csv.NewWriter(w)
	cw.Write(cols)
	for rows.Next() {
		vals := make([]interface{}, len(cols))
		ptrs := make([]interface{}, len(cols))
		for i := range vals {
			ptrs[i] = &vals[i]
		}
		rows.Scan(ptrs...)
		strs := make([]string, len(cols))
		for i, v := range vals {
			if b, ok := v.([]byte); ok {
				strs[i] = string(b)
			} else if v == nil {
				strs[i] = ""
			} else {
				strs[i] = fmt.Sprintf("%v", v)
			}
		}
		cw.Write(strs)
	}
	cw.Flush()
}

func (h *Handler) importCSV(w http.ResponseWriter, r *http.Request) {
	// Parse multipart form
	r.ParseMultipartForm(10 << 20)
	file, _, err := r.FormFile("file")
	if err != nil {
		errJSON(w, 400, "file required")
		return
	}
	defer file.Close()
	table := r.FormValue("table")
	if table == "" {
		errJSON(w, 400, "table required")
		return
	}
	writeJSON(w, 200, map[string]string{"message": "CSV import is read-only preview only"})
}

// ── AUDIT ────────────────────────────────────────────────────────────────────

func (h *Handler) audit(w http.ResponseWriter, r *http.Request) {
	page := queryInt(r, "page", 1)
	pageSize := queryInt(r, "page_size", 20)
	offset := (page - 1) * pageSize
	var total int64
	h.db.QueryRow(`SELECT COUNT(*) FROM audit_log`).Scan(&total)
	rows, err := h.db.Query(`SELECT id,repo_id,action,details,created_at FROM audit_log ORDER BY created_at DESC LIMIT $1 OFFSET $2`, pageSize, offset)
	if err != nil {
		errJSON(w, 500, err.Error())
		return
	}
	defer rows.Close()
	var logs []models.AuditLog
	for rows.Next() {
		var l models.AuditLog
		rows.Scan(&l.ID, &l.RepoID, &l.Action, &l.Details, &l.CreatedAt)
		logs = append(logs, l)
	}
	if logs == nil {
		logs = []models.AuditLog{}
	}
	writeJSON(w, 200, models.PaginatedResult{
		Data:       logs,
		Total:      total,
		Page:       page,
		PageSize:   pageSize,
		TotalPages: int(math.Ceil(float64(total) / float64(pageSize))),
	})
}

// ── SEARCH ───────────────────────────────────────────────────────────────────

func (h *Handler) search(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query().Get("q")
	if q == "" {
		writeJSON(w, 200, []interface{}{})
		return
	}
	pattern := "%" + q + "%"
	type result struct {
		Type     string `json:"type"`
		ID       string `json:"id"`
		Title    string `json:"title"`
		Subtitle string `json:"subtitle"`
		RepoID   string `json:"repo_id"`
		RepoName string `json:"repo_name"`
		URL      *string `json:"url"`
	}
	var results []result

	// Search repos
	rows, _ := h.db.Query(`SELECT id,name,COALESCE(description,''),COALESCE(github_url,'') FROM repositories WHERE name ILIKE $1 OR COALESCE(description,'') ILIKE $1 LIMIT 5`, pattern)
	for rows.Next() {
		var r result
		var url string
		rows.Scan(&r.ID, &r.Title, &r.Subtitle, &url)
		r.Type = "repository"
		r.RepoID = r.ID
		r.RepoName = r.Title
		if url != "" {
			r.URL = &url
		}
		results = append(results, r)
	}
	rows.Close()

	// Search commits
	rows, _ = h.db.Query(`SELECT c.id,c.hash,c.message,c.author_name,c.repo_id,r.name FROM commits c JOIN repositories r ON r.id=c.repo_id WHERE c.message ILIKE $1 OR c.short_hash ILIKE $1 LIMIT 5`, pattern)
	for rows.Next() {
		var r result
		rows.Scan(&r.ID, &r.Subtitle, &r.Title, &r.Subtitle, &r.RepoID, &r.RepoName)
		r.Type = "commit"
		results = append(results, r)
	}
	rows.Close()

	// Search branches
	rows, _ = h.db.Query(`SELECT b.id,b.name,b.last_commit_message,b.repo_id,r.name FROM branches b JOIN repositories r ON r.id=b.repo_id WHERE b.name ILIKE $1 LIMIT 5`, pattern)
	for rows.Next() {
		var r result
		rows.Scan(&r.ID, &r.Title, &r.Subtitle, &r.RepoID, &r.RepoName)
		r.Type = "branch"
		if r.Subtitle == "" {
			r.Subtitle = "branch"
		}
		results = append(results, r)
	}
	rows.Close()

	if results == nil {
		results = []result{}
	}
	writeJSON(w, 200, results)
}

// ── SSH TEST ─────────────────────────────────────────────────────────────────

// ── SSH CONFIG (active key selection) ────────────────────────────────────────

func (h *Handler) sshConfig(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		var activeKey string
		h.db.QueryRow(`SELECT value FROM app_config WHERE key='ssh_active_key'`).Scan(&activeKey)
		writeJSON(w, 200, map[string]string{"active_key": activeKey})
	case http.MethodPost:
		var input struct {
			ActiveKey string `json:"active_key"`
		}
		if err := readJSON(r, &input); err != nil {
			errJSON(w, 400, "invalid body")
			return
		}
		h.db.Exec(`INSERT INTO app_config (key,value) VALUES ('ssh_active_key',$1)
			ON CONFLICT (key) DO UPDATE SET value=$1, updated_at=NOW()`, input.ActiveKey)
		// Also update the in-process variable so git ops pick it up immediately
		git.ActiveSSHKey = input.ActiveKey
		writeJSON(w, 200, map[string]string{"active_key": input.ActiveKey})
	default:
		errJSON(w, 405, "method not allowed")
	}
}

func (h *Handler) sshTest(w http.ResponseWriter, r *http.Request) {
	host := r.URL.Query().Get("host")
	if host == "" {
		host = "github.com"
	}
	// key param: basename of the private key file (e.g. "id_rsa" or "id_rsa_git")
	selectedKey := r.URL.Query().Get("key")

	// Read public keys from mounted ~/.ssh
	type KeyInfo struct {
		File        string `json:"file"`
		PrivKeyFile string `json:"priv_key_file"` // base name without .pub
		PublicKey   string `json:"public_key"`
		Fingerprint string `json:"fingerprint"`
		Type        string `json:"type"`
	}

	var keys []KeyInfo
	sshDir := "/root/.ssh"
	entries, err := os.ReadDir(sshDir)
	if err == nil {
		for _, e := range entries {
			name := e.Name()
			// Only public keys that have a matching private key
			if !strings.HasSuffix(name, ".pub") {
				continue
			}
			privName := strings.TrimSuffix(name, ".pub")
			// Check private key exists
			if _, serr := os.Stat(sshDir + "/" + privName); serr != nil {
				continue
			}
			pubPath := sshDir + "/" + name
			content, readErr := os.ReadFile(pubPath)
			if readErr != nil {
				continue
			}
			pubStr := strings.TrimSpace(string(content))
			if len(strings.Fields(pubStr)) < 2 {
				continue // not a valid pub key line
			}
			fpOut, _, _ := RunSysCmd("ssh-keygen", "-lf", pubPath)
			ki := KeyInfo{
				File:        name,
				PrivKeyFile: privName,
				PublicKey:   pubStr,
				Type:        strings.Fields(pubStr)[0],
			}
			if fpOut != "" {
				parts := strings.Fields(fpOut)
				if len(parts) >= 2 {
					ki.Fingerprint = parts[1]
				}
			}
			keys = append(keys, ki)
		}
	}

	// Determine which private key to use for this test
	keyToUse := selectedKey
	if keyToUse == "" {
		// Fall back to DB preference
		h.db.QueryRow(`SELECT value FROM app_config WHERE key='ssh_active_key'`).Scan(&keyToUse)
	}
	// Build ssh args
	sshArgs := []string{"-T",
		"-o", "StrictHostKeyChecking=accept-new",
		"-o", "BatchMode=yes",
		"-o", "ConnectTimeout=10",
	}
	if keyToUse != "" {
		sshArgs = append(sshArgs, "-i", sshDir+"/"+keyToUse)
	}
	sshArgs = append(sshArgs, "git@"+host)

	testOut, testErr, _ := RunSysCmd("ssh", sshArgs...)
	connected := strings.Contains(testOut+testErr, "successfully authenticated") ||
		strings.Contains(testOut+testErr, "Hi ") ||
		strings.Contains(testOut+testErr, "Welcome to GitLab")

	writeJSON(w, 200, map[string]interface{}{
		"keys":            keys,
		"ssh_dir":         sshDir,
		"host":            host,
		"active_key":      keyToUse,
		"connected":       connected,
		"test_output":     testOut + testErr,
		"github_keys_url": "https://github.com/settings/keys",
		"gitlab_keys_url": "https://gitlab.com/-/profile/keys",
	})
}

func RunSysCmd(name string, args ...string) (string, string, error) {
	cmd := exec.Command(name, args...)
	var out, errOut bytes.Buffer
	cmd.Stdout = &out
	cmd.Stderr = &errOut
	err := cmd.Run()
	return strings.TrimSpace(out.String()), strings.TrimSpace(errOut.String()), err
}
