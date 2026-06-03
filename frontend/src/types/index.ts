export interface Repository {
  id: string; name: string; path: string;
  remote_url?: string; github_url?: string;
  default_branch: string; description?: string;
  is_initialized: boolean;
  created_at: string; updated_at: string;
}
export interface Branch {
  id: string; repo_id: string; name: string;
  is_protected: boolean; is_remote: boolean;
  upstream?: string;
  last_commit_hash?: string; last_commit_message?: string;
  last_commit_author?: string; last_commit_at?: string;
  created_at: string;
}
export interface Commit {
  id: string; repo_id: string; hash: string; short_hash: string;
  message: string; author_name?: string; author_email?: string;
  branch_name?: string; parent_hash?: string;
  files_changed: number; insertions: number;
  deletions: number; committed_at: string; created_at: string;
}
export interface PullRequest {
  id: string; repo_id: string; title: string; description?: string;
  source_branch: string; target_branch: string; status: string;
  author?: string; reviewers: string[]; has_conflicts: boolean;
  github_pr_url?: string; created_at: string; updated_at: string; merged_at?: string;
}
export interface SSHKey {
  id: string; name: string; public_key: string; fingerprint?: string;
  is_active: boolean; created_at: string;
}
export interface Stash {
  id: string; repo_id: string; message: string; author?: string;
  branch_name?: string; created_at: string;
}
export interface Tag {
  id: string; repo_id: string; name: string; commit_hash?: string;
  message?: string; is_annotated: boolean; created_at: string;
}
export interface DiffLine {
  content: string; type: 'added' | 'removed' | 'context' | 'header';
  line_num_old?: number; line_num_new?: number;
}
export interface DiffFile {
  path: string; old_path: string; lines: DiffLine[];
  additions: number; deletions: number; is_binary: boolean;
}
export interface SearchResult {
  type: string; id: string; title: string; subtitle: string;
  repo_id: string; repo_name: string; url?: string;
}
export interface PaginatedResult<T = unknown> {
  data: T[]; total: number; page: number; page_size: number; total_pages: number;
}
export interface TableSchema {
  table_name: string;
  columns: { name: string; data_type: string; nullable: string }[];
  row_count: number;
}
export interface FileStatus {
  index: string; working: string; path: string;
}
export interface ConflictFile {
  path: string; our_lines: string[]; their_lines: string[]; base_lines: string[]; status: string;
}
export interface BlameInfo {
  hash: string; author: string; email: string; date: string; line_num: number; content: string;
}
export interface RemoteInfo { name: string; url: string; }
