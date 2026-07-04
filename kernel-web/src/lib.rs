//! `kernel-web` — a `wasm-bindgen` bridge exposing the REAL Astrid kernel
//! (`astrid-kernel`, compiled to `wasm32-unknown-unknown`) to JavaScript.
//!
//! Nothing here is mocked. `AstridWeb` owns a live [`Kernel`] booted with
//! in-memory resources (the exact `kernel-smoke::boot_in_memory` recipe) and
//! every method drives a real kernel/capability/audit surface:
//!
//! - `kv_set`/`kv_get` go through `kernel.kv` (the injected [`KvStore`]).
//! - `publish`/`subscribe` drive the real [`EventBus`].
//! - `grant`/`check` mint and verify real signed [`CapabilityToken`]s in the
//!   kernel's [`CapabilityStore`].
//! - `events_routed` counts every event the kernel routes, via a crate-owned
//!   subscribe-everything pump started at boot.
//! - `audit_len`/`audit_tail` read the real signed audit chain — the
//!   genuinely-async audit storage resolves on `wasm32-unknown-unknown` (the
//!   old sync-over-async surface panicked here; that regression is fixed).
//! - The guest mediation surface (`guest_kv_get`/`guest_kv_set`/`guest_publish`,
//!   plus `revoke`) is the playground's ENFORCEMENT path: each op checks the
//!   real `CapabilityStore` first, lands every allow/deny decision on the real
//!   audit chain, and throws on denial — the thrown error is the enforcement.
//! - The synchronous host shims (`host_publish`/`host_kv_get_sync`/
//!   `host_kv_set_sync`/`host_subscribe_queue`) back a jco-transpiled capsule
//!   whose `astrid:*` host imports are SYNCHRONOUS; they drive the same live
//!   kernel bus/KV without an `.await`, with a drainable `SyncTopicQueue` for
//!   the sync `Subscription.recv` import.
//!
//! [`KvStore`]: astrid_storage::KvStore
//! [`EventBus`]: astrid_events::EventBus
//! [`CapabilityStore`]: astrid_capabilities::CapabilityStore

use std::cell::RefCell;
use std::collections::{HashMap, VecDeque};
use std::path::PathBuf;
use std::rc::Rc;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;

use astrid_capabilities::{AuditEntryId, CapabilityToken, ResourcePattern, TokenScope};
use astrid_core::dirs::AstridHome;
use astrid_core::session_token::SessionToken;
use astrid_core::{Permission, PrincipalId, SessionId, TokenId};
use astrid_events::{AstridEvent, EventMetadata, TopicMatcher};
use astrid_kernel::{Kernel, KernelResources};
use futures::FutureExt;
use wasm_bindgen::prelude::*;

/// Maximum entries held by a [`SyncTopicQueue`] before it drops the oldest
/// (mirrors the real bus's lag-drop semantics).
const SYNC_QUEUE_CAP: usize = 256;

/// Git commit of the `core/` checkout this bridge was compiled from, injected
/// by `build.rs` (falls back to `"unknown"` when git is unavailable).
const CORE_COMMIT: &str = env!("KERNEL_WEB_CORE_COMMIT");

/// The live bridge handle exposed to JavaScript.
///
/// Holds an `Arc<Kernel>` (the real kernel) plus the crate-owned
/// events-routed counter incremented by the boot-time wildcard pump.
#[wasm_bindgen]
pub struct AstridWeb {
    kernel: Arc<Kernel>,
    events_routed: Arc<AtomicU64>,
}

