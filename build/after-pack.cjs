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

/**
 * Switch off the ways another program on this computer could start the app's
 * own engine and make it run that program's code instead. Such code would run
 * under this app's name: macOS would hand it the keychain entry that protects
 * the saved passwords, and the camera/microphone permission given to the
 * browser. These switches are baked into the app and cannot be turned back on
 * from outside:
 *
 *   - no "run as plain Node.js" mode (ELECTRON_RUN_AS_NODE)
 *   - NODE_OPTIONS is ignored
 *   - --inspect and friends are ignored (no debugger can attach to the app)
 *   - the app's code is only ever loaded from its own archive
 *
 * This edits the engine itself, so it has to happen before the Widevine
 * signature below and before code-signing, both of which seal the result.
 */
async function harden(context) {
  const { FuseVersion, FuseV1Options } = await import('@electron/fuses')
  await context.packager.addElectronFuses(context, {
    version: FuseVersion.V1,
    [FuseV1Options.RunAsNode]: false,
    [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
    [FuseV1Options.EnableNodeCliInspectArguments]: false,
    [FuseV1Options.OnlyLoadAppFromAsar]: true,
  })
}

exports.default = async function afterPack(context) {
  // Every pass, including both halves of a universal build.
  await harden(context)
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
