// The blocked URL rides in the hash (the redirect rule appends it), so the tab
// can return there as soon as its domain leaves the block list.

const url = location.hash.slice(1)
let host = null
try {
  host = new URL(url).hostname.replace(/^www\./, '')
} catch {}
if (host) document.getElementById('site').textContent = host

const stillBlocked = (domains) => !!host && domains.some((d) => host === d || host.endsWith(`.${d}`))
const check = (domains) => { if (url && !stillBlocked(domains ?? [])) location.replace(url) }

chrome.storage.session.get('blocked').then((s) => check(s.blocked))
chrome.storage.session.onChanged.addListener((c) => { if (c.blocked) check(c.blocked.newValue) })
