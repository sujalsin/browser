/**
 * The engine under this browser is Chromium, delivered through a build of
 * Electron that includes Widevine (tags like "v45.2.1+wvcus"). Chromium gets
 * security fixes every week or two; this browser only receives them when it
 * is rebuilt on a newer engine. These helpers tell when that is due.
 */

export type Version = [major: number, minor: number, patch: number]

/** "v45.2.1+wvcus" or "45.2.1+wvcus" → [45, 2, 1]. Alphas, betas and other flavours → null. */
export function parseEngineVersion(tag: unknown): Version | null {
  if (typeof tag !== 'string') return null
  const m = /^v?(\d{1,4})\.(\d{1,4})\.(\d{1,4})\+wvcus$/.exec(tag.trim())
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null
}

export const compareVersions = (a: Version, b: Version): number => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]

const text = (v: Version) => v.join('.')

export interface EngineStatus {
  /** Newest release in the same major line, if newer than the one in use: fixes with the least risk of change. */
  update: string | null
  /** Newest release of all, if it is a later major line. */
  nextLine: string | null
  /** False once the line in use is more than two behind the newest: Electron stops patching it. */
  supported: boolean
}

/** Compare the engine in use with the published release tags. */
export function engineStatus(current: string, tags: unknown[]): EngineStatus {
  const mine = parseEngineVersion(current) ?? parseEngineVersion(`${current}+wvcus`)
  const all = tags.map(parseEngineVersion).filter((v): v is Version => v !== null).sort(compareVersions)
  if (!mine || !all.length) return { update: null, nextLine: null, supported: true }
  const newest = all[all.length - 1]
  const sameLine = all.filter((v) => v[0] === mine[0]).pop()
  return {
    update: sameLine && compareVersions(sameLine, mine) > 0 ? text(sameLine) : null,
    nextLine: newest[0] > mine[0] ? text(newest) : null,
    supported: mine[0] >= newest[0] - 2,
  }
}

/** What the interface shows. */
export interface EngineInfo extends EngineStatus {
  /** When the releases were last looked up successfully (ms), or null if never. */
  checkedAt: number | null
}

/** The version worth moving to now, if any: a fix in the same line, or a newer line once this one is abandoned. */
export function engineUpdateDue(info: EngineStatus): string | null {
  return info.update ?? (info.supported ? null : info.nextLine)
}
