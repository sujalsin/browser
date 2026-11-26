import { createContext, memo, useContext, useMemo, useRef, useState, type CSSProperties, type DragEvent, type KeyboardEvent, type ReactNode, type WheelEvent } from 'react'
import type { Folder, ListRef, Tab, TabRuntime, UIState } from '../../shared/types'
import { boostsFor } from '../../shared/boosts'
import { displayHost } from '../../shared/url'
import { Favicon } from './Favicon'
import { Icon } from './Icon'
import { dispatch } from './useBrowserState'

// ───────────────────────────── drag and drop ─────────────────────────────

type DropPos = 'before' | 'after' | 'into'

interface DragState {
  dragging: { id: string; isFolder: boolean } | null
  over: { key: string; pos: DropPos } | null
}

/**
 * What a row needs to take part in dragging. It never changes, so rows don't
 * re-render as the pointer moves during a drag; each row is told separately
 * (its `drop` prop) when the drop marker is on it.
 */
interface DragApi {
  get(): DragState
  setDragging(d: DragState['dragging']): void
  setOver(o: DragState['over']): void
}

const DragApiCtx = createContext<DragApi | null>(null)
/** The current drag, for the parts that draw it (drop zones, the lists). */
const DragCtx = createContext<DragState>({ dragging: null, over: null })

function refKey(ref: ListRef) {
  return ref.type === 'folder' ? `folder:${ref.id}` : ref.type
}

const dropKey = (ref: ListRef, id: string) => `${refKey(ref)}#${id}`

/**
 * Drag handlers for one sidebar item. `index` is its position in `ref`.
 * Folders accept tabs dropped onto their middle ("into"); tiles in the
 * favorites grid split left/right instead of top/bottom.
 */
function useDraggable(id: string, ref: ListRef, index: number, opts: { folder?: Folder; horizontal?: boolean } = {}) {
  const dnd = useContext(DragApiCtx)!
  const key = dropKey(ref, id)

  const allowed = () => {
    const d = dnd.get().dragging
    if (!d || d.id === id) return false
    // Folders don't nest and can't be favorites.
    if (d.isFolder && (ref.type === 'folder' || ref.type === 'favorites')) return false
    return true
  }

  const posFor = (e: DragEvent): DropPos => {
    const r = e.currentTarget.getBoundingClientRect()
    const f = opts.horizontal ? (e.clientX - r.left) / r.width : (e.clientY - r.top) / r.height
    if (opts.folder && !dnd.get().dragging?.isFolder) {
      // Top edge: above the folder. Bottom edge of a collapsed folder: below it. Otherwise: into it.
      if (f < 0.3) return 'before'
      if (f > 0.75 && opts.folder.collapsed) return 'after'
      return 'into'
    }
    return f < 0.5 ? 'before' : 'after'
  }

  return {
    draggable: true,
    onDragStart: (e: DragEvent) => {
      e.stopPropagation()
      e.dataTransfer.effectAllowed = 'move'
      e.dataTransfer.setData('text/plain', id)
      dnd.setDragging({ id, isFolder: !!opts.folder })
    },
    onDragEnd: () => {
      dnd.setDragging(null)
      dnd.setOver(null)
    },
    onDragOver: (e: DragEvent) => {
      if (!allowed()) return
      e.preventDefault()
      e.stopPropagation()
      e.dataTransfer.dropEffect = 'move'
      const pos = posFor(e)
      const over = dnd.get().over
      if (over?.key !== key || over.pos !== pos) dnd.setOver({ key, pos })
    },
    onDrop: (e: DragEvent) => {
      const d = dnd.get().dragging
      if (!d || !allowed()) return
      e.preventDefault()
      e.stopPropagation()
      const pos = posFor(e)
      if (pos === 'into' && opts.folder) {
        dispatch({ type: 'item.move', id: d.id, to: { type: 'folder', id: opts.folder.id }, index: opts.folder.children.length })
      } else {
        dispatch({ type: 'item.move', id: d.id, to: ref, index: pos === 'after' ? index + 1 : index })
      }
      dnd.setDragging(null)
      dnd.setOver(null)
    },
  }
}

