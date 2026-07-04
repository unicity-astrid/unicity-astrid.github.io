/** @module Interface astrid:kv/host@1.0.0 **/
export function kvGet(key: string): Uint8Array | undefined;
export function kvSet(key: string, value: Uint8Array): void;
export function kvDelete(key: string): void;
export type ErrorCode = ErrorCodeInvalidKey | ErrorCodeTooLarge | ErrorCodeQuota | ErrorCodeCasMismatch | ErrorCodeUnknown;
export interface ErrorCodeInvalidKey {
  tag: 'invalid-key',
}
export interface ErrorCodeTooLarge {
  tag: 'too-large',
}
export interface ErrorCodeQuota {
  tag: 'quota',
}
export interface ErrorCodeCasMismatch {
  tag: 'cas-mismatch',
}
export interface ErrorCodeUnknown {
  tag: 'unknown',
  val: string,
}
