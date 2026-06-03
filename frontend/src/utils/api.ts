import axios from 'axios'

const api = axios.create({ baseURL: '/api' })

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const d = (r: any) => r.data

export const getRepos = (search?: string) => api.get('/repos', { params: search ? { search } : {} }).then(d)
export const getRepo = (id: string) => api.get(`/repos/${id}`).then(d)
export const createRepo = (data: Record<string, unknown>) => api.post('/repos', data).then(d)
export const updateRepo = (id: string, data: Record<string, unknown>) => api.put(`/repos/${id}`, data).then(d)
export const deleteRepo = (id: string) => api.delete(`/repos/${id}`)
export const syncRepo = (id: string) => api.post(`/repos/${id}/sync`).then(d)

export const getBranches = (repoId: string, search?: string) => api.get(`/repos/${repoId}/branches`, { params: search ? { search } : {} }).then(d)
export const createBranch = (repoId: string, data: Record<string, unknown>) => api.post(`/repos/${repoId}/branches`, data).then(d)
export const deleteBranch = (repoId: string, branchId: string, force?: boolean) => api.delete(`/repos/${repoId}/branches/${branchId}`, { params: force ? { force: 'true' } : {} })
export const renameBranch = (repoId: string, branchId: string, name: string) => api.put(`/repos/${repoId}/branches/${branchId}`, { name }).then(d)
export const checkoutBranch = (repoId: string, branchId: string) => api.post(`/repos/${repoId}/branches/${branchId}`).then(d)

export const getCommits = (repoId: string, params?: Record<string, unknown>) => api.get(`/repos/${repoId}/commits`, { params }).then(d)
export const createCommit = (repoId: string, data: Record<string, unknown>) => api.post(`/repos/${repoId}/commit`, data).then(d)
export const revertCommit = (repoId: string, commitId: string) => api.post(`/repos/${repoId}/commits/${commitId}/revert`).then(d)
export const stageFiles = (repoId: string, data: Record<string, unknown>) => api.post(`/repos/${repoId}/stage`, data).then(d)

export const getDiff = (repoId: string, base?: string, compare?: string) => api.get(`/repos/${repoId}/diff`, { params: { base, compare } }).then(d)
export const getDiffDebug = (repoId: string, base?: string, compare?: string) => api.get(`/repos/${repoId}/diff-debug`, { params: { base, compare } }).then(d)
export const getWorkingDiff = (repoId: string) => api.get(`/repos/${repoId}/working-diff`).then(d)
export const getStatus = (repoId: string) => api.get(`/repos/${repoId}/status`).then(d)

export const mergeBranches = (repoId: string, data: Record<string, unknown>) => api.post(`/repos/${repoId}/merge`, data).then(d)
export const rebaseBranch = (repoId: string, data: Record<string, unknown>) => api.post(`/repos/${repoId}/rebase`, data).then(d)
export const cherryPick = (repoId: string, data: Record<string, unknown>) => api.post(`/repos/${repoId}/cherry-pick`, data).then(d)
export const pushRepo = (repoId: string, data: Record<string, unknown>) => api.post(`/repos/${repoId}/push`, data).then(d)
export const pullRepo = (repoId: string, data: Record<string, unknown>) => api.post(`/repos/${repoId}/pull`, data).then(d)
export const fetchRepo = (repoId: string, data: Record<string, unknown>) => api.post(`/repos/${repoId}/fetch`, data).then(d)
export const resetRepo = (repoId: string, data: Record<string, unknown>) => api.post(`/repos/${repoId}/reset`, data).then(d)
export const restoreFile = (repoId: string, data: Record<string, unknown>) => api.post(`/repos/${repoId}/restore`, data).then(d)

export const getConflicts = (repoId: string) => api.get(`/repos/${repoId}/conflicts`).then(d)
export const resolveConflict = (repoId: string, data: Record<string, unknown>) => api.post(`/repos/${repoId}/conflicts`, data).then(d)

export const bisect = (repoId: string, data: Record<string, unknown>) => api.post(`/repos/${repoId}/bisect`, data).then(d)
export const getBlame = (repoId: string, file: string, ref?: string) => api.get(`/repos/${repoId}/blame`, { params: { file, ref } }).then(d)

export const getStashes = (repoId: string) => api.get(`/repos/${repoId}/stashes`).then(d)
export const createStash = (repoId: string, data: Record<string, unknown>) => api.post(`/repos/${repoId}/stashes`, data).then(d)
export const applyStash = (repoId: string, stashId: string) => api.post(`/repos/${repoId}/stashes/${stashId}/apply`).then(d)
export const popStash = (repoId: string, stashId: string) => api.post(`/repos/${repoId}/stashes/${stashId}/pop`).then(d)
export const dropStash = (repoId: string, stashId: string) => api.delete(`/repos/${repoId}/stashes/${stashId}`)

