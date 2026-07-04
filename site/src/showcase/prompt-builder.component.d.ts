// world root:component/root
export type CapsuleResult = import('./interfaces/astrid-guest-lifecycle.js').CapsuleResult;
import type * as AstridGuestLifecycle from './interfaces/astrid-guest-lifecycle.js'; // astrid:guest/lifecycle@1.0.0
import type * as AstridIpcHost from './interfaces/astrid-ipc-host.js'; // astrid:ipc/host@1.0.0
import type * as AstridKvHost from './interfaces/astrid-kv-host.js'; // astrid:kv/host@1.0.0
import type * as AstridSysHost from './interfaces/astrid-sys-host.js'; // astrid:sys/host@1.0.0
export interface ImportObject {
  'astrid:guest/lifecycle@1.0.0': typeof AstridGuestLifecycle,
  'astrid:ipc/host@1.0.0': typeof AstridIpcHost,
  'astrid:kv/host@1.0.0': typeof AstridKvHost,
  'astrid:sys/host@1.0.0': typeof AstridSysHost,
}
export interface Root {
  astridHookTrigger(action: string, payload: Uint8Array): CapsuleResult,
  run(): void,
  astridInstall(): void,
  astridUpgrade(): void,
}

/**
* Instantiates this component with the provided imports and
* returns a map of all the exports of the component.
*
* This function is intended to be similar to the
* `WebAssembly.Instantiate` constructor. The second `imports`
* argument is the "import object" for wasm, except here it
* uses component-model-layer types instead of core wasm
* integers/numbers/etc.
*
* The first argument to this function, `getCoreModule`, is
* used to compile core wasm modules within the component.
* Components are composed of core wasm modules and this callback
* will be invoked per core wasm module. The caller of this
* function is responsible for reading the core wasm module
* identified by `path` and returning its compiled
* `WebAssembly.Module` object. This would use the
* `WebAssembly.Module` constructor on the web, for example.
*/
export function instantiate(
getCoreModule: (path: string) => WebAssembly.Module,
imports: ImportObject,
instantiateCore?: (module: WebAssembly.Module, imports: Record<string, any>) => WebAssembly.Instance
): Root;
export function instantiate(
getCoreModule: (path: string) => WebAssembly.Module | Promise<WebAssembly.Module>,
imports: ImportObject,
instantiateCore?: (module: WebAssembly.Module, imports: Record<string, any>) => WebAssembly.Instance | Promise<WebAssembly.Instance>
): Root | Promise<Root>;