/** Drop area at the end of a list (and the whole area when the list is empty). */
function EndDropZone({ listRef, length, label, inline }: { listRef: ListRef; length: number; label?: string; inline?: boolean }) {
  const dnd = useContext(DragCtx)
  const api = useContext(DragApiCtx)!
  const key = dropKey(listRef, 'end')
  const d = dnd.dragging
  const ok = !!d && !(d.isFolder && (listRef.type === 'folder' || listRef.type === 'favorites'))
  const Tag = inline ? 'div' : 'li'
  return (
    <Tag
      className={`end-drop ${d && ok ? 'dragging' : ''} ${length === 0 ? 'empty' : ''}`}
      data-drop={dnd.over?.key === key ? 'before' : undefined}
      onDragOver={(e) => {
        if (!ok) return
        e.preventDefault()
        e.stopPropagation()
        if (dnd.over?.key !== key) api.setOver({ key, pos: 'before' })
      }}
      onDrop={(e) => {
        if (!d || !ok) return
        e.preventDefault()
        e.stopPropagation()
        dispatch({ type: 'item.move', id: d.id, to: listRef, index: length })
        api.setDragging(null)
        api.setOver(null)
      }}
    >
      {d && ok && length === 0 && label ? label : null}
    </Tag>
  )
}

// ───────────────────────────── sidebar ─────────────────────────────

/** Looked up once per update instead of searching the lists for every row. */
interface Ctx {
  state: UIState
  tabs: Map<string, Tab>
  folders: Map<string, Folder>
  /** Tabs that are part of a split view. */
  inSplit: Set<string>
  editing: UIState['editing']
  startEdit(e: NonNullable<UIState['editing']>): void
  endEdit(): void
}

const SidebarCtx = createContext<Ctx | null>(null)

