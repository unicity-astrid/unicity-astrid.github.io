//! End-to-end bridge test: boots the real kernel through `AstridWeb` and
//! exercises every public method against live kernel surfaces on
//! `wasm32-unknown-unknown` under node.

#![cfg(target_arch = "wasm32")]

use std::cell::RefCell;
use std::rc::Rc;

use kernel_web::AstridWeb;
use wasm_bindgen::prelude::*;
use wasm_bindgen::JsCast;
use wasm_bindgen_futures::JsFuture;
use wasm_bindgen_test::wasm_bindgen_test;

/// Yield to the JS microtask queue so spawned pump tasks can run. Awaiting a
/// resolved promise drains one microtask turn without any timer dependency.
async fn tick() {
    let _ = JsFuture::from(js_sys::Promise::resolve(&JsValue::UNDEFINED)).await;
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

    Ok(())
}
