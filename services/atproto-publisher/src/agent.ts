import { AtpAgent, AtUri, XRPCError } from "@atproto/api"

export type WriteResult = { uri: string; cid: string }

export type BatchWrite = {
  op: "create" | "update"
  collection: string
  rkey: string
  record: object
}

/** Seconds the PDS asked us to wait, or undefined if this was not a rate
 * limit. Callers back off on the server's terms rather than guessing. */
export function rateLimitDelay(e: unknown): number | undefined {
  if (!(e instanceof XRPCError) || e.status !== 429) return undefined
  const header = e.headers?.["retry-after"]
  const seconds = header ? Number(header) : NaN
  return Number.isFinite(seconds) ? seconds : 60
}

export type PdsConfig = {
  service: string
  identifier: string
  password: string
}

/** A logged-in connection to the maple PDS.
 *
 * Cloud functions instances are short-lived but reused, so the agent is cached
 * in module scope by the caller: logging in on every invocation would burn the
 * PDS's createSession rate limit for no benefit. AtpAgent refreshes its own
 * access token, so a warm instance keeps working across the token lifetime.
 */
export class PdsClient {
  private constructor(private readonly agent: AtpAgent, readonly did: string) {}

  static async login(config: PdsConfig): Promise<PdsClient> {
    const agent = new AtpAgent({ service: config.service })
    await agent.login({
      identifier: config.identifier,
      password: config.password
    })
    const did = agent.session?.did
    if (!did) throw new Error(`No session DID after login to ${config.service}`)
    return new PdsClient(agent, did)
  }

  /** Every rkey already in a collection, so a batch backfill knows which
   * writes are creates and which are updates — applyWrites has no upsert.
   *
   * Terminates on an empty page rather than on a missing cursor: a PDS may
   * return a cursor alongside the last page, and trusting it loops forever. */
  async listRkeys(collection: string): Promise<Set<string>> {
    const rkeys = new Set<string>()
    let cursor: string | undefined
    for (;;) {
      const res = await this.agent.com.atproto.repo.listRecords({
        repo: this.did,
        collection,
        limit: 100,
        cursor
      })
      if (res.data.records.length === 0) return rkeys
      for (const r of res.data.records) rkeys.add(new AtUri(r.uri).rkey)
      cursor = res.data.cursor
      if (!cursor) return rkeys
    }
  }

  /** One repo commit for many records, which is the point: a per-record
   * backfill of ~8000 bills would put 8000 commits on the firehose for the
   * consumer and the relay to chew through. */
  async applyWrites(writes: BatchWrite[]): Promise<WriteResult[]> {
    const res = await this.agent.com.atproto.repo.applyWrites({
      repo: this.did,
      writes: writes.map(w => ({
        $type: `com.atproto.repo.applyWrites#${w.op}` as const,
        collection: w.collection,
        rkey: w.rkey,
        value: w.record
      })) as never
    })
    // Results come back in write order. A PDS predating the results field
    // would leave us without cids; say so rather than recording empty ones,
    // because the parity checker compares on cid.
    const results = res.data.results
    if (!results || results.length !== writes.length) {
      throw new Error(
        `applyWrites returned ${results?.length ?? 0} results for ${
          writes.length
        } writes`
      )
    }
    return results.map((r, i) => ({
      uri:
        (r as { uri?: string }).uri ??
        `at://${this.did}/${writes[i]!.collection}/${writes[i]!.rkey}`,
      cid: (r as { cid?: string }).cid ?? ""
    }))
  }

  /** Upserts a record. The PDS validates structure only for our unknown NSIDs,
   * so callers must validate against the lexicon first; never pass
   * `validate: false`, which would disable even the structural check. */
  async putRecord(collection: string, rkey: string, record: object) {
    const res = await this.agent.com.atproto.repo.putRecord({
      repo: this.did,
      collection,
      rkey,
      record: record as Record<string, unknown>
    })
    return { uri: res.data.uri, cid: res.data.cid }
  }
}
