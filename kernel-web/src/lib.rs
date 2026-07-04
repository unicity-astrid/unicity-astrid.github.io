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
//!
//! The audit surface (`audit_len`/`audit_tail`) is deliberately absent: the
//! real `AuditLog` storage panics on `wasm32-unknown-unknown` (see the note on
//! the impl block).
//!
//! [`KvStore`]: astrid_storage::KvStore
//! [`EventBus`]: astrid_events::EventBus
//! [`CapabilityStore`]: astrid_capabilities::CapabilityStore

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;

use astrid_capabilities::{AuditEntryId, CapabilityToken, ResourcePattern, TokenScope};
use astrid_core::dirs::AstridHome;
use astrid_core::session_token::SessionToken;
use astrid_core::{Permission, PrincipalId, SessionId};
use astrid_events::{AstridEvent, EventMetadata, TopicMatcher};
use astrid_kernel::{Kernel, KernelResources};
use wasm_bindgen::prelude::*;

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
        // keeps running on the microtask queue), so ignoring it is correct.
        let _ = astrid_runtime::spawn(async move {
            while let Some(_event) = all.recv().await {
                counter.fetch_add(1, Ordering::Relaxed);
            }
        });

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
                let (topic, data_json) = match &*event {
                    AstridEvent::Custom { name, data, .. } => (name.clone(), data.to_string()),
                    other => {
                        let value = serde_json::to_value(other)
                            .unwrap_or_else(|_| serde_json::json!({}));
                        let kind = value
                            .get("type")
                            .and_then(serde_json::Value::as_str)
                            .unwrap_or("event")
                            .to_string();
                        let json = serde_json::to_string(&value)
                            .unwrap_or_else(|_| "{}".to_string());
                        (kind, json)
                    }
                };

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
