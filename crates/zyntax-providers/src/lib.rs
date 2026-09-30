#![forbid(unsafe_code)]

pub mod error;
pub mod gemini;
pub mod http;
pub mod ollama;
pub mod openai;
pub mod request_options;

use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use tokio_util::sync::CancellationToken;
use ts_rs::TS;
use zyntax_core::{Prompt, ProviderId, ProviderProfile, TokenUsage};

pub use error::{ProviderError, ProviderErrorInfo};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ModelInfo {
    pub id: String,

    pub label: String,
}

impl ModelInfo {
    pub fn new(id: impl Into<String>) -> Self {
        let id = id.into();
        Self {
            label: id.clone(),
            id,
        }
    }
}

#[derive(Debug, Clone)]
pub struct CompletionRequest {
    pub model: String,
    pub prompt: Prompt,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Completion {
    pub text: String,
    pub usage: TokenUsage,
}

#[async_trait]
pub trait Provider: Send + Sync {
    fn id(&self) -> ProviderId;

    async fn list_models(&self) -> Result<Vec<ModelInfo>, ProviderError>;

    async fn complete(
        &self,
        request: &CompletionRequest,
        cancel: &CancellationToken,
    ) -> Result<Completion, ProviderError>;
}

pub fn build(
    profile: &ProviderProfile,
    api_key: Option<String>,
) -> Result<Box<dyn Provider>, ProviderError> {
    request_options::validate(profile.id, &profile.request_overrides).map_err(|error| {
        ProviderError::RequestParameters {
            provider: profile.id,
            error,
        }
    })?;
    let key = match (profile.id.needs_api_key(), api_key) {
        (true, Some(key)) if !key.trim().is_empty() => Some(key),
        (true, _) => {
            return Err(ProviderError::NoApiKey {
                provider: profile.id,
            })
        }
        (false, key) => key,
    };

    let base_url = profile.base_url().to_owned();

    Ok(match profile.id {
        ProviderId::Gemini => Box::new(gemini::Gemini::new(
            base_url,
            key.unwrap_or_default(),
            profile.request_overrides.clone(),
        )?),
        ProviderId::OpenAiCompatible => Box::new(openai::OpenAiCompatible::new(
            base_url,
            key.unwrap_or_default(),
            profile.request_overrides.clone(),
        )?),
        ProviderId::Ollama => Box::new(ollama::Ollama::new(
            base_url,
            profile.request_overrides.clone(),
        )?),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn model_info_labels_itself_by_id_when_unnamed() {
        let model = ModelInfo::new("gemini-2.5-flash");
        assert_eq!(model.id, "gemini-2.5-flash");
        assert_eq!(model.label, "gemini-2.5-flash");
    }

    #[test]
    fn building_a_keyed_provider_without_a_key_fails_early() {
        let profile = ProviderProfile::new(ProviderId::Gemini);
        assert!(matches!(
            build(&profile, None),
            Err(ProviderError::NoApiKey { .. })
        ));
    }

    #[test]
    fn a_blank_key_counts_as_no_key() {
        let profile = ProviderProfile::new(ProviderId::Gemini);
        assert!(matches!(
            build(&profile, Some("   ".to_owned())),
            Err(ProviderError::NoApiKey { .. })
        ));
    }

    #[test]
    fn ollama_needs_no_key() {
        let profile = ProviderProfile::new(ProviderId::Ollama);
        let provider = build(&profile, None).expect("ollama builds without a key");
        assert_eq!(provider.id(), ProviderId::Ollama);
    }

    #[test]
    fn each_provider_id_builds_its_own_backend() {
        for id in ProviderId::ALL {
            let profile = ProviderProfile::new(id);
            let provider = build(&profile, Some("test-key".to_owned())).expect("builds");
            assert_eq!(provider.id(), id);
        }
    }
}
