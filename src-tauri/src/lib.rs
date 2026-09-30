mod commands;
mod events;
mod feedback;
mod fix;
mod hotkeys;
mod logging;
mod state;
mod tray;
mod updates;
mod windows;

use state::AppState;
use std::sync::OnceLock;
use tauri::{Manager, WindowEvent};
use tauri_plugin_autostart::MacosLauncher;
use tauri_plugin_window_state::StateFlags;
use time::UtcOffset;

const ARG_MINIMIZED: &str = "--minimized";

const ARG_FIX: &str = "fix";

static LOCAL_OFFSET: OnceLock<UtcOffset> = OnceLock::new();

pub fn local_offset() -> UtcOffset {
    *LOCAL_OFFSET.get().unwrap_or(&UtcOffset::UTC)
}

pub fn run() {
    let _ = LOCAL_OFFSET.set(UtcOffset::current_local_offset().unwrap_or(UtcOffset::UTC));

    let args: Vec<String> = std::env::args().collect();
    let start_hidden = args.iter().any(|arg| arg == ARG_MINIMIZED);

    logging::init();
    tracing::info!(version = zyntax_core::VERSION, "starting ZyntaxAI");

    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            if argv.iter().any(|arg| arg == ARG_FIX) {
                fix::trigger_from_selection(app.clone());
            } else {
                windows::show_settings(app);
            }
        }))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(
            tauri_plugin_window_state::Builder::default()
                .with_state_flags(StateFlags::SIZE | StateFlags::POSITION | StateFlags::MAXIMIZED)
                .with_denylist(&[events::OVERLAY_WINDOW])
                .build(),
        )
        .plugin(tauri_plugin_autostart::init(
            MacosLauncher::LaunchAgent,
            Some(vec![ARG_MINIMIZED]),
        ))
        .invoke_handler(tauri::generate_handler![
            commands::get_settings,
            commands::save_settings,
            commands::validate_request_parameters,
            commands::save_request_parameters,
            commands::get_personas,
            commands::get_languages,
            commands::get_capabilities,
            commands::validate_hotkey,
            commands::get_hotkey_status,
            commands::list_models,
            commands::set_api_key,
            commands::has_api_key,
            commands::get_secret_backend,
            commands::get_stats,
            commands::get_usage,
            commands::get_daily_usage,
            commands::get_recent,
            commands::clear_history,
            commands::get_logs,
            commands::clear_logs,
            commands::set_autostart,
            commands::is_autostart_enabled,
            commands::app_version,
            commands::get_paths,
            commands::run_fix,
            commands::cancel_fix,
            commands::apply_fix,
            commands::dismiss_overlay,
            commands::show_settings_window,
            commands::check_for_update,
            commands::pending_update,
            commands::install_update,
        ])
        .setup(move |app| {
            match AppState::load() {
                Ok(state) => {
                    app.manage(state);
                }
                Err(err) => {
                    tracing::error!(%err, "could not load application state");
                    eprintln!("ZyntaxAI could not start: {err}");
                    std::process::exit(1);
                }
            }

            tray::install(app)?;

            let handle = app.handle().clone();
            let accelerator = handle.state::<AppState>().settings().hotkey;
            if let Err(err) = hotkeys::register_and_record(&handle, &accelerator) {
                tracing::error!(%err, %accelerator, "could not register the global hotkey");
            }

            if updates::UPDATES_ENABLED
                && handle
                    .state::<AppState>()
                    .settings()
                    .system
                    .check_for_updates
            {
                updates::check_on_startup(&handle);
            }

            if start_hidden {
                windows::hide_settings(&handle);
            } else {
                windows::show_settings(&handle);
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                if window.label() != events::MAIN_WINDOW {
                    return;
                }

                let app = window.app_handle();
                if app.state::<AppState>().settings().behavior.minimize_to_tray {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .build(tauri::generate_context!())
        .expect("failed to start ZyntaxAI")
        .run(|app, event| {
            if let tauri::RunEvent::ExitRequested { .. } = event {
                hotkeys::unregister_all(app);
            }
        });
}
