pub mod install;
pub mod server;

pub use install::{install_hooks, is_installed, uninstall_hooks};
pub use server::start_server;
// `ServerHandle` is intentionally not re-exported — only `start_server`
// returns it, and callers in `lib.rs::setup` consume it inline. Kept
// public on the module so future probes (status diagnostics) can pull
// it without churning the wider re-export surface.
