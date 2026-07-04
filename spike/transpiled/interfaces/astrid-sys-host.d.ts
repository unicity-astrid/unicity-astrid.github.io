/** @module Interface astrid:sys/host@1.0.0 **/
export function getConfig(key: string): string | undefined;
export function log(level: LogLevel, message: string): void;
export function clockMonotonicNs(): bigint;
export function randomBytes(length: bigint): Uint8Array;
export function checkCapsuleCapability(request: CapabilityCheckRequest): CapabilityCheckResponse;
/**
 * # Variants
 * 
 * ## `"trace"`
 * 
 * ## `"debug"`
 * 
 * ## `"info"`
 * 
 * ## `"warn"`
 * 
 * ## `"error"`
 */
export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error';
export type ErrorCode = ErrorCodeCapabilityDenied | ErrorCodeConfigKeyReserved | ErrorCodeTooLarge | ErrorCodeRegistryUnavailable | ErrorCodeCancelled | ErrorCodeUnknown;
export interface ErrorCodeCapabilityDenied {
  tag: 'capability-denied',
}
export interface ErrorCodeConfigKeyReserved {
  tag: 'config-key-reserved',
}
export interface ErrorCodeTooLarge {
  tag: 'too-large',
}
export interface ErrorCodeRegistryUnavailable {
  tag: 'registry-unavailable',
}
export interface ErrorCodeCancelled {
  tag: 'cancelled',
}
export interface ErrorCodeUnknown {
  tag: 'unknown',
  val: string,
}
export interface CapabilityCheckRequest {
  sourceUuid: string,
  capability: string,
}
export interface CapabilityCheckResponse {
  allowed: boolean,
}
