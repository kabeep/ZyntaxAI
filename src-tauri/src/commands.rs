use crate::state::AppState;
use crate::{events, fix, hotkeys, updates, windows};
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_autostart::ManagerExt;
use ts_rs::TS;
use zyntax_core::{Language, ModelPricing, OutputMode, Persona, ProviderId, ProviderProfile};
use zyntax_platform::{Capabilities, Hotkey};
use zyntax_providers::ModelInfo;
use zyntax_store::{AppSettings, FixRecord, SecretBackend, Stats, UsageSummary};

use crate::fix::FixError;

type CommandResult<T> = Result<T, FixError>;

fn simple_error(code: &str, message: impl Into<String>, remedy: impl Into<String>) -> FixError {
    FixError {
        code: code.to_owned(),
        message: message.into(),
        remedy: remedy.into(),
        retryable: false,
    }
}

#[tauri::command]
pub fn get_settings(state: State<'_, AppState>) -> AppSettings {
    state.settings()
}

#[tauri::command]
pub fn save_settings(
    app: AppHandle,
    state: State<'_, AppState>,
    settings: AppSettings,
) -> CommandResult<AppSettings> {
    for profile in &settings.providers {
        zyntax_providers::request_options::validate(profile.id, &profile.request_overrides)
            .map_err(|error| {
                FixError::from(zyntax_providers::ProviderError::RequestParameters {
                    provider: profile.id,
                    error,
                })
            })?;
    }
    let hotkey_changed = state.settings().hotkey != settings.hotkey;

    let saved = state.save_settings(settings).map_err(|err| {
        simple_error(
            "settings_write",
            err.to_string(),
            "Check that ZyntaxAI's config directory is writable.",
        )
    })?;

    if hotkey_changed {
        hotkeys::register_and_record(&app, &saved.hotkey).map_err(|err| {
            simple_error(
                "hotkey_unavailable",
                err.to_string(),
                "Choose a different combination in the Hotkeys panel.",
            )
        })?;
    }

    state.sync_tray_enabled();

    let _ = app.emit(events::SETTINGS_CHANGED, &saved);
    Ok(saved)
}

#[tauri::command]
pub fn get_personas(state: State<'_, AppState>) -> Vec<Persona> {
    state.settings().all_personas()
}

#[tauri::command]
pub fn validate_request_parameters(
    provider: ProviderId,
    draft: String,
) -> Result<serde_json::Value, zyntax_providers::request_options::RequestParameterError> {
    zyntax_providers::request_options::parse(provider, &draft)
}

#[tauri::command]
pub fn save_request_parameters(
    app: AppHandle,
    state: State<'_, AppState>,
    provider: ProviderId,
    draft: String,
) -> CommandResult<AppSettings> {
    validate_request_parameters(provider, draft.clone()).map_err(|error| {
        FixError::from(zyntax_providers::ProviderError::RequestParameters { provider, error })
    })?;
    let saved = state
        .save_request_parameters(provider, &draft)
        .map_err(|err| {
            simple_error(
                "settings_write",
                err.to_string(),
                "Check that ZyntaxAI's config directory is writable.",
            )
        })?;
    let _ = app.emit(events::SETTINGS_CHANGED, &saved);
    Ok(saved)
}

#[tauri::command]
pub fn get_languages(state: State<'_, AppState>) -> Vec<Language> {
    state.settings().all_languages()
}

#[tauri::command]
pub fn get_capabilities(state: State<'_, AppState>) -> Capabilities {
    state.capabilities.clone()
}

#[tauri::command]
pub fn validate_hotkey(accelerator: String) -> CommandResult<String> {
    Hotkey::parse(&accelerator)
        .map(|hotkey| hotkey.to_string())
        .map_err(|err| {
            simple_error(
                "hotkey_invalid",
                err.to_string(),
                "Include at least one modifier and one key.",
            )
        })
}

#[tauri::command]
pub fn get_hotkey_status(state: State<'_, AppState>) -> crate::hotkeys::HotkeyStatus {
    state
        .hotkey_status
        .lock()
        .expect("hotkey-status lock poisoned")
        .clone()
}

#[tauri::command]
pub async fn list_models(app: AppHandle, provider: ProviderId) -> CommandResult<Vec<ModelInfo>> {
    let (mut profile, api_key) = {
        let state = app.state::<AppState>();
        let settings = state.settings();
        let profile = settings
            .providers
            .iter()
            .find(|p| p.id == provider)
            .cloned()
            .unwrap_or_else(|| ProviderProfile::new(provider));
        let key = state.secrets.get(provider.slug()).ok().flatten();
        (profile, key)
    };

    // Generation overrides do not participate in model discovery.
    profile.request_overrides = serde_json::json!({});
    zyntax_providers::build(&profile, api_key)?
        .list_models()
        .await
        .map_err(FixError::from)
}

