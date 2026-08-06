import type { Testimony } from "../db/testimony"
import { recordRkey, testimonyNsid } from "./lexicons"
import { timestampFromIso } from "./mappers"
import {
  AtpReadClient,
  collectBillTestimony,
  filterByAuthorRole,
  slicePage
} from "./testimonyFanout"

const court = 194
const billId = "H1234"
const rkey = recordRkey(court, billId)

const record = (
  did: string,
  position: string,
  createdAt: string,
  overrides: Partial<{ billId: string; court: number; rkey: string }> = {}
) => ({
  uri: `at://${did}/${testimonyNsid}/${overrides.rkey ?? rkey}`,
  value: {
    $type: testimonyNsid,
    bill: { uri: `at://maple/bill/${rkey}`, cid: "bafyfake" },
    court: overrides.court ?? court,
    billId: overrides.billId ?? billId,
    position,
    content: `${position} from ${did}`,
    createdAt
  }
})

type Repo = {
  handle: string
  collections: string[]
  records?: ReturnType<typeof record>[]
  fail?: boolean
}

/** In-memory PDS: serves listRepos/listRecords in pages of `pageSize` to
 * exercise the cursor loops, and records every call for fan-out assertions. */
const fakeClient = (repos: Record<string, Repo>, pageSize = 100) => {
  const calls = {
    listRepos: 0,
    describeRepo: [] as string[],
    listRecords: [] as string[]
  }
  const paged = <T>(all: T[], cursor?: string) => {
    const start = cursor ? Number(cursor) : 0
    const page = all.slice(start, start + pageSize)
    const next = start + pageSize
    return { items: page, cursor: next < all.length ? String(next) : undefined }
  }
  const client: AtpReadClient = {
    listRepos: async cursor => {
      calls.listRepos++
      const { items, cursor: next } = paged(Object.keys(repos), cursor)
      return { repos: items.map(did => ({ did })), cursor: next }
    },
    describeRepo: async did => {
      calls.describeRepo.push(did)
      const repo = repos[did]
      if (repo.fail) throw new Error(`UpstreamFailure for ${did}`)
      return { handle: repo.handle, collections: repo.collections }
    },
    listRecords: async (did, cursor) => {
      calls.listRecords.push(did)
      const { items, cursor: next } = paged(repos[did].records ?? [], cursor)
      return { records: items, cursor: next }
    }
  }
  return { client, calls }
}

const testimonyRepos: Record<string, Repo> = {
  "did:plc:maple": {
    handle: "maple.test",
    collections: ["org.mapletestimony.bill"]
  },
  "did:plc:alice": {
    handle: "alice.test",
    collections: [testimonyNsid],
    records: [
      record("did:plc:alice", "oppose", "2026-07-28T10:00:00Z"),
      record("did:plc:alice", "endorse", "2026-07-28T11:00:00Z", {
        billId: "S25",
        rkey: "194-S25"
      })
    ]
  },
  "did:plc:bob": {
    handle: "bob.test",
    collections: [testimonyNsid],
    records: [record("did:plc:bob", "endorse", "2026-07-28T12:00:00Z")]
  }
}

