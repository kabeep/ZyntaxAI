use serde::{Deserialize, Serialize};
use std::time::Duration;
use thiserror::Error;
use ts_rs::TS;
use zyntax_core::ProviderId;

#[derive(Debug, Error)]
pub enum ProviderError {
    #[error("Invalid request parameters for {}: {error}", .provider.label())]
    RequestParameters {
        provider: ProviderId,
        error: crate::request_options::RequestParameterError,
    },
    #[error("no API key is configured for {}", .provider.label())]
    NoApiKey { provider: ProviderId },

    #[error("{} rejected the API key", .provider.label())]
    Auth { provider: ProviderId },

    #[error("rate limit reached")]
    RateLimited { retry_after: Option<Duration> },

    #[error("{}", match model {
        Some(name) => format!("the model '{name}' is not available"),
        None => "the selected model is not available".to_owned(),
    })]
    ModelNotFound { model: Option<String> },

    #[error("{} rejected the request: {message}", .provider.label())]
    BadRequest {
        provider: ProviderId,
        status: u16,
        message: String,
    },

    #[error("{} had a server error (HTTP {status})", .provider.label())]
    Server { provider: ProviderId, status: u16 },

    #[error("could not reach {}: {message}", .provider.label())]
    Network {
        provider: ProviderId,
        message: String,
    },

    #[error("the request timed out")]
    Timeout,

    #[error("cancelled")]
    Cancelled,

    #[error("the response could not be understood: {0}")]
    Malformed(String),

    #[error("the correction was cut off before it finished")]
    Truncated,

    #[error("{} declined to process this text{}", .provider.label(), reason.as_deref().map(|r| format!(" ({r})")).unwrap_or_default())]
    Filtered {
        provider: ProviderId,
        reason: Option<String>,
    },
}

impl ProviderError {
    pub fn is_retryable(&self) -> bool {
        matches!(
            self,
            ProviderError::RateLimited { .. }
                | ProviderError::Server { .. }
                | ProviderError::Network { .. }
                | ProviderError::Timeout
        )
    }

