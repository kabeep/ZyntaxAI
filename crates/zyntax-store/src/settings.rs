use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::path::Path;
use thiserror::Error;
use ts_rs::TS;
use zyntax_core::{
    language::AUTO_TAG, persona::DEFAULT_PERSONA_ID, InputSource, Language, ModelPricing,
    OutputMode, Persona, ProviderId, ProviderProfile, Speed,
};

pub const CURRENT_SCHEMA_VERSION: u32 = 1;

#[derive(Debug, Error)]
pub enum SettingsError {
    #[error("could not read settings from {path}: {source}")]
    Read {
        path: String,
        #[source]
        source: std::io::Error,
    },
    #[error("could not write settings to {path}: {source}")]
    Write {
        path: String,
        #[source]
        source: std::io::Error,
    },
    #[error("settings file is not valid JSON: {0}")]
    Parse(#[from] serde_json::Error),
    #[error(
        "settings were written by a newer version of ZyntaxAI (schema {found}, this build \
         understands {CURRENT_SCHEMA_VERSION}); upgrade the app rather than downgrading the file"
    )]
    FromTheFuture { found: u32 },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum Theme {
    #[default]
    System,
    Dark,
    Light,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", default)]
#[ts(export)]
pub struct BehaviorSettings {
    pub input_source: InputSource,
    pub output_mode: OutputMode,

    pub minimize_to_tray: bool,
    pub show_notifications: bool,
    pub play_sound: bool,

    pub auto_copy_fixed: bool,

    pub keep_history: bool,
}

impl Default for BehaviorSettings {
    fn default() -> Self {
        Self {
            input_source: InputSource::default(),
            output_mode: OutputMode::default(),
            minimize_to_tray: true,
            show_notifications: true,
            play_sound: false,
            auto_copy_fixed: false,
            keep_history: true,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", default)]
#[ts(export)]
pub struct SystemSettings {
    pub start_with_os: bool,

    pub start_minimized: bool,

    pub check_for_updates: bool,
}

impl Default for SystemSettings {
    fn default() -> Self {
        Self {
            start_with_os: false,
            start_minimized: false,

            check_for_updates: true,
        }
    }
}

pub const SIDEBAR_SECTIONS: [&str; 10] = [
    "hotkeys",
    "personas",
    "languages",
    "providers",
    "behavior",
    "appearance",
    "usage",
    "system",
    "logs",
    "about",
];

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct SidebarCategory {
    pub id: String,
    pub name: String,

    pub collapsed: bool,

    pub items: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", default)]
#[ts(export)]
pub struct SidebarLayout {
    pub categories: Vec<SidebarCategory>,
}

pub const DEFAULT_CATEGORY_ID: &str = "general";

impl Default for SidebarLayout {
    fn default() -> Self {
        Self {
            categories: vec![SidebarCategory {
                id: DEFAULT_CATEGORY_ID.to_owned(),
                name: "General".to_owned(),
                collapsed: false,
                items: SIDEBAR_SECTIONS.iter().map(|s| (*s).to_owned()).collect(),
            }],
        }
    }
}

impl SidebarLayout {
    fn normalize(&mut self) {
        let known: Vec<&str> = SIDEBAR_SECTIONS.to_vec();

        let mut seen: Vec<String> = Vec::new();
        for category in &mut self.categories {
            category
                .items
                .retain(|item| known.contains(&item.as_str()) && !seen.contains(item));
            seen.extend(category.items.iter().cloned());
        }

        if self.categories.is_empty() {
            self.categories.push(SidebarCategory {
                id: DEFAULT_CATEGORY_ID.to_owned(),
                name: "General".to_owned(),
                collapsed: false,
                items: Vec::new(),
            });
        }

        let missing: Vec<String> = known
            .iter()
            .filter(|section| !seen.contains(&(*section).to_string()))
            .map(|section| (*section).to_owned())
            .collect();
        if let Some(first) = self.categories.first_mut() {
            first.items.extend(missing);
        }

        for category in &mut self.categories {
            if category.name.trim().is_empty() {
                category.name = "Untitled".to_owned();
            }
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", default)]
#[ts(export)]
pub struct AppearanceSettings {
    pub theme: Theme,

    pub opacity: u8,
}

pub const OPACITY_MIN: u8 = 40;

impl Default for AppearanceSettings {
    fn default() -> Self {
        Self {
            theme: Theme::default(),
            opacity: 100,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", default)]
#[ts(export)]
pub struct AppSettings {
    pub schema_version: u32,

    pub enabled: bool,

    pub hotkey: String,

    pub persona_id: String,

    pub custom_personas: Vec<Persona>,

    pub language_tag: String,
    pub custom_languages: Vec<Language>,
    pub translate: bool,

    pub speed: Speed,

    pub active_provider: ProviderId,
    pub providers: Vec<ProviderProfile>,

    pub pricing: BTreeMap<String, ModelPricing>,

    pub behavior: BehaviorSettings,
    pub system: SystemSettings,
    pub appearance: AppearanceSettings,
    pub sidebar: SidebarLayout,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            schema_version: CURRENT_SCHEMA_VERSION,
            enabled: true,
            hotkey: DEFAULT_HOTKEY.to_owned(),
            persona_id: DEFAULT_PERSONA_ID.to_owned(),
            custom_personas: Vec::new(),
            language_tag: AUTO_TAG.to_owned(),
            custom_languages: Vec::new(),
            translate: false,
            speed: Speed::default(),
            active_provider: ProviderId::default(),
            providers: ProviderId::ALL
                .iter()
                .copied()
                .map(ProviderProfile::new)
                .collect(),
            pricing: BTreeMap::new(),
            behavior: BehaviorSettings::default(),
            system: SystemSettings::default(),
            appearance: AppearanceSettings::default(),
            sidebar: SidebarLayout::default(),
        }
    }
}

pub const DEFAULT_HOTKEY: &str = "Ctrl+Alt+G";

impl AppSettings {
    pub fn all_personas(&self) -> Vec<Persona> {
        let mut personas = zyntax_core::builtin_personas();
        personas.extend(self.custom_personas.iter().cloned());
        personas
    }

    pub fn all_languages(&self) -> Vec<Language> {
        let mut languages = zyntax_core::builtin_languages();
        languages.extend(self.custom_languages.iter().cloned());
        languages
    }

    pub fn active_persona(&self) -> Persona {
        self.all_personas()
            .into_iter()
            .find(|p| p.id == self.persona_id)
            .or_else(|| zyntax_core::builtin_persona(DEFAULT_PERSONA_ID))
            .expect("the default persona is always built in")
    }

    pub fn active_language(&self) -> Language {
        self.all_languages()
            .into_iter()
            .find(|l| l.tag == self.language_tag)
            .unwrap_or_else(zyntax_core::auto_language)
    }

    pub fn active_provider_profile(&self) -> ProviderProfile {
        self.providers
            .iter()
            .find(|p| p.id == self.active_provider)
            .cloned()
            .unwrap_or_else(|| ProviderProfile::new(self.active_provider))
    }

    pub fn pricing_for(&self, provider: ProviderId, model: &str) -> ModelPricing {
        self.pricing
            .get(&pricing_key(provider, model))
            .copied()
            .unwrap_or_default()
    }

    pub fn normalize(&mut self) {
        self.appearance.opacity = self.appearance.opacity.clamp(OPACITY_MIN, 100);
        self.sidebar.normalize();

        if self.hotkey.trim().is_empty() {
            self.hotkey = DEFAULT_HOTKEY.to_owned();
        }

        if self.translate && self.language_tag == AUTO_TAG {
            self.translate = false;
        }

        for id in ProviderId::ALL {
            if !self.providers.iter().any(|p| p.id == id) {
                self.providers.push(ProviderProfile::new(id));
            }
        }
        for profile in &mut self.providers {
            if profile.model.trim().is_empty() {
                profile.model = profile.id.default_model().to_owned();
            }
        }

        let builtin_ids: Vec<String> = zyntax_core::builtin_personas()
            .into_iter()
            .map(|p| p.id)
            .collect();
        self.custom_personas
            .retain(|p| !builtin_ids.contains(&p.id));
        for persona in &mut self.custom_personas {
            persona.builtin = false;
        }
    }

    pub fn load(path: &Path) -> Result<Self, SettingsError> {
        let raw = match std::fs::read_to_string(path) {
            Ok(raw) => raw,
            Err(err) if err.kind() == std::io::ErrorKind::NotFound => {
                return Ok(Self::default());
            }
            Err(source) => {
                return Err(SettingsError::Read {
                    path: path.display().to_string(),
                    source,
                })
            }
        };

        let value: serde_json::Value = serde_json::from_str(&raw)?;
        let mut settings = migrate(value)?;
        settings.normalize();
        Ok(settings)
    }

    pub fn save(&self, path: &Path) -> Result<(), SettingsError> {
        let json = serde_json::to_string_pretty(self)?;
        let temp = path.with_extension("json.tmp");

        std::fs::write(&temp, json).map_err(|source| SettingsError::Write {
            path: temp.display().to_string(),
            source,
        })?;

        std::fs::rename(&temp, path).map_err(|source| SettingsError::Write {
            path: path.display().to_string(),
            source,
        })
    }
}

pub fn pricing_key(provider: ProviderId, model: &str) -> String {
    format!("{}/{}", provider.slug(), model)
}

pub fn migrate(mut value: serde_json::Value) -> Result<AppSettings, SettingsError> {
    let found = value
        .get("schemaVersion")
        .and_then(serde_json::Value::as_u64)
        .unwrap_or(0) as u32;

    if found > CURRENT_SCHEMA_VERSION {
        return Err(SettingsError::FromTheFuture { found });
    }

    for version in found..CURRENT_SCHEMA_VERSION {
        match version {
            0 => {
                value["schemaVersion"] = serde_json::json!(1);
            }
            _ => unreachable!("no migration defined for schema version {version}"),
        }
    }

    let mut settings: AppSettings = serde_json::from_value(value)?;
    settings.schema_version = CURRENT_SCHEMA_VERSION;
    Ok(settings)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_file() -> (tempfile::TempDir, std::path::PathBuf) {
        let dir = tempfile::tempdir().expect("temp dir");
        let path = dir.path().join("settings.json");
        (dir, path)
    }

    #[test]
    fn missing_file_is_a_first_run_not_an_error() {
        let (_dir, path) = temp_file();
        let settings = AppSettings::load(&path).expect("first run loads defaults");
        assert_eq!(settings, AppSettings::default());
    }

    #[test]
    fn an_older_settings_file_still_opts_into_update_checks() {
        let system: SystemSettings =
            serde_json::from_str(r#"{"startWithOs":true,"startMinimized":true}"#)
                .expect("an older system block still parses");

        assert!(system.start_with_os);
        assert!(system.start_minimized);
        assert!(system.check_for_updates);
    }

    #[test]
    fn round_trips_through_disk() {
        let (_dir, path) = temp_file();
        let settings = AppSettings {
            hotkey: "Ctrl+Shift+G".to_owned(),
            behavior: BehaviorSettings {
                play_sound: true,
                ..Default::default()
            },
            appearance: AppearanceSettings {
                opacity: 85,
                ..Default::default()
            },
            ..Default::default()
        };

        settings.save(&path).expect("save");
        let loaded = AppSettings::load(&path).expect("load");
        assert_eq!(loaded, settings);
    }

    #[test]
    fn request_parameters_round_trip_as_objects_without_affecting_other_profiles() {
        let (_dir, path) = temp_file();
        let mut settings = AppSettings::default();
        settings.providers[0].request_overrides = serde_json::json!({
            "generationConfig": { "thinkingConfig": { "thinkingBudget": 0 } },
            "note": "a  b\nc 日本語", "custom": [false, 0, null]
        });
        settings.save(&path).expect("save");
        assert_eq!(AppSettings::load(&path).expect("load"), settings);
        let document: serde_json::Value =
            serde_json::from_str(&std::fs::read_to_string(&path).expect("read")).expect("json");
        assert!(document["providers"][0]["requestOverrides"].is_object());
        for profile in settings.providers.iter().skip(1) {
            assert_eq!(profile.request_overrides, serde_json::json!({}));
        }
    }

    #[test]
    fn older_provider_profiles_default_to_no_overrides() {
        let profile: ProviderProfile =
            serde_json::from_str(r#"{"id":"ollama","baseUrl":null,"model":"local"}"#)
                .expect("old profile");
        assert_eq!(profile.request_overrides, serde_json::json!({}));
    }

    #[test]
    fn invalid_request_parameter_shapes_remain_available_for_repair() {
        let (_dir, path) = temp_file();
        let mut settings = AppSettings::default();
        settings.providers[0].request_overrides = serde_json::Value::Null;
        settings.save(&path).expect("save fixture");
        assert_eq!(
            AppSettings::load(&path)
                .expect("settings can open")
                .providers[0]
                .request_overrides,
            serde_json::Value::Null
        );
    }

    #[test]
    fn save_leaves_no_temp_file_behind() {
        let (_dir, path) = temp_file();
        AppSettings::default().save(&path).expect("save");
        assert!(!path.with_extension("json.tmp").exists());
    }

    #[test]
    fn unknown_fields_are_ignored_and_missing_ones_defaulted() {
        let (_dir, path) = temp_file();
        std::fs::write(
            &path,
            r#"{"schemaVersion":1,"hotkey":"Ctrl+Alt+Y","somethingRemoved":42}"#,
        )
        .unwrap();

        let settings = AppSettings::load(&path).expect("load");
        assert_eq!(settings.hotkey, "Ctrl+Alt+Y");
        assert_eq!(settings.speed, Speed::Normal);
        assert_eq!(settings.behavior, BehaviorSettings::default());
    }

    #[test]
    fn pre_versioned_document_migrates_to_current() {
        let value = serde_json::json!({ "hotkey": "Ctrl+Alt+Q" });
        let settings = migrate(value).expect("migrates");
        assert_eq!(settings.schema_version, CURRENT_SCHEMA_VERSION);
        assert_eq!(settings.hotkey, "Ctrl+Alt+Q");
    }

    #[test]
    fn refuses_a_document_from_a_newer_build() {
        let value = serde_json::json!({ "schemaVersion": CURRENT_SCHEMA_VERSION + 1 });
        assert!(matches!(
            migrate(value),
            Err(SettingsError::FromTheFuture { .. })
        ));
    }

    #[test]
    fn enabled_defaults_to_true_including_for_older_files() {
        assert!(AppSettings::default().enabled);

        let migrated = migrate(serde_json::json!({ "schemaVersion": 1 })).expect("migrates");
        assert!(
            migrated.enabled,
            "a file predating the field must not arrive disabled"
        );
    }

    #[test]
    fn enabled_survives_a_round_trip() {
        let (_dir, path) = temp_file();
        let settings = AppSettings {
            enabled: false,
            ..Default::default()
        };
        settings.save(&path).expect("save");
        assert!(!AppSettings::load(&path).expect("load").enabled);
    }

    #[test]
    fn a_fresh_sidebar_contains_every_panel_exactly_once() {
        let layout = SidebarLayout::default();
        let items: Vec<&str> = layout.categories[0]
            .items
            .iter()
            .map(String::as_str)
            .collect();
        assert_eq!(items, SIDEBAR_SECTIONS.to_vec());
    }

    #[test]
    fn normalize_adopts_panels_missing_from_a_saved_layout() {
        let mut settings = AppSettings {
            sidebar: SidebarLayout {
                categories: vec![SidebarCategory {
                    id: "mine".to_owned(),
                    name: "Mine".to_owned(),
                    collapsed: false,
                    items: vec!["hotkeys".to_owned()],
                }],
            },
            ..Default::default()
        };
        settings.normalize();

        let all: Vec<String> = settings
            .sidebar
            .categories
            .iter()
            .flat_map(|c| c.items.clone())
            .collect();
        for section in SIDEBAR_SECTIONS {
            assert!(
                all.contains(&section.to_string()),
                "{section} became unreachable"
            );
        }
    }

    #[test]
    fn normalize_drops_panels_that_no_longer_exist() {
        let mut settings = AppSettings {
            sidebar: SidebarLayout {
                categories: vec![SidebarCategory {
                    id: "mine".to_owned(),
                    name: "Mine".to_owned(),
                    collapsed: false,
                    items: vec!["hotkeys".to_owned(), "a-panel-that-was-removed".to_owned()],
                }],
            },
            ..Default::default()
        };
        settings.normalize();

        let all: Vec<String> = settings
            .sidebar
            .categories
            .iter()
            .flat_map(|c| c.items.clone())
            .collect();
        assert!(!all.contains(&"a-panel-that-was-removed".to_string()));
    }

    #[test]
    fn normalize_removes_duplicates_keeping_the_first() {
        let mut settings = AppSettings {
            sidebar: SidebarLayout {
                categories: vec![
                    SidebarCategory {
                        id: "a".to_owned(),
                        name: "A".to_owned(),
                        collapsed: false,
                        items: vec!["hotkeys".to_owned()],
                    },
                    SidebarCategory {
                        id: "b".to_owned(),
                        name: "B".to_owned(),
                        collapsed: false,
                        items: vec!["hotkeys".to_owned()],
                    },
                ],
            },
            ..Default::default()
        };
        settings.normalize();

        let all: Vec<String> = settings
            .sidebar
            .categories
            .iter()
            .flat_map(|c| c.items.clone())
            .collect();
        assert_eq!(
            all.iter().filter(|item| *item == "hotkeys").count(),
            1,
            "a panel must not end up in two groups"
        );

        let mut unique = all.clone();
        unique.sort();
        unique.dedup();
        assert_eq!(unique.len(), all.len(), "no panel may be duplicated");

        assert!(settings.sidebar.categories[0]
            .items
            .contains(&"hotkeys".to_owned()));
    }

    #[test]
    fn normalize_restores_a_layout_with_no_categories() {
        let mut settings = AppSettings {
            sidebar: SidebarLayout { categories: vec![] },
            ..Default::default()
        };
        settings.normalize();

        assert!(!settings.sidebar.categories.is_empty());
        assert_eq!(
            settings.sidebar.categories[0].items.len(),
            SIDEBAR_SECTIONS.len()
        );
    }

    #[test]
    fn normalize_names_an_untitled_category() {
        let mut settings = AppSettings {
            sidebar: SidebarLayout {
                categories: vec![SidebarCategory {
                    id: "x".to_owned(),
                    name: "   ".to_owned(),
                    collapsed: false,
                    items: vec![],
                }],
            },
            ..Default::default()
        };
        settings.normalize();
        assert_eq!(settings.sidebar.categories[0].name, "Untitled");
    }

    #[test]
    fn a_custom_sidebar_survives_a_round_trip() {
        let (_dir, path) = temp_file();
        let settings = AppSettings {
            sidebar: SidebarLayout {
                categories: vec![
                    SidebarCategory {
                        id: "active".to_owned(),
                        name: "Active".to_owned(),
                        collapsed: false,
                        items: vec!["personas".to_owned(), "hotkeys".to_owned()],
                    },
                    SidebarCategory {
                        id: "rest".to_owned(),
                        name: "Everything else".to_owned(),
                        collapsed: true,
                        items: SIDEBAR_SECTIONS
                            .iter()
                            .filter(|s| !matches!(**s, "personas" | "hotkeys"))
                            .map(|s| (*s).to_owned())
                            .collect(),
                    },
                ],
            },
            ..Default::default()
        };

        settings.save(&path).expect("save");
        let loaded = AppSettings::load(&path).expect("load");

        assert_eq!(loaded.sidebar.categories.len(), 2);
        assert_eq!(
            loaded.sidebar.categories[0].items,
            vec!["personas", "hotkeys"]
        );
        assert!(loaded.sidebar.categories[1].collapsed);
    }

    #[test]
    fn normalize_clamps_opacity() {
        let mut settings = AppSettings::default();
        settings.appearance.opacity = 5;
        settings.normalize();
        assert_eq!(settings.appearance.opacity, OPACITY_MIN);

        settings.appearance.opacity = 200;
        settings.normalize();
        assert_eq!(settings.appearance.opacity, 100);
    }

    #[test]
    fn normalize_restores_a_blank_hotkey() {
        let mut settings = AppSettings {
            hotkey: "   ".to_owned(),
            ..Default::default()
        };
        settings.normalize();
        assert_eq!(settings.hotkey, DEFAULT_HOTKEY);
    }

    #[test]
    fn normalize_disables_translation_without_a_target() {
        let mut settings = AppSettings {
            translate: true,
            language_tag: AUTO_TAG.to_owned(),
            ..Default::default()
        };
        settings.normalize();
        assert!(!settings.translate, "translate+auto is not a valid request");
    }

    #[test]
    fn normalize_fills_in_a_missing_provider_profile() {
        let mut settings = AppSettings::default();
        settings.providers.clear();
        settings.normalize();
        assert_eq!(settings.providers.len(), ProviderId::ALL.len());
    }

    #[test]
    fn normalize_rejects_a_custom_persona_shadowing_a_builtin() {
        let mut settings = AppSettings::default();
        settings.custom_personas.push(Persona {
            id: DEFAULT_PERSONA_ID.to_owned(),
            name: "Hijacked".to_owned(),
            instruction: "…".to_owned(),
            builtin: true,
            custom_instructions: false,
        });
        settings.normalize();
        assert!(settings.custom_personas.is_empty());
        assert_eq!(settings.active_persona().name, "Standard");
    }

    #[test]
    fn deleted_persona_falls_back_to_the_default() {
        let settings = AppSettings {
            persona_id: "a-persona-the-user-deleted".to_owned(),
            ..Default::default()
        };
        assert_eq!(settings.active_persona().id, DEFAULT_PERSONA_ID);
    }

    #[test]
    fn deleted_language_falls_back_to_auto() {
        let settings = AppSettings {
            language_tag: "kl".to_owned(),
            ..Default::default()
        };
        assert!(settings.active_language().is_auto());
    }

    #[test]
    fn custom_personas_are_offered_alongside_builtins() {
        let mut settings = AppSettings::default();
        settings.custom_personas.push(Persona {
            id: "pirate".to_owned(),
            name: "Pirate".to_owned(),
            instruction: "Arr.".to_owned(),
            builtin: false,
            custom_instructions: false,
        });
        settings.persona_id = "pirate".to_owned();

        assert_eq!(settings.active_persona().name, "Pirate");
        assert_eq!(
            settings.all_personas().len(),
            zyntax_core::builtin_personas().len() + 1
        );
    }

    #[test]
    fn pricing_defaults_to_zero_and_reads_back_what_was_set() {
        let mut settings = AppSettings::default();
        assert_eq!(
            settings.pricing_for(ProviderId::Gemini, "gemini-2.5-flash"),
            ModelPricing::default()
        );

        settings.pricing.insert(
            pricing_key(ProviderId::Gemini, "gemini-2.5-flash"),
            ModelPricing {
                input_per_million: 0.3,
                output_per_million: 2.5,
            },
        );
        let pricing = settings.pricing_for(ProviderId::Gemini, "gemini-2.5-flash");
        assert_eq!(pricing.output_per_million, 2.5);
    }

    #[test]
    fn malformed_json_is_an_error() {
        let (_dir, path) = temp_file();
        std::fs::write(&path, "{not json").unwrap();
        assert!(matches!(
            AppSettings::load(&path),
            Err(SettingsError::Parse(_))
        ));
    }
}

#[cfg(test)]
mod custom_instruction_tests {
    use super::*;
    #[test]
    fn older_personas_default_to_original_mode_and_switch_round_trips() {
        let mut settings = AppSettings::default();
        let old = serde_json::json!({"id":"custom","name":"Casual","instruction":"  Translate casually.\n","builtin":false});
        let mut persona: Persona = serde_json::from_value(old).unwrap();
        assert!(!persona.custom_instructions);
        persona.custom_instructions = true;
        settings.custom_personas.push(persona);
        settings.persona_id = "custom".to_owned();
        settings.translate = true;
        settings.language_tag = "en".to_owned();
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("settings.json");
        settings.save(&path).unwrap();
        let loaded = AppSettings::load(&path).unwrap();
        assert_eq!(loaded, settings);
        assert!(loaded.active_persona().custom_instructions);
        assert!(loaded.translate);
        assert!(serde_json::from_value::<Persona>(serde_json::json!({"id":"custom","name":"Casual","instruction":"hi","builtin":false,"customInstructions":"true"})).is_err());
    }
}
