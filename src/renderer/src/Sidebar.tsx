import { createContext, useContext, useRef, useState, type CSSProperties, type DragEvent, type KeyboardEvent, type ReactNode, type WheelEvent } from 'react'
import type { Folder, ListRef, Tab, UIState } from '../../shared/types'
import { displayHost } from '../../shared/url'
import { Favicon } from './Favicon'
import { Icon } from './Icon'
import { dispatch } from './useBrowserState'

// ───────────────────────────── drag and drop ─────────────────────────────

type DropPos = 'before' | 'after' | 'into'

interface DragState {
  dragging: { id: string; isFolder: boolean } | null
  over: { key: string; pos: DropPos } | null
  setDragging(d: DragState['dragging']): void
  setOver(o: DragState['over']): void
}

const DragCtx = createContext<DragState | null>(null)

function refKey(ref: ListRef) {
  return ref.type === 'folder' ? `folder:${ref.id}` : ref.type
}

/**
 * Drag handlers for one sidebar item. `index` is its position in `ref`.
 * Folders accept tabs dropped onto their middle ("into"); tiles in the
 * favorites grid split left/right instead of top/bottom.
 */
function useDraggable(id: string, ref: ListRef, index: number, opts: { folder?: Folder; horizontal?: boolean } = {}) {
  const dnd = useContext(DragCtx)!
  const key = `${refKey(ref)}#${id}`

  const allowed = () => {
    const d = dnd.dragging
    if (!d || d.id === id) return false
    // Folders don't nest and can't be favorites.
    if (d.isFolder && (ref.type === 'folder' || ref.type === 'favorites')) return false
    return true
  }

  const posFor = (e: DragEvent): DropPos => {
    const r = e.currentTarget.getBoundingClientRect()
    const f = opts.horizontal ? (e.clientX - r.left) / r.width : (e.clientY - r.top) / r.height
    if (opts.folder && !dnd.dragging?.isFolder) {
      // Top edge: above the folder. Bottom edge of a collapsed folder: below it. Otherwise: into it.
      if (f < 0.3) return 'before'
      if (f > 0.75 && opts.folder.collapsed) return 'after'
      return 'into'
    }
    return f < 0.5 ? 'before' : 'after'
  }

  return {
    draggable: true,
    'data-drop': dnd.over?.key === key ? dnd.over.pos : undefined,
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
      if (dnd.over?.key !== key || dnd.over.pos !== pos) dnd.setOver({ key, pos })
    },
    onDrop: (e: DragEvent) => {
      const d = dnd.dragging
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
  const dnd = useContext(DragCtx)!
  const key = `${refKey(listRef)}#end`
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
        if (dnd.over?.key !== key) dnd.setOver({ key, pos: 'before' })
      }}
      onDrop={(e) => {
        if (!d || !ok) return
        e.preventDefault()
        e.stopPropagation()
        dispatch({ type: 'item.move', id: d.id, to: listRef, index: length })
        dnd.setDragging(null)
        dnd.setOver(null)
      }}
    >
      {d && ok && length === 0 && label ? label : null}
    </Tag>
  )
}

// ───────────────────────────── sidebar ─────────────────────────────

export function Sidebar({ state }: { state: UIState }) {
  const [showArchive, setShowArchive] = useState(false)
  const [dragging, setDragging] = useState<DragState['dragging']>(null)
  const [over, setOver] = useState<DragState['over']>(null)
  const [localEdit, setLocalEdit] = useState<UIState['editing']>(null)
  const swipe = useRef({ dx: 0, lockedUntil: 0 })

  const space = state.spaces.find((s) => s.id === state.activeSpaceId) ?? state.spaces[0]
  const active = state.tabs.find((t) => t.id === state.activeTabId)
  const rt = active ? state.runtime[active.id] : undefined
  const favorites = state.favorites[space.partition] ?? []
  const editing = localEdit ?? state.editing
  const hasToday = space.today.length > 0

  const ctx: Ctx = {
    state,
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
    <DragCtx.Provider value={{ dragging, over, setDragging, setOver }}>
      <SidebarCtx.Provider value={ctx}>
        <aside className={`sidebar ${dragging ? 'is-dragging' : ''}`} onWheel={onWheel}>
          <header className="sidebar-top">
            <div className="traffic-light-space" />
            <div className="nav-buttons">
              <button className="icon-btn" title="Toggle sidebar (⌘S)" onClick={() => dispatch({ type: 'sidebar.toggle' })}>
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

          <div className="url-row">
            <button className="url-pill" title="Edit URL (⌘L)" onClick={() => dispatch({ type: 'commandBar.open', mode: active ? 'edit' : 'new' })}>
              {active ? (
                <>
                  {active.url.startsWith('https://') && <Icon name="lock" size={12} />}
                  <span className="url-text">{displayHost(active.url)}</span>
                </>
              ) : (
                <span className="url-placeholder">Search or enter URL…</span>
              )}
            </button>
            <ShieldsButton state={state} />
          </div>

          <div className="extensions-row">
            <browser-action-list partition={space.partition} alignment="bottom right" />
          </div>

          <div className="tab-scroll">
            <Favorites ids={favorites} />

            <div className="space-header" onContextMenu={(e) => (e.preventDefault(), dispatch({ type: 'space.menu', id: space.id }))}>
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
            <SpaceSwitcher state={state} />
            <DownloadsButton state={state} />
            <button className="icon-btn" title="New space" onClick={() => dispatch({ type: 'space.addMenu' })}>
              <Icon name="plus" size={15} />
            </button>
            <button className={`icon-btn ${showArchive ? 'on' : ''}`} title="Archived tabs" onClick={() => setShowArchive((v) => !v)}>
              <Icon name="archive" />
            </button>
          </footer>
        </aside>
      </SidebarCtx.Provider>
    </DragCtx.Provider>
  )
}