#[wasm_bindgen]
impl AstridWeb {
    /// Boot a real kernel with in-memory resources and start the
    /// events-routed pump.
    ///
    /// This is the `kernel-smoke::boot_in_memory` recipe: `AstridHome`
    /// pointing at a virtual path, an in-memory `KvStore`, a freshly
    /// generated runtime keypair shared with an in-memory `AuditLog`, and a
    /// generated session token. No filesystem, no network.
    ///
    /// # Errors
    ///
    /// Returns a `JsError` if `Kernel::with_resources` fails.
    pub async fn boot() -> Result<AstridWeb, JsError> {
        let home = AstridHome::from_path("/astrid");
        let kv: Arc<dyn astrid_storage::KvStore> = Arc::new(astrid_storage::MemoryKvStore::new());
        let runtime_key = Arc::new(astrid_crypto::KeyPair::generate());
        let audit_log = Arc::new(astrid_audit::AuditLog::in_memory(Arc::clone(&runtime_key)));
        let session_token = Arc::new(SessionToken::generate());

        let resources = KernelResources::new(
            home,
            kv,
            audit_log,
            runtime_key,
            session_token,
            PathBuf::from("/astrid/run/session.token"),
            None,
            None,
        );

        let kernel = Kernel::with_resources(
            SessionId::new(),
            PathBuf::from("/workspace"),
            astrid_capsule_types::CapsuleRuntimeLimits::default(),
            HashMap::new(),
            astrid_capsule_types::HttpLimits::default(),
            resources,
        )
        .await
        .map_err(|e| JsError::new(&format!("kernel boot failed: {e}")))?;

        let events_routed = Arc::new(AtomicU64::new(0));

        // Crate-owned subscribe-everything pump: a broadcast receiver sees
        // every event the kernel routes, and each delivery bumps the counter.
        // The future is `Send` (broadcast `Receiver<Arc<AstridEvent>>` + an
        // `Arc<AtomicU64>`), so it goes through `astrid_runtime::spawn`
        // (spawn_local-backed on this target).
        let mut all = kernel.event_bus.subscribe();
        let counter = Arc::clone(&events_routed);
        // Detach the pump: dropping the handle does NOT cancel the task (it
        // keeps running on the microtask queue), so dropping it is correct.
        drop(astrid_runtime::spawn(async move {
            while let Some(_event) = all.recv().await {
                counter.fetch_add(1, Ordering::Relaxed);
            }
        }));

        Ok(AstridWeb {
            kernel,
            events_routed,
        })
    }

    /// Git commit of the `astrid-kernel` checkout this module was built from.
    #[wasm_bindgen(js_name = kernelCommit)]
    #[must_use]
    pub fn kernel_commit(&self) -> String {
        CORE_COMMIT.to_string()
    }

    /// Store a UTF-8 value under `(namespace, key)` in the kernel KV.
    ///
    /// # Errors
    ///
    /// Returns a `JsError` if the KV write fails.
    #[wasm_bindgen(js_name = kvSet)]
    pub async fn kv_set(&self, ns: String, key: String, val: String) -> Result<(), JsError> {
        self.kernel
            .kv
            .set(&ns, &key, val.into_bytes())
            .await
            .map_err(|e| JsError::new(&format!("kv set failed: {e}")))
    }

    /// Read the UTF-8 value stored under `(namespace, key)`, or `None`.
    ///
    /// # Errors
    ///
    /// Returns a `JsError` if the KV read fails or the stored bytes are not
    /// valid UTF-8.
    #[wasm_bindgen(js_name = kvGet)]
    pub async fn kv_get(&self, ns: String, key: String) -> Result<Option<String>, JsError> {
        let bytes = self
            .kernel
            .kv
            .get(&ns, &key)
            .await
            .map_err(|e| JsError::new(&format!("kv get failed: {e}")))?;
        match bytes {
            None => Ok(None),
            Some(b) => String::from_utf8(b)
                .map(Some)
                .map_err(|e| JsError::new(&format!("kv value is not valid UTF-8: {e}"))),
        }
    }

    /// Publish a `Custom` event on the real bus.
    ///
    /// `json` is parsed as the event payload; `topic` becomes the event name.
    /// The event is stamped with source `"astrid-web"`.
    ///
    /// # Errors
    ///
    /// Returns a `JsError` if `json` is not valid JSON.
    pub async fn publish(&self, topic: String, json: String) -> Result<(), JsError> {
        let data: serde_json::Value = serde_json::from_str(&json)
            .map_err(|e| JsError::new(&format!("publish payload is not valid JSON: {e}")))?;
        self.kernel.event_bus.publish(AstridEvent::Custom {
            metadata: EventMetadata::new("astrid-web"),
            name: topic,
            data,
        });
        Ok(())
    }

