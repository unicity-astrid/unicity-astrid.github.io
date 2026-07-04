// host-stubs.mjs
//
// Minimal, well-typed stubs for the `astrid:*` host imports that the
// transpiled prompt-builder component actually demands. The jco/ComponentEncoder
// tree-shook the capsule's full WIT world (14 host interfaces) down to the three
// it actually calls: astrid:ipc/host, astrid:kv/host, astrid:sys/host
// (plus the type-only astrid:guest/lifecycle).
//
// Every host call is appended to an in-memory journal AND echoed to console so a
// human (Node or browser) can watch the guest drive the host. Return values are
// the minimal well-typed shapes jco generates from the WIT:
//   - option<T>            -> `undefined` for none
//   - result<T,error-code> -> return T on ok; `throw` to signal err (never used here)
//   - u64                  -> BigInt
//   - list<u8>             -> Uint8Array
//   - record               -> plain object with camelCase fields
//   - resource             -> a JS class instance
//
// The ipc `recv` returns an EMPTY envelope, which is exactly how the real Astrid
// host signals "timeout / no messages" (documented invariant: recv timeout is an
// Ok empty envelope, never the error variant). This makes both of the capsule's
// nested recv loops (hook fan-out + tool-describe fan-out) break on the first
// poll instead of blocking.

export function createHost({ log = true } = {}) {
  const journal = [];
  const record = (iface, fn, args, ret) => {
    const entry = { seq: journal.length, iface, fn, args, ret };
    journal.push(entry);
    if (log) {
      const a = args.map((x) => summarize(x)).join(", ");
      console.log(`  [host] ${iface}#${fn}(${a})` + (ret !== undefined ? `  -> ${summarize(ret)}` : ""));
    }
    return entry;
  };

  // --- astrid:ipc/host ---------------------------------------------------
  // Imported resource: Subscription. jco expects a class; `subscribe` returns
  // an instance and the guest calls `.recv(timeoutMs)` on it.
  class Subscription {
    #topic;
    constructor(topic) {
      this.#topic = topic;
    }
    recv(timeoutMs) {
      // Empty envelope == host "timeout / no messages" signal.
      const envelope = { messages: [], dropped: 0n, lagged: 0n };
      record("astrid:ipc/host", "Subscription.recv", [this.#topic, timeoutMs], "empty-envelope");
      return envelope;
    }
  }

  const ipc = {
    Subscription,
    publish(topic, payload) {
      record("astrid:ipc/host", "publish", [topic, payload]);
      // result<_, error-code> ok == return nothing.
    },
    subscribe(topicPattern) {
      record("astrid:ipc/host", "subscribe", [topicPattern]);
      return new Subscription(topicPattern);
    },
  };

  // --- astrid:kv/host ----------------------------------------------------
  const kvStore = new Map(); // key -> Uint8Array
  const kv = {
    kvGet(key) {
      const v = kvStore.get(key);
      record("astrid:kv/host", "kvGet", [key], v === undefined ? "none" : `${v.length}B`);
      return v; // option<list<u8>> -> undefined for none
    },
    kvSet(key, value) {
      kvStore.set(key, value);
      record("astrid:kv/host", "kvSet", [key, value]);
    },
    kvDelete(key) {
      kvStore.delete(key);
      record("astrid:kv/host", "kvDelete", [key]);
    },
  };

  // --- astrid:sys/host ---------------------------------------------------
  const startNs = process?.hrtime?.bigint ? process.hrtime.bigint() : BigInt(Math.trunc(performance.now() * 1e6));
  const nowMonotonicNs = () =>
    process?.hrtime?.bigint ? process.hrtime.bigint() - startNs : BigInt(Math.trunc(performance.now() * 1e6)) - startNs;

  const sys = {
    getConfig(key) {
      // option<string> -> undefined => capsule uses its compiled defaults.
      record("astrid:sys/host", "getConfig", [key], "none");
      return undefined;
    },
    log(level, message) {
      record("astrid:sys/host", "log", [level, message]);
    },
    clockMonotonicNs() {
      const ns = nowMonotonicNs();
      // Not journaled verbosely (called in a tight loop); count only.
      return ns;
    },
    randomBytes(length) {
      const n = Number(length);
      const out = new Uint8Array(n);
      for (let i = 0; i < n; i++) out[i] = (Math.random() * 256) & 0xff;
      record("astrid:sys/host", "randomBytes", [length], `${n}B`);
      return out;
    },
    checkCapsuleCapability(request) {
      record("astrid:sys/host", "checkCapsuleCapability", [request], "allowed=false");
      return { allowed: false };
    },
  };

  const imports = {
    "astrid:ipc/host": ipc,
    "astrid:kv/host": kv,
    "astrid:sys/host": sys,
    "astrid:guest/lifecycle": {}, // type-only interface; no runtime fns
    // Versioned aliases (harmless if unused; some jco outputs key by version).
    "astrid:ipc/host@1.0.0": ipc,
    "astrid:kv/host@1.0.0": kv,
    "astrid:sys/host@1.0.0": sys,
    "astrid:guest/lifecycle@1.0.0": {},
  };

  return { imports, journal, kvStore };
}

function summarize(x) {
  if (x instanceof Uint8Array) {
    const s = new TextDecoder().decode(x.subarray(0, 80));
    return `<${x.length}B: ${JSON.stringify(s)}${x.length > 80 ? "…" : ""}>`;
  }
  if (typeof x === "bigint") return `${x}n`;
  if (typeof x === "string") return x.length > 100 ? JSON.stringify(x.slice(0, 100)) + "…" : JSON.stringify(x);
  if (x && typeof x === "object") return JSON.stringify(x);
  return String(x);
}
