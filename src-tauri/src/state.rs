use std::sync::Mutex;
use tokio_util::sync::CancellationToken;
use zyntax_platform::{Capabilities, DesktopTextIo};
use zyntax_store::{AppSettings, History, Paths, SecretStore};

pub struct AppState {
    pub paths: Paths,
    pub settings: Mutex<AppSettings>,
    pub secrets: SecretStore,
    pub history: Mutex<History>,
    pub capabilities: Capabilities,

    pub text_io: Mutex<Option<DesktopTextIo>>,

    pub in_flight: Mutex<Option<CancellationToken>>,

    pub hotkey_status: Mutex<crate::hotkeys::HotkeyStatus>,

    pub tray_enabled_item: Mutex<Option<tauri::menu::CheckMenuItem<tauri::Wry>>>,

    #[cfg(target_os = "linux")]
    pub portal_task: Mutex<Option<tauri::async_runtime::JoinHandle<()>>>,
}

impl AppState {
    pub fn load() -> anyhow::Result<Self> {
        let paths = Paths::from_env()?;
        let settings = AppSettings::load(&paths.settings_file())?;
        // Keep malformed overrides available in Settings for repair, while the
        // provider's build/send validation prevents using them for generation.
        for profile in &settings.providers {
            if let Err(error) =
                zyntax_providers::request_options::validate(profile.id, &profile.request_overrides)
            {
                tracing::warn!(provider = profile.id.slug(), field = %error.path, "saved request parameters need correction in Settings");
            }
        }
        let history = History::open(&paths.history_db())?;
        let secrets = SecretStore::new(paths.fallback_key_file(), paths.fallback_secrets_file());
        let capabilities = Capabilities::detect();

        let text_io = match DesktopTextIo::new(capabilities.clone()) {
            Ok(io) => Some(io),
            Err(err) => {
                tracing::warn!(%err, "clipboard unavailable; corrections cannot be captured");
                None
            }
        };

        tracing::info!(
            display_server = ?capabilities.display_server,
            injection = ?capabilities.injection,
            hotkey = ?capabilities.hotkey,
            secrets = ?secrets.backend(),
            "session capabilities detected"
        );

        let hotkey_status = crate::hotkeys::HotkeyStatus {
            accelerator: settings.hotkey.clone(),
            display: settings.hotkey.clone(),
            registered: false,
            problem: Some("not registered yet".to_owned()),
        };

        Ok(Self {
            paths,
            settings: Mutex::new(settings),
            secrets,
            history: Mutex::new(history),
            capabilities,
            text_io: Mutex::new(text_io),
            in_flight: Mutex::new(None),
            hotkey_status: Mutex::new(hotkey_status),
            tray_enabled_item: Mutex::new(None),
            #[cfg(target_os = "linux")]
            portal_task: Mutex::new(None),
        })
    }

    pub fn sync_tray_enabled(&self) {
        let enabled = self.settings().enabled;
        if let Some(item) = self
            .tray_enabled_item
            .lock()
            .expect("tray-item lock poisoned")
            .as_ref()
        {
            let _ = item.set_checked(enabled);
        }
    }

    pub fn settings(&self) -> AppSettings {
        self.settings
            .lock()
            .expect("settings lock poisoned")
            .clone()
    }

    pub fn save_settings(&self, mut next: AppSettings) -> anyhow::Result<AppSettings> {
        for profile in &next.providers {
            zyntax_providers::request_options::validate(profile.id, &profile.request_overrides)?;
        }
        let mut current = self.settings.lock().expect("settings lock poisoned");
        next.normalize();
        next.save(&self.paths.settings_file())?;
        *current = next.clone();
        Ok(next)
    }

    pub fn save_request_parameters(
        &self,
        provider: zyntax_core::ProviderId,
        draft: &str,
    ) -> anyhow::Result<AppSettings> {
        let overrides = zyntax_providers::request_options::parse(provider, draft)?;
        let mut current = self.settings.lock().expect("settings lock poisoned");
        let mut next = current.clone();
        let profile = next
            .providers
            .iter_mut()
            .find(|profile| profile.id == provider)
            .ok_or_else(|| anyhow::anyhow!("Provider profile is missing."))?;
        profile.request_overrides = overrides;
        next.save(&self.paths.settings_file())?;
        *current = next.clone();
        Ok(next)
    }

    pub fn begin_request(&self) -> CancellationToken {
        let token = CancellationToken::new();
        let mut slot = self.in_flight.lock().expect("in-flight lock poisoned");
        if let Some(previous) = slot.replace(token.clone()) {
            tracing::debug!("superseding the correction already in flight");
            previous.cancel();
        }
        token
    }

    pub fn cancel_in_flight(&self) {
        if let Some(token) = self
            .in_flight
            .lock()
            .expect("in-flight lock poisoned")
            .take()
        {
            token.cancel();
        }
    }

    pub fn finish_request(&self, token: &CancellationToken) {
        let mut slot = self.in_flight.lock().expect("in-flight lock poisoned");
        if slot.as_ref().is_some_and(|current| current == token) {
            *slot = None;
        }
    }
}