    /// Subscribe to bus events whose derived topic matches `pattern`.
    ///
    /// For each matching event the JS `cb` is invoked as
    /// `cb(topic_string, data_json_string)`:
    /// - `Custom` events deliver `(name, data)`.
    /// - Any other event delivers `(kind, full_event_json)` where `kind` is
    ///   the event's serde tag — nothing is dropped silently.
    ///
    /// The pump runs on `wasm_bindgen_futures::spawn_local` rather than
    /// `astrid_runtime::spawn`: the latter requires a `Send` future, and the
    /// captured `js_sys::Function` is `!Send` on this target, so spawn_local
    /// (which drives `!Send` futures on the JS microtask queue) is the only
    /// correct primitive here. Callback errors are ignored — a throwing JS
    /// callback must not wedge or panic the pump.
    ///
    /// # Errors
    ///
    /// This constructor never fails today; the `Result` leaves room for future
    /// pattern validation without an API break.
    pub fn subscribe(&self, pattern: String, cb: js_sys::Function) -> Result<(), JsError> {
        let matcher = TopicMatcher::new(pattern);
        let mut rx = self.kernel.event_bus.subscribe();
        wasm_bindgen_futures::spawn_local(async move {
            while let Some(event) = rx.recv().await {
                let (topic, data_json) = extract_topic_data(&event);

                if !matcher.matches_topic(&topic) {
                    continue;
                }

                // Ignore a throwing callback: the pump must survive it.
                let _ = cb.call2(
                    &JsValue::NULL,
                    &JsValue::from_str(&topic),
                    &JsValue::from_str(&data_json),
                );
            }
        });
        Ok(())
    }

    /// Grant `principal` a real capability for `(resource, perm)`.
    ///
    /// Mints a session-scoped [`CapabilityToken`] (signed by the kernel's
    /// runtime key) and adds it to the kernel `CapabilityStore`. Session scope
    /// is deliberate: it stores the token purely in-memory, avoiding the
    /// SurrealKV persistence path that a `Persistent` token would require — the
    /// browser has no filesystem. Returns the new token id.
    ///
    /// `perm` maps `"read"`/`"write"`/`"execute"` onto the real [`Permission`]
    /// variants; any other value is rejected.
    ///
    /// # Errors
    ///
    /// Returns a `JsError` for an invalid principal, an unsupported permission,
    /// an invalid resource pattern, or a capability-store failure.
    pub async fn grant(
        &self,
        principal: String,
        resource: String,
        perm: String,
    ) -> Result<String, JsError> {
        let principal = PrincipalId::new(&principal)
            .map_err(|e| JsError::new(&format!("invalid principal: {e}")))?;
        let permission = parse_permission(&perm)?;
        let pattern = ResourcePattern::exact(&resource)
            .map_err(|e| JsError::new(&format!("invalid resource: {e}")))?;

        let token = CapabilityToken::create(
            pattern,
            vec![permission],
            TokenScope::Session,
            self.kernel.runtime_key.key_id(),
            AuditEntryId::new(),
            &self.kernel.runtime_key,
            None,
            principal.clone(),
        );
        let token_id = token.id.clone();

        self.kernel
            .capabilities
            .add(token)
            .await
            .map_err(|e| JsError::new(&format!("capability add failed: {e}")))?;

        // Land the grant on the real signed audit chain. Failure degrades to
        // continue (the grant itself already succeeded) — same fail-secure
        // posture as the kernel's own audit paths — but is surfaced to JS via
        // console warn through tracing rather than swallowed.
        if let Err(e) = self
            .kernel
            .audit_log
            .append_with_principal(
                self.kernel.session_id.clone(),
                principal,
                astrid_audit::AuditAction::CapabilityCreated {
                    token_id: token_id.clone(),
                    resource,
                    permissions: vec![permission],
                    scope: astrid_audit::ApprovalScope::Session,
                },
                astrid_audit::AuthorizationProof::NotRequired {
                    reason: "interactive site demo grant".to_string(),
                },
                astrid_audit::AuditOutcome::success(),
            )
            .await
        {
            web_console_warn(&format!("astrid: audit append failed for grant: {e}"));
        }

        Ok(token_id.to_string())
    }

