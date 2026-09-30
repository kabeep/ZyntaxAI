use serde::{Deserialize, Serialize};
use ts_rs::TS;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Default, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum ProviderId {
    #[default]
    Gemini,

    OpenAiCompatible,

    Ollama,
}

impl ProviderId {
    pub const fn slug(self) -> &'static str {
        match self {
            ProviderId::Gemini => "gemini",
            ProviderId::OpenAiCompatible => "openai-compatible",
            ProviderId::Ollama => "ollama",
        }
    }

    pub const fn label(self) -> &'static str {
        match self {
            ProviderId::Gemini => "Google Gemini",
            ProviderId::OpenAiCompatible => "OpenAI-compatible",
            ProviderId::Ollama => "Ollama (local)",
        }
    }

    pub const fn needs_api_key(self) -> bool {
        match self {
            ProviderId::Gemini | ProviderId::OpenAiCompatible => true,
            ProviderId::Ollama => false,
        }
    }

    pub const fn api_key_url(self) -> Option<&'static str> {
        match self {
            ProviderId::Gemini => Some("https://aistudio.google.com/app/apikey"),
            ProviderId::OpenAiCompatible => Some("https://platform.openai.com/api-keys"),
            ProviderId::Ollama => None,
        }
    }

    pub const fn models_doc_url(self) -> &'static str {
        match self {
            ProviderId::Gemini => "https://ai.google.dev/gemini-api/docs/models",
            ProviderId::OpenAiCompatible => "https://platform.openai.com/docs/models",
            ProviderId::Ollama => "https://ollama.com/library",
        }
    }

    pub const fn default_base_url(self) -> &'static str {
        match self {
            ProviderId::Gemini => "https://generativelanguage.googleapis.com/v1beta",
            ProviderId::OpenAiCompatible => "https://api.openai.com/v1",
            ProviderId::Ollama => "http://localhost:11434",
        }
    }

    pub const fn default_model(self) -> &'static str {
        match self {
            ProviderId::Gemini => "gemini-2.5-flash",
            ProviderId::OpenAiCompatible => "gpt-4o-mini",
            ProviderId::Ollama => "llama3.2",
        }
    }

    pub const ALL: [ProviderId; 3] = [
        ProviderId::Gemini,
        ProviderId::OpenAiCompatible,
        ProviderId::Ollama,
    ];
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ModelPricing {
    pub input_per_million: f64,
    pub output_per_million: f64,
}

impl Default for ModelPricing {
    fn default() -> Self {
        Self {
            input_per_million: 0.0,
            output_per_million: 0.0,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ProviderProfile {
    pub id: ProviderId,

    pub base_url: Option<String>,
    pub model: String,

    #[serde(default = "empty_request_overrides")]
    pub request_overrides: serde_json::Value,
}

fn empty_request_overrides() -> serde_json::Value {
    serde_json::json!({})
}

impl ProviderProfile {
    pub fn new(id: ProviderId) -> Self {
        Self {
            id,
            base_url: None,
            model: id.default_model().to_owned(),
            request_overrides: empty_request_overrides(),
        }
    }

    pub fn base_url(&self) -> &str {
        self.base_url
            .as_deref()
            .map(|url| url.trim_end_matches('/'))
            .filter(|url| !url.is_empty())
            .unwrap_or_else(|| self.id.default_base_url())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn slugs_are_unique_and_stable() {
        let mut slugs: Vec<&str> = ProviderId::ALL.iter().map(|p| p.slug()).collect();
        slugs.sort_unstable();
        let count = slugs.len();
        slugs.dedup();
        assert_eq!(slugs.len(), count);
    }

    #[test]
    fn only_remote_providers_need_a_key() {
        assert!(ProviderId::Gemini.needs_api_key());
        assert!(ProviderId::OpenAiCompatible.needs_api_key());
        assert!(!ProviderId::Ollama.needs_api_key());
    }

    #[test]
    fn providers_needing_a_key_say_where_to_get_one() {
        for id in ProviderId::ALL {
            assert_eq!(id.needs_api_key(), id.api_key_url().is_some());
        }
    }

    #[test]
    fn base_url_falls_back_to_the_default() {
        let profile = ProviderProfile::new(ProviderId::Gemini);
        assert_eq!(profile.base_url(), ProviderId::Gemini.default_base_url());
    }

    #[test]
    fn base_url_override_is_trimmed() {
        let profile = ProviderProfile {
            id: ProviderId::OpenAiCompatible,
            base_url: Some("http://localhost:1234/v1/".to_owned()),
            model: "local".to_owned(),
            request_overrides: empty_request_overrides(),
        };
        assert_eq!(profile.base_url(), "http://localhost:1234/v1");
    }

    #[test]
    fn blank_override_is_ignored() {
        let profile = ProviderProfile {
            id: ProviderId::Ollama,
            base_url: Some(String::new()),
            model: "llama3.2".to_owned(),
            request_overrides: empty_request_overrides(),
        };
        assert_eq!(profile.base_url(), ProviderId::Ollama.default_base_url());
    }

    #[test]
    fn default_pricing_is_zero_not_a_guess() {
        let pricing = ModelPricing::default();
        assert_eq!(pricing.input_per_million, 0.0);
        assert_eq!(pricing.output_per_million, 0.0);
    }
}
