// electron-builder hook: runs after the app is assembled, before it is signed.
//
// macOS adds extended attributes (Finder info, iCloud/File Provider tags,
// quarantine) to files, especially in iCloud-synced folders like ~/Desktop.
// codesign rejects them with "resource fork, Finder information, or similar
// detritus not allowed", so strip them from the bundle first.
const { execFileSync } = require('node:child_process')

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return
  execFileSync('xattr', ['-cr', context.appOutDir])
}