    /// Check whether `principal` holds a live capability for `(resource, perm)`.
    ///
    /// Drives the real `CapabilityStore::find_capability`: `true` only if a
    /// non-expired, signature-valid token owned by `principal` grants the
    /// permission for a resource matching the token's pattern.
    ///
    /// # Errors
    ///
    /// Returns a `JsError` for an invalid principal or unsupported permission.
    pub async fn check(
        &self,
        principal: String,
        resource: String,
        perm: String,
    ) -> Result<bool, JsError> {
        let principal = PrincipalId::new(&principal)
            .map_err(|e| JsError::new(&format!("invalid principal: {e}")))?;
        let permission = parse_permission(&perm)?;
        let allowed = self
            .kernel
            .capabilities
            .find_capability(&principal, &resource, permission)
            .await
            .is_some();

        // Every check decision lands on the real signed chain (grant AND
        // deny), so the page's ledger is the actual audit record.
        let action = format!("{perm} {resource}");
        let audit_action = if allowed {
            astrid_audit::AuditAction::ApprovalGranted {
                action,
                resource: Some(resource),
                scope: astrid_audit::ApprovalScope::Session,
            }
        } else {
            astrid_audit::AuditAction::ApprovalDenied {
                action,
                reason: Some("no capability covers this resource/permission".to_string()),
            }
        };
        let outcome = if allowed {
            astrid_audit::AuditOutcome::success()
        } else {
            astrid_audit::AuditOutcome::failure("denied: no covering capability")
        };
        if let Err(e) = self
            .kernel
            .audit_log
            .append_with_principal(
                self.kernel.session_id.clone(),
                principal,
                audit_action,
                astrid_audit::AuthorizationProof::NotRequired {
                    reason: "interactive site demo check".to_string(),
                },
                outcome,
            )
            .await
        {
            web_console_warn(&format!("astrid: audit append failed for check: {e}"));
        }

        Ok(allowed)
    }

    /// Number of entries on the real audit chain.
    ///
    /// Requires the genuinely-async audit storage (core branch for issue
    /// #1154); on the old sync-over-async surface this call panicked on wasm.
    ///
    /// # Errors
    ///
    /// Returns a `JsError` if the audit storage fails.
    #[wasm_bindgen(js_name = auditLen)]
    pub async fn audit_len(&self) -> Result<u64, JsError> {
        let n = self
            .kernel
            .audit_log
            .count()
            .await
            .map_err(|e| JsError::new(&format!("audit count failed: {e}")))?;
        Ok(n as u64)
    }

    /// Last `n` entries of this session's real audit chain, oldest first, as a
    /// JSON array of `{hash, action, at}` — `hash` is the entry's BLAKE3
    /// content hash (hex), `action` the serde tag of the audited action.
    ///
    /// # Errors
    ///
    /// Returns a `JsError` if the audit storage fails.
    #[wasm_bindgen(js_name = auditTail)]
    pub async fn audit_tail(&self, n: u32) -> Result<String, JsError> {
        let entries = self
            .kernel
            .audit_log
            .get_session_entries(&self.kernel.session_id)
            .await
            .map_err(|e| JsError::new(&format!("audit read failed: {e}")))?;
        let tail: Vec<serde_json::Value> = entries
            .iter()
            .rev()
            .take(n as usize)
            .rev()
            .map(|entry| {
                let action = serde_json::to_value(&entry.action)
                    .ok()
                    .and_then(|v| {
                        v.get("type")
                            .and_then(serde_json::Value::as_str)
                            .map(str::to_string)
                    })
                    .unwrap_or_else(|| "entry".to_string());
                serde_json::json!({
                    "hash": entry.content_hash().to_hex(),
                    "action": action,
                    "at": entry.timestamp.to_string(),
                })
            })
            .collect();
        serde_json::to_string(&tail)
            .map_err(|e| JsError::new(&format!("audit tail serialization failed: {e}")))
    }

    /// Number of events the kernel has routed since boot, from the crate-owned
    /// wildcard pump.
    #[wasm_bindgen(js_name = eventsRouted)]
    #[must_use]
    pub fn events_routed(&self) -> u64 {
        self.events_routed.load(Ordering::Relaxed)
    }