export function Sidebar({ state }: { state: UIState }) {
  const [showArchive, setShowArchive] = useState(false)
  const [dragging, setDragging] = useState<DragState['dragging']>(null)
  const [over, setOver] = useState<DragState['over']>(null)
  const [localEdit, setLocalEdit] = useState<UIState['editing']>(null)
  const swipe = useRef({ dx: 0, lockedUntil: 0 })

  const drag: DragState = { dragging, over }
  const dragRef = useRef(drag)
  dragRef.current = drag
  const dragApi = useMemo<DragApi>(() => ({ get: () => dragRef.current, setDragging, setOver }), [])

  const space = state.spaces.find((s) => s.id === state.activeSpaceId) ?? state.spaces[0]
  // Which way the list should come in when the space changes: from the side of the space you moved to.
  const spaceIndex = state.spaces.indexOf(space)
  const [arrival, setArrival] = useState({ id: space.id, index: spaceIndex, from: '' })
  if (arrival.id !== space.id) setArrival({ id: space.id, index: spaceIndex, from: spaceIndex >= arrival.index ? 'from-right' : 'from-left' })
  const active = state.tabs.find((t) => t.id === state.activeTabId)
  const rt = active ? state.runtime[active.id] : undefined
  const favorites = state.favorites[space.partition] ?? []
  const editing = localEdit ?? state.editing
  const hasToday = space.today.length > 0

  const ctx: Ctx = {
    state,
    tabs: new Map(state.tabs.map((t) => [t.id, t])),
    folders: new Map(state.folders.map((f) => [f.id, f])),
    inSplit: new Set(state.splits.flatMap((sp) => sp.tabIds)),
    editing,
    startEdit: (e) => setLocalEdit(e),
    endEdit: () => {
      setLocalEdit(null)
      if (state.editing) dispatch({ type: 'edit.cancel' })
    },
  }

  // Two-finger horizontal swipe switches spaces, like Arc.
  const onWheel = (e: WheelEvent) => {
    if (Math.abs(e.deltaX) <= Math.abs(e.deltaY) * 1.5) return
    const now = Date.now()
    if (now < swipe.current.lockedUntil) return
    swipe.current.dx += e.deltaX
    if (Math.abs(swipe.current.dx) > 90) {
      dispatch({ type: 'space.cycle', delta: swipe.current.dx > 0 ? 1 : -1 })
      swipe.current = { dx: 0, lockedUntil: now + 600 }
    }
  }

  return (
    <DragApiCtx.Provider value={dragApi}>
      <DragCtx.Provider value={drag}>
        <SidebarCtx.Provider value={ctx}>
          <aside className={`sidebar ${dragging ? 'is-dragging' : ''}`} onWheel={onWheel}>
            <header className="sidebar-top">
              <div className="traffic-light-space" />
              <div className="nav-buttons">
                <button className="icon-btn" title="Hide sidebar (⌘S)" onClick={() => dispatch({ type: 'sidebar.toggle' })}>
                  <Icon name="sidebar" />
                </button>
                <button className="icon-btn" title="Back (⌘[)" disabled={!rt?.canGoBack} onClick={() => dispatch({ type: 'nav.back' })}>
                  <Icon name="back" />
                </button>
                <button className="icon-btn" title="Forward (⌘])" disabled={!rt?.canGoForward} onClick={() => dispatch({ type: 'nav.forward' })}>
                  <Icon name="forward" />
                </button>
                <button className="icon-btn" title="Reload (⌘R)" disabled={!rt} onClick={() => dispatch({ type: 'nav.reload' })}>
                  <Icon name="reload" />
                </button>
              </div>
            </header>

            <AddressField state={state} active={active} rt={rt} />

            {space.private ? (
              <div className="private-banner" title="History isn’t saved; cookies are discarded when you close this space. Extensions are off.">
                <Icon name="private" size={14} /> Private — nothing is saved
                <button className="lib-button small" onClick={() => dispatch({ type: 'space.closePrivate', id: space.id })}>
                  Close
                </button>
              </div>
            ) : (
              <div className="extensions-row">
                <browser-action-list partition={space.partition} alignment="bottom right" />
              </div>
            )}

            <div className={`tab-scroll ${arrival.from}`} key={space.id}>
              <Favorites ids={favorites} />

              <div className="space-header" onContextMenu={(e) => (e.preventDefault(), dispatch({ type: 'space.menu', id: space.id }))}>
                {!space.private && <span className="space-chip" />}
                {editing?.type === 'space' && editing.id === space.id ? (
                  <EditableName value={space.name} onCommit={(name) => dispatch({ type: 'space.rename', id: space.id, name })} />
                ) : (
                  <span className="space-title" onDoubleClick={() => setLocalEdit({ type: 'space', id: space.id })} title="Double-click to rename">
                    {space.name}
                  </span>
                )}
                <button className="icon-btn small" title="New folder" onClick={() => dispatch({ type: 'folder.create', list: 'pinned' })}>
                  <Icon name="folderPlus" size={14} />
                </button>
                <button className="icon-btn small" title="Space options" onClick={() => dispatch({ type: 'space.menu', id: space.id })}>
                  <Icon name="more" size={14} />
                </button>
              </div>

              <ItemList ids={space.pinned} listRef={{ type: 'pinned' }} dropLabel="Drop here to pin" />

              <div className="divider-row">
                <div className="divider" />
                {hasToday && (
                  <button className="clear-btn" title="Close duplicates and group tabs by site (⇧⌘Y)" onClick={() => dispatch({ type: 'tabs.tidy' })}>
                    <Icon name="tidy" size={11} /> Tidy
                  </button>
                )}
                {hasToday && (
                  <button className="clear-btn" title="Archive all Today tabs (⇧⌘K)" onClick={() => dispatch({ type: 'tabs.clearToday' })}>
                    <Icon name="arrowDown" size={11} /> Clear
                  </button>
                )}
              </div>

              <button className="new-tab-row" onClick={() => dispatch({ type: 'commandBar.open', mode: 'new' })}>
                <Icon name="plus" /> New Tab
              </button>

              <ItemList ids={space.today} listRef={{ type: 'today' }} dropLabel="Drop here to unpin" />
            </div>

            {showArchive && <ArchivePanel state={state} />}

            <footer className="sidebar-bottom">
              <button className={`icon-btn ${showArchive ? 'on' : ''}`} title="Archived tabs" onClick={() => setShowArchive((v) => !v)}>
                <Icon name="archive" />
              </button>
              <DownloadsButton state={state} />
              <SpaceSwitcher state={state} />
              <button className="icon-btn" title="New space" onClick={() => dispatch({ type: 'space.addMenu' })}>
                <Icon name="plus" size={15} />
              </button>
            </footer>
          </aside>
        </SidebarCtx.Provider>
      </DragCtx.Provider>
    </DragApiCtx.Provider>
  )
}

