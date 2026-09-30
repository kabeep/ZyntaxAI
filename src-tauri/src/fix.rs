use crate::events;
use crate::state::AppState;
use crate::windows;
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};
use ts_rs::TS;
use zyntax_core::{FixOutcome, InputSource, OutputMode, PromptSpec};
use zyntax_platform::{PlatformError, TextIo};
use zyntax_providers::{CompletionRequest, ProviderError};
use zyntax_store::NewFix;

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct FixError {
    pub code: String,
    pub message: String,
    pub remedy: String,
    pub retryable: bool,
}

impl From<ProviderError> for FixError {
    fn from(error: ProviderError) -> Self {
        Self {
            code: error.code().to_owned(),
            message: error.to_string(),
            remedy: error.remedy(),
            retryable: error.is_retryable(),
        }
    }
}

impl From<PlatformError> for FixError {
    fn from(error: PlatformError) -> Self {
        let (code, remedy) = match &error {
            PlatformError::NothingToCorrect => (
                "nothing_to_correct",
                "Select some text, or copy it first and set the input source to Clipboard."
                    .to_owned(),
            ),
            PlatformError::InjectionUnavailable => (
                "injection_unavailable",
                "The correction is on your clipboard — paste it with Ctrl+V. See the System \
                 panel for how to enable automatic replacement."
                    .to_owned(),
            ),
            PlatformError::Injection(_) => (
                "injection_failed",
                "Try again, or switch the output mode to Copy to clipboard.".to_owned(),
            ),
            PlatformError::Clipboard(_) => (
                "clipboard_unavailable",
                "ZyntaxAI could not reach the system clipboard.".to_owned(),
            ),
        };
        Self {
            code: code.to_owned(),
            message: error.to_string(),
            remedy,
            retryable: false,
        }
    }
}

impl From<zyntax_core::PromptError> for FixError {
    fn from(error: zyntax_core::PromptError) -> Self {
        let (code, remedy) = match &error {
            zyntax_core::PromptError::InvalidPersona { .. } => (
                "invalid_persona",
                "Edit the active persona in Settings and save valid instructions.".to_owned(),
            ),
            zyntax_core::PromptError::EmptyInput => (
                "nothing_to_correct",
                "Select some text before pressing the hotkey.".to_owned(),
            ),
            zyntax_core::PromptError::InputTooLong { .. } => {
                ("input_too_long", "Correct a smaller selection.".to_owned())
            }
            zyntax_core::PromptError::TranslateRequiresTarget => (
                "translate_needs_target",
                "Choose a target language in the Languages panel, or turn translation off."
                    .to_owned(),
            ),
        };
        Self {
            code: code.to_owned(),
            message: error.to_string(),
            remedy,
            retryable: false,
        }
    }
}

pub fn trigger_from_selection(app: AppHandle) {
    let source = app.state::<AppState>().settings().behavior.input_source;
    spawn(app, source);
}

pub fn trigger_from_clipboard(app: AppHandle) {
    spawn(app, InputSource::Clipboard);
}

fn spawn(app: AppHandle, source: InputSource) {
    tauri::async_runtime::spawn(async move {
        if let Err(error) = run(&app, source).await {
            tracing::warn!(code = %error.code, message = %error.message, "correction failed");
            let _ = app.emit(events::FIX_FAILED, &error);
            crate::feedback::notify_failure(&app, &error);
        }
    });
}