describe("collectBillTestimony", () => {
  let info: jest.SpyInstance
  beforeEach(() => {
    info = jest.spyOn(console, "info").mockImplementation(() => {})
  })
  afterEach(() => info.mockRestore())

  it("collects only this bill's records across repos, newest first", async () => {
    const { client } = fakeClient(testimonyRepos)
    const { testimony } = await collectBillTestimony(
      client,
      court,
      billId,
      "An Act"
    )
    expect(testimony.map(t => t.authorDisplayName)).toEqual([
      "bob.test",
      "alice.test"
    ])
    expect(testimony.every(t => t.billId === billId)).toBe(true)
  })

  it("maps repo identity into the testimony and uniquifies colliding rkeys", async () => {
    const { client } = fakeClient(testimonyRepos)
    const { testimony } = await collectBillTestimony(
      client,
      court,
      billId,
      "An Act"
    )
    const alice = testimony.find(t => t.authorDisplayName === "alice.test")!
    expect(alice.authorUid).toBe("did:plc:alice")
    expect(alice.fullName).toBe("alice.test")
    expect(alice.billTitle).toBe("An Act")
    // Both records share the deterministic rkey; AT-URIs keep ids unique.
    // Encoded so the id survives interpolation into a /testimony/:id href.
    expect(new Set(testimony.map(t => t.id)).size).toBe(testimony.length)
    expect(alice.id).toBe(
      encodeURIComponent(`at://did:plc:alice/${testimonyNsid}/${rkey}`)
    )
  })

  it("computes real position counts", async () => {
    const { client } = fakeClient(testimonyRepos)
    const { counts } = await collectBillTestimony(
      client,
      court,
      billId,
      "An Act"
    )
    expect(counts).toEqual({
      testimonyCount: 2,
      endorseCount: 1,
      opposeCount: 1,
      neutralCount: 0
    })
  })

  it("returns an empty listing with zero counts for a bill nobody testified on", async () => {
    const { client } = fakeClient(testimonyRepos)
    const { testimony, counts } = await collectBillTestimony(
      client,
      court,
      "H2246",
      "An Act"
    )
    expect(testimony).toEqual([])
    expect(counts).toEqual({
      testimonyCount: 0,
      endorseCount: 0,
      opposeCount: 0,
      neutralCount: 0
    })
  })

  it("skips repos without the testimony collection, without listing them", async () => {
    const { client, calls } = fakeClient(testimonyRepos)
    const { stats } = await collectBillTestimony(
      client,
      court,
      billId,
      "An Act"
    )
    expect(stats.skippedNoCollection).toBe(1)
    expect(calls.listRecords).not.toContain("did:plc:maple")
    expect(stats.describeCalls).toBe(3)
    expect(stats.listRecordsCalls).toBe(2)
  })

  it("survives a dead repo and keeps the rest of the listing", async () => {
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {})
    const { client } = fakeClient({
      ...testimonyRepos,
      "did:plc:dead": { handle: "dead.test", collections: [], fail: true }
    })
    const { testimony, stats } = await collectBillTestimony(
      client,
      court,
      billId,
      "An Act"
    )
    expect(stats.failedRepos).toBe(1)
    expect(testimony).toHaveLength(2)
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  it("follows listRepos and listRecords cursors across pages", async () => {
    const repos = {
      ...testimonyRepos,
      "did:plc:alice": {
        ...testimonyRepos["did:plc:alice"],
        // 3 records = 2 pages at pageSize 2, forcing the cursor loop.
        records: [
          ...testimonyRepos["did:plc:alice"].records!,
          record("did:plc:alice", "neutral", "2026-07-28T09:00:00Z", {
            billId: "H72",
            rkey: "194-H72"
          })
        ]
      }
    }
    const { client, calls } = fakeClient(repos, 2)
    const { testimony, stats } = await collectBillTestimony(
      client,
      court,
      billId,
      "An Act"
    )
    // 3 repos at 2 per page → 2 listRepos calls.
    expect(calls.listRepos).toBe(2)
    expect(stats.listRepoPages).toBe(2)
    expect(
      calls.listRecords.filter(did => did === "did:plc:alice")
    ).toHaveLength(2)
    expect(testimony).toHaveLength(2)
    expect(stats.repoCount).toBe(3)
  })
})

describe("slicePage", () => {
  const items = ["a", "b", "c", "d", "e"].map(
    id =>
      ({
        id,
        publishedAt: timestampFromIso("2026-07-28T10:00:00Z")
      } as Testimony)
  )

  it("returns the first page for a null key", () => {
    expect(slicePage(items, 2, null).map(i => i.id)).toEqual(["a", "b"])
  })

  it("starts after the keyed item", () => {
    expect(slicePage(items, 2, "b").map(i => i.id)).toEqual(["c", "d"])
  })

  it("returns a short final page", () => {
    expect(slicePage(items, 2, "d").map(i => i.id)).toEqual(["e"])
  })

  it("falls back to the first page for an unknown key", () => {
    expect(slicePage(items, 2, "zzz").map(i => i.id)).toEqual(["a", "b"])
  })
})

describe("filterByAuthorRole", () => {
  const items = [{ authorRole: "user" }, { authorRole: "user" }] as Testimony[]

  it("passes everything through for the All tab", () => {
    expect(filterByAuthorRole(items, undefined)).toHaveLength(2)
    expect(filterByAuthorRole(items, "")).toHaveLength(2)
  })

  it("treats every ATProto author as an individual", () => {
    expect(filterByAuthorRole(items, "user")).toHaveLength(2)
    expect(filterByAuthorRole(items, "organization")).toHaveLength(0)
  })
})