#[tauri::command]
pub fn set_api_key(
    state: State<'_, AppState>,
    provider: ProviderId,
    key: String,
) -> CommandResult<()> {
    state
        .secrets
        .set(provider.slug(), key.trim())
        .map_err(|err| {
            simple_error(
                "keychain_write",
                err.to_string(),
                "Check that your system keychain is unlocked.",
            )
        })
}

#[tauri::command]
pub fn has_api_key(state: State<'_, AppState>, provider: ProviderId) -> bool {
    state
        .secrets
        .get(provider.slug())
        .ok()
        .flatten()
        .is_some_and(|key| !key.trim().is_empty())
}

#[tauri::command]
pub fn get_secret_backend(state: State<'_, AppState>) -> SecretBackend {
    state.secrets.backend()
}

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct UsagePeriod {
    pub summary: UsageSummary,

    pub cost: f64,

    pub partial_pricing: bool,
}

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ModelUsage {
    pub provider: String,
    pub model: String,
    pub summary: UsageSummary,
    pub cost: f64,
    pub priced: bool,
}

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct UsageReport {
    pub today: UsagePeriod,
    pub week: UsagePeriod,
    pub month: UsagePeriod,
    pub all_time: UsagePeriod,
    pub by_model: Vec<ModelUsage>,

    #[ts(type = "number | null")]
    pub since: Option<i64>,
}

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct DailyUsage {
    #[ts(type = "number")]
    pub day: i64,
    pub fixes: u32,
    #[ts(type = "number")]
    pub tokens: u64,
}

#[tauri::command]
pub fn get_daily_usage(state: State<'_, AppState>, days: u32) -> CommandResult<Vec<DailyUsage>> {
    let days = days.clamp(1, 365) as i64;
    let offset = i64::from(crate::local_offset().whole_seconds());

    let today_start = start_of_local_day(fix::current_unix_seconds());
    let from = today_start - (days - 1) * SECONDS_PER_DAY;
    let to = today_start + SECONDS_PER_DAY;

    let recorded = state
        .history
        .lock()
        .expect("history lock poisoned")
        .usage_by_day(from, to, offset)
        .map_err(history_error)?;

    Ok((0..days)
        .map(|index| {
            let day = from + index * SECONDS_PER_DAY;
            let found = recorded.iter().find(|(bucket, _)| *bucket == day);
            DailyUsage {
                day,
                fixes: found.map_or(0, |(_, usage)| usage.fixes),
                tokens: found.map_or(0, |(_, usage)| usage.total_tokens()),
            }
        })
        .collect())
}

#[tauri::command]
pub fn get_stats(state: State<'_, AppState>) -> Stats {
    state
        .history
        .lock()
        .expect("history lock poisoned")
        .stats()
        .unwrap_or_default()
}

#[tauri::command]
pub fn get_usage(state: State<'_, AppState>) -> CommandResult<UsageReport> {
    let settings = state.settings();
    let history = state.history.lock().expect("history lock poisoned");

    let now = fix::current_unix_seconds();
    let day_start = start_of_local_day(now);

    let period = |from: i64| -> CommandResult<UsagePeriod> {
        let summary = history
            .usage_between(from, i64::MAX)
            .map_err(history_error)?;
        let by_model = history
            .usage_by_model_between(from, i64::MAX)
            .map_err(history_error)?;

        let mut cost = 0.0;
        let mut partial = false;
        for (provider, model, usage) in &by_model {
            let pricing = pricing_for(&settings, provider, model);
            if pricing == ModelPricing::default() {
                partial = true;
            }
            cost += usage.cost(pricing);
        }

        Ok(UsagePeriod {
            summary,
            cost,
            partial_pricing: partial,
        })
    };

    let by_model = history
        .usage_by_model()
        .map_err(history_error)?
        .into_iter()
        .map(|(provider, model, summary)| {
            let pricing = pricing_for(&settings, &provider, &model);
            ModelUsage {
                cost: summary.cost(pricing),
                priced: pricing != ModelPricing::default(),
                provider,
                model,
                summary,
            }
        })
        .collect();

    Ok(UsageReport {
        today: period(day_start)?,
        week: period(day_start - 6 * SECONDS_PER_DAY)?,
        month: period(day_start - 29 * SECONDS_PER_DAY)?,
        all_time: period(i64::MIN)?,
        by_model,
        since: history.first_record_at().map_err(history_error)?,
    })
}

#[tauri::command]
pub fn get_recent(state: State<'_, AppState>, limit: u32) -> CommandResult<Vec<FixRecord>> {
    state
        .history
        .lock()
        .expect("history lock poisoned")
        .recent(limit.clamp(1, 500))
        .map_err(history_error)
}

#[tauri::command]
pub fn clear_history(state: State<'_, AppState>) -> CommandResult<()> {
    state
        .history
        .lock()
        .expect("history lock poisoned")
        .clear()
        .map_err(history_error)
}

const SECONDS_PER_DAY: i64 = 86_400;

