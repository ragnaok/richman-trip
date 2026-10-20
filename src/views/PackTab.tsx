import { useState, useRef } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import { CheckSquare, Square, PencilSimple, SlidersHorizontal, ArrowsDownUp, DotsSixVertical } from '@phosphor-icons/react'
import { useStore, useCatNames, useMemberNames, sortPackItems } from '../lib/store'
import type { PackItem } from '../lib/types'
import { genId } from '../lib/id'
import { usePullToRefresh } from '../lib/usePullToRefresh'
import { pull as syncPull, push as syncPush } from '../lib/sync'
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
  const movePackItem = useStore((s) => s.movePackItem)
  const reorderPackCats = useStore((s) => s.reorderPackCats)

  const { toast, showToast } = useToast()
  const { containerRef, pull, status } = usePullToRefresh({
    onRefresh: () => syncPull().then(() => syncPush()),
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

  // 排序模式：進入時暫時顯示全部項目（不受持有人篩選影響），離開後篩選自然還原——
  // 篩選中拖曳的話，插入位置的鄰居可能是被藏起來的項目，使用者看不到自己放到哪。
  const [sorting, setSorting] = useState(false)
  const filteredItems = items.filter(
    (i) => sorting || i.owner === SHARED_OWNER || packOwner === ALL_OWNER_FILTER || i.owner === packOwner,
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

  // 排序模式拖曳：手刻 pointer events（理由同 ItineraryTab：HTML5 draggable 在手機觸控
  // 不會觸發）。把手只在排序模式才出現，所以不需要長按門檻，按下就開始拖。
  // 放置位置每次 move 都從 DOM 即時量：data-cat / data-item-id 標在分類區塊與項目列上。
  type Drag =
    | { kind: 'item'; id: PackItem['id']; startY: number; startScroll: number; deltaY: number; drop: { cat: string; beforeId: PackItem['id'] | null } }
    | { kind: 'cat'; id: string; startY: number; startScroll: number; deltaY: number; drop: { beforeCat: string | null } }
  const [drag, setDrag] = useState<Drag | null>(null)
  const dragRef = useRef<{ pointerId: number } | null>(null)

  function computeDrop(d: Drag, y: number): Drag['drop'] {
    const root = containerRef.current
    if (!root) return d.drop
    const blocks = Array.from(root.querySelectorAll<HTMLElement>('[data-cat]'))
    if (d.kind === 'cat') {
      const others = blocks.filter((b) => b.dataset.cat !== d.id)
      const hit = others.find((b) => {
        const r = b.getBoundingClientRect()
        return y < r.top + r.height / 2
      })
      return { beforeCat: hit?.dataset.cat ?? null }
    }
    if (blocks.length === 0) return d.drop
    const block = blocks.find((b) => y < b.getBoundingClientRect().bottom) ?? blocks[blocks.length - 1]
    const cat = block.dataset.cat!
    const rows = Array.from(block.querySelectorAll<HTMLElement>('[data-item-id]')).filter((r) => r.dataset.itemId !== String(d.id))
    const headerBottom = block.querySelector('.pack-cat-kicker')?.getBoundingClientRect().bottom ?? 0
    const currentCat = items.find((i) => i.id === d.id)?.cat
    if (y < headerBottom) {
      // 放在分類標題上：換分類＝放到該分類最後；同分類＝移到最前面。
      return { cat, beforeId: cat === currentCat ? (rows[0]?.dataset.itemId ?? null) : null }
    }
    const hit = rows.find((r) => {
      const rect = r.getBoundingClientRect()
      return y < rect.top + rect.height / 2
    })
    return { cat, beforeId: hit?.dataset.itemId ?? null }
  }

  function startDrag(e: ReactPointerEvent<HTMLElement>, next: Omit<Drag, 'startY' | 'startScroll' | 'deltaY' | 'drop'> & { kind: Drag['kind']; id: string }) {
    e.stopPropagation()
    e.currentTarget.setPointerCapture(e.pointerId)
    dragRef.current = { pointerId: e.pointerId }
    const startScroll = containerRef.current?.scrollTop ?? 0
    const base = { startY: e.clientY, startScroll, deltaY: 0 }
    setDrag(
      next.kind === 'item'
        ? { ...base, kind: 'item', id: next.id, drop: { cat: items.find((i) => String(i.id) === next.id)?.cat ?? '', beforeId: null } }
        : { ...base, kind: 'cat', id: next.id, drop: { beforeCat: null } },
    )
  }

  function moveDrag(e: ReactPointerEvent<HTMLElement>) {
    if (!dragRef.current || dragRef.current.pointerId !== e.pointerId || !drag) return
    e.preventDefault()
    const root = containerRef.current
    if (root) {
      // 靠近上下緣時自動捲動，長清單才拖得到遠處。
      const rect = root.getBoundingClientRect()
      if (e.clientY < rect.top + 60) root.scrollTop -= 12
      else if (e.clientY > rect.bottom - 60) root.scrollTop += 12
    }
    const deltaY = e.clientY - drag.startY + ((root?.scrollTop ?? 0) - drag.startScroll)
    setDrag({ ...drag, deltaY, drop: computeDrop(drag, e.clientY) } as Drag)
  }

  function endDrag(e: ReactPointerEvent<HTMLElement>) {
    if (!dragRef.current || dragRef.current.pointerId !== e.pointerId) return
    dragRef.current = null
    // 放開後瀏覽器會補一個 click，目標是手指停的那一列；吃掉它，免得誤觸別的按鈕。
    const swallow = (ev: Event) => {
      ev.stopPropagation()
      ev.preventDefault()
    }
    document.addEventListener('click', swallow, { capture: true, once: true })
    setTimeout(() => document.removeEventListener('click', swallow, { capture: true }), 400)

    const finished = drag
    setDrag(null)
    if (!finished) return
    if (finished.kind === 'item') {
      const byKey = (key: PackItem['id']) => items.find((i) => String(i.id) === String(key))?.id
      const id = byKey(finished.id)
      if (id === undefined) return
      movePackItem(id, finished.drop.cat, finished.drop.beforeId === null ? null : (byKey(finished.drop.beforeId) ?? null))
    } else {
      const rest = catNames.filter((n) => n !== finished.id)
      const at = finished.drop.beforeCat === null ? rest.length : rest.indexOf(finished.drop.beforeCat)
      reorderPackCats([...rest.slice(0, at), finished.id, ...rest.slice(at)])
    }
  }

  const handleProps = {
    onPointerMove: moveDrag,
    onPointerUp: endDrag,
    onPointerCancel: endDrag,
    onClick: (e: React.MouseEvent) => e.stopPropagation(),
  }

  return (
    <div className="pack" ref={containerRef}>
      <PullToRefresh status={status} pull={pull} />

      <div className="pack-head">
        <h2 className="spots-h2">行李</h2>
        <button
          type="button"
          className={`btn ${sorting ? 'btn-primary' : 'btn-secondary'}`}
          onClick={() => {
            setSorting((v) => !v)
            setDrag(null)
          }}
        >
          <ArrowsDownUp size={14} weight="duotone" /> {sorting ? '完成排序' : '排序'}
        </button>
      </div>
      <p className="spots-sub">
        {doneCount} / {totalCount} 已打包
      </p>

      <div className="pack-progress">
        <div className="pack-progress-value" style={{ width: `${progressPct}%` }} />
      </div>

      {!sorting && (
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
      )}

      {catNames.map((cat) => {
        const catItems = sortPackItems(filteredItems.filter((i) => i.cat === cat))
        const catDone = catItems.filter((i) => i.done).length
        const catDragging = drag?.kind === 'cat' && drag.id === cat
        const dropEnd = drag?.kind === 'item' && drag.drop.cat === cat && drag.drop.beforeId === null
        return (
          <div key={cat}>
          {drag?.kind === 'cat' && drag.drop.beforeCat === cat && <div className="pack-drop-line" />}
          <div
            data-cat={cat}
            className={`pack-cat${catDragging ? ' is-dragging' : ''}`}
            style={catDragging && drag ? { transform: `translateY(${drag.deltaY}px)` } : undefined}
          >
            <div className="pack-cat-kicker">
              {sorting && (
                <span
                  className="pack-drag-handle"
                  aria-label={`拖曳排序分類 ${cat}`}
                  onPointerDown={(e) => startDrag(e, { kind: 'cat', id: cat })}
                  {...handleProps}
                >
                  <DotsSixVertical size={16} weight="bold" />
                </span>
              )}
              {cat} · {catDone} / {catItems.length}
            </div>
            {catItems.length === 0 ? (
              <p className="pack-empty">還沒有項目</p>
            ) : (
              catItems.map((item) => {
                const itemDragging = drag?.kind === 'item' && drag.id === item.id
                return (
                <div key={item.id}>
                {drag?.kind === 'item' && drag.drop.beforeId === item.id && <div className="pack-drop-line" />}
                <div
                  data-item-id={String(item.id)}
                  className={`pack-item-row${itemDragging ? ' is-dragging' : ''}`}
                  style={itemDragging && drag ? { transform: `translateY(${drag.deltaY}px) scale(1.03)` } : undefined}
                  onClick={sorting ? undefined : () => togglePackDone(item.id)}
                >
                  {sorting ? (
                    <span
                      className="pack-drag-handle"
                      aria-label={`拖曳排序 ${item.name}`}
                      onPointerDown={(e) => startDrag(e, { kind: 'item', id: String(item.id) })}
                      {...handleProps}
                    >
                      <DotsSixVertical size={16} weight="bold" />
                    </span>
                  ) : item.done ? (
                    <CheckSquare size={19} weight="duotone" color="var(--color-accent)" />
                  ) : (
                    <Square size={19} weight="duotone" />
                  )}
                  <span className={`pack-item-name${item.done ? ' is-done' : ''}`}>{item.name}</span>
                  <span className="tag tag-neutral pack-item-owner">{item.owner}</span>
                  {!sorting && (
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
                  )}
                </div>
                </div>
                )
              })
            )}
            {dropEnd && <div className="pack-drop-line" />}
          </div>
          </div>
        )
      })}
      {drag?.kind === 'cat' && drag.drop.beforeCat === null && <div className="pack-drop-line" />}

      {!sorting && (
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
      )}

      {toast && <Toast message={toast.message} />}
    </div>
  )
}
