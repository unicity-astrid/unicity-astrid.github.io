// run-node.mjs — the actual go/no-go gate.
//
// Instantiate the jco-transpiled, real prompt-builder capsule in Node (V8) with
// stubbed astrid:* host imports, then drive ONE real interaction:
//   astridHookTrigger("handle_assemble", <AssembleRequest JSON>)
// which is exactly how the Astrid kernel dispatches the capsule's
// #[astrid::interceptor("handle_assemble")] handler.
//
// Success == the guest executes its real assemble() business logic and produces
// observable host-side behaviour (subscribe/publish/kv calls in the journal,
// culminating in a published `prompt_builder.v1.response.assemble` envelope).

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { instantiate } from "./transpiled/prompt-builder.component.js";
import { createHost } from "./host-stubs.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const transpiledDir = join(here, "transpiled");

async function getCoreModule(path) {
  const bytes = await readFile(join(transpiledDir, path));
  return await WebAssembly.compile(bytes);
}

async function main() {
  console.log("== Astrid-in-the-browser spike: Node (V8) drive ==");
  console.log("node", process.version);

  const { imports, journal } = createHost();

  console.log("\n[1] instantiating transpiled component with stubbed astrid:* host…");
  const root = await instantiate(getCoreModule, imports);
  console.log("    instantiated. exports:", Object.keys(root).join(", "));

  // Synthesize a real prompt_builder.v1.assemble request, consistent with the
  // AssembleRequest WIT/serde shape (request_id required and non-empty).
  const request = {
    system_prompt: "You are Astrid, a secure agent runtime assistant.",
    request_id: "spike-req-0001",
    model: "claude-opus-4",
    provider: "anthropic",
    messages: [{ role: "user", content: "What can you do?" }],
  };
  const payload = new TextEncoder().encode(JSON.stringify(request));

  console.log("\n[2] driving astridHookTrigger('handle_assemble', <payload>)…");
  console.log("    payload:", JSON.stringify(request));
  console.log("    --- guest executes, host calls follow ---");
  const result = root.astridHookTrigger("handle_assemble", payload);
  console.log("    --- guest returned ---");
  console.log("\n[3] CapsuleResult:", JSON.stringify(result));

  // Pull the assembled response the guest published back onto the bus.
  const assembled = journal.find(
    (e) => e.fn === "publish" && e.args[0] === "prompt_builder.v1.response.assemble"
  );

  console.log("\n[4] host-call journal (", journal.length, "entries ):");
  for (const e of journal) {
    console.log(`   #${e.seq} ${e.iface}#${e.fn}(${e.args[0] ?? ""})`);
  }

  console.log("\n[5] GUEST OUTPUT — published prompt_builder.v1.response.assemble:");
  if (assembled) {
    console.log(JSON.stringify(JSON.parse(assembled.args[1]), null, 2));
  } else {
    console.log("   (none found — FAIL)");
  }

  // Gate assertions.
  const publishes = journal.filter((e) => e.fn === "publish").map((e) => e.args[0]);
  const ok =
    result &&
    result.action === "continue" &&
    assembled &&
    JSON.parse(assembled.args[1]).request_id === "spike-req-0001" &&
    publishes.includes("prompt_builder.v1.hook.before_build") &&
    publishes.includes("tool.v1.request.describe");

  console.log("\n[6] VERDICT:", ok ? "PASS — guest code ran and produced observable behaviour" : "FAIL");
  if (!ok) process.exit(1);
}

main().catch((e) => {
  console.error("SPIKE ERROR:", e);
  process.exit(1);
});