    pub fn code(&self) -> &'static str {
        match self {
            ProviderError::RequestParameters { .. } => "request_parameters",
            ProviderError::NoApiKey { .. } => "no_api_key",
            ProviderError::Auth { .. } => "auth",
            ProviderError::RateLimited { .. } => "rate_limited",
            ProviderError::ModelNotFound { .. } => "model_not_found",
            ProviderError::BadRequest { .. } => "bad_request",
            ProviderError::Server { .. } => "server",
            ProviderError::Network { .. } => "network",
            ProviderError::Timeout => "timeout",
            ProviderError::Cancelled => "cancelled",
            ProviderError::Malformed(_) => "malformed",
            ProviderError::Truncated => "truncated",
            ProviderError::Filtered { .. } => "filtered",
        }
    }

    pub fn remedy(&self) -> String {
        match self {
            ProviderError::RequestParameters { .. } => {
                "Correct the JSON in Providers & models → Advanced request parameters.".to_owned()
            }
            ProviderError::NoApiKey { provider } => match provider.api_key_url() {
                Some(url) => format!("Add a key in Providers & models. Get one at {url}."),
                None => "Configure this provider in Providers & models.".to_owned(),
            },
            ProviderError::Auth { provider } => format!(
                "Check the key in Providers & models for stray spaces, or issue a new one{}.",
                provider
                    .api_key_url()
                    .map(|url| format!(" at {url}"))
                    .unwrap_or_default()
            ),
            ProviderError::RateLimited { retry_after } => match retry_after {
                Some(wait) => format!(
                    "Wait about {} seconds and try again.",
                    wait.as_secs().max(1)
                ),
                None => "You are sending requests faster than your plan allows. Wait a moment, \
                         or switch to a different provider."
                    .to_owned(),
            },
            ProviderError::ModelNotFound { .. } => {
                "Pick a different model in Providers & models. The list refreshes from the \
                 provider."
                    .to_owned()
            }
            ProviderError::BadRequest { .. } => {
                "This request was rejected as invalid. If it repeats, report it with the log \
                 from the Logs panel."
                    .to_owned()
            }
            ProviderError::Server { provider, .. } => format!(
                "{} is having trouble on their end. Try again shortly.",
                provider.label()
            ),
            ProviderError::Network { provider, .. } => {
                if matches!(provider, ProviderId::Ollama) {
                    "Ollama does not appear to be running. Start it with `ollama serve`, or \
                     check the endpoint in Providers & models."
                        .to_owned()
                } else {
                    "Check your internet connection, then try again.".to_owned()
                }
            }
            ProviderError::Timeout => {
                "The provider took too long. Try a faster model or a shorter selection.".to_owned()
            }
            ProviderError::Cancelled => "No action needed.".to_owned(),
            ProviderError::Malformed(_) => {
                "The provider returned something unexpected. If it repeats, switch models or \
                 report it with the log from the Logs panel."
                    .to_owned()
            }
            ProviderError::Truncated => {
                "The text was too long for the model's output budget. Try Detailed depth, or \
                 correct a smaller selection."
                    .to_owned()
            }
            ProviderError::Filtered { .. } => {
                "The provider's safety filter blocked this text. A local Ollama model has no \
                 such filter."
                    .to_owned()
            }
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ProviderErrorInfo {
    pub code: String,

    pub message: String,

    pub remedy: String,
    pub retryable: bool,
}

impl From<&ProviderError> for ProviderErrorInfo {
    fn from(error: &ProviderError) -> Self {
        Self {
            code: error.code().to_owned(),
            message: error.to_string(),
            remedy: error.remedy(),
            retryable: error.is_retryable(),
        }
    }
}

impl From<ProviderError> for ProviderErrorInfo {
    fn from(error: ProviderError) -> Self {
        Self::from(&error)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn every_variant() -> Vec<ProviderError> {
        vec![
            ProviderError::NoApiKey {
                provider: ProviderId::Gemini,
            },
            ProviderError::Auth {
                provider: ProviderId::Gemini,
            },
            ProviderError::RateLimited {
                retry_after: Some(Duration::from_secs(30)),
            },
            ProviderError::RateLimited { retry_after: None },
            ProviderError::ModelNotFound {
                model: Some("nope".to_owned()),
            },
            ProviderError::BadRequest {
                provider: ProviderId::Gemini,
                status: 400,
                message: "bad".to_owned(),
            },
            ProviderError::Server {
                provider: ProviderId::Gemini,
                status: 503,
            },
            ProviderError::Network {
                provider: ProviderId::Ollama,
                message: "refused".to_owned(),
            },
            ProviderError::Timeout,
            ProviderError::Cancelled,
            ProviderError::Malformed("no candidates".to_owned()),
            ProviderError::Truncated,
            ProviderError::Filtered {
                provider: ProviderId::Gemini,
                reason: Some("SAFETY".to_owned()),
            },
        ]
    }

    #[test]
    fn every_error_has_a_message_and_a_remedy() {
        for error in every_variant() {
            assert!(!error.to_string().is_empty(), "{error:?} needs a message");
            assert!(!error.remedy().is_empty(), "{error:?} needs a remedy");
            assert!(!error.code().is_empty());
        }
    }

    #[test]
    fn codes_are_unique_per_variant() {
        let mut codes: Vec<&str> = every_variant().iter().map(|e| e.code()).collect();
        codes.sort_unstable();
        codes.dedup();

        assert_eq!(codes.len(), every_variant().len() - 1);
    }

    #[test]
    fn only_transient_failures_are_retryable() {
        assert!(ProviderError::Timeout.is_retryable());
        assert!(ProviderError::RateLimited { retry_after: None }.is_retryable());
        assert!(ProviderError::Server {
            provider: ProviderId::Gemini,
            status: 500
        }
        .is_retryable());

        assert!(!ProviderError::Auth {
            provider: ProviderId::Gemini
        }
        .is_retryable());
        assert!(!ProviderError::Truncated.is_retryable());
        assert!(!ProviderError::Cancelled.is_retryable());
    }

    #[test]
    fn rate_limit_remedy_quotes_the_wait_when_known() {
        let error = ProviderError::RateLimited {
            retry_after: Some(Duration::from_secs(42)),
        };
        assert!(error.remedy().contains("42"));
    }

    #[test]
    fn ollama_network_failure_suggests_starting_it() {
        let error = ProviderError::Network {
            provider: ProviderId::Ollama,
            message: "connection refused".to_owned(),
        };
        assert!(error.remedy().contains("ollama serve"));
    }

    #[test]
    fn missing_key_points_at_where_to_get_one() {
        let error = ProviderError::NoApiKey {
            provider: ProviderId::Gemini,
        };
        assert!(error.remedy().contains("aistudio.google.com"));
    }

    #[test]
    fn info_carries_everything_the_ui_needs() {
        let info = ProviderErrorInfo::from(&ProviderError::Timeout);
        assert_eq!(info.code, "timeout");
        assert!(info.retryable);
        assert!(!info.remedy.is_empty());
    }
}
