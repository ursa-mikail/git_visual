import { useState, useEffect } from 'react'
import { toast } from 'react-hot-toast'
import { Key, ExternalLink, Check, Copy, AlertTriangle, Wifi, WifiOff, Shield, ChevronDown, Save } from 'lucide-react'
import { testSSH, getSSHConfig, setSSHConfig } from '../utils/api'

interface KeyInfo {
  file: string
  priv_key_file: string
  public_key: string
  fingerprint: string
  type: string
}

interface SSHTestResult {
  keys: KeyInfo[]
  ssh_dir: string
  host: string
  active_key: string
  connected: boolean
  test_output: string
  github_keys_url: string
  gitlab_keys_url: string
}

export default function SSHPage() {
  const [tab, setTab] = useState<'verify' | 'pat'>('verify')
  const [host, setHost] = useState('github.com')

  return (
    <div style={{ padding: 24 }}>
      <h1 style={{ fontSize: 20, fontWeight: 700, marginBottom: 4 }}>SSH &amp; Authentication</h1>
      <p style={{ color: 'var(--text-muted)', fontSize: 13, marginBottom: 20 }}>
        GitVisual mounts your <code style={{ background: 'var(--bg-overlay)', padding: '1px 6px', borderRadius: 3 }}>~/.ssh</code> folder
        into the Docker container so your existing SSH keys work automatically.
      </p>

      <div className="tabs" style={{ marginBottom: 24 }}>
        <button className={`tab ${tab === 'verify' ? 'active' : ''}`} onClick={() => setTab('verify')}>
          🔑 SSH Key Verification
        </button>
        <button className={`tab ${tab === 'pat' ? 'active' : ''}`} onClick={() => setTab('pat')}>
          🎫 Personal Access Token
        </button>
      </div>

      {tab === 'verify' && <SSHVerifyPanel host={host} setHost={setHost} />}
      {tab === 'pat' && <PATPanel />}
    </div>
  )
}

/* ── KEY SELECTOR ────────────────────────────────────────────────────────── */

function KeySelector({
  keys,
  activeKey,
  onChange,
  saving,
}: {
  keys: KeyInfo[]
  activeKey: string
  onChange: (k: string) => void
  saving: boolean
}) {
  if (keys.length === 0) return null
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
      <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
        🔑 Active key:
      </span>
      <div style={{ position: 'relative' }}>
        <select
          value={activeKey}
          onChange={e => onChange(e.target.value)}
          style={{ paddingRight: 28, minWidth: 200, fontFamily: 'var(--font-mono)', fontSize: 12 }}
        >
          <option value="">(auto — let SSH decide)</option>
          {keys.map(k => (
            <option key={k.priv_key_file} value={k.priv_key_file}>
              {k.priv_key_file}  [{k.type}]
            </option>
          ))}
        </select>
        <ChevronDown size={13} style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none', color: 'var(--text-muted)' }} />
      </div>
      {saving && <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Saving…</span>}
      {!saving && activeKey && (
        <span style={{ fontSize: 12, color: 'var(--accent-green)' }}>
          <Check size={12} style={{ display: 'inline', verticalAlign: 'middle' }} /> Saved — used for all git operations
        </span>
      )}
    </div>
  )
}

/* ── SSH VERIFY ──────────────────────────────────────────────────────────── */

