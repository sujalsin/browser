// electron-builder hook: runs after the app is assembled, before it is signed.
const { execFileSync, spawnSync } = require('node:child_process')
const { existsSync, rmSync } = require('node:fs')
const { join } = require('node:path')

/**
 * Widevine "VMP" signature. Netflix, Disney+ and similar services only play
 * in apps carrying a production signature from castLabs' free EVS service.
 * On macOS it must be applied BEFORE code-signing, which is exactly when this
 * hook runs. Needs the one-time setup in the README; without it the build still
 * works, just without protected video.
 */
function vmpSign(appOutDir) {
  const attempts = [
    ['evs-vmp', ['sign-pkg', appOutDir]],
    ['python3', ['-m', 'castlabs_evs.vmp', 'sign-pkg', appOutDir]],
  ]
  for (const [cmd, args] of attempts) {
    const result = spawnSync(cmd, args, { stdio: 'inherit' })
    if (result.status === 0) return true
  }
  return false
}

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return
  const appPath = join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`)

  // Universal builds pack each architecture into a "-temp" folder and then merge
  // them. The merge can't combine the bundled development signature, so drop it
  // from the halves; the merged app is signed below on the final pass.
  if (/-temp$/.test(context.appOutDir)) {
    const sig = join(appPath, 'Contents/Frameworks/Electron Framework.framework/Versions/A/Resources/Electron Framework.sig')
    if (existsSync(sig)) rmSync(sig)
  } else if (process.env.SKIP_VMP_SIGN) {
    console.log('  • skipping Widevine VMP signing (SKIP_VMP_SIGN is set)')
  } else if (!vmpSign(context.appOutDir)) {
    console.warn(
      '\n  ⚠ Widevine VMP signing was skipped: Netflix, Disney+ and other protected video will not play in this build.\n' +
        '    One-time setup (free): see "Netflix, Spotify and other protected video" in README.md, then build again.\n',
    )
  }

  // macOS adds extended attributes (Finder info, iCloud/File Provider tags,
  // quarantine) to files, especially in iCloud-synced folders like ~/Desktop.
  // codesign rejects them with "resource fork, Finder information, or similar
  // detritus not allowed", so strip them from the bundle before signing.
  execFileSync('xattr', ['-cr', context.appOutDir])
}
