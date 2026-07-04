//! The smoke-boot test: real kernel, wasm32-unknown-unknown, node runtime.

#![cfg(target_arch = "wasm32")]

use astrid_events::{AstridEvent, EventMetadata};
use wasm_bindgen_test::wasm_bindgen_test;

#[wasm_bindgen_test]
async fn kernel_boots_and_bus_is_live() {
    let kernel = kernel_smoke::boot_in_memory().await.expect("kernel boot");

    // Liveness beyond construction: the injected KV round-trips through the
    // kernel's own handle...
    kernel
        .kv
        .set("smoke", "key", b"value".to_vec())
        .await
        .expect("kv set");
    let got = kernel.kv.get("smoke", "key").await.expect("kv get");
    assert_eq!(got.as_deref(), Some(b"value".as_slice()));

    // ...and the event bus delivers a published event to a subscriber. The
    // bus may also carry kernel-internal events, so scan for ours.
    let mut sub = kernel.event_bus.subscribe();
    let delivered = kernel.event_bus.publish(AstridEvent::Custom {
        metadata: EventMetadata::new("kernel-smoke"),
        name: "smoke.ping".to_string(),
        data: serde_json::json!({"ok": true}),
    });
    assert!(delivered >= 1, "no subscribers saw the publish");

    for _ in 0..16 {
        let event = sub.recv().await.expect("bus closed before delivery");
        if let AstridEvent::Custom { name, data, .. } = &*event {
            assert_eq!(name, "smoke.ping");
            assert_eq!(data["ok"], true);
            return;
        }
    }
    panic!("smoke.ping never arrived");
}