function SSHVerifyPanel({ host, setHost }: { host: string; setHost: (h: string) => void }) {
  const [testing, setTesting] = useState(false)
  const [result, setResult] = useState<SSHTestResult | null>(null)
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null)
  const [activeKey, setActiveKey] = useState('')
  const [saving, setSaving] = useState(false)

  // Load saved key preference on mount
  useEffect(() => {
    getSSHConfig()
      .then((cfg: { active_key: string }) => setActiveKey(cfg.active_key || ''))
      .catch(() => {})
  }, [])

  const handleKeyChange = async (k: string) => {
    setActiveKey(k)
    setSaving(true)
    try {
      await setSSHConfig(k)
      toast.success(k ? `Active key set to ${k}` : 'Key preference cleared — SSH will auto-select')
    } catch {
      toast.error('Could not save key preference')
    } finally {
      setSaving(false)
    }
  }

  const runTest = async () => {
    setTesting(true)
    try {
      const data = await testSSH(host, activeKey || undefined)
      setResult(data)
      // Sync key list from result in case it changed
      if (data.active_key && !activeKey) setActiveKey(data.active_key)
    } catch {
      toast.error('Could not reach backend — is Docker running?')
    } finally {
      setTesting(false)
    }
  }

  const copyKey = (pub: string, idx: number) => {
    navigator.clipboard.writeText(pub)
    setCopiedIdx(idx)
    toast.success('Public key copied!')
    setTimeout(() => setCopiedIdx(null), 2000)
  }

  const keysForSelector = result?.keys ?? []

  return (
    <div style={{ maxWidth: 780 }}>

      {/* How it works */}
      <div className="card" style={{ padding: 20, marginBottom: 20 }}>
        <h3 style={{ fontWeight: 600, marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
          <Shield size={16} color="var(--accent-blue)" /> How SSH works in GitVisual
        </h3>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, fontSize: 13, color: 'var(--text-secondary)' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ display: 'flex', gap: 10 }}>
              <span style={{ color: 'var(--accent-blue)', fontWeight: 700, fontSize: 18, lineHeight: 1 }}>1</span>
              <div>
                <div style={{ fontWeight: 600, color: 'var(--text-primary)', marginBottom: 2 }}>Your <code>~/.ssh</code> is mounted</div>
                <div>The <code>docker-compose.yml</code> mounts your local <code>~/.ssh</code> folder read-only.
                  Your private keys never leave your machine.</div>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <span style={{ color: 'var(--accent-blue)', fontWeight: 700, fontSize: 18, lineHeight: 1 }}>2</span>
              <div>
                <div style={{ fontWeight: 600, color: 'var(--text-primary)', marginBottom: 2 }}>Pick which key to use</div>
                <div>Use the <strong>Active key</strong> selector below to choose which private key
                  GitVisual uses for clone, push, and pull. The choice is saved and restored on restart.</div>
              </div>
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ display: 'flex', gap: 10 }}>
              <span style={{ color: 'var(--accent-green)', fontWeight: 700, fontSize: 18, lineHeight: 1 }}>3</span>
              <div>
                <div style={{ fontWeight: 600, color: 'var(--text-primary)', marginBottom: 2 }}>Verify your fingerprint</div>
                <div>Click <strong>Test Connection</strong> to see which keys are loaded and compare
                  SHA256 fingerprints to <a href="https://github.com/settings/keys" target="_blank" rel="noreferrer">github.com/settings/keys ↗</a>.</div>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <span style={{ color: 'var(--accent-green)', fontWeight: 700, fontSize: 18, lineHeight: 1 }}>4</span>
              <div>
                <div style={{ fontWeight: 600, color: 'var(--text-primary)', marginBottom: 2 }}>Green = ready</div>
                <div>If the test shows <strong style={{ color: 'var(--diff-add-text)' }}>✓ Authenticated</strong>,
                  GitVisual can push and pull using SSH with no passwords.</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Key selector (shown after first test or when keys known) */}
      {keysForSelector.length > 0 && (
        <div className="card" style={{ padding: '14px 18px', marginBottom: 16 }}>
          <KeySelector keys={keysForSelector} activeKey={activeKey} onChange={handleKeyChange} saving={saving} />
        </div>
      )}

      {/* Test controls */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 16, alignItems: 'center', flexWrap: 'wrap' }}>
        <select value={host} onChange={e => setHost(e.target.value)} style={{ width: 180 }}>
          <option value="github.com">github.com</option>
          <option value="gitlab.com">gitlab.com</option>
          <option value="bitbucket.org">bitbucket.org</option>
        </select>
        <button className="btn btn-primary" onClick={runTest} disabled={testing}>
          {testing
            ? <><div className="spinner" style={{ width: 14, height: 14 }} /> Testing…</>
            : <><Wifi size={14} /> Test SSH Connection</>}
        </button>
        {result && (
          <a
            href={host === 'github.com' ? 'https://github.com/settings/keys'
              : host === 'gitlab.com' ? 'https://gitlab.com/-/profile/keys'
              : 'https://bitbucket.org/account/settings/ssh-keys/'}
            target="_blank" rel="noreferrer"
            className="btn btn-ghost btn-sm">
            <ExternalLink size={13} /> Verify on {host} ↗
          </a>
        )}
        {activeKey && (
          <span style={{ fontSize: 12, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
            using: {activeKey}
          </span>
        )}
      </div>

      {/* Results */}
      {result && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

          {/* Connection status */}
          <div className={`banner ${result.connected ? 'banner-success' : 'banner-error'}`}>
            {result.connected
              ? <><Check size={16} /> <span><strong>✓ Authenticated to {result.host}</strong> — SSH is working. GitVisual can push and pull using these keys.</span></>
              : <><WifiOff size={16} /> <span><strong>✗ Not authenticated to {result.host}</strong> — SSH connection failed. See keys below and make sure your public key is added to {result.host}.</span></>}
          </div>

          {/* Raw SSH output */}
          {result.test_output && (
            <div className="card">
              <div className="card-header">
                <span style={{ fontWeight: 600, fontSize: 13 }}>SSH handshake output</span>
              </div>
              <pre style={{ padding: 12, fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-secondary)', margin: 0, whiteSpace: 'pre-wrap' }}>
                {result.test_output}
              </pre>
            </div>
          )}

          {/* Keys found */}
          <div className="card">
            <div className="card-header">
              <span style={{ fontWeight: 600, fontSize: 13 }}>
                Keys found in <code style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>{result.ssh_dir}</code>
              </span>
              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                Select one as your active key above to use it for all git operations
              </span>
            </div>

            {!result.keys || result.keys.length === 0 ? (
              <div className="empty-state" style={{ padding: 24 }}>
                <Key size={36} />
                <div>
                  <p style={{ fontWeight: 600 }}>No SSH keys found in ~/.ssh</p>
                  <p style={{ fontSize: 13 }}>Generate one with: <code style={{ background: 'var(--bg-overlay)', padding: '2px 6px', borderRadius: 3 }}>ssh-keygen -t ed25519 -C "your@email.com"</code></p>
                </div>
              </div>
            ) : result.keys.map((k: KeyInfo, i: number) => (
              <div key={i} style={{
                padding: '14px 16px',
                borderBottom: i < result.keys.length - 1 ? '1px solid var(--border-muted)' : 'none',
                background: activeKey === k.priv_key_file ? 'color-mix(in srgb, var(--accent-blue) 6%, transparent)' : undefined,
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                  <Key size={15} color={activeKey === k.priv_key_file ? 'var(--accent-green)' : 'var(--accent-yellow)'} />
                  <span style={{ fontWeight: 600, fontSize: 13, fontFamily: 'var(--font-mono)' }}>{k.file}</span>
                  <span className="badge badge-blue">{k.type}</span>
                  {activeKey === k.priv_key_file && (
                    <span className="badge badge-green">active</span>
                  )}
                  <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
                    {activeKey !== k.priv_key_file && (
                      <button className="btn btn-ghost btn-sm" onClick={() => handleKeyChange(k.priv_key_file)}>
                        <Save size={12} /> Use this key
                      </button>
                    )}
                    <button className="btn btn-ghost btn-sm" onClick={() => copyKey(k.public_key, i)}>
                      {copiedIdx === i ? <><Check size={12} /> Copied</> : <><Copy size={12} /> Copy public key</>}
                    </button>
                  </div>
                </div>

                {k.fingerprint && (
                  <div style={{ background: 'var(--bg-base)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: '10px 14px', marginBottom: 8 }}>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: 1 }}>
                      SHA256 Fingerprint — compare to <a href="https://github.com/settings/keys" target="_blank" rel="noreferrer" style={{ color: 'var(--text-link)' }}>github.com/settings/keys ↗</a>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <code style={{ fontFamily: 'var(--font-mono)', fontSize: 13, color: 'var(--accent-teal)', flex: 1 }}>
                        {k.fingerprint}
                      </code>
                      <button className="btn btn-ghost btn-sm" onClick={() => { navigator.clipboard.writeText(k.fingerprint); toast.success('Fingerprint copied') }}>
                        <Copy size={12} />
                      </button>
                    </div>
                  </div>
                )}

                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {k.public_key}
                </div>
              </div>
            ))}
          </div>

          {!result.connected && result.keys && result.keys.length > 0 && (
            <div className="card" style={{ padding: 20 }}>
              <h3 style={{ fontWeight: 600, marginBottom: 12 }}>🛠 Fix: Add your public key to {host}</h3>
              <ol style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 2, paddingLeft: 20 }}>
                <li>Click <strong>Use this key</strong> on the key you want to use, then <strong>Copy public key</strong></li>
                <li>
                  Go to{' '}
                  <a href={host === 'github.com' ? 'https://github.com/settings/ssh/new'
                    : host === 'gitlab.com' ? 'https://gitlab.com/-/profile/keys'
                    : 'https://bitbucket.org/account/settings/ssh-keys/add'}
                    target="_blank" rel="noreferrer" style={{ color: 'var(--text-link)', fontWeight: 600 }}>
                    {host} → SSH Keys → Add new key ↗
                  </a>
                </li>
                <li>Paste your public key and save</li>
                <li>Click <strong>Test SSH Connection</strong> again</li>
              </ol>
            </div>
          )}
        </div>
      )}

      {!result && !testing && (
        <div className="empty-state" style={{ padding: 40 }}>
          <Wifi size={48} style={{ opacity: 0.4 }} />
          <div>
            <p style={{ fontWeight: 600 }}>Click "Test SSH Connection" to check your keys</p>
            <p style={{ fontSize: 13 }}>GitVisual will read your real <code>~/.ssh</code> keys and test whether they authenticate with {host}</p>
          </div>
        </div>
      )}
    </div>
  )
}

/* ── PAT PANEL ───────────────────────────────────────────────────────────── */

function PATPanel() {
  const [pat, setPAT] = useState('')
  const [copied, setCopied] = useState(false)

  const copyPAT = () => {
    navigator.clipboard.writeText(pat)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div style={{ maxWidth: 780 }}>
      <div className="card">
        <div className="card-header">
          <span style={{ fontWeight: 600 }}>🗺️ Create a GitHub Personal Access Token — step by step</span>
        </div>
        <div style={{ padding: 20 }}>
          {[
            {
              n: 1,
              title: 'Open GitHub Token Settings',
              content: (
                <div>
                  <a href="https://github.com/settings/tokens/new?scopes=repo,workflow"
                    target="_blank" rel="noreferrer"
                    className="btn btn-primary btn-sm" style={{ display: 'inline-flex', gap: 6, marginBottom: 8 }}>
                    <ExternalLink size={13} /> Open GitHub → Settings → Personal Access Tokens ↗
                  </a>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                    Or: github.com → Profile picture → Settings → Developer Settings → Personal Access Tokens → Tokens (classic)
                  </div>
                </div>
              ),
            },
            {
              n: 2,
              title: 'Configure your token',
              content: (
                <ul style={{ fontSize: 13, color: 'var(--text-secondary)', paddingLeft: 20, lineHeight: 2 }}>
                  <li><strong>Note:</strong> "GitVisual" (so you remember what it's for)</li>
                  <li><strong>Expiration:</strong> 90 days or No expiration</li>
                  <li><strong>Scopes:</strong> check <code style={{ background: 'var(--bg-overlay)', padding: '0 4px', borderRadius: 3 }}>repo</code> (gives read+write access to your repos)</li>
                  <li>Also check <code style={{ background: 'var(--bg-overlay)', padding: '0 4px', borderRadius: 3 }}>workflow</code> if you use GitHub Actions</li>
                  <li>Click <strong>Generate token</strong> at the bottom</li>
                </ul>
              ),
            },
            {
              n: 3,
              title: 'Copy and save your token here',
              content: (
                <div>
                  <div className="banner banner-warn" style={{ marginBottom: 10 }}>
                    <AlertTriangle size={14} />
                    <span>GitHub shows the token <strong>only once</strong>. Copy it right now before closing that page.</span>
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <input type="password" className="form-input" style={{ flex: 1 }}
                      value={pat} onChange={e => setPAT(e.target.value)}
                      placeholder="ghp_xxxxxxxxxxxxxxxxxxxx" />
                    {pat && (
                      <button className="btn btn-ghost btn-sm" onClick={copyPAT}>
                        {copied ? <Check size={13} /> : <Copy size={13} />}
                      </button>
                    )}
                  </div>
                </div>
              ),
            },
            {
              n: 4,
              title: 'Use your PAT in GitVisual',
              content: (
                <ul style={{ fontSize: 13, color: 'var(--text-secondary)', paddingLeft: 20, lineHeight: 2 }}>
                  <li>When <strong>cloning an HTTPS repo</strong>: paste it in the PAT field in Repositories → Add Repository</li>
                  <li>When <strong>pushing/pulling over HTTPS</strong>: paste it in Advanced Ops → Push/Pull/Fetch → PAT field</li>
                  <li>Or use SSH (left tab) — then you never need a PAT at all</li>
                  <li>GitLab PAT: <a href="https://gitlab.com/-/profile/personal_access_tokens" target="_blank" rel="noreferrer">gitlab.com/-/profile/personal_access_tokens ↗</a></li>
                </ul>
              ),
            },
          ].map(step => (
            <div key={step.n} style={{ display: 'flex', gap: 14, marginBottom: 20, paddingBottom: 20, borderBottom: '1px solid var(--border-muted)' }}>
              <div style={{ width: 28, height: 28, borderRadius: '50%', background: 'var(--accent-blue)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 700, flexShrink: 0 }}>
                {step.n}
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 8 }}>{step.title}</div>
                {step.content}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