/** Site info, the address (opens the command bar) and Shields, in one field. */
function AddressField({ state, active, rt }: { state: UIState; active?: Tab; rt?: TabRuntime }) {
  const secure = !!active && active.url.startsWith('https://')
  return (
    <div className={`url-pill ${rt?.loading ? 'loading' : ''}`}>
      {active && (
        <button
          className={`site-btn ${active.url.startsWith('http://') ? 'insecure' : ''}`}
          title={secure ? 'Connection is secure — site info' : 'Site info'}
          onClick={() => dispatch({ type: 'site.info' })}
        >
          <Icon name={secure ? 'lock' : 'info'} size={13} />
        </button>
      )}
      <button className="url-main" title="Edit URL (⌘L)" onClick={() => dispatch({ type: 'commandBar.open', mode: active ? 'edit' : 'new' })}>
        {active && state.hoverUrl ? (
          // Hovering a link: show where it goes (Chrome's status bubble, without an extra view).
          <span className="url-text hover" title={state.hoverUrl}>
            → {state.hoverUrl.replace(/^https?:\/\/(www\.)?/, '')}
          </span>
        ) : active ? (
          <>
            <span className="url-text">{displayHost(active.url)}</span>
            {rt?.translated && (
              <span className="url-boost" title={`Translated to ${rt.translated}`}>
                <Icon name="translate" size={13} />
              </span>
            )}
            {boostsFor(state.boosts, active.url).length > 0 && (
              <span className="url-boost" title="A Boost is active on this site">
                <Icon name="boost" size={12} />
              </span>
            )}
          </>
        ) : (
          <span className="url-placeholder">Search or enter URL…</span>
        )}
      </button>
      <ShieldsButton state={state} />
    </div>
  )
}

// ───────────────────────────── lists ─────────────────────────────

function ItemList({ ids, listRef, dropLabel }: { ids: string[]; listRef: ListRef; dropLabel?: string }) {
  const { state, tabs, folders, inSplit } = useContext(SidebarCtx)!
  const { over } = useContext(DragCtx)
  const items: ReactNode[] = []
  ids.forEach((id, index) => {
    const folder = folders.get(id)
    if (folder) {
      items.push(<FolderItem key={id} folder={folder} listRef={listRef} index={index} drop={over?.key === dropKey(listRef, id) ? over.pos : undefined} />)
      return
    }
    const tab = tabs.get(id)
    if (!tab) return
    const rt = state.runtime[id]
    items.push(
      <TabRow
        key={id}
        id={id}
        title={tab.title}
        url={tab.url}
        favicon={tab.favicon}
        keeps={tab.kind !== 'today'}
        listType={listRef.type}
        folderId={listRef.type === 'folder' ? listRef.id : undefined}
        index={index}
        active={state.activeTabId === id}
        awake={!!rt}
        loaded={!!rt?.loaded}
        loading={!!rt?.loading}
        audible={!!rt?.audible}
        muted={!!rt?.muted}
        inSplit={inSplit.has(id)}
        drop={over?.key === dropKey(listRef, id) ? over.pos : undefined}
      />,
    )
  })
  return (
    <ul className="tab-list">
      {items}
      <EndDropZone listRef={listRef} length={ids.length} label={dropLabel} />
    </ul>
  )
}

function FolderItem({ folder, listRef, index, drop }: { folder: Folder; listRef: ListRef; index: number; drop?: DropPos }) {
  const { editing, startEdit } = useContext(SidebarCtx)!
  const drag = useDraggable(folder.id, listRef, index, { folder })
  const isEditing = editing?.type === 'folder' && editing.id === folder.id
  return (
    <li className="folder">
      <div
        {...drag}
        data-drop={drop}
        className="folder-row"
        onClick={() => !isEditing && dispatch({ type: 'folder.toggle', id: folder.id })}
        onDoubleClick={(e) => {
          e.stopPropagation()
          startEdit({ type: 'folder', id: folder.id })
        }}
        onContextMenu={(e) => {
          e.preventDefault()
          dispatch({ type: 'folder.menu', id: folder.id })
        }}
      >
        <Icon name="chevron" size={12} className={`folder-chevron ${folder.collapsed ? '' : 'open'}`} />
        <Icon name={folder.collapsed ? 'folder' : 'folderOpen'} size={15} className="folder-icon" />
        {isEditing ? (
          <EditableName value={folder.name} onCommit={(name) => dispatch({ type: 'folder.rename', id: folder.id, name })} />
        ) : (
          <span className="tab-title">{folder.name}</span>
        )}
        {folder.collapsed && folder.children.length > 0 && <span className="folder-count">{folder.children.length}</span>}
      </div>
      {!folder.collapsed && (
        <div className="folder-children">
          <ItemList ids={folder.children} listRef={{ type: 'folder', id: folder.id }} dropLabel="Empty folder" />
        </div>
      )}
    </li>
  )
}

