import { useEffect } from 'react'
import { CaretLeft } from '@phosphor-icons/react'
import TabBar from './components/TabBar'
import OfflineBanner from './components/OfflineBanner'
import Toast, { useToast } from './components/Toast'
import ItineraryTab from './views/ItineraryTab'
import SpotsTab from './views/SpotsTab'
import PackTab from './views/PackTab'
import MoneyTab from './views/MoneyTab'
import PlanDetail from './views/PlanDetail'
import PlanEditSheet from './views/PlanEditSheet'
import SpotDetail from './views/SpotDetail'
import ExpenseSheet from './views/ExpenseSheet'
import AuthGate from './views/AuthGate'
import PackItemEditSheet from './views/PackItemEditSheet'
import CatManagerSheet from './views/CatManagerSheet'
import SpotEditSheet from './views/SpotEditSheet'
import PhotoLightbox from './components/PhotoLightbox'
import SettingsSheet from './views/SettingsSheet'
import { useStore, useAllSpots } from './lib/store'
import { bootstrapAuth } from './lib/auth'
import { startSyncTriggers, stopSyncTriggers } from './lib/sync'
import { useEdgeSwipeBack } from './lib/useEdgeSwipeBack'
import { useEdgeSwipeOpenRight } from './lib/useEdgeSwipeOpenRight'

export type TabId = 'itinerary' | 'spots' | 'pack' | 'money'

const VIEWS: Record<TabId, typeof ItineraryTab> = {
  itinerary: ItineraryTab,
  spots: SpotsTab,
  pack: PackTab,
  money: MoneyTab,
}

