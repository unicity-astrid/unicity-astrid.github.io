//! End-to-end bridge test: boots the real kernel through `AstridWeb` and
//! exercises every public method against live kernel surfaces on
//! `wasm32-unknown-unknown` under node.

#![cfg(target_arch = "wasm32")]

use std::cell::RefCell;
use std::rc::Rc;

use kernel_web::{AstridWeb, SyncTopicQueue};
use wasm_bindgen::prelude::*;
use wasm_bindgen::JsCast;
use wasm_bindgen_futures::JsFuture;
use wasm_bindgen_test::wasm_bindgen_test;

/// Yield to the JS microtask queue so spawned pump tasks can run. Awaiting a
/// resolved promise drains one microtask turn without any timer dependency.
async fn tick() {
    let _ = JsFuture::from(js_sys::Promise::resolve(&JsValue::UNDEFINED)).await;
}

/// Tick the microtask queue `tries` times so the queue's spawn_local pump can
/// deliver all buffered events, then drain once and return the parsed JSON
/// array. `drain` is destructive, so we tick generously up front rather than
/// poll-then-drain in a loop. All events are already buffered in the broadcast
/// channel before the first tick, so the pump drains them well within `tries`.
async fn drain_after_ticks(queue: &SyncTopicQueue, tries: usize) -> serde_json::Value {
    for _ in 0..tries {
        tick().await;
    }
    let json = queue.drain();
    serde_json::from_str(&json).expect("drain must yield a JSON array")
}

