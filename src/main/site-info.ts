import { Menu, dialog, session, type BrowserWindow, type MenuItemConstructorOptions, type Session } from 'electron'
import { getPermission, setPermission } from './permissions'
import { Shields } from './shields'

/** Permissions offered in the site menu, in Chrome's order. */
const SITE_PERMISSIONS: [permission: string, label: string][] = [
  ['media', 'Camera & Microphone'],
  ['geolocation', 'Location'],
  ['notifications', 'Notifications'],
  ['clipboard-read', 'Clipboard'],
  ['display-capture', 'Screen Recording'],
]

interface SiteInfoOptions {
  win: BrowserWindow
  url: string
  partition: string
  reload(): void
  openSettings(): void
}

/**
 * The menu behind the lock button: is the connection secure, what may this
 * site do (Ask / Allow / Block per permission), how many cookies it has, and a
 * way to clear its cookies and stored data.
 */
export async function showSiteInfo({ win, url, partition, reload, openSettings }: SiteInfoOptions): Promise<void> {
  let page: URL
  try {
    page = new URL(url)
  } catch {
    return
  }
  const isWeb = page.protocol === 'https:' || page.protocol === 'http:'
  const site = Shields.siteOf(url)
  const ses = session.fromPartition(partition)
  const cookies = isWeb && site ? await siteCookies(ses, site) : []

  const items: MenuItemConstructorOptions[] = [
    { label: isWeb ? page.host : url.slice(0, 60), enabled: false },
    {
      label:
        page.protocol === 'https:'
          ? 'Connection is secure'
          : page.protocol === 'http:'
            ? 'Connection is not secure — don’t enter passwords or card numbers'
            : 'This is a page from your computer or the browser',
      enabled: false,
    },
  ]

  if (isWeb) {
    items.push({ type: 'separator' })
    for (const [permission, label] of SITE_PERMISSIONS) {
      const current = getPermission(partition, page.origin, permission)
      const set = (allowed: boolean | null) => () => setPermission(partition, page.origin, permission, allowed)
      items.push({
        label: `${label}: ${current === undefined ? 'Ask' : current ? 'Allow' : 'Block'}`,
        submenu: [
          { label: 'Ask (default)', type: 'radio', checked: current === undefined, click: set(null) },
          { label: 'Allow', type: 'radio', checked: current === true, click: set(true) },
          { label: 'Block', type: 'radio', checked: current === false, click: set(false) },
        ],
      })
    }
    items.push(
      { type: 'separator' },
      { label: `${cookies.length} cookie${cookies.length === 1 ? '' : 's'} from ${site}`, enabled: false },
      {
        label: 'Clear Cookies and Site Data…',
        click: async () => {
          const { response } = await dialog.showMessageBox(win, {
            type: 'warning',
            buttons: ['Clear', 'Cancel'],
            defaultId: 1,
            cancelId: 1,
            message: `Clear cookies and data for ${site}?`,
            detail: 'You will be signed out of this site, and anything it saved on your Mac is removed.',
          })
          if (response !== 0) return
          await clearSiteData(partition, site!, page.origin)
          reload()
        },
      },
    )
  }
  items.push({ type: 'separator' }, { label: 'All Site Settings…', click: openSettings })
  Menu.buildFromTemplate(items).popup({ window: win })
}

/**
 * Cookies belonging to a site: its own domain and every subdomain.
 * (Electron's `cookies.get({ domain })` only returns cookies that apply to that
 * exact host, so cookies set by shop.example.com are missed when asking for example.com.)
 */
async function siteCookies(ses: Session, site: string): Promise<Electron.Cookie[]> {
  const all = await ses.cookies.get({}).catch(() => [])
  return all.filter((c) => {
    const domain = (c.domain ?? '').replace(/^\./, '')
    return domain === site || domain.endsWith(`.${site}`)
  })
}

/** Remove a site's cookies (including subdomains) and its stored data. */
export async function clearSiteData(partition: string, site: string, origin: string): Promise<number> {
  const ses = session.fromPartition(partition)
  const cookies = await siteCookies(ses, site)
  for (const c of cookies) {
    const host = (c.domain ?? site).replace(/^\./, '')
    await ses.cookies.remove(`${c.secure ? 'https' : 'http'}://${host}${c.path ?? '/'}`, c.name).catch(() => {})
  }
  await ses
    .clearStorageData({ origin, storages: ['localstorage', 'indexdb', 'cachestorage', 'serviceworkers', 'filesystem'] })
    .catch(() => {})
  return cookies.length
}
