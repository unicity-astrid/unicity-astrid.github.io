/** @module Interface astrid:ipc/host@1.0.0 **/
export function publish(topic: string, payload: string): void;
export function subscribe(topicPattern: string): Subscription;
export type PrincipalAttribution = PrincipalAttributionVerified | PrincipalAttributionClaimed | PrincipalAttributionSystem;
export interface PrincipalAttributionVerified {
  tag: 'verified',
  val: string,
}
export interface PrincipalAttributionClaimed {
  tag: 'claimed',
  val: string,
}
export interface PrincipalAttributionSystem {
  tag: 'system',
}
export interface IpcMessage {
  topic: string,
  payload: string,
  sourceId: string,
  principal: PrincipalAttribution,
}
export interface IpcEnvelope {
  messages: Array<IpcMessage>,
  dropped: bigint,
  lagged: bigint,
}
export type ErrorCode = ErrorCodeCapabilityDenied | ErrorCodeInvalidInput | ErrorCodeClosed | ErrorCodeRateLimited | ErrorCodeBackpressure | ErrorCodeQuota | ErrorCodeTimeout | ErrorCodeUnknown;
export interface ErrorCodeCapabilityDenied {
  tag: 'capability-denied',
}
export interface ErrorCodeInvalidInput {
  tag: 'invalid-input',
}
export interface ErrorCodeClosed {
  tag: 'closed',
}
export interface ErrorCodeRateLimited {
  tag: 'rate-limited',
}
export interface ErrorCodeBackpressure {
  tag: 'backpressure',
}
export interface ErrorCodeQuota {
  tag: 'quota',
}
export interface ErrorCodeTimeout {
  tag: 'timeout',
}
export interface ErrorCodeUnknown {
  tag: 'unknown',
  val: string,
}

export class Subscription {
  /**
   * This type does not have a public constructor.
   */
  private constructor();
  recv(timeoutMs: bigint): IpcEnvelope;
}