interface TabRowProps {
  id: string
  title: string
  url: string
  favicon?: string
  /** Pinned tabs stay in the list when closed (closing only unloads them). */
  keeps: boolean
  listType: ListRef['type']
  folderId?: string
  index: number
  active: boolean
  /** Has a live page (not asleep). */
  awake: boolean
  loaded: boolean
  loading: boolean
  audible: boolean
  muted: boolean
  inSplit: boolean
  drop?: DropPos
}

/**
 * One tab. Takes plain values rather than the whole state, so a row is only
 * redrawn when something about that tab changed. The browser sends a fresh
 * state many times a second while pages load or the pointer crosses links.
 */
const TabRow = memo(function TabRow(p: TabRowProps) {
  const listRef: ListRef = p.listType === 'folder' ? { type: 'folder', id: p.folderId! } : { type: p.listType }
  const drag = useDraggable(p.id, listRef, p.index)
  // Pinned tabs only show a button when loaded (it unloads them, like Arc).
  const showClose = !p.keeps || p.loaded

  return (
    <li
      {...drag}
      data-drop={p.drop}
      className={`tab-row ${p.active ? 'active' : ''} ${p.awake ? '' : 'asleep'}`}
      onMouseDown={(e) => {
        if (e.button === 0) dispatch({ type: 'tab.activate', id: p.id })
      }}
      onAuxClick={(e) => {
        if (e.button === 1) dispatch({ type: 'tab.close', id: p.id })
      }}
      onContextMenu={(e) => {
        e.preventDefault()
        dispatch({ type: 'tab.contextMenu', id: p.id })
      }}
      title={p.url}
    >
      <Favicon src={p.favicon} loading={p.loading} url={p.url} />
      <span className="tab-title">{p.title || displayHost(p.url)}</span>
      {p.audible && <Icon name={p.muted ? 'muted' : 'speaker'} size={13} className="tab-audio" />}
      {p.inSplit && (
        <span title="In split view">
          <Icon name="split" size={13} className="tab-audio" />
        </span>
      )}
      {showClose && (
        <button
          className="tab-close"
          title={p.keeps ? 'Unload tab' : 'Close tab (⌘W)'}
          draggable={false}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={() => dispatch({ type: 'tab.close', id: p.id })}
        >
          <Icon name={p.keeps ? 'minus' : 'close'} size={12} />
        </button>
      )}
    </li>
  )
})

function Favorites({ ids }: { ids: string[] }) {
  const { state, tabs } = useContext(SidebarCtx)!
  const dnd = useContext(DragCtx)
  const listRef: ListRef = { type: 'favorites' }
  if (!ids.length && !dnd.dragging) return null
  return (
    <div className={`favorites ${ids.length ? '' : 'empty'}`}>
      {ids.map((id, index) => {
        const tab = tabs.get(id)
        if (!tab) return null
        const rt = state.runtime[id]
        return (
          <FavoriteTile
            key={id}
            id={id}
            title={tab.title}
            url={tab.url}
            favicon={tab.favicon}
            index={index}
            active={state.activeTabId === id}
            awake={!!rt}
            loading={!!rt?.loading}
            drop={dnd.over?.key === dropKey(listRef, id) ? dnd.over.pos : undefined}
          />
        )
      })}
      <EndDropZone listRef={listRef} length={ids.length} label="Drop here to add to Favorites" inline />
    </div>
  )
}

interface FavoriteProps {
  id: string
  title: string
  url: string
  favicon?: string
  index: number
  active: boolean
  awake: boolean
  loading: boolean
  drop?: DropPos
}

const FavoriteTile = memo(function FavoriteTile(p: FavoriteProps) {
  const drag = useDraggable(p.id, { type: 'favorites' }, p.index, { horizontal: true })
  return (
    <div
      {...drag}
      data-drop={p.drop}
      className={`favorite ${p.active ? 'active' : ''} ${p.awake ? 'loaded' : ''}`}
      title={p.title || p.url}
      onMouseDown={(e) => {
        if (e.button === 0) dispatch({ type: 'tab.activate', id: p.id })
      }}
      onAuxClick={(e) => {
        if (e.button === 1) dispatch({ type: 'tab.close', id: p.id })
      }}
      onContextMenu={(e) => {
        e.preventDefault()
        dispatch({ type: 'tab.contextMenu', id: p.id })
      }}
    >
      <Favicon src={p.favicon} loading={p.loading} url={p.url} />
    </div>
  )
})

