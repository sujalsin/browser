#!/usr/bin/env node
// Move this project to the newest engine (Chromium, via the Widevine build of
// Electron), which is how the browser gets Chromium's security fixes.
//
//   npm run engine:update            newest release of the line you are on (safest)
//   npm run engine:update -- --latest   newest release of all (a new line may need code changes)
//
// Then rebuild: npm run dist:mac:arm64 (or :x64), and replace the app.
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const REPO = 'https://github.com/castlabs/electron-releases'
const parse = (tag) => /^v?(\d+)\.(\d+)\.(\d+)\+wvcus$/.exec(tag)?.slice(1).map(Number) ?? null
const cmp = (a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
const current = parse(String(pkg.devDependencies.electron).split('#')[1] ?? '')
if (!current) throw new Error(`Cannot read the current engine version from package.json (${pkg.devDependencies.electron})`)

const listed = execFileSync('git', ['ls-remote', '--tags', '--refs', REPO], { encoding: 'utf8' })
const versions = listed
  .split('\n')
  .map((line) => parse(line.split('refs/tags/')[1] ?? ''))
  .filter(Boolean)
  .sort(cmp)
if (!versions.length) throw new Error('No releases found. Are you online?')

const wantLatest = process.argv.includes('--latest')
const newest = versions.at(-1)
const sameLine = versions.filter((v) => v[0] === current[0]).at(-1) ?? current
const target = wantLatest ? newest : sameLine

console.log(`In use: ${current.join('.')}   newest of line ${current[0]}: ${sameLine.join('.')}   newest of all: ${newest.join('.')}`)
if (cmp(target, current) <= 0) {
  console.log('Already on the newest engine' + (wantLatest ? '.' : ' of this line.'))
  if (!wantLatest && newest[0] > current[0]) {
    console.log(
      newest[0] - current[0] > 2
        ? `Line ${current[0]} no longer receives security fixes. Move on with: npm run engine:update -- --latest`
        : `A newer line (${newest.join('.')}) exists; line ${current[0]} still receives fixes. To move anyway: npm run engine:update -- --latest`,
    )
  }
  process.exit(0)
}

const tag = `v${target.join('.')}+wvcus`
console.log(`Installing ${tag} …`)
execFileSync('npm', ['install', '--save-dev', `electron@github:castlabs/electron-releases#${tag}`], { stdio: 'inherit' })
console.log(`\nDone. Now rebuild and replace the app:\n  npm test && npm run dist:mac:arm64     (Apple Silicon)\n  npm test && npm run dist:mac:x64       (Intel)`)