interface Ctx {
  state: UIState
  editing: UIState['editing']
  startEdit(e: NonNullable<UIState['editing']>): void
  endEdit(): void
}

const SidebarCtx = createContext<Ctx | null>(null)

// ───────────────────────────── lists ─────────────────────────────

function ItemList({ ids, listRef, dropLabel }: { ids: string[]; listRef: ListRef; dropLabel?: string }) {
  const { state } = useContext(SidebarCtx)!
  const items: ReactNode[] = []
  ids.forEach((id, index) => {
    const folder = state.folders.find((f) => f.id === id)
    if (folder) {
      items.push(<FolderItem key={id} folder={folder} listRef={listRef} index={index} />)
      return
    }
    const tab = state.tabs.find((t) => t.id === id)
    if (tab) items.push(<TabRow key={id} tab={tab} listRef={listRef} index={index} />)
  })
  return (
    <ul className="tab-list">
      {items}
      <EndDropZone listRef={listRef} length={ids.length} label={dropLabel} />
    </ul>
  )
}

function FolderItem({ folder, listRef, index }: { folder: Folder; listRef: ListRef; index: number }) {
  const { editing, startEdit } = useContext(SidebarCtx)!
  const drag = useDraggable(folder.id, listRef, index, { folder })
  const isEditing = editing?.type === 'folder' && editing.id === folder.id
  return (
    <li className="folder">
      <div
        {...drag}
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
        <Icon name="folder" size={15} className="folder-icon" />
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

function TabRow({ tab, listRef, index }: { tab: Tab; listRef: ListRef; index: number }) {
  const { state } = useContext(SidebarCtx)!
  const drag = useDraggable(tab.id, listRef, index)
  const rt = state.runtime[tab.id]
  const isActive = state.activeTabId === tab.id
  const keeps = tab.kind !== 'today'
  // Pinned tabs only show a button when loaded (it unloads them, like Arc).
  const showClose = !keeps || rt?.loaded

  return (
    <li
      {...drag}
      className={`tab-row ${isActive ? 'active' : ''} ${rt ? '' : 'asleep'}`}
      onMouseDown={(e) => {
        if (e.button === 0) dispatch({ type: 'tab.activate', id: tab.id })
      }}
      onAuxClick={(e) => {
        if (e.button === 1) dispatch({ type: 'tab.close', id: tab.id })
      }}
      onContextMenu={(e) => {
        e.preventDefault()
        dispatch({ type: 'tab.contextMenu', id: tab.id })
      }}
      title={tab.url}
    >
      <Favicon src={tab.favicon} loading={rt?.loading} url={tab.url} />
      <span className="tab-title">{tab.title || displayHost(tab.url)}</span>
      {rt?.audible && <Icon name={rt.muted ? 'muted' : 'speaker'} size={13} className="tab-audio" />}
      {state.splits.some((sp) => sp.tabIds.includes(tab.id)) && (
        <span title="In split view">
          <Icon name="split" size={13} className="tab-audio" />
        </span>
      )}
      {showClose && (
        <button
          className="tab-close"
          title={keeps ? 'Unload tab' : 'Close tab (⌘W)'}
          draggable={false}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={() => dispatch({ type: 'tab.close', id: tab.id })}
        >
          <Icon name={keeps ? 'minus' : 'close'} size={12} />
        </button>
      )}
    </li>
  )
}

function Favorites({ ids }: { ids: string[] }) {
  const { state } = useContext(SidebarCtx)!
  const dnd = useContext(DragCtx)!
  if (!ids.length && !dnd.dragging) return null
  return (
    <div className={`favorites ${ids.length ? '' : 'empty'}`}>
      {ids.map((id, index) => {
        const tab = state.tabs.find((t) => t.id === id)
        return tab ? <FavoriteTile key={id} tab={tab} index={index} /> : null
      })}
      <EndDropZone listRef={{ type: 'favorites' }} length={ids.length} label="Drop here to add to Favorites" inline />
    </div>
  )
}

function FavoriteTile({ tab, index }: { tab: Tab; index: number }) {
  const { state } = useContext(SidebarCtx)!
  const drag = useDraggable(tab.id, { type: 'favorites' }, index, { horizontal: true })
  const rt = state.runtime[tab.id]
  return (
    <div
      {...drag}
      className={`favorite ${state.activeTabId === tab.id ? 'active' : ''} ${rt ? 'loaded' : ''}`}
      title={tab.title || tab.url}
      onMouseDown={(e) => {
        if (e.button === 0) dispatch({ type: 'tab.activate', id: tab.id })
      }}
      onAuxClick={(e) => {
        if (e.button === 1) dispatch({ type: 'tab.close', id: tab.id })
      }}
      onContextMenu={(e) => {
        e.preventDefault()
        dispatch({ type: 'tab.contextMenu', id: tab.id })
      }}
    >
      <Favicon src={tab.favicon} loading={rt?.loading} url={tab.url} />
    </div>
  )
}

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
          className={`space-dot-btn ${sp.id === state.activeSpaceId ? 'active' : ''}`}
          style={{ '--dot': sp.color } as CSSProperties}
          title={`${sp.name}${i < 9 ? ` (⌃${i + 1})` : ''}`}
          onClick={() => dispatch({ type: 'space.switch', id: sp.id })}
          onContextMenu={(e) => {
            e.preventDefault()
            dispatch({ type: 'space.menu', id: sp.id })
          }}
        >
          <span className="dot" />
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