fn history_error(err: zyntax_store::HistoryError) -> FixError {
    simple_error(
        "history_unavailable",
        err.to_string(),
        "ZyntaxAI could not read its history database.",
    )
}

fn pricing_for(settings: &AppSettings, provider: &str, model: &str) -> ModelPricing {
    ProviderId::ALL
        .iter()
        .find(|id| id.slug() == provider)
        .map(|id| settings.pricing_for(*id, model))
        .unwrap_or_default()
}

fn start_of_local_day(now: i64) -> i64 {
    let Ok(instant) = time::OffsetDateTime::from_unix_timestamp(now) else {
        return now - now.rem_euclid(SECONDS_PER_DAY);
    };

    instant
        .to_offset(crate::local_offset())
        .replace_time(time::Time::MIDNIGHT)
        .unix_timestamp()
}

#[tauri::command]
pub fn get_logs(limit: u32) -> Vec<crate::logging::LogLine> {
    crate::logging::recent(limit.clamp(1, 2_000) as usize)
}

#[tauri::command]
pub fn clear_logs() {
    crate::logging::clear();
}

#[tauri::command]
pub fn set_autostart(app: AppHandle, enabled: bool) -> CommandResult<()> {
    let manager = app.autolaunch();
    let result = if enabled {
        manager.enable()
    } else {
        manager.disable()
    };

    result.map_err(|err| {
        simple_error(
            "autostart_failed",
            err.to_string(),
            "ZyntaxAI could not change its start-up entry. On Linux this needs a writable \
             ~/.config/autostart directory.",
        )
    })
}

#[tauri::command]
pub fn is_autostart_enabled(app: AppHandle) -> bool {
    app.autolaunch().is_enabled().unwrap_or(false)
}

#[tauri::command]
pub fn app_version() -> String {
    env!("CARGO_PKG_VERSION").to_owned()
}

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct AppPaths {
    pub config: String,
    pub data: String,
    pub logs: String,
}

#[tauri::command]
pub fn get_paths(state: State<'_, AppState>) -> AppPaths {
    AppPaths {
        config: state.paths.config_dir().display().to_string(),
        data: state.paths.data_dir().display().to_string(),
        logs: state.paths.logs_dir().display().to_string(),
    }
}

#[tauri::command]
pub async fn check_for_update(app: AppHandle) -> CommandResult<Option<updates::UpdateInfo>> {
    updates::check(&app).await
}

#[tauri::command]
pub fn pending_update() -> Option<updates::UpdateInfo> {
    updates::pending()
}

#[tauri::command]
pub async fn install_update(app: AppHandle) -> CommandResult<()> {
    updates::install(&app).await
}

#[tauri::command]
pub fn run_fix(app: AppHandle) {
    fix::trigger_from_selection(app);
}

#[tauri::command]
pub fn cancel_fix(app: AppHandle) {
    fix::cancel(&app);
}

#[tauri::command]
pub async fn apply_fix(
    app: AppHandle,
    corrected: String,
    original: String,
    mode: OutputMode,
) -> CommandResult<()> {
    fix::apply_reviewed(&app, corrected, original, mode).await
}

#[tauri::command]
pub fn dismiss_overlay(app: AppHandle) {
    windows::hide_overlay(&app);
}

#[tauri::command]
pub fn show_settings_window(app: AppHandle) {
    windows::show_settings(&app);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_local_day_starts_at_a_day_boundary() {
        let now = 1_700_000_000;
        let start = start_of_local_day(now);

        assert!(start <= now, "midnight cannot be in the future");
        assert!(now - start < SECONDS_PER_DAY, "and must be within a day");

        assert_eq!(start % 60, 0);
    }

    #[test]
    fn the_day_boundary_is_stable_within_a_day() {
        let morning = 1_700_000_000;
        let later = morning + 3_600;

        if start_of_local_day(morning) + SECONDS_PER_DAY > later {
            assert_eq!(start_of_local_day(morning), start_of_local_day(later));
        }
    }

    #[test]
    fn unpriced_models_report_zero_rather_than_a_guess() {
        let settings = AppSettings::default();
        let pricing = pricing_for(&settings, "gemini", "gemini-2.5-flash");
        assert_eq!(pricing, ModelPricing::default());
    }

    #[test]
    fn an_unknown_provider_slug_does_not_panic() {
        let settings = AppSettings::default();
        assert_eq!(
            pricing_for(&settings, "not-a-provider", "whatever"),
            ModelPricing::default()
        );
    }

    #[test]
    fn configured_pricing_is_found_by_slug() {
        let mut settings = AppSettings::default();
        settings.pricing.insert(
            zyntax_store::settings::pricing_key(ProviderId::Gemini, "gemini-2.5-flash"),
            ModelPricing {
                input_per_million: 0.3,
                output_per_million: 2.5,
            },
        );

        let pricing = pricing_for(&settings, "gemini", "gemini-2.5-flash");
        assert_eq!(pricing.output_per_million, 2.5);
    }
}
