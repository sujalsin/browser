// What runs at the start of every web page and frame, before the page's own
// scripts. One file, so each frame pays for starting one script, not several.
import './shields' // first: its scriptlets must be in place before the page's scripts
import './logins'
