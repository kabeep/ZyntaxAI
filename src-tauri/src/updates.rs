use crate::events;
use crate::fix::FixError;
use serde::Serialize;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter};
use tauri_plugin_updater::UpdaterExt;
use ts_rs::TS;

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct UpdateInfo {
    pub version: String,
    pub current_version: String,

    pub notes: Option<String>,

    pub date: Option<String>,

    pub can_install: bool,
}

#[derive(Debug, Clone, Copy, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct UpdateProgress {
    #[ts(type = "number")]
    pub downloaded: u64,

    #[ts(type = "number | null")]
    pub total: Option<u64>,
}

// Keep the updater implementation and configuration for a future fork-owned channel.
pub const UPDATES_ENABLED: bool = false;

fn ensure_enabled() -> Result<(), FixError> {
    if !UPDATES_ENABLED {
        return Err(FixError {
            code: "updates_disabled".to_owned(),
            message: "Upstream updates are disabled in this fork.".to_owned(),
            remedy: "Install updates from this fork's distribution channel.".to_owned(),
            retryable: false,
        });
    }
    Ok(())
}

static PENDING: Mutex<Option<UpdateInfo>> = Mutex::new(None);

pub fn pending() -> Option<UpdateInfo> {
    if !UPDATES_ENABLED {
        return None;
    }
    PENDING.lock().expect("update state poisoned").clone()
}

pub async fn check(app: &AppHandle) -> Result<Option<UpdateInfo>, FixError> {
    ensure_enabled()?;
    let updater = app.updater().map_err(unavailable)?;

    let update = updater.check().await.map_err(|err| FixError {
        code: "update_check_failed".to_owned(),
        message: err.to_string(),
        remedy: "Check your internet connection, or download the latest version \
                 from zsync.eu/zyntaxai."
            .to_owned(),
        retryable: true,
    })?;

    let info = update.map(|update| UpdateInfo {
        version: update.version.clone(),
        current_version: update.current_version.clone(),
        notes: update.body.clone(),
        date: update.date.map(|date| date.to_string()),
        can_install: can_install_in_place(),
    });

    *PENDING.lock().expect("update state poisoned") = info.clone();

    Ok(info)
}

pub async fn install(app: &AppHandle) -> Result<(), FixError> {
    ensure_enabled()?;
    if !can_install_in_place() {
        return Err(FixError {
            code: "update_not_installable".to_owned(),
            message: "This copy of ZyntaxAI was installed by your package manager.".to_owned(),
            remedy: "Update it the same way you installed it, or download the new \
                     version from zsync.eu/zyntaxai."
                .to_owned(),
            retryable: false,
        });
    }

    let update = app
        .updater()
        .map_err(unavailable)?
        .check()
        .await
        .map_err(|err| FixError {
            code: "update_check_failed".to_owned(),
            message: err.to_string(),
            remedy: "Check your internet connection and try again.".to_owned(),
            retryable: true,
        })?
        .ok_or_else(|| FixError {
            code: "update_gone".to_owned(),
            message: "There is no longer an update to install.".to_owned(),
            remedy: "ZyntaxAI is already up to date.".to_owned(),
            retryable: false,
        })?;

    let version = update.version.clone();
    tracing::info!(version = %version, "downloading update");

    let progress_app = app.clone();
    let mut downloaded: u64 = 0;

    update
        .download_and_install(
            move |chunk, total| {
                downloaded += chunk as u64;

                let _ = progress_app.emit(
                    events::UPDATE_PROGRESS,
                    UpdateProgress { downloaded, total },
                );
            },
            || tracing::info!("update downloaded, applying"),
        )
        .await
        .map_err(install_failed)?;

    tracing::info!(version = %version, "restarting into the new version");
    app.restart();
}

pub fn check_on_startup(app: &AppHandle) {
    if !UPDATES_ENABLED {
        return;
    }
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        match check(&app).await {
            Ok(Some(info)) => {
                tracing::info!(version = %info.version, "update available");
                let _ = app.emit(events::UPDATE_AVAILABLE, info);
            }
            Ok(None) => tracing::debug!("no update available"),
            Err(err) => tracing::warn!(error = %err.message, "update check failed"),
        }
    });
}

fn can_install_in_place() -> bool {
    #[cfg(target_os = "linux")]
    {
        std::env::var_os("APPIMAGE").is_some()
    }
    #[cfg(not(target_os = "linux"))]
    {
        true
    }
}

fn install_failed(err: tauri_plugin_updater::Error) -> FixError {
    let detail = err.to_string();
    tracing::error!(error = %detail, "update install failed");

    let looks_like_a_bad_signature = matches!(
        err,
        tauri_plugin_updater::Error::Minisign(_) | tauri_plugin_updater::Error::Base64(_)
    ) || detail.to_lowercase().contains("signature");

    if looks_like_a_bad_signature {
        return FixError {
            code: "update_signature_invalid".to_owned(),
            message: "The downloaded update was not signed by ZyntaxAI, so it was discarded."
                .to_owned(),
            remedy: "Nothing was installed. Do not install this update by hand — \
                     check zsync.eu/zyntaxai, and treat it as suspicious if the \
                     problem persists."
                .to_owned(),
            retryable: false,
        };
    }

    FixError {
        code: "update_install_failed".to_owned(),
        message: format!("The update could not be installed: {detail}"),
        remedy: "Download the new version from zsync.eu/zyntaxai and install it manually."
            .to_owned(),
        retryable: false,
    }
}

fn unavailable(err: tauri_plugin_updater::Error) -> FixError {
    FixError {
        code: "update_unavailable".to_owned(),
        message: err.to_string(),
        remedy: "Download the latest version from zsync.eu/zyntaxai.".to_owned(),
        retryable: false,
    }
}

#[cfg(test)]
mod policy_tests {
    use super::*;
    #[test]
    fn disabled_updates_reject_operations_and_do_not_expose_pending_updates() {
        let error = ensure_enabled().unwrap_err();
        assert_eq!(error.code, "updates_disabled");
        assert!(!error.retryable);
        assert!(pending().is_none());
    }
}