    // --- guest mediation surface -----------------------------------------
    // The playground lets a visitor author a small JS "guest capsule" with a
    // name (its principal), subscriptions, and requested capabilities minted
    // via `grant`. These methods are the ENFORCEMENT path: each mediated op
    // checks the real `CapabilityStore` first, lands the allow/deny decision
    // on the real audit chain, and throws on denial. The thrown `JsError` is
    // the enforcement the playground UI surfaces.

    /// Read a guest KV value under `(ns, key)`, mediated by the guest's real
    /// `Read` capability for resource `kv:<ns>`.
    ///
    /// # Errors
    ///
    /// Returns a `JsError` for an invalid principal, if the guest holds no
    /// covering capability (denial), or if the KV read fails / is not UTF-8.
    #[wasm_bindgen(js_name = guestKvGet)]
    pub async fn guest_kv_get(
        &self,
        principal: String,
        ns: String,
        key: String,
    ) -> Result<Option<String>, JsError> {
        self.guest_authorize(&principal, format!("kv:{ns}"), Permission::Read, "read")
            .await?;
        let bytes = self
            .kernel
            .kv
            .get(&ns, &key)
            .await
            .map_err(|e| JsError::new(&format!("kv get failed: {e}")))?;
        match bytes {
            None => Ok(None),
            Some(b) => String::from_utf8(b)
                .map(Some)
                .map_err(|e| JsError::new(&format!("kv value is not valid UTF-8: {e}"))),
        }
    }

    /// Store a guest KV value under `(ns, key)`, mediated by the guest's real
    /// `Write` capability for resource `kv:<ns>`.
    ///
    /// # Errors
    ///
    /// Returns a `JsError` for an invalid principal, if the guest holds no
    /// covering capability (denial), or if the KV write fails.
    #[wasm_bindgen(js_name = guestKvSet)]
    pub async fn guest_kv_set(
        &self,
        principal: String,
        ns: String,
        key: String,
        val: String,
    ) -> Result<(), JsError> {
        self.guest_authorize(&principal, format!("kv:{ns}"), Permission::Write, "write")
            .await?;
        self.kernel
            .kv
            .set(&ns, &key, val.into_bytes())
            .await
            .map_err(|e| JsError::new(&format!("kv set failed: {e}")))
    }

    /// Publish a guest `Custom` event, mediated by the guest's real `Write`
    /// capability for resource `topic:<topic>`.
    ///
    /// On allow the event is attributed to the guest principal (not
    /// `"astrid-web"`), so the audited source is the guest itself.
    ///
    /// # Errors
    ///
    /// Returns a `JsError` for an invalid principal, if the guest holds no
    /// covering capability (denial), or if `json` is not valid JSON.
    #[wasm_bindgen(js_name = guestPublish)]
    pub async fn guest_publish(
        &self,
        principal: String,
        topic: String,
        json: String,
    ) -> Result<(), JsError> {
        self.guest_authorize(
            &principal,
            format!("topic:{topic}"),
            Permission::Write,
            "write",
        )
        .await?;
        let data: serde_json::Value = serde_json::from_str(&json)
            .map_err(|e| JsError::new(&format!("publish payload is not valid JSON: {e}")))?;
        self.kernel.event_bus.publish(AstridEvent::Custom {
            metadata: EventMetadata::new(&principal),
            name: topic,
            data,
        });
        Ok(())
    }