// ───────────────────────────── bits ─────────────────────────────

function EditableName({ value, onCommit }: { value: string; onCommit(name: string): void }) {
  const { endEdit } = useContext(SidebarCtx)!
  const done = useRef(false)
  const finish = (name: string | null) => {
    if (done.current) return
    done.current = true
    if (name !== null && name.trim() && name.trim() !== value) onCommit(name)
    endEdit()
  }
  return (
    <input
      className="name-input"
      defaultValue={value}
      autoFocus
      spellCheck={false}
      onFocus={(e) => e.currentTarget.select()}
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Enter') finish(e.currentTarget.value)
        else if (e.key === 'Escape') finish(null)
      }}
      onBlur={(e) => finish(e.currentTarget.value)}
    />
  )
}

function SpaceSwitcher({ state }: { state: UIState }) {
  return (
    <div className="spaces">
      {state.spaces.map((sp, i) => (
        <button
          key={sp.id}
          className={`space-dot-btn ${sp.id === state.activeSpaceId ? 'active' : ''} ${sp.private ? 'private' : ''}`}
          style={{ '--dot': sp.color } as CSSProperties}
          title={`${sp.name}${i < 9 ? ` (⌃${i + 1})` : ''}`}
          onClick={() => dispatch({ type: 'space.switch', id: sp.id })}
          onContextMenu={(e) => {
            e.preventDefault()
            dispatch({ type: 'space.menu', id: sp.id })
          }}
        >
          {sp.private ? <Icon name="private" size={13} /> : <span className="dot" />}
        </button>
      ))}
    </div>
  )
}

function ArchivePanel({ state }: { state: UIState }) {
  const items = state.archive
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => item.spaceId === state.activeSpaceId)
    .slice(0, 50)
  return (
    <div className="archive-panel">
      <div className="archive-title">Archive</div>
      {items.length === 0 && <div className="archive-empty">Cleared tabs show up here.</div>}
      <ul className="tab-list">
        {items.map(({ item, index }) => (
          <li key={`${index}-${item.archivedAt}`} className="tab-row" onClick={() => dispatch({ type: 'archive.restore', index })} title={item.url}>
            <Favicon src={item.favicon} url={item.url} />
            <span className="tab-title">{item.title || displayHost(item.url)}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

function ShieldsButton({ state }: { state: UIState }) {
  const active = state.tabs.find((t) => t.id === state.activeTabId)
  const blocked = active ? (state.runtime[active.id]?.blocked ?? 0) : 0
  const on = state.activeShieldsOn
  const title = !state.shieldsStatus.ready
    ? 'Shields: downloading filter lists…'
    : on
      ? `Shields: ${blocked} blocked on this page`
      : 'Shields are off for this site'
  return (
    <button className={`shields-btn ${on ? '' : 'off'}`} title={title} onClick={() => dispatch({ type: 'shields.menu' })}>
      <Icon name={on ? 'shield' : 'shieldOff'} size={15} />
      {on && blocked > 0 && <span className="shields-count">{blocked > 99 ? '99+' : blocked}</span>}
    </button>
  )
}

/** Shows while something is downloading (with progress) or a finished download is new. */
function DownloadsButton({ state }: { state: UIState }) {
  const active = state.downloads.filter((d) => d.state === 'progressing')
  if (!active.length && !state.downloadsUnseen) return null
  const total = active.reduce((n, d) => n + d.total, 0)
  const received = active.reduce((n, d) => n + d.received, 0)
  const pct = total ? Math.round((received / total) * 100) : 0
  return (
    <button
      className={`icon-btn downloads-btn ${state.downloadsUnseen ? 'unseen' : ''}`}
      title={active.length ? `Downloading ${active.length} file${active.length > 1 ? 's' : ''}${total ? ` (${pct}%)` : ''}` : 'Download finished'}
      style={{ '--pct': `${active.length ? pct : 100}%` } as CSSProperties}
      onClick={() => dispatch({ type: 'library.open', tab: 'downloads' })}
    >
      <Icon name="download" size={15} />
    </button>
  )
}
