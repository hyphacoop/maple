import * as v8 from "v8"
import * as vm from "vm"

/** Runs a full, memory-reducing garbage collection of this process, or does
 * nothing if the runtime will not expose one.
 *
 * Why it exists: the backfill's garbage is bill text — large strings that
 * live in old space and are only reclaimed by a full mark-sweep. V8 schedules
 * those against its own heap limit, which it grows toward geometrically and
 * which need not be below the container's limit, so a chunk can be killed by
 * the container before V8 sees any reason to collect. And a collection alone
 * is not enough: V8 keeps freed pages for reuse and returns them to the OS
 * only when idle, which a warm gen1 instance, CPU-throttled between events,
 * may never be. The kill is measured on resident memory, so both steps have to
 * happen while the chunk still runs.
 *
 * Node's exposed `gc` does both — it raises V8's low-memory notification,
 * which sweeps and uncommits. Exposing it normally needs `--expose-gc` on the
 * command line, which cannot be set for one function, so the flag is set at
 * runtime and `gc` read out of a fresh context, which V8 populates from the
 * flags in force at its creation. The function collects the whole isolate,
 * not just that context. Resolved lazily so only the process that calls it
 * flips the flag.
 */
export const forceGc = (): void => (resolved ??= resolve())()

let resolved: (() => void) | undefined

const resolve = (): (() => void) => {
  try {
    v8.setFlagsFromString("--expose-gc")
    const gc = vm.runInNewContext("gc")
    if (typeof gc !== "function") throw Error("gc is not a function")
    return gc
  } catch (error: any) {
    console.warn(`Forced GC unavailable, relying on V8's own: ${error.message}`)
    return () => {}
  }
}