    /// Revoke the capability token `token_id`, removing it from the real
    /// `CapabilityStore` and landing a `CapabilityRevoked` entry on the audit
    /// chain.
    ///
    /// `token_id` accepts the `"token:<uuid>"` string returned by `grant`
    /// (the bare `<uuid>` is also accepted).
    ///
    /// # Errors
    ///
    /// Returns a `JsError` for a malformed token id or a capability-store
    /// failure.
    pub async fn revoke(&self, token_id: String) -> Result<(), JsError> {
        // `grant` returns `TokenId::to_string()` == `"token:<uuid>"`; strip the
        // `Display` prefix, then deserialize the bare UUID through `TokenId`'s
        // transparent newtype serde (no direct uuid-crate dep needed).
        let raw = token_id.strip_prefix("token:").unwrap_or(&token_id);
        let tid: TokenId = serde_json::from_str(&format!("\"{raw}\""))
            .map_err(|e| JsError::new(&format!("invalid token id: {e}")))?;

        self.kernel
            .capabilities
            .revoke(&tid)
            .await
            .map_err(|e| JsError::new(&format!("capability revoke failed: {e}")))?;

        // Land the revocation on the real signed chain. Failure degrades to
        // continue (the revoke already succeeded) — same fail-secure posture as
        // the kernel's own audit paths.
        if let Err(e) = self
            .kernel
            .audit_log
            .append(
                self.kernel.session_id.clone(),
                astrid_audit::AuditAction::CapabilityRevoked {
                    token_id: tid,
                    reason: "interactive site demo revoke".to_string(),
                },
                astrid_audit::AuthorizationProof::NotRequired {
                    reason: "playground guest mediation".to_string(),
                },
                astrid_audit::AuditOutcome::success(),
            )
            .await
        {
            web_console_warn(&format!("astrid: audit append failed for revoke: {e}"));
        }

        Ok(())
    }

    // --- synchronous host shims for the jco showcase ---------------------
    // A real jco-transpiled capsule runs in the tab with its `astrid:*` host
    // imports wired to this live kernel. jco host-import calls are SYNCHRONOUS,
    // so these are non-async entry points onto the same bus/KV.

    /// Synchronously publish a `Custom` event on the real bus, attributed to
    /// `source`. Backs the `astrid:ipc/host#publish` import.
    ///
    /// The bus `publish` is already synchronous; only JSON parsing can fail.
    ///
    /// # Errors
    ///
    /// Returns a `JsError` if `json` is not valid JSON.
    #[wasm_bindgen(js_name = hostPublish)]
    pub fn host_publish(&self, source: String, topic: String, json: String) -> Result<(), JsError> {
        let data: serde_json::Value = serde_json::from_str(&json)
            .map_err(|e| JsError::new(&format!("publish payload is not valid JSON: {e}")))?;
        self.kernel.event_bus.publish(AstridEvent::Custom {
            metadata: EventMetadata::new(&source),
            name: topic,
            data,
        });
        Ok(())
    }

    /// Synchronously read `(ns, key)` from the kernel KV. Backs the
    /// `astrid:kv/host#kv-get` import.
    ///
    /// The kernel KV is the in-memory `MemoryKvStore`, whose futures have no
    /// await points and resolve on the first poll; `now_or_never` drives that
    /// without blocking. If the future genuinely pended it returns an honest
    /// error rather than spinning.
    ///
    /// # Errors
    ///
    /// Returns a `JsError` if the store pended (sync path unavailable), the KV
    /// read fails, or the stored bytes are not valid UTF-8.
    #[wasm_bindgen(js_name = hostKvGetSync)]
    pub fn host_kv_get_sync(&self, ns: String, key: String) -> Result<Option<String>, JsError> {
        let bytes = match self.kernel.kv.get(&ns, &key).now_or_never() {
            Some(r) => r.map_err(|e| JsError::new(&format!("kv get failed: {e}")))?,
            None => {
                return Err(JsError::new(
                    "sync KV path unavailable: store pended (get did not resolve on first poll)",
                ))
            }
        };
        match bytes {
            None => Ok(None),
            Some(b) => String::from_utf8(b)
                .map(Some)
                .map_err(|e| JsError::new(&format!("kv value is not valid UTF-8: {e}"))),
        }
    }

    /// Synchronously store `(ns, key) = val` in the kernel KV. Backs the
    /// `astrid:kv/host#kv-set` import. See [`host_kv_get_sync`] for the
    /// `now_or_never` rationale.
    ///
    /// [`host_kv_get_sync`]: AstridWeb::host_kv_get_sync
    ///
    /// # Errors
    ///
    /// Returns a `JsError` if the store pended (sync path unavailable) or the
    /// KV write fails.
    #[wasm_bindgen(js_name = hostKvSetSync)]
    pub fn host_kv_set_sync(&self, ns: String, key: String, val: String) -> Result<(), JsError> {
        match self.kernel.kv.set(&ns, &key, val.into_bytes()).now_or_never() {
            Some(r) => r.map_err(|e| JsError::new(&format!("kv set failed: {e}"))),
            None => Err(JsError::new(
                "sync KV path unavailable: store pended (set did not resolve on first poll)",
            )),
        }
    }

