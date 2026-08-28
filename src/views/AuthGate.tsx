import { useState } from 'react'
import { User, ArrowRight, Trash, X, Plus, SlidersHorizontal } from '@phosphor-icons/react'
import { login, pickRole } from '../lib/auth'
import { useStore, useMemberNames } from '../lib/store'
import { formatHeroDateRange } from '../lib/time'
import type { Payer } from '../lib/types'

/**
 * 登入畫面，全螢幕覆蓋。ui.auth.status 是 'loggedOut'（還沒輸密碼）或 'pickingRole'
 * （密碼過了還沒選身分）時由 App.tsx 掛載。
 * 兩階段流程：單一共用密碼 → 選身分；角色是本地偏好，不是伺服器授權的一部分。
 * 畫面上刻意不放任何示範密碼。
 */
export default function AuthGate() {
  const status = useStore((s) => s.ui.auth.status)
  const destTitle = useStore((s) => s.entities.settings.destTitle ?? '')
  const destSubtitle = useStore((s) => s.entities.settings.destSubtitle ?? '')
  const tripStart = useStore((s) => s.entities.settings.tripStart)
  const tripEnd = useStore((s) => s.entities.settings.tripEnd)
  const heroPhoto = useStore((s) => s.entities.settings.heroPhoto)
  const heroDate =
    (tripStart && tripEnd ? formatHeroDateRange(tripStart, tripEnd) : null) ?? { year: '', range: '' }

  return (
    <div className="auth-gate">
      <div className="auth-gate-hero">
        <div className="auth-gate-hero-photo">
          <img src={heroPhoto || '/hero-photo.jpg'} alt="行程主視覺" />
        </div>
        <div className="auth-gate-hero-mask" />
        <div className="auth-gate-hero-title">
          <div className="auth-gate-hero-kicker">TRAVEL DATE</div>
          <div className="auth-gate-hero-date-row">
            <h1 className="auth-gate-hero-year">{heroDate.year}</h1>
            <div className="auth-gate-hero-range">{heroDate.range}</div>
          </div>
        </div>
      </div>

      <div className="auth-gate-body">
        <h1 className="auth-gate-title">{destTitle}</h1>
        <p className="auth-gate-sub">{destSubtitle}</p>

        {status === 'pickingRole' ? <RolePickStage /> : <PasswordStage />}
      </div>
    </div>
  )
}

function PasswordStage() {
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!password || submitting) return
    setSubmitting(true)
    setError(null)
    try {
      await login(password)
      // 成功後 auth 狀態變 'pickingRole'，接著渲染 RolePickStage。
    } catch (err) {
      setError(err instanceof Error ? err.message : '登入失敗')
      setPassword('')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="auth-gate-stage">
      <form onSubmit={handleSubmit}>
        <div className="field">
          <label>通行密碼</label>
          <input
            className="input auth-gate-input"
            type="password"
            placeholder="輸入密碼"
            autoFocus
            value={password}
            onChange={(e) => {
              setPassword(e.target.value)
              setError(null)
            }}
          />
        </div>
        {error && (
          <div className="auth-gate-error" role="alert">
            {error}
          </div>
        )}
        <button type="submit" className="btn btn-primary btn-block auth-gate-submit" disabled={!password || submitting}>
          {submitting ? '驗證中…' : '進入'}
        </button>
      </form>
    </div>
  )
}

const ROLE_NOTE = '記帳預設由你付款 · 行李看你的清單'

