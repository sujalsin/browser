// Runs in a process of its own, started for each filter-list update and gone
// when it is done. Turning ~190,000 filters into a compiled engine takes
// seconds on an Intel Mac and a couple of hundred megabytes while it runs.
// On a thread of the main process, that memory stayed with the browser long
// after the update; a separate process hands all of it back when it exits.
import { FiltersEngine } from '@ghostery/adblocker'

export interface BuildInput {
  lists: string[]
  resources?: string
}

export interface BuildOutput {
  bytes: Uint8Array
  filterCount: number
}

process.parentPort.once('message', (event: Electron.MessageEvent) => {
  const { lists, resources } = event.data as BuildInput
  const engine = FiltersEngine.parse(lists.join('\n'), {
    loadNetworkFilters: true,
    loadCosmeticFilters: true,
    loadGenericCosmeticsFilters: true,
    enableMutationObserver: true,
    // Electron cannot rewrite response bodies.
    enableHtmlFiltering: false,
  })
  if (resources) engine.updateResources(resources, String(resources.length))

  let filterCount = 0
  try {
    filterCount = engine.getFilters().networkFilters.length + engine.getFilters().cosmeticFilters.length
  } catch {
    /* count is informational only */
  }
  const output: BuildOutput = { bytes: engine.serialize(), filterCount }
  process.parentPort.postMessage(output)
})
