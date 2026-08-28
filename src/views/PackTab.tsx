import { useState } from 'react'
import { CheckSquare, Square, PencilSimple, SlidersHorizontal } from '@phosphor-icons/react'
import { useStore, useCatNames, useMemberNames } from '../lib/store'
import { genId } from '../lib/id'
import { usePullToRefresh } from '../lib/usePullToRefresh'
import PullToRefresh from '../components/PullToRefresh'
import Toast, { useToast } from '../components/Toast'

const ALL_OWNER_FILTER = '全部'
const SHARED_OWNER = '共同'

/** 行李分頁。篩選規則：「共同」項目在任何持有人篩選下都出現，其餘依 packOwner 篩選。 */
export default function PackTab() {
  const packItems = useStore((s) => s.entities.packItems)
  const packOwner = useStore((s) => s.ui.packOwner)
  const setPackOwner = useStore((s) => s.setPackOwner)
  const togglePackDone = useStore((s) => s.togglePackDone)
  const upsertPackItem = useStore((s) => s.upsertPackItem)
  const upsertCat = useStore((s) => s.upsertCat)
  const openPackItemEdit = useStore((s) => s.openPackItemEdit)
  const openCatMgr = useStore((s) => s.openCatMgr)

  const { toast, showToast } = useToast()
  const { containerRef, pull, status } = usePullToRefresh({
    onRefresh: () => new Promise((resolve) => setTimeout(resolve, 300)),
    onDone: () => showToast('已更新'),
  })

  const [showNewCat, setShowNewCat] = useState(false)
  const [newCatName, setNewCatName] = useState('')
  const [newItemName, setNewItemName] = useState('')
  const [newItemCat, setNewItemCat] = useState<string | null>(null)
  const [newItemOwner, setNewItemOwner] = useState<string>(SHARED_OWNER)
  const memberNames = useMemberNames()
  const OWNER_FILTERS = [ALL_OWNER_FILTER, ...memberNames]
  const NEW_ITEM_OWNERS = [SHARED_OWNER, ...memberNames]

  const items = packItems.filter((i) => i.deleted !== 1)
  const catNames = useCatNames('pack')

  const filteredItems = items.filter(
    (i) => i.owner === SHARED_OWNER || packOwner === ALL_OWNER_FILTER || i.owner === packOwner,
  )
  const doneCount = filteredItems.filter((i) => i.done).length
  const totalCount = filteredItems.length
  const progressPct = totalCount > 0 ? (doneCount / totalCount) * 100 : 0

  const effectiveNewItemCat = newItemCat ?? catNames[0] ?? '其他'

  const handleCreateCat = () => {
    const name = newCatName.trim()
    if (!name) return
    upsertCat({ kind: 'pack', name })
    setNewItemCat(name)
    setNewCatName('')
    setShowNewCat(false)
    showToast(`已建立分類 · ${name}`)
  }

  const handleAddItem = () => {
    const name = newItemName.trim()
    if (!name) return
    upsertPackItem({
      id: genId(),
      cat: effectiveNewItemCat,
      name,
      owner: newItemOwner,
      done: false,
    })
    setNewItemName('')
    showToast(`已加入行李 · ${name}`)
  }

  return (
    <div className="pack" ref={containerRef}>
      <PullToRefresh status={status} pull={pull} />

      <h2 className="spots-h2">行李</h2>
      <p className="spots-sub">
        {doneCount} / {totalCount} 已打包
      </p>

      <div className="pack-progress">
        <div className="pack-progress-value" style={{ width: `${progressPct}%` }} />
      </div>

      <div className="pack-owner-chips">
        {OWNER_FILTERS.map((owner) => (
          <button
            key={owner}
            type="button"
            className={`itin-day-chip${packOwner === owner ? ' is-selected' : ''}`}
            onClick={() => setPackOwner(owner)}
          >
            {owner}
          </button>
        ))}
      </div>

      {catNames.map((cat) => {
        const catItems = filteredItems.filter((i) => i.cat === cat)
        const catDone = catItems.filter((i) => i.done).length
        return (
          <div key={cat} className="pack-cat">
            <div className="pack-cat-kicker">
              {cat} · {catDone} / {catItems.length}
            </div>
            {catItems.length === 0 ? (
              <p className="pack-empty">還沒有項目</p>
            ) : (
              catItems.map((item) => (
                <div key={item.id} className="pack-item-row" onClick={() => togglePackDone(item.id)}>
                  {item.done ? (
                    <CheckSquare size={19} weight="duotone" color="var(--color-accent)" />
                  ) : (
                    <Square size={19} weight="duotone" />
                  )}
                  <span className={`pack-item-name${item.done ? ' is-done' : ''}`}>{item.name}</span>
                  <span className="tag tag-neutral pack-item-owner">{item.owner}</span>
                  <button
                    type="button"
                    className="btn btn-ghost pack-item-edit-btn"
                    aria-label={`編輯 ${item.name}`}
                    onClick={(e) => {
                      e.stopPropagation()
                      openPackItemEdit(item.id)
                    }}
                  >
                    <PencilSimple size={15} weight="duotone" />
                  </button>
                </div>
              ))
            )}
          </div>
        )
      })}

      <div className="pack-add">
        <div className="pack-cat-chips">
          {catNames.map((cat) => (
            <button
              key={cat}
              type="button"
              className={`edit-kind-chip${effectiveNewItemCat === cat ? ' is-selected' : ''}`}
              onClick={() => setNewItemCat(cat)}
            >
              {cat}
            </button>
          ))}
          {!showNewCat && (
            <button type="button" className="btn btn-secondary" onClick={() => setShowNewCat(true)}>
              ＋分類
            </button>
          )}
          <button type="button" className="btn btn-ghost" onClick={() => openCatMgr('pack')}>
            <SlidersHorizontal size={14} weight="duotone" /> 管理分類
          </button>
        </div>

        {showNewCat && (
          <div className="pack-new-cat">
            <input
              className="input"
              placeholder="新分類名稱"
              value={newCatName}
              onChange={(e) => setNewCatName(e.target.value)}
            />
            <button type="button" className="btn btn-primary" onClick={handleCreateCat}>
              建立
            </button>
          </div>
        )}

        <div className="pack-owner-chips">
          {NEW_ITEM_OWNERS.map((owner) => (
            <button
              key={owner}
              type="button"
              className={`itin-day-chip${newItemOwner === owner ? ' is-selected' : ''}`}
              onClick={() => setNewItemOwner(owner)}
            >
              {owner}
            </button>
          ))}
        </div>

        <div className="pack-new-item">
          <input
            className="input"
            placeholder="新增行李項目"
            value={newItemName}
            onChange={(e) => setNewItemName(e.target.value)}
          />
          <button type="button" className="btn btn-primary" onClick={handleAddItem} disabled={!newItemName.trim()}>
            加入
          </button>
        </div>

        <p className="pack-add-hint">
          將加入「{effectiveNewItemCat}」· 持有人：{newItemOwner}
        </p>
      </div>

      {toast && <Toast message={toast.message} />}
    </div>
  )
}