function RolePickStage() {
  const [picking, setPicking] = useState<Payer | null>(null)
  const [managing, setManaging] = useState(false)
  const memberNames = useMemberNames()

  async function choose(role: Payer) {
    if (picking) return
    setPicking(role)
    await pickRole(role)
  }

  if (managing) return <RoleManagerPanel onDone={() => setManaging(false)} />

  return (
    <div className="auth-gate-stage">
      <div className="auth-gate-role-kicker">你是誰？</div>
      <p className="auth-gate-role-hint">選擇後，記帳與行李都會預設為這個身分，可隨時在畫面上切換。</p>
      {memberNames.map((name) => (
        <button
          key={name}
          type="button"
          className="auth-gate-role-btn"
          disabled={picking !== null}
          onClick={() => void choose(name as Payer)}
        >
          <User weight="duotone" className="auth-gate-role-icon" />
          <span className="auth-gate-role-text">
            <span className="auth-gate-role-name">{name}</span>
            <span className="auth-gate-role-role-note">{ROLE_NOTE}</span>
          </span>
          <ArrowRight weight="duotone" className="auth-gate-role-caret" />
        </button>
      ))}
      <button type="button" className="btn btn-ghost auth-gate-role-manage-btn" onClick={() => setManaging(true)}>
        <SlidersHorizontal size={14} weight="duotone" /> 管理身分
      </button>
    </div>
  )
}

/**
 * 管理身分：改名會連動記帳「誰付的」／行李持有人（store.renameMember），刪除會連同
 * 名下的記帳與行李資料一起移除，所以一定要先跳二次確認才執行。
 */
function RoleManagerPanel({ onDone }: { onDone: () => void }) {
  const memberNames = useMemberNames()
  const renameMember = useStore((s) => s.renameMember)
  const deleteMember = useStore((s) => s.deleteMember)
  const addMember = useStore((s) => s.addMember)

  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [newName, setNewName] = useState('')
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null)

  function handleDone() {
    for (const [from, to] of Object.entries(drafts)) {
      if (to.trim() && to.trim() !== from) renameMember(from, to)
    }
    setDrafts({})
    onDone()
  }

  function handleAdd() {
    const v = newName.trim()
    if (!v) return
    addMember(v)
    setNewName('')
  }

  if (deleteTarget) {
    return (
      <div className="auth-gate-stage">
        <div className="auth-gate-role-kicker auth-gate-role-kicker-danger">刪除身分</div>
        <p className="auth-gate-role-hint">
          確定要刪除「{deleteTarget}」嗎？<b>這個身分底下的所有記帳與行李資料都會被永久移除</b>，此動作無法復原。
        </p>
        <div className="auth-gate-role-confirm-row">
          <button type="button" className="btn btn-secondary" onClick={() => setDeleteTarget(null)}>
            取消
          </button>
          <button
            type="button"
            className="btn btn-primary auth-gate-role-danger-btn"
            onClick={() => {
              deleteMember(deleteTarget)
              setDeleteTarget(null)
            }}
          >
            <Trash size={16} weight="duotone" /> 確定刪除
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="auth-gate-stage">
      <div className="auth-gate-role-kicker">管理身分</div>
      {memberNames.map((name) => (
        <div key={name} className="auth-gate-role-edit-row">
          <input
            className="input"
            value={drafts[name] ?? name}
            onChange={(e) => setDrafts((d) => ({ ...d, [name]: e.target.value }))}
          />
          <button
            type="button"
            className="btn btn-ghost btn-icon auth-gate-role-del-btn"
            onClick={() => setDeleteTarget(name)}
            aria-label={`刪除 ${name}`}
          >
            <Trash size={16} weight="duotone" />
          </button>
        </div>
      ))}
      <div className="auth-gate-role-edit-row">
        <input
          className="input"
          placeholder="新增身分名稱"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleAdd()
          }}
        />
        <button type="button" className="btn btn-ghost btn-icon" onClick={handleAdd} aria-label="新增身分">
          <Plus size={16} weight="duotone" />
        </button>
      </div>
      <button type="button" className="btn btn-primary btn-block auth-gate-role-done-btn" onClick={handleDone}>
        完成
      </button>
      <button type="button" className="btn btn-ghost auth-gate-role-manage-btn" onClick={onDone}>
        <X size={14} weight="duotone" /> 取消
      </button>
    </div>
  )
}
