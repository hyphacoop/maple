import { applyGenesis, applyNullify, applySpec, SafetyError } from "./apply.js"
import {
  generateKey,
  loadPrivateKey,
  writePrivateKeyFile,
  type KeySource
} from "./keys.js"
import { exitCodeFor, formatPlan, plan } from "./plan.js"
import {
  borrowedRotationKeys,
  readSpec,
  REPO_ROOT,
  specPath,
  updateSpec,
  type IdentitySpec
} from "./spec.js"
import {
  activateAccount,
  checkAccountStatus,
  createAccountWithDid,
  createServiceJwt,
  createSession,
  describeServer,
  getRecommendedDidCredentials
} from "./xrpc.js"

const USAGE = `identity <command> [options]

  plan                  diff the live PLC document against the spec. Keyless; non-zero on drift.
  genesis               mint the DID. IRREVERSIBLE, and the only command that creates an identity.
  apply                 reconcile the live document to the spec, signed with a rotation key.
  nullify               undo a later key's operation with a higher-priority key (72h window).
  create-account        create the PDS account WITH the pre-minted DID.
  rotate-signing-key    adopt the PDS's own signing key into the document.
  activate              bring the account live. Borrows the PDS rotation key for one call.
  keygen                generate a secp256k1 keypair. Prints the did:key; writes the private half.
  pubkey                print the did:key of an existing private key. Never prints the key.

Spec selection (all commands but keygen):
  --env <dev|prod>      use infra/identity/<env>.json
  --spec <path>         use an explicit spec file (the local harness does this)

Signing key (genesis, apply, nullify, rotate-signing-key, activate, pubkey):
  --kms <resource>      sign with a Cloud KMS key (MAPLE's ops key; terraform's
                        identity_ops_key output, optionally /cryptoKeyVersions/N)
  --key-file <path>     read the private key from a file (hex or multikey)
  --key-secret <id>     read it from Secret Manager, with --project

Other:
  --i-mean-it           allow an operation that removes the recovery key
  --project <id>        GCP project for --key-secret
`

type Args = { command: string; flags: Map<string, string>; bools: Set<string> }

function parseArgs(argv: string[]): Args {
  const [command = "", ...rest] = argv
  const flags = new Map<string, string>()
  const bools = new Set<string>()
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i]!
    if (!arg.startsWith("--")) throw new Error(`unexpected argument: ${arg}`)
    const name = arg.slice(2)
    const next = rest[i + 1]
    if (next === undefined || next.startsWith("--")) {
      bools.add(name)
    } else {
      flags.set(name, next)
      i++
    }
  }
  return { command, flags, bools }
}

function resolveSpec(args: Args): { path: URL; spec: IdentitySpec } {
  const explicit = args.flags.get("spec")
  const env = args.flags.get("env")
  if (explicit !== undefined && env !== undefined) {
    throw new Error("pass --env or --spec, not both")
  }
  if (explicit === undefined && env === undefined) {
    throw new Error("no spec selected: pass --env <dev|prod> or --spec <path>")
  }
  const path =
    explicit !== undefined
      ? new URL(explicit, `file://${process.cwd()}/`)
      : specPath(env!, REPO_ROOT)
  return { path, spec: readSpec(path) }
}

function resolveKeySource(args: Args): KeySource {
  const file = args.flags.get("key-file")
  const secret = args.flags.get("key-secret")
  const kms = args.flags.get("kms")
  const given = [file, secret, kms].filter(v => v !== undefined).length
  if (given > 1) {
    throw new Error("pass exactly one of --kms, --key-file or --key-secret")
  }
  if (kms !== undefined) return { kind: "kms", resource: kms }
  if (file !== undefined) return { kind: "file", path: file }
  if (secret !== undefined) {
    const project = args.flags.get("project")
    if (project === undefined) throw new Error("--key-secret needs --project")
    return { kind: "secret", secretId: secret, project }
  }
  throw new Error(
    "no signing key: pass --kms <resource>, --key-file <path> or --key-secret <id> --project <id>"
  )
}

/**
 * Applying to prod is a two-key, one-organisation decision (ADR 0002 §2), so it
 * never happens because someone had the wrong shell history.
 */