#[wasm_bindgen_test]
async fn bridge_drives_the_real_kernel() -> Result<(), JsValue> {
    let web = AstridWeb::boot().await?;

    // Provenance string is present (a real short SHA, or "unknown").
    assert!(!web.kernel_commit().is_empty(), "kernel_commit empty");

    // --- KV round-trip through the bridge ---
    web.kv_set("web".into(), "greeting".into(), "hello".into())
        .await?;
    let got = web.kv_get("web".into(), "greeting".into()).await?;
    assert_eq!(got.as_deref(), Some("hello"), "kv round-trip mismatch");
    let missing = web.kv_get("web".into(), "absent".into()).await?;
    assert_eq!(missing, None, "absent key should be None");

    // --- subscribe + publish: a real bus delivery reaches the JS callback ---
    let seen: Rc<RefCell<Vec<(String, String)>>> = Rc::new(RefCell::new(Vec::new()));
    let sink = Rc::clone(&seen);
    let closure = Closure::<dyn FnMut(String, String)>::new(move |topic: String, data: String| {
        sink.borrow_mut().push((topic, data));
    });
    let func: js_sys::Function = closure.as_ref().unchecked_ref::<js_sys::Function>().clone();
    web.subscribe("smoke.*".into(), func)?;

    web.publish("smoke.ping".into(), r#"{"ok":true}"#.into())
        .await?;

    // Let the spawn_local pump drain and invoke the callback.
    let mut delivered = false;
    for _ in 0..200 {
        if !seen.borrow().is_empty() {
            delivered = true;
            break;
        }
        tick().await;
    }
    assert!(delivered, "callback never observed the published event");
    {
        let events = seen.borrow();
        let (topic, data) = &events[0];
        assert_eq!(topic, "smoke.ping", "unexpected topic");
        assert!(data.contains("\"ok\":true"), "unexpected payload: {data}");
    }
    // Keep the JS closure alive for the whole test: the pump holds its function.
    drop(closure);

    // --- events_routed counts real routed events ---
    assert!(web.events_routed() > 0, "events_routed did not advance");

    // --- grant then check: real CapabilityStore issuance + verification ---
    let token_id = web
        .grant("alice".into(), "notes://alice".into(), "read".into())
        .await?;
    assert!(!token_id.is_empty(), "grant returned empty token id");

    let allowed = web
        .check("alice".into(), "notes://alice".into(), "read".into())
        .await?;
    assert!(allowed, "check should allow the exact granted triple");

    let denied_resource = web
        .check("alice".into(), "notes://bob".into(), "read".into())
        .await?;
    assert!(!denied_resource, "check should deny a different resource");

    let denied_perm = web
        .check("alice".into(), "notes://alice".into(), "write".into())
        .await?;
    assert!(!denied_perm, "check should deny a different permission");

    // Unsupported permission is rejected, not silently coerced.
    assert!(
        web.grant("alice".into(), "notes://alice".into(), "bogus".into())
            .await
            .is_err(),
        "unsupported permission must error"
    );

    // --- audit chain: runtime regression for the astrid-audit wasm fix ---
    // The grant + three checks above must have landed real signed entries
    // (1 CapabilityCreated + 1 ApprovalGranted + 2 ApprovalDenied). On the old
    // sync-over-async storage this whole surface panicked on wasm.
    let audit_len = web.audit_len().await?;
    assert!(
        audit_len >= 4,
        "expected at least 4 audit entries, got {audit_len}"
    );

    let tail_json = web.audit_tail(8).await?;
    let tail: serde_json::Value =
        serde_json::from_str(&tail_json).map_err(|e| JsValue::from_str(&e.to_string()))?;
    let entries = tail.as_array().expect("audit tail must be a JSON array");
    assert!(entries.len() >= 4, "tail too short: {tail_json}");
    for entry in entries {
        let hash = entry["hash"].as_str().expect("entry.hash");
        assert_eq!(hash.len(), 64, "BLAKE3 hex hash expected: {hash}");
        assert!(entry["action"].as_str().is_some(), "entry.action missing");
    }
    let actions: Vec<&str> = entries
        .iter()
        .filter_map(|e| e["action"].as_str())
        .collect();
    assert!(
        actions.contains(&"capability_created"),
        "grant must land capability_created: {actions:?}"
    );
    assert!(
        actions.contains(&"approval_denied"),
        "denied checks must land approval_denied: {actions:?}"
    );

    Ok(())
}

#[wasm_bindgen_test]
async fn guest_mediation_enforces_and_audits() -> Result<(), JsValue> {
    let web = AstridWeb::boot().await?;

    // --- ungranted guest KV write is DENIED, and the denial lands on chain ---
    let before = web.audit_len().await?;
    let denied = web
        .guest_kv_set(
            "guest-notes".into(),
            "guest.notes".into(),
            "draft".into(),
            "hello".into(),
        )
        .await;
    assert!(denied.is_err(), "ungranted guest write must be denied");
    let after = web.audit_len().await?;
    assert!(
        after > before,
        "denial must grow the audit chain: {before} -> {after}"
    );

    // --- grant Write (for set) AND Read (for get) on kv:guest.notes, then the
    // mediated round-trip works. Enforcement is per-permission: a Write grant
    // alone does NOT satisfy the Read that `guest_kv_get` requires. ---
    web.grant(
        "guest-notes".into(),
        "kv:guest.notes".into(),
        "write".into(),
    )
    .await?;
    web.grant("guest-notes".into(), "kv:guest.notes".into(), "read".into())
        .await?;
    web.guest_kv_set(
        "guest-notes".into(),
        "guest.notes".into(),
        "draft".into(),
        "hello".into(),
    )
    .await?;
    let got = web
        .guest_kv_get("guest-notes".into(), "guest.notes".into(), "draft".into())
        .await?;
    assert_eq!(got.as_deref(), Some("hello"), "guest KV round-trip mismatch");

    // --- guest publish is DENIED without a topic capability ---
    let pub_denied = web
        .guest_publish(
            "guest-notes".into(),
            "site.v1.guest.out".into(),
            r#"{"note":"hi"}"#.into(),
        )
        .await;
    assert!(pub_denied.is_err(), "ungranted guest publish must be denied");

    // --- grant Write on topic:site.v1.guest.out, subscribe, publish, drain ---
    let queue = web.host_subscribe_queue("site.v1.guest.*".into());
    web.grant(
        "guest-notes".into(),
        "topic:site.v1.guest.out".into(),
        "write".into(),
    )
    .await?;
    web.guest_publish(
        "guest-notes".into(),
        "site.v1.guest.out".into(),
        r#"{"note":"hi"}"#.into(),
    )
    .await?;

    let entries = drain_after_ticks(&queue, 200).await;
    let arr = entries.as_array().expect("drain must be a JSON array");
    assert_eq!(arr.len(), 1, "queue should hold exactly the guest event");
    assert_eq!(
        arr[0]["topic"].as_str(),
        Some("site.v1.guest.out"),
        "unexpected drained topic"
    );
    assert_eq!(
        arr[0]["data"]["note"].as_str(),
        Some("hi"),
        "unexpected drained payload: {entries}"
    );

    Ok(())
}

#[wasm_bindgen_test]
async fn sync_host_shims_round_trip_and_bound() -> Result<(), JsValue> {
    let web = AstridWeb::boot().await?;

    // --- synchronous KV round-trip via now_or_never (MemoryKvStore) ---
    web.host_kv_set_sync("sys".into(), "cfg".into(), "on".into())?;
    let got = web.host_kv_get_sync("sys".into(), "cfg".into())?;
    assert_eq!(got.as_deref(), Some("on"), "sync KV round-trip mismatch");
    let absent = web.host_kv_get_sync("sys".into(), "missing".into())?;
    assert_eq!(absent, None, "absent sync key should be None");

    // --- sync publish lands in a queue created before the publish ---
    let queue = web.host_subscribe_queue("host.demo.*".into());
    web.host_publish(
        "prompt-builder".into(),
        "host.demo.ready".into(),
        r#"{"phase":1}"#.into(),
    )?;
    let entries = drain_after_ticks(&queue, 200).await;
    let arr = entries.as_array().expect("drain must be a JSON array");
    assert_eq!(arr.len(), 1, "sync publish should reach the queue");
    assert_eq!(arr[0]["topic"].as_str(), Some("host.demo.ready"));
    assert_eq!(arr[0]["data"]["phase"].as_i64(), Some(1));

    // --- queue bounding: 300 in, 256 retained, 44 dropped (oldest first) ---
    let bounded = web.host_subscribe_queue("host.flood.*".into());
    for i in 0..300 {
        web.host_publish(
            "prompt-builder".into(),
            "host.flood.tick".into(),
            format!(r#"{{"i":{i}}}"#),
        )?;
    }
    let flood = drain_after_ticks(&bounded, 300).await;
    let flood_arr = flood.as_array().expect("drain must be a JSON array");
    assert_eq!(flood_arr.len(), 256, "queue must cap at 256 entries");
    assert_eq!(bounded.dropped(), 44, "44 oldest entries must be dropped");
    // Oldest survivor is index 44 (0..43 were dropped).
    assert_eq!(
        flood_arr[0]["data"]["i"].as_i64(),
        Some(44),
        "oldest retained entry should be i=44"
    );

    Ok(())
}

#[wasm_bindgen_test]
async fn revoke_removes_the_capability() -> Result<(), JsValue> {
    let web = AstridWeb::boot().await?;

    let token_id = web
        .grant("carol".into(), "notes://carol".into(), "write".into())
        .await?;
    assert!(
        web.check("carol".into(), "notes://carol".into(), "write".into())
            .await?,
        "check should allow the freshly granted triple"
    );

    web.revoke(token_id).await?;

    assert!(
        !web.check("carol".into(), "notes://carol".into(), "write".into())
            .await?,
        "check must deny after revocation"
    );

    Ok(())
}
