import { forceGc } from "./forceGc"

/** The runtime trick — flipping `--expose-gc` after startup and reading `gc`
 * out of a fresh context — is the whole module, so the test is that it works
 * on the Node this runs under: it resolves to a real collector rather than
 * falling back to the no-op, and it can be called repeatedly. */
describe("forceGc", () => {
  it("exposes a real collector at runtime", () => {
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {})
    forceGc()
    forceGc()
    expect(warn).not.toHaveBeenCalled()
    warn.mockRestore()
  })

  it("reclaims garbage", () => {
    let junk: string[] | undefined = Array.from(
      { length: 2000 },
      (_, n) => "x".repeat(10_000) + n
    )
    forceGc()
    const before = process.memoryUsage().heapUsed
    junk = undefined
    forceGc()
    const after = process.memoryUsage().heapUsed
    expect(junk).toBeUndefined()
    expect(after).toBeLessThan(before)
  })
})
