package models

import "time"

type Repository struct {
	ID            string     `json:"id"`
	Name          string     `json:"name"`
	Path          string     `json:"path"`
	RemoteURL     *string    `json:"remote_url"`
	GithubURL     *string    `json:"github_url"`
	DefaultBranch string     `json:"default_branch"`
	Description   *string    `json:"description"`
	IsInitialized bool       `json:"is_initialized"`
	CreatedAt     time.Time  `json:"created_at"`
	UpdatedAt     time.Time  `json:"updated_at"`
}

type Branch struct {
	ID                string     `json:"id"`
	RepoID            string     `json:"repo_id"`
	Name              string     `json:"name"`
	IsProtected       bool       `json:"is_protected"`
	IsRemote          bool       `json:"is_remote"`
	Upstream          *string    `json:"upstream"`
	LastCommitHash    *string    `json:"last_commit_hash"`
	LastCommitMessage *string    `json:"last_commit_message"`
	LastCommitAuthor  *string    `json:"last_commit_author"`
	LastCommitAt      *time.Time `json:"last_commit_at"`
	CreatedAt         time.Time  `json:"created_at"`
}

type Commit struct {
	ID            string    `json:"id"`
	RepoID        string    `json:"repo_id"`
	Hash          string    `json:"hash"`
	ShortHash     string    `json:"short_hash"`
	Message       string    `json:"message"`
	AuthorName    *string   `json:"author_name"`
	AuthorEmail   *string   `json:"author_email"`
	BranchName    *string   `json:"branch_name"`
	ParentHash    *string   `json:"parent_hash"`
	FilesChanged  int       `json:"files_changed"`
	Insertions    int       `json:"insertions"`
	Deletions     int       `json:"deletions"`
	CommittedAt   time.Time `json:"committed_at"`
	CreatedAt     time.Time `json:"created_at"`
}

type PullRequest struct {
	ID           string     `json:"id"`
	RepoID       string     `json:"repo_id"`
	Title        string     `json:"title"`
	Description  *string    `json:"description"`
	SourceBranch string     `json:"source_branch"`
	TargetBranch string     `json:"target_branch"`
	Status       string     `json:"status"`
	Author       *string    `json:"author"`
	Reviewers    []string   `json:"reviewers"`
	HasConflicts bool       `json:"has_conflicts"`
	GithubPRURL  *string    `json:"github_pr_url"`
	CreatedAt    time.Time  `json:"created_at"`
	UpdatedAt    time.Time  `json:"updated_at"`
	MergedAt     *time.Time `json:"merged_at"`
}

type SSHKey struct {
	ID          string    `json:"id"`
	Name        string    `json:"name"`
	PublicKey   string    `json:"public_key"`
	Fingerprint *string   `json:"fingerprint"`
	IsActive    bool      `json:"is_active"`
	CreatedAt   time.Time `json:"created_at"`
}

type Stash struct {
	ID            string    `json:"id"`
	RepoID        string    `json:"repo_id"`
	Message       string    `json:"message"`
	Author        *string   `json:"author"`
	BranchName    *string   `json:"branch_name"`
	FilesSnapshot *string   `json:"files_snapshot"`
	CreatedAt     time.Time `json:"created_at"`
}

type Tag struct {
	ID           string    `json:"id"`
	RepoID       string    `json:"repo_id"`
	Name         string    `json:"name"`
	CommitHash   *string   `json:"commit_hash"`
	Message      *string   `json:"message"`
	IsAnnotated  bool      `json:"is_annotated"`
	CreatedAt    time.Time `json:"created_at"`
}

type AuditLog struct {
	ID        string    `json:"id"`
	RepoID    *string   `json:"repo_id"`
	Action    string    `json:"action"`
	Details   string    `json:"details"`
	CreatedAt time.Time `json:"created_at"`
}

type DiffLine struct {
	Content    string  `json:"content"`
	Type       string  `json:"type"` // added | removed | context | header
	LineNumOld *int    `json:"line_num_old"`
	LineNumNew *int    `json:"line_num_new"`
}

type DiffFile struct {
	Path      string     `json:"path"`
	OldPath   string     `json:"old_path"`
	Lines     []DiffLine `json:"lines"`
	Additions int        `json:"additions"`
	Deletions int        `json:"deletions"`
	IsBinary  bool       `json:"is_binary"`
}

type TableSchema struct {
	TableName   string       `json:"table_name"`
	Columns     []ColumnInfo `json:"columns"`
	RowCount    int64        `json:"row_count"`
}

type ColumnInfo struct {
	Name     string `json:"name"`
	DataType string `json:"data_type"`
	Nullable string `json:"nullable"`
}

type PaginatedResult struct {
	Data       interface{} `json:"data"`
	Total      int64       `json:"total"`
	Page       int         `json:"page"`
	PageSize   int         `json:"page_size"`
	TotalPages int         `json:"total_pages"`
}

type GitOperation struct {
	Command     string   `json:"command"`
	Description string   `json:"description"`
	Args        []string `json:"args"`
}

type ConflictFile struct {
	Path       string   `json:"path"`
	OurLines   []string `json:"our_lines"`
	TheirLines []string `json:"their_lines"`
	BaseLines  []string `json:"base_lines"`
	Status     string   `json:"status"` // conflict | resolved
}

type GitConfig struct {
	UserName  string `json:"user_name"`
	UserEmail string `json:"user_email"`
	PAT       string `json:"pat"`
}