function confirmProd(args: Args, action: string): void {
  if (args.flags.get("env") !== "prod") return
  if (!args.bools.has("yes-really-prod")) {
    throw new SafetyError(
      `${action} against prod is a change to MAPLE's real identity. Re-run with --yes-really-prod ` +
        `once the spec change is reviewed and the recovery-key holders know.`
    )
  }
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2))

  switch (args.command) {
    case "":
    case "help":
    case "--help":
      process.stdout.write(USAGE)
      return 0

    case "keygen": {
      const { didKey, privateKeyHex } = await generateKey()
      const out = args.flags.get("out")
      if (out !== undefined) {
        writePrivateKeyFile(out, privateKeyHex)
        process.stdout.write(`${didKey}\n`)
        process.stderr.write(`private key written to ${out} (mode 0600)\n`)
      } else {
        // Only ever to stdout, only when explicitly asked for, never logged.
        process.stdout.write(`${didKey}\n${privateKeyHex}\n`)
      }
      return 0
    }

    case "pubkey": {
      // The did:key for a private key, without ever printing the key itself.
      // Used by infra/atproto/identity-check.sh to name the PDS's rotation key
      // when asserting it is absent from the document.
      const key = await loadPrivateKey(resolveKeySource(args))
      process.stdout.write(`${await key.exportPublicKey("did")}\n`)
      return 0
    }

    case "plan": {
      const { spec } = resolveSpec(args)
      const result = await plan(spec)
      process.stdout.write(formatPlan(spec, result) + "\n")
      return exitCodeFor(result)
    }

    case "genesis": {
      const { path, spec } = resolveSpec(args)
      confirmProd(args, "genesis")
      const key = await loadPrivateKey(resolveKeySource(args))
      const applied = await applyGenesis(path, spec, key)
      process.stdout.write(`${applied.did}\n`)
      process.stderr.write(
        `did written to ${path.pathname}\naudit log: ${applied.auditLog}\n`
      )
      return 0
    }

    case "apply": {
      const { spec } = resolveSpec(args)
      confirmProd(args, "apply")
      const key = await loadPrivateKey(resolveKeySource(args))
      const applied = await applySpec(spec, key, {
        iMeanIt: args.bools.has("i-mean-it")
      })
      process.stderr.write(
        `applied to ${applied.did}\naudit log: ${applied.auditLog}\n`
      )
      return 0
    }

    case "nullify": {
      const { spec } = resolveSpec(args)
      confirmProd(args, "nullify")
      const source = resolveKeySource(args)
      const key = await loadPrivateKey(source)
      const keyDid = await key.exportPublicKey("did")
      const applied = await applyNullify(spec, key, keyDid)
      process.stderr.write(
        `nullified with ${keyDid}\naudit log: ${applied.auditLog}\n`
      )
      return 0
    }

    case "create-account": {
      const { spec } = resolveSpec(args)
      if (spec.did === "")
        throw new SafetyError("the spec has no did: run genesis first")
      const signingKeyFile = args.flags.get("signing-key-file")
      if (signingKeyFile === undefined) {
        throw new Error(
          "--signing-key-file is required: createAccount for a DID the PDS did not mint must be " +
            "authorised by the key currently in verificationMethods.atproto"
        )
      }
      const email = args.flags.get("email") ?? process.env.ATP_ACCOUNT_EMAIL
      const password =
        args.flags.get("password") ?? process.env.ATP_ACCOUNT_PASSWORD
      if (email === undefined || password === undefined) {
        throw new Error(
          "create-account needs --email and --password (or ATP_ACCOUNT_EMAIL/PASSWORD)"
        )
      }

      const signingKey = await loadPrivateKey({
        kind: "file",
        path: signingKeyFile
      })
      const { did: audience } = await describeServer(spec.pdsEndpoint)
      const serviceJwt = await createServiceJwt({
        iss: spec.did,
        aud: audience,
        lxm: "com.atproto.server.createAccount",
        key: signingKey
      })
      const account = await createAccountWithDid({
        pdsUrl: spec.pdsEndpoint,
        did: spec.did,
        handle: spec.handle,
        email,
        password,
        serviceJwt,
        ...(args.flags.get("invite-code") === undefined
          ? {}
          : { inviteCode: args.flags.get("invite-code")! })
      })
      if (account.did !== spec.did) {
        throw new SafetyError(
          `the PDS created ${account.did}, not the pre-minted ${spec.did}: it minted its own DID, ` +
            `which means the rotation key it holds is in the document. Do not use this account.`
        )
      }
      process.stdout.write(`${account.did}\n`)
      process.stderr.write(
        `account created on ${spec.pdsEndpoint} with the pre-minted did\n`
      )
      return 0
    }

    case "rotate-signing-key": {
      const { path, spec } = resolveSpec(args)
      confirmProd(args, "rotate-signing-key")
      const password =
        args.flags.get("pds-password") ?? process.env.ATP_ACCOUNT_PASSWORD
      if (password === undefined) {
        throw new Error(
          "rotate-signing-key needs --pds-password (or ATP_ACCOUNT_PASSWORD)"
        )
      }
      const key = await loadPrivateKey(resolveKeySource(args))
      const session = await createSession({
        pdsUrl: spec.pdsEndpoint,
        identifier: spec.handle,
        password
      })
      const { signingKey } = await getRecommendedDidCredentials({
        pdsUrl: spec.pdsEndpoint,
        accessJwt: session.accessJwt
      })
      const updated = updateSpec(path, {
        verificationMethods: { atproto: signingKey }
      })
      const applied = await applySpec(updated, key, {
        iMeanIt: args.bools.has("i-mean-it")
      })
      process.stdout.write(`${signingKey}\n`)
      process.stderr.write(
        `verificationMethods.atproto written to ${path.pathname} and applied\n` +
          `audit log: ${applied.auditLog}\n`
      )
      return 0
    }

    case "activate": {
      // Bring the repo onto the firehose -- and the one place ADR 0002 §1 has to
      // bend.
      //
      // com.atproto.server.activateAccount asserts rotationKeys.includes(the
      // PDS's own rotation key) (account-manager.js -> server/util.js
      // assertValidDocContents). We do not want that key in the document: the VM
      // holds it, and a document listing it lets a compromised box attempt to
      // move the identity. So it is adopted for the length of one call and
      // removed again -- three PLC operations, ending exactly where the spec
      // says.
      //
      // That is safe to leave in this shape because the assertion sits on no hot
      // path. Its only two callers are activateAccount itself and
      // checkAccountStatus, which merely REPORTS validDid -- expect that to read
      // false forever afterwards; it is not an error. Nothing in auth, session
      // creation, repo writes or the firehose consults it. The PDS image is
      // pinned in infra/atproto/images.env and bootstrap.sh runs this whole
      // sequence in CI, so a future version that moves the check goes red here
      // before it reaches dev.
      const { spec } = resolveSpec(args)
      confirmProd(args, "activate")
      const password =
        args.flags.get("pds-password") ?? process.env.ATP_ACCOUNT_PASSWORD
      if (password === undefined) {
        throw new Error(
          "activate needs --pds-password (or ATP_ACCOUNT_PASSWORD)"
        )
      }
      const key = await loadPrivateKey(resolveKeySource(args))
      const session = await createSession({
        pdsUrl: spec.pdsEndpoint,
        identifier: spec.handle,
        password
      })

      const status = await checkAccountStatus({
        pdsUrl: spec.pdsEndpoint,
        accessJwt: session.accessJwt
      })
      if (status.activated) {
        process.stderr.write(
          `${session.did} is already active on ${spec.pdsEndpoint}\n`
        )
        return 0
      }

      const before = await plan(spec)
      if (before.status !== "clean" && !args.bools.has("reconcile")) {
        process.stdout.write(formatPlan(spec, before) + "\n")
        throw new SafetyError(
          "the document does not match the spec, so activate will not touch it. If a previous " +
            "activate was interrupted the document may still carry the PDS rotation key; " +
            "re-run with --reconcile to put it back and continue."
        )
      }

      const { rotationKeys: recommended } = await getRecommendedDidCredentials({
        pdsUrl: spec.pdsEndpoint,
        accessJwt: session.accessJwt
      })
      const borrowed = borrowedRotationKeys(spec, recommended)

      if (borrowed.length > 0) {
        process.stderr.write(
          `temporarily adding ${borrowed.join(
            ", "
          )} to satisfy activateAccount\n`
        )
        await applySpec(
          { ...spec, rotationKeys: [...spec.rotationKeys, ...borrowed] },
          key
        )
      }
      await activateAccount({
        pdsUrl: spec.pdsEndpoint,
        accessJwt: session.accessJwt
      })
      if (borrowed.length > 0) {
        await applySpec(spec, key)
        process.stderr.write(
          "removed it again; rotationKeys is back to the spec\n"
        )
      }

      const after = await plan(spec)
      if (after.status !== "clean") {
        process.stdout.write(formatPlan(spec, after) + "\n")
        throw new Error(
          "activate finished but the document does not match the spec"
        )
      }
      process.stderr.write(
        `${session.did} is active on ${spec.pdsEndpoint}\n` +
          `checkAccountStatus will now report validDid: false -- that is expected, see above\n`
      )
      return 0
    }

    default:
      process.stderr.write(`unknown command: ${args.command}\n\n${USAGE}`)
      return 2
  }
}

main().then(
  code => {
    process.exitCode = code
  },
  (err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err)
    process.stderr.write(
      `${err instanceof SafetyError ? "refused" : "error"}: ${msg}\n`
    )
    process.exitCode = 1
  }
)