export const getTags = (repoId: string) => api.get(`/repos/${repoId}/tags`).then(d)
export const createTag = (repoId: string, data: Record<string, unknown>) => api.post(`/repos/${repoId}/tags`, data).then(d)
export const deleteTag = (repoId: string, tagId: string, remote?: boolean) => api.delete(`/repos/${repoId}/tags/${tagId}`, { params: remote ? { remote: 'true' } : {} })

export const getPRs = (repoId: string, status?: string) => api.get(`/repos/${repoId}/prs`, { params: status ? { status } : {} }).then(d)
export const createPR = (repoId: string, data: Record<string, unknown>) => api.post(`/repos/${repoId}/prs`, data).then(d)
export const updatePR = (repoId: string, prId: string, data: Record<string, unknown>) => api.put(`/repos/${repoId}/prs/${prId}`, data).then(d)
export const mergePR = (repoId: string, prId: string, data?: Record<string, unknown>) => api.post(`/repos/${repoId}/prs/${prId}/merge`, data || {}).then(d)
export const closePR = (repoId: string, prId: string) => api.delete(`/repos/${repoId}/prs/${prId}`)

export const getSSHKeys = () => api.get('/ssh-keys').then(d)
export const createSSHKey = (data: Record<string, unknown>) => api.post('/ssh-keys', data).then(d)
export const testSSH = (host?: string, key?: string) =>
  api.get('/ssh-test', { params: { ...(host ? { host } : {}), ...(key ? { key } : {}) } }).then(d)
export const getSSHConfig = () => api.get('/ssh-config').then(d)
export const setSSHConfig = (activeKey: string) => api.post('/ssh-config', { active_key: activeKey }).then(d)

export const getGlobalConfig = () => api.get('/config').then(d)
export const updateGlobalConfig = (data: Record<string, unknown>) => api.post('/config', data).then(d)

export const getLogGraph = (repoId: string, limit?: number) => api.get(`/repos/${repoId}/log-graph`, { params: { limit } }).then(d)
export const getReflog = (repoId: string) => api.get(`/repos/${repoId}/reflog`).then(d)

export const getRemotes = (repoId: string) => api.get(`/repos/${repoId}/remotes`).then(d)
export const addRemote = (repoId: string, data: Record<string, unknown>) => api.post(`/repos/${repoId}/remotes`, data).then(d)

export const discoverRepos = () => api.get('/repos/discover').then(d)
export const bulkImportRepos = (repos: unknown[]) => api.post('/repos/bulk-import', repos).then(d)

// Returns RefInfo[] — { label, ref, kind: 'branch'|'tag'|'commit' }
export const getRefs = (repoId: string) => api.get(`/repos/${repoId}/refs`).then(d)
// Returns RefEntry[] — { label, repo_id, ref, kind }
export const getAllRefs = (repoId: string) => api.get(`/repos/${repoId}/all-refs`).then(d)
export const getCrossDiff = (repoId: string, base?: string, compare?: string, compareRepoId?: string) =>
  api.get(`/repos/${repoId}/cross-diff`, { params: { base, compare, compare_repo_id: compareRepoId } }).then(d)

export const getFileTree = (repoId: string, ref?: string) => api.get(`/repos/${repoId}/files`, { params: { ref } }).then(d)
export const getFileContent = (repoId: string, path: string, ref?: string) => api.get(`/repos/${repoId}/files/${path}`, { params: { ref } }).then(d)

export const getSubmodules = (repoId: string) => api.get(`/repos/${repoId}/submodules`).then(d)
export const submoduleAction = (repoId: string, data: Record<string, unknown>) => api.post(`/repos/${repoId}/submodules`, data).then(d)

export const search = (q: string) => api.get('/search', { params: { q } }).then(d)

export const getSchema = () => api.get('/schema').then(d)
export const getTableData = (table: string, page: number, pageSize: number, search?: string) =>
  api.get('/table-data', { params: { table, page, page_size: pageSize, search } }).then(d)
export const exportCSV = (table: string) =>
  api.get('/export-csv', { params: { table }, responseType: 'blob' }).then(d)

export const getAudit = (page: number, pageSize: number) =>
  api.get('/audit', { params: { page, page_size: pageSize } }).then(d)
