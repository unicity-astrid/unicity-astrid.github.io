//! Smoke-boot harness: boots the real `astrid-kernel` on
//! `wasm32-unknown-unknown` under a JS event loop.
//!
//! The portability CI guard in core is compile-only; the seam work caught
//! three compiles-but-fails-at-runtime bugs (std `Instant`, `std::fs`
//! `Unsupported` errors) that only an actual wasm boot can surface. This
//! crate is that boot.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;

use astrid_core::SessionId;
use astrid_core::dirs::AstridHome;
use astrid_core::session_token::SessionToken;
use astrid_kernel::{Kernel, KernelResources};

/// Boot a kernel with in-memory resources and return it.
///
/// # Errors
///
/// Propagates any boot failure from `Kernel::with_resources`.
pub async fn boot_in_memory() -> Result<Arc<Kernel>, std::io::Error> {
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

    Kernel::with_resources(
        SessionId::new(),
        PathBuf::from("/workspace"),
        astrid_capsule_types::CapsuleRuntimeLimits::default(),
        HashMap::new(),
        astrid_capsule_types::HttpLimits::default(),
        resources,
    )
    .await
}
