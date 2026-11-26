/// <reference lib="dom" />
// Saved passwords, the part inside the page: notice sign-in fields, put a
// chosen login into them, and notice a password being sent.
//
// Kept cheap, since it runs in every page and frame: a handful of listeners on
// the document and nothing else. No scanning of the page, no watching it change.
// It runs in its own JavaScript world: the page's scripts can't see or call it.
import { ipcRenderer } from 'electron'
import { LOGINS, passwordToSave } from '../shared/passwords'

const TEXT_TYPES = new Set(['text', 'email', 'tel', ''])
const isVisible = (el: HTMLElement) => el.getClientRects().length > 0
const looksLikeUsername = (el: HTMLInputElement) => el.type === 'email' || /user|email|login|account|identifier/i.test(`${el.autocomplete} ${el.name} ${el.id}`)

/** The form a field belongs to, or the whole page for sites that don't use a form. */
const scopeOf = (el: Element): ParentNode => (el as HTMLInputElement).form ?? el.closest('form') ?? document

const passwordFields = (scope: ParentNode) => [...scope.querySelectorAll<HTMLInputElement>('input[type=password]')]

/** The text field a user name goes in: the last one before the password field, or one named like a user name. */
function usernameField(scope: ParentNode, password?: HTMLInputElement): HTMLInputElement | null {
  const fields = [...scope.querySelectorAll<HTMLInputElement>('input')].filter((el) => TEXT_TYPES.has(el.type) && isVisible(el))
  if (!password) return fields.find(looksLikeUsername) ?? null
  let found: HTMLInputElement | null = null
  for (const el of fields) if (el.compareDocumentPosition(password) & Node.DOCUMENT_POSITION_FOLLOWING) found = el
  return found
}

/** Set a field the way typing would, so sites built with React and the like notice. */
function setValue(el: HTMLInputElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, value)
  el.dispatchEvent(new Event('input', { bubbles: true }))
  el.dispatchEvent(new Event('change', { bubbles: true }))
}

// ── offering saved logins ──

/** The field that asked, so the answer goes to the right form. */
let asked: { field: HTMLInputElement; scope: ParentNode } | null = null
/** Each field asks once per page: closing the menu means "let me type". */
const askedBefore = new WeakSet<HTMLInputElement>()

document.addEventListener(
  'focusin',
  (event) => {
    const el = event.target
    if (!(el instanceof HTMLInputElement) || el.value || el.readOnly || askedBefore.has(el)) return
    const scope = scopeOf(el)
    if (el.type === 'password') {
      if (el.autocomplete === 'new-password') return // choosing a new password, not signing in
    } else {
      if (!TEXT_TYPES.has(el.type)) return
      const password = passwordFields(scope).find(isVisible)
      // Only the user-name field of a sign-in form, not every text box near a password.
      if (password ? usernameField(scope, password) !== el : !looksLikeUsername(el)) return
    }
    askedBefore.add(el)
    asked = { field: el, scope }
    const box = el.getBoundingClientRect()
    ipcRenderer.send(LOGINS.focus, { x: box.left, y: box.bottom + 2, top: window === window.top })
  },
  true,
)

ipcRenderer.on(LOGINS.fill, (_event, login: { username: string; password: string }) => {
  if (!asked || !asked.field.isConnected) return
  const { field, scope } = asked
  const password = field.type === 'password' ? field : passwordFields(scope).find(isVisible)
  const username = field.type === 'password' ? usernameField(scope, field) : field
  if (username && login.username) setValue(username, login.username)
  if (password) setValue(password, login.password)
  ;(password ?? username)?.focus()
})

// ── noticing a password being sent ──

let lastReported = ''

function report(scope: ParentNode) {
  const fields = passwordFields(scope)
  const password = passwordToSave(fields.map((el) => el.value))
  if (!password) {
    // Sign-ins in two steps ask for the user name first: pass it on for the second step.
    const username = usernameField(scope)
    if (username?.value) ipcRenderer.send(LOGINS.username, username.value)
    return
  }
  const username = usernameField(scope, fields[0])?.value ?? ''
  const key = `${username}\n${password}`
  if (key === lastReported) return
  lastReported = key
  ipcRenderer.send(LOGINS.submit, { username, password })
}

document.addEventListener('submit', (event) => event.target instanceof Element && report(event.target), true)
document.addEventListener(
  'keydown',
  (event) => {
    if (event.key === 'Enter' && event.target instanceof HTMLInputElement) report(scopeOf(event.target))
  },
  true,
)
document.addEventListener(
  'click',
  (event) => {
    // Sites that sign in from a button without submitting a form. Buttons marked
    // type="button" (show password, and so on) are left alone.
    const button = event.target instanceof Element ? event.target.closest('button:not([type=button]), input[type=submit]') : null
    if (button) report(scopeOf(button))
  },
  true,
)