async fn run(app: &AppHandle, source: InputSource) -> Result<(), FixError> {
    let state = app.state::<AppState>();
    let settings = state.settings();

    if !settings.enabled {
        tracing::debug!("hotkey pressed while ZyntaxAI is switched off");
        return Err(FixError {
            code: "disabled".to_owned(),
            message: "ZyntaxAI is switched off".to_owned(),
            remedy: "Turn it back on from the tray menu, or with the switch in the app.".to_owned(),
            retryable: false,
        });
    }

    let token = state.begin_request();

    let _ = app.emit(events::FIX_STARTED, ());

    let original = capture(app, source).await?;

    if settings.behavior.output_mode == OutputMode::Review {
        windows::show_overlay_at_cursor(app);
    }

    let persona = settings.active_persona();
    let prompt = PromptSpec {
        persona: &persona,
        language: &settings.active_language(),
        translate: settings.translate,
        speed: settings.speed,
    }
    .build(&original)?;

    let profile = settings.active_provider_profile();
    let api_key = state
        .secrets
        .get(profile.id.slug())
        .inspect_err(|err| tracing::warn!(%err, "could not read the stored API key"))
        .ok()
        .flatten();

    let provider = zyntax_providers::build(&profile, api_key)?;

    let started = std::time::Instant::now();
    let completion = provider
        .complete(
            &CompletionRequest {
                model: profile.model.clone(),
                prompt,
            },
            &token,
        )
        .await;

    if token.is_cancelled() {
        tracing::debug!("discarding the result of a superseded correction");
        return Ok(());
    }
    state.finish_request(&token);

    let completion = completion?;
    let corrected = zyntax_core::postprocess::process_model_output(
        &completion.text,
        &original,
        persona.custom_instructions,
    );

    let outcome = FixOutcome::new(
        original,
        corrected,
        completion.usage,
        profile.id.slug().to_owned(),
        profile.model.clone(),
        started.elapsed().as_millis().min(u128::from(u64::MAX)) as u64,
    );

    tracing::info!(
        provider = %outcome.provider,
        model = %outcome.model,
        changed = outcome.changed,
        chars = outcome.original.chars().count(),
        tokens = outcome.usage.total(),
        elapsed_ms = outcome.elapsed_ms,
        persona = %settings.persona_id,
        "correction completed"
    );

    record(&state, &settings, &outcome);
    deliver(app, &settings, &outcome).await?;

    let _ = app.emit(events::FIX_COMPLETED, &outcome);
    Ok(())
}

fn no_display() -> FixError {
    FixError {
        code: "no_display".to_owned(),
        message: "no graphical session is available".to_owned(),
        remedy: "ZyntaxAI needs a desktop session to read selected text.".to_owned(),
        retryable: false,
    }
}

fn join_failed(err: impl std::fmt::Display) -> FixError {
    tracing::error!(%err, "a blocking desktop operation failed");
    FixError {
        code: "desktop_operation_failed".to_owned(),
        message: "a desktop operation did not complete".to_owned(),
        remedy: "Try again. If it repeats, check the Logs panel.".to_owned(),
        retryable: true,
    }
}

async fn capture(app: &AppHandle, source: InputSource) -> Result<String, FixError> {
    let app = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        let mut guard = state.text_io.lock().expect("text-io lock poisoned");
        let io = guard.as_mut().ok_or_else(no_display)?;
        io.capture(source).map_err(FixError::from)
    })
    .await
    .map_err(join_failed)?
}

async fn deliver(
    app: &AppHandle,
    settings: &zyntax_store::AppSettings,
    outcome: &FixOutcome,
) -> Result<(), FixError> {
    let mode = settings.behavior.output_mode;

    if mode == OutputMode::Review {
        return Ok(());
    }

    let handle = app.clone();
    let corrected = outcome.corrected.clone();
    let original = outcome.original.clone();

    let also_copy = settings.behavior.auto_copy_fixed && mode != OutputMode::Clipboard;

    tauri::async_runtime::spawn_blocking(move || {
        let state = handle.state::<AppState>();
        let mut guard = state.text_io.lock().expect("text-io lock poisoned");
        let Some(io) = guard.as_mut() else {
            return Ok(());
        };

        io.deliver(&corrected, &original, mode)?;
        if also_copy {
            let _ = io.copy(&corrected);
        }
        Ok::<(), FixError>(())
    })
    .await
    .map_err(join_failed)??;

    crate::feedback::notify_success(app, settings, outcome);
    Ok(())
}

