// Reports the focused tab's site to Nube Nube and blocks the domains it sends
// while a focus timer runs. The release build and `make dev` listen on
// different ports, so both are tried and their block lists are merged.

const PORTS = [47615, 47616]
const BLOCKED = chrome.runtime.getURL('blocked.html')
const conns = new Map() // port → { ws, block: string[] }

const siteOf = (url) => {
  try {
    const u = new URL(url)
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.hostname.replace(/^www\./, '') : null
  } catch {
    return null
  }
}

const covers = (site, domain) => site === domain || site.endsWith(`.${domain}`)

// null when no browser window has focus, so the desktop app in front counts instead.
async function focusedSite() {
  const win = await chrome.windows.getLastFocused().catch(() => null)
  if (!win?.focused) return null
  const [tab] = await chrome.tabs.query({ active: true, windowId: win.id })
  return tab?.url ? siteOf(tab.url) : null
}

async function report() {
  const msg = JSON.stringify({ type: 'tab', domain: await focusedSite() })
  for (const { ws } of conns.values()) if (ws.readyState === WebSocket.OPEN) ws.send(msg)
}

async function applyBlock() {
  const domains = [...new Set([...conns.values()].flatMap((c) => c.block))]
  const old = await chrome.declarativeNetRequest.getDynamicRules()
  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: old.map((r) => r.id),
    addRules: domains.map((domain, i) => ({
      id: i + 1,
      action: { type: 'redirect', redirect: { regexSubstitution: `${BLOCKED}#\\0` } },
      condition: { regexFilter: '^.*$', requestDomains: [domain], resourceTypes: ['main_frame'] },
    })),
  })
  // blocked.html watches this to send the tab back once the timer ends.
  await chrome.storage.session.set({ blocked: domains })
  if (!domains.length) return
  // Rules only catch new navigations; a tab already open on a Rest site would keep playing.
  for (const tab of await chrome.tabs.query({})) {
    const site = tab.url && siteOf(tab.url)
    if (site && domains.some((d) => covers(site, d))) await chrome.tabs.update(tab.id, { url: `${BLOCKED}#${tab.url}` })
  }
}

// Block messages can arrive back to back; rule ids collide if two updates interleave.
let applying = Promise.resolve()
const queueBlock = () => {
  applying = applying.then(applyBlock).catch((e) => console.error('Nube Nube: updating blocks failed', e))
}

function connect(port) {
  if (conns.has(port)) return
  const ws = new WebSocket(`ws://127.0.0.1:${port}`)
  const conn = { ws, block: [] }
  conns.set(port, conn)
  ws.onopen = () => void report()
  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data)
    if (msg.type === 'block') {
      conn.block = msg.domains
      queueBlock()
    }
  }
  // Without Nube Nube there's no timer to end the block, so it lifts with the connection.
  ws.onclose = () => {
    conns.delete(port)
    if (conn.block.length) queueBlock()
  }
}

const connectAll = () => PORTS.forEach(connect)

chrome.tabs.onActivated.addListener(() => void report())
chrome.tabs.onUpdated.addListener((_id, info, tab) => { if (info.url && tab.active) void report() })
chrome.windows.onFocusChanged.addListener(() => void report())
// Wakes the worker after Chrome idles it out, so it reconnects once Nube Nube starts.
chrome.alarms.create('reconnect', { periodInMinutes: 0.5 })
chrome.alarms.onAlarm.addListener(connectAll)
// Traffic on an open socket keeps the worker alive, and the resend corrects any missed focus event.
setInterval(() => { connectAll(); void report() }, 20_000)

// Rules persist across worker restarts; start clear and let Nube Nube resend its list.
queueBlock()
connectAll()