    /// Create a drainable [`SyncTopicQueue`] fed by the real bus for events
    /// whose derived topic matches `pattern`. Backs the sync
    /// `astrid:ipc/host#subscribe` + `Subscription.recv` import pair: the
    /// capsule's synchronous `recv` drains this queue instead of awaiting.
    ///
    /// The queue is `Rc<RefCell<..>>` (hence `!Send`), so the pump runs on
    /// `wasm_bindgen_futures::spawn_local` — the same reasoning as [`subscribe`]:
    /// `astrid_runtime::spawn` demands a `Send` future the `Rc` cannot satisfy.
    ///
    /// [`subscribe`]: AstridWeb::subscribe
    #[wasm_bindgen(js_name = hostSubscribeQueue)]
    #[must_use]
    pub fn host_subscribe_queue(&self, pattern: String) -> SyncTopicQueue {
        let matcher = TopicMatcher::new(pattern);
        let mut rx = self.kernel.event_bus.subscribe();

        let queue: Rc<RefCell<VecDeque<(String, String)>>> = Rc::new(RefCell::new(VecDeque::new()));
        let dropped: Rc<RefCell<u64>> = Rc::new(RefCell::new(0));
        let pump_queue = Rc::clone(&queue);
        let pump_dropped = Rc::clone(&dropped);

        wasm_bindgen_futures::spawn_local(async move {
            while let Some(event) = rx.recv().await {
                let (topic, data_json) = extract_topic_data(&event);
                if !matcher.matches_topic(&topic) {
                    continue;
                }
                let mut q = pump_queue.borrow_mut();
                // Bounded: on overflow drop the OLDEST entry and count it,
                // mirroring the bus's lag-drop semantics.
                if q.len() >= SYNC_QUEUE_CAP {
                    q.pop_front();
                    *pump_dropped.borrow_mut() += 1;
                }
                q.push_back((topic, data_json));
            }
        });

        SyncTopicQueue { queue, dropped }
    }

    /// Shared enforcement core for the guest mediation surface: parse the
    /// principal, check the real `CapabilityStore`, land the allow/deny
    /// decision on the real audit chain (allow AND deny), and throw on denial.
    /// Returns `Ok(())` only when the guest holds a covering capability.
    async fn guest_authorize(
        &self,
        principal: &str,
        resource: String,
        permission: Permission,
        perm_label: &str,
    ) -> Result<(), JsError> {
        let principal = PrincipalId::new(principal)
            .map_err(|e| JsError::new(&format!("invalid principal: {e}")))?;
        let allowed = self
            .kernel
            .capabilities
            .find_capability(&principal, &resource, permission)
            .await
            .is_some();

        let action = format!("{perm_label} {resource}");
        let (audit_action, outcome) = if allowed {
            (
                astrid_audit::AuditAction::ApprovalGranted {
                    action,
                    resource: Some(resource.clone()),
                    scope: astrid_audit::ApprovalScope::Session,
                },
                astrid_audit::AuditOutcome::success(),
            )
        } else {
            (
                astrid_audit::AuditAction::ApprovalDenied {
                    action,
                    reason: Some(format!(
                        "{principal} has no {perm_label} capability for {resource}"
                    )),
                },
                astrid_audit::AuditOutcome::failure("denied: no covering capability"),
            )
        };
        if let Err(e) = self
            .kernel
            .audit_log
            .append_with_principal(
                self.kernel.session_id.clone(),
                principal.clone(),
                audit_action,
                astrid_audit::AuthorizationProof::NotRequired {
                    reason: "playground guest mediation".to_string(),
                },
                outcome,
            )
            .await
        {
            web_console_warn(&format!(
                "astrid: audit append failed for guest mediation: {e}"
            ));
        }

        if !allowed {
            return Err(JsError::new(&format!(
                "denied: {principal} has no {perm_label} capability for {resource}"
            )));
        }
        Ok(())
    }
}