fn record(
    state: &tauri::State<'_, AppState>,
    settings: &zyntax_store::AppSettings,
    outcome: &FixOutcome,
) {
    if !settings.behavior.keep_history {
        return;
    }

    let fix = NewFix {
        timestamp: current_unix_seconds(),
        provider: outcome.provider.clone(),
        model: outcome.model.clone(),
        persona_id: settings.persona_id.clone(),
        language_tag: settings.language_tag.clone(),
        translate: settings.translate,
        usage: outcome.usage,
        original_chars: outcome.original.chars().count() as u32,
        corrected_chars: outcome.corrected.chars().count() as u32,
        changed: outcome.changed,
        elapsed_ms: outcome.elapsed_ms.min(u64::from(u32::MAX)) as u32,
    };

    if let Err(err) = state
        .history
        .lock()
        .expect("history lock poisoned")
        .record(&fix)
    {
        tracing::warn!(%err, "could not record the correction in history");
    }
}

pub fn current_unix_seconds() -> i64 {
    time::OffsetDateTime::now_utc().unix_timestamp()
}

const FOCUS_HANDBACK: std::time::Duration = std::time::Duration::from_millis(80);

pub async fn apply_reviewed(
    app: &AppHandle,
    corrected: String,
    original: String,
    mode: OutputMode,
) -> Result<(), FixError> {
    let settings = app.state::<AppState>().settings();

    windows::hide_overlay(app);
    tokio::time::sleep(FOCUS_HANDBACK).await;

    let handle = app.clone();
    let also_copy = settings.behavior.auto_copy_fixed && mode != OutputMode::Clipboard;

    tauri::async_runtime::spawn_blocking(move || {
        let state = handle.state::<AppState>();
        let mut guard = state.text_io.lock().expect("text-io lock poisoned");
        let io = guard.as_mut().ok_or_else(|| FixError {
            remedy: "ZyntaxAI needs a desktop session to apply corrections.".to_owned(),
            ..no_display()
        })?;

        io.deliver(&corrected, &original, mode)?;
        if also_copy {
            let _ = io.copy(&corrected);
        }
        Ok::<(), FixError>(())
    })
    .await
    .map_err(join_failed)?
}

pub fn cancel(app: &AppHandle) {
    app.state::<AppState>().cancel_in_flight();
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn provider_failures_carry_a_code_and_a_remedy() {
        let error = FixError::from(ProviderError::Timeout);
        assert_eq!(error.code, "timeout");
        assert!(error.retryable);
        assert!(!error.remedy.is_empty());
    }

    #[test]
    fn nothing_selected_explains_what_to_do() {
        let error = FixError::from(PlatformError::NothingToCorrect);
        assert_eq!(error.code, "nothing_to_correct");
        assert!(error.remedy.contains("Select"));
    }

    #[test]
    fn unavailable_injection_points_at_the_clipboard() {
        let error = FixError::from(PlatformError::InjectionUnavailable);
        assert_eq!(error.code, "injection_unavailable");
        assert!(error.remedy.contains("Ctrl+V"));
    }

    #[test]
    fn translate_without_a_target_names_the_panel_to_fix_it_in() {
        let error = FixError::from(zyntax_core::PromptError::TranslateRequiresTarget);
        assert_eq!(error.code, "translate_needs_target");
        assert!(error.remedy.contains("Languages"));
    }

    #[test]
    fn the_disabled_state_is_not_retryable_and_says_how_to_undo_it() {
        let error = FixError {
            code: "disabled".to_owned(),
            message: "ZyntaxAI is switched off".to_owned(),
            remedy: "Turn it back on from the tray menu, or with the switch in the app.".to_owned(),
            retryable: false,
        };
        assert!(!error.retryable);
        assert!(error.remedy.contains("tray"));
    }

    #[test]
    fn timestamps_are_plausible() {
        let now = current_unix_seconds();
        assert!(now > 1_577_836_800, "got {now}");
        assert!(now < 4_102_444_800, "got {now}");
    }
}
