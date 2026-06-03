-- GitVisual Database Schema v2
-- Full schema for all git operations

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS repositories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    path TEXT NOT NULL UNIQUE,
    remote_url TEXT,
    github_url TEXT,
    default_branch TEXT NOT NULL DEFAULT 'main',
    description TEXT,
    is_initialized BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS branches (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    repo_id UUID NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    is_protected BOOLEAN NOT NULL DEFAULT false,
    is_remote BOOLEAN NOT NULL DEFAULT false,
    upstream TEXT,
    last_commit_hash TEXT,
    last_commit_message TEXT,
    last_commit_author TEXT,
    last_commit_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(repo_id, name)
);

CREATE TABLE IF NOT EXISTS commits (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    repo_id UUID NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
    hash TEXT NOT NULL,
    short_hash TEXT NOT NULL,
    message TEXT NOT NULL DEFAULT '',
    author_name TEXT,
    author_email TEXT,
    branch_name TEXT,
    parent_hash TEXT,
    files_changed INTEGER NOT NULL DEFAULT 0,
    insertions INTEGER NOT NULL DEFAULT 0,
    deletions INTEGER NOT NULL DEFAULT 0,
    committed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(repo_id, hash)
);

CREATE TABLE IF NOT EXISTS pull_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    repo_id UUID NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    description TEXT,
    source_branch TEXT NOT NULL,
    target_branch TEXT NOT NULL DEFAULT 'main',
    status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','merged','closed')),
    author TEXT,
    reviewers JSONB NOT NULL DEFAULT '[]',
    has_conflicts BOOLEAN NOT NULL DEFAULT false,
    github_pr_url TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    merged_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS ssh_keys (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    public_key TEXT NOT NULL,
    fingerprint TEXT,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS stashes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    repo_id UUID NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
    message TEXT NOT NULL DEFAULT 'WIP',
    author TEXT,
    branch_name TEXT,
    files_snapshot TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS tags (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    repo_id UUID NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    commit_hash TEXT,
    message TEXT,
    is_annotated BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(repo_id, name)
);

CREATE TABLE IF NOT EXISTS audit_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    repo_id UUID REFERENCES repositories(id) ON DELETE SET NULL,
    action TEXT NOT NULL,
    details TEXT NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS app_config (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_branches_repo ON branches(repo_id);
CREATE INDEX IF NOT EXISTS idx_commits_repo ON commits(repo_id);
CREATE INDEX IF NOT EXISTS idx_commits_hash ON commits(hash);
CREATE INDEX IF NOT EXISTS idx_commits_branch ON commits(branch_name);
CREATE INDEX IF NOT EXISTS idx_commits_message ON commits USING gin(to_tsvector('english', message));
CREATE INDEX IF NOT EXISTS idx_prs_repo ON pull_requests(repo_id);
CREATE INDEX IF NOT EXISTS idx_prs_status ON pull_requests(status);
CREATE INDEX IF NOT EXISTS idx_stashes_repo ON stashes(repo_id);
CREATE INDEX IF NOT EXISTS idx_tags_repo ON tags(repo_id);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log(created_at DESC);

-- Protect main/master by default (trigger)
CREATE OR REPLACE FUNCTION auto_protect_branch() RETURNS TRIGGER AS $$
BEGIN
    IF NEW.name IN ('main','master','develop','production','release') THEN
        NEW.is_protected := true;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_protect_branch ON branches;
CREATE TRIGGER trg_protect_branch BEFORE INSERT OR UPDATE ON branches
    FOR EACH ROW EXECUTE FUNCTION auto_protect_branch();