/// A drainable, bounded queue of `(topic, data_json)` events fed by the real
/// bus, backing the synchronous `astrid:ipc/host` `Subscription.recv` import.
///
/// The capsule's synchronous recv loop calls [`drain`](SyncTopicQueue::drain)
/// to pull all queued events (an empty `"[]"` is the "no messages" signal) and
/// [`dropped`](SyncTopicQueue::dropped) to observe lag-drop. Bounded at
/// [`SYNC_QUEUE_CAP`]; on overflow the OLDEST entry is dropped.
#[wasm_bindgen]
pub struct SyncTopicQueue {
    queue: Rc<RefCell<VecDeque<(String, String)>>>,
    dropped: Rc<RefCell<u64>>,
}

#[wasm_bindgen]
impl SyncTopicQueue {
    /// Drain and clear the queue, returning a JSON array
    /// `[{"topic": ..., "data": ...}]` of all queued entries, oldest first.
    ///
    /// `data` is the event payload parsed back to JSON when possible (a bare
    /// string otherwise). An empty queue returns `"[]"` — the "no messages"
    /// signal the capsule's recv loop expects.
    #[wasm_bindgen(js_name = drain)]
    pub fn drain(&self) -> String {
        let mut q = self.queue.borrow_mut();
        let items: Vec<serde_json::Value> = q
            .iter()
            .map(|(topic, data_json)| {
                let data = serde_json::from_str::<serde_json::Value>(data_json)
                    .unwrap_or_else(|_| serde_json::Value::String(data_json.clone()));
                serde_json::json!({ "topic": topic, "data": data })
            })
            .collect();
        q.clear();
        serde_json::to_string(&items).unwrap_or_else(|_| "[]".to_string())
    }

    /// Running count of entries dropped due to the queue being full.
    #[wasm_bindgen(js_name = dropped)]
    #[must_use]
    pub fn dropped(&self) -> u64 {
        *self.dropped.borrow()
    }
}

/// Derive `(topic, data_json)` from a bus event: `Custom` events deliver
/// `(name, data)`; any other event delivers `(serde tag, full event json)` so
/// nothing is dropped silently. Shared by [`AstridWeb::subscribe`] and
/// [`AstridWeb::host_subscribe_queue`] so the extraction lives in one place.
fn extract_topic_data(event: &AstridEvent) -> (String, String) {
    match event {
        AstridEvent::Custom { name, data, .. } => (name.clone(), data.to_string()),
        other => {
            let value = serde_json::to_value(other).unwrap_or_else(|_| serde_json::json!({}));
            let kind = value
                .get("type")
                .and_then(serde_json::Value::as_str)
                .unwrap_or("event")
                .to_string();
            let json = serde_json::to_string(&value).unwrap_or_else(|_| "{}".to_string());
            (kind, json)
        }
    }
}

/// Surface a non-fatal bridge warning on the browser console (fail-secure
/// audit posture: continue + alert, never panic the caller path).
fn web_console_warn(msg: &str) {
    js_sys::global()
        .dyn_into::<js_sys::Object>()
        .ok()
        .and_then(|_| js_sys::Reflect::get(&js_sys::global(), &"console".into()).ok())
        .and_then(|c| js_sys::Reflect::get(&c, &"warn".into()).ok())
        .and_then(|w| w.dyn_into::<js_sys::Function>().ok())
        .map(|f| f.call1(&JsValue::NULL, &JsValue::from_str(msg)));
}

/// Map a permission string onto a real [`Permission`]. Only the three the
/// bridge exposes are accepted; anything else is rejected rather than silently
/// coerced.
fn parse_permission(perm: &str) -> Result<Permission, JsError> {
    match perm {
        "read" => Ok(Permission::Read),
        "write" => Ok(Permission::Write),
        "execute" => Ok(Permission::Execute),
        other => Err(JsError::new(&format!(
            "unsupported permission '{other}' (expected read, write, or execute)"
        ))),
    }
}
