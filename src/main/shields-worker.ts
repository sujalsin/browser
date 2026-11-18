// Runs on a background thread: turns raw filter-list text into a compiled,
// serialized engine. Parsing ~100k filters takes seconds on an Intel Mac and
// would freeze the browser if it ran on the main thread.
import { FiltersEngine } from '@ghostery/adblocker'
import { parentPort, workerData } from 'node:worker_threads'

interface Input {
  lists: string[]
  resources?: string
}

const { lists, resources } = workerData as Input

const engine = FiltersEngine.parse(lists.join('\n'), {
  loadNetworkFilters: true,
  loadCosmeticFilters: true,
  loadGenericCosmeticsFilters: true,
  enableMutationObserver: true,
  // Electron cannot rewrite response bodies.
  enableHtmlFiltering: false,
})
if (resources) engine.updateResources(resources, String(resources.length))

const bytes = engine.serialize()
let filterCount = 0
try {
  filterCount = engine.getFilters().networkFilters.length + engine.getFilters().cosmeticFilters.length
} catch {
  /* count is informational only */
}
parentPort!.postMessage({ bytes, filterCount }, [bytes.buffer as ArrayBuffer])