export default function App() {
  // tab 以 store.ui.tab 為單一事實來源，跨分頁互動（例如行程頁按鈕切到景點分頁）
  // 才會有畫面效果。
  const tab = useStore((s) => s.ui.tab)
  const setTab = useStore((s) => s.setTab)
  const closeDetail = useStore((s) => s.closeDetail)
  const closeSpot = useStore((s) => s.closeSpot)
  const setEdit = useStore((s) => s.setEdit)
  const closeAddExpense = useStore((s) => s.closeAddExpense)
  const closePackItemEdit = useStore((s) => s.closePackItemEdit)
  const closeCatMgr = useStore((s) => s.closeCatMgr)
  const closeAddSpot = useStore((s) => s.closeAddSpot)
  const closeSpotEditor = useStore((s) => s.closeSpotEditor)
  const closePhotoLightbox = useStore((s) => s.closePhotoLightbox)
  const detail = useStore((s) => s.ui.detail)
  const edit = useStore((s) => s.ui.edit)
  const spot = useStore((s) => s.ui.spot)
  const addExpenseOpen = useStore((s) => s.ui.addExpenseOpen)
  const editingExpenseId = useStore((s) => s.ui.editingExpenseId)
  const packEditItemId = useStore((s) => s.ui.packEditItemId)
  const catMgrKind = useStore((s) => s.ui.catMgrKind)
  const addingSpotOpen = useStore((s) => s.ui.addingSpotOpen)
  const editingSpotId = useStore((s) => s.ui.editingSpotId)
  const photoLightbox = useStore((s) => s.ui.photoLightbox)
  const settingsOpen = useStore((s) => s.ui.settingsOpen)
  const openSettings = useStore((s) => s.openSettings)
  const closeSettings = useStore((s) => s.closeSettings)
  const authStatus = useStore((s) => s.ui.auth.status)
  const destTitle = useStore((s) => s.entities.settings.destTitle)
  const allSpots = useAllSpots()
  const { toast } = useToast()

  // 啟動時讀登入旗標決定要不要先樂觀顯示 App（見 lib/auth.ts）。只跑一次。
  useEffect(() => {
    void bootstrapAuth()
  }, [])

  // loggedIn 才掛同步觸發（見 lib/sync.ts）；登出後停掉輪詢，不對失效 session 打 API。
  useEffect(() => {
    if (authStatus === 'loggedIn') {
      startSyncTriggers()
    } else if (authStatus === 'loggedOut') {
      stopSyncTriggers()
    }
  }, [authStatus])

  // 分頁標題與 iOS 加到主畫面的名稱跟著設定頁「標題」走。只在有值時才覆蓋：預設
  // destTitle 是空字串，拿去蓋會讓第一次打開的人看到空白標題，寧可停在上一個值。
  //
  // manifest 的 name/short_name（Android 安裝名稱、iOS 的退路）不在這裡蓋，改由
  // functions/manifest.webmanifest.ts 查 D1 動態產生——iOS Safari 讀「加入主畫面」的
  // manifest 不吃 blob: scheme，必須是真的可 fetch 的端點。
  useEffect(() => {
    if (!destTitle) return
    document.title = destTitle
    document.querySelector('meta[name="apple-mobile-web-app-title"]')?.setAttribute('content', destTitle)
  }, [destTitle])

  const ActiveView = VIEWS[tab]

  // 切換分頁時關閉所有覆蓋層。只綁在底部 tab bar 的手動切換：程式化切換（例如先設
  // ui.spot 再切分頁）不經過這裡，才不會把剛設好的狀態清掉。
  function handleTabChange(id: TabId) {
    closeDetail()
    closeSpot()
    setEdit(null)
    closeAddExpense()
    closePackItemEdit()
    closeCatMgr()
    closeAddSpot()
    closeSpotEditor()
    closePhotoLightbox()
    closeSettings()
    setTab(id)
  }

  // 左緣滑動返回：關掉目前最上層的覆蓋層，依 z-index 高到低判斷（bottom sheet >
  // 全螢幕詳情頁）。不含 AuthGate，登入關卡不該被手勢滑掉。
  // 只有全螢幕詳情頁跟手指滑動、放開後滑出才關閉；bottom sheet 維持放開立刻關閉，
  // 往右退場跟它由下往上的進場方向衝突。
  const expenseSheetOpen = addExpenseOpen || editingExpenseId != null
  const spotEditSheetOpen = addingSpotOpen || editingSpotId != null
  const bottomSheetOpen =
    edit || expenseSheetOpen || packEditItemId != null || catMgrKind != null || spotEditSheetOpen
  const hasOverlay = Boolean(settingsOpen || bottomSheetOpen || spot || detail || photoLightbox)
  const topmostFullPage = settingsOpen
    ? 'settings'
    : !bottomSheetOpen
      ? spot
        ? 'spot'
        : detail
          ? 'detail'
          : null
      : null
  const { dragX, maxDragX, commitThreshold, pageDragX, isDragging } = useEdgeSwipeBack(({ animateClose }) => {
    if (settingsOpen) animateClose(closeSettings)
    else if (photoLightbox) closePhotoLightbox()
    else if (edit) setEdit(null)
    else if (expenseSheetOpen) closeAddExpense()
    else if (packEditItemId != null) closePackItemEdit()
    else if (catMgrKind != null) closeCatMgr()
    else if (spotEditSheetOpen) {
      closeAddSpot()
      closeSpotEditor()
    } else if (spot) animateClose(closeSpot)
    else if (detail) animateClose(closeDetail)
  })
  // 右緣滑動開啟設定頁：只在沒有其他覆蓋層且已登入時響應，避免搶手勢或登入流程中被滑開。
  const { dragX: settingsOpenDragX, isDragging: settingsOpenDragging } = useEdgeSwipeOpenRight(
    !hasOverlay && authStatus === 'loggedIn',
    openSettings,
  )
  const settingsTranslateX = settingsOpen
    ? topmostFullPage === 'settings'
      ? pageDragX
      : 0
    : Math.max(0, window.innerWidth - settingsOpenDragX)
  const settingsDragging = settingsOpen ? topmostFullPage === 'settings' && isDragging : settingsOpenDragging

  return (
    <div className="app-shell">
      {/* 不畫自訂狀態列（時間/電量/訊號交給系統列），只留安全區間隔，避免第一個標題
          被系統時間那一列切到。 */}
      <div className="safe-area-spacer" />

      <div className="app-content">
        <OfflineBanner />

        <ActiveView />
      </div>

      {detail && (
        <PlanDetail
          swipeX={topmostFullPage === 'detail' ? pageDragX : 0}
          swipeDragging={topmostFullPage === 'detail' && isDragging}
        />
      )}
      {edit && <PlanEditSheet />}
      {spot && (
        <SpotDetail
          swipeX={topmostFullPage === 'spot' ? pageDragX : 0}
          swipeDragging={topmostFullPage === 'spot' && isDragging}
        />
      )}
      {expenseSheetOpen && <ExpenseSheet />}
      {packEditItemId != null && <PackItemEditSheet itemId={packEditItemId} onClose={closePackItemEdit} />}
      {catMgrKind && <CatManagerSheet kind={catMgrKind} onClose={closeCatMgr} />}
      {spotEditSheetOpen && (
        <SpotEditSheet
          existingSpot={editingSpotId != null ? allSpots.find((s) => s.id === editingSpotId) : undefined}
          onClose={() => {
            closeAddSpot()
            closeSpotEditor()
          }}
          onSaved={() => {
            closeAddSpot()
            closeSpotEditor()
          }}
          onDeleted={() => {
            closeAddSpot()
            closeSpotEditor()
            closeSpot()
          }}
        />
      )}
      {photoLightbox && (
        <PhotoLightbox src={photoLightbox.src} alt={photoLightbox.alt} onClose={closePhotoLightbox} />
      )}
      {(settingsOpen || settingsOpenDragX > 0) && (
        <SettingsSheet openX={settingsTranslateX} dragging={settingsDragging} />
      )}
      {(authStatus === 'loggedOut' || authStatus === 'pickingRole') && <AuthGate />}

      {toast && <Toast message={toast.message} />}

      {/* 左緣滑動返回的視覺回饋：跟著手指從左邊緣浮現的返回箭頭，拖到門檻會變色，
          放開瞬間才判斷有沒有觸發（見 useEdgeSwipeBack），沒有覆蓋層時完全不顯示。 */}
      {hasOverlay && (
        <div
          className={`edge-back-indicator${dragX > commitThreshold ? ' is-armed' : ''}`}
          style={{
            transform: `translateY(-50%) translateX(${dragX - maxDragX}px)`,
            opacity: dragX > 0 ? 1 : 0,
          }}
        >
          <CaretLeft size={16} weight="bold" />
        </div>
      )}

      <TabBar active={tab} onChange={handleTabChange} />
    </div>
  )
}
