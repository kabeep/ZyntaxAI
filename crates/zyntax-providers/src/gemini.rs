use crate::error::ProviderError;
use crate::http;
use crate::{Completion, CompletionRequest, ModelInfo, Provider};
use async_trait::async_trait;
use serde::Deserialize;
use tokio_util::sync::CancellationToken;
use zyntax_core::{ProviderId, TokenUsage};

const ID: ProviderId = ProviderId::Gemini;

pub struct Gemini {
    client: reqwest::Client,
    base_url: String,
    request_overrides: serde_json::Value,
    api_key: String,
}

impl Gemini {
    pub fn new(
        base_url: String,
        api_key: String,
        request_overrides: serde_json::Value,
    ) -> Result<Self, ProviderError> {
        Ok(Self {
            client: http::client()?,
            base_url,
            request_overrides,
            api_key,
        })
    }
}

#[async_trait]
impl Provider for Gemini {
    fn id(&self) -> ProviderId {
        ID
    }

    async fn list_models(&self) -> Result<Vec<ModelInfo>, ProviderError> {
        let url = format!("{}/models", self.base_url);

        let response = self
            .client
            .get(&url)
            .header("x-goog-api-key", &self.api_key)
            .send()
            .await
            .map_err(|err| http::map_transport_error(ID, &err))?;

        let body: ModelListResponse = http::error_for_status(ID, response)
            .await?
            .json()
            .await
            .map_err(|err| ProviderError::Malformed(err.to_string()))?;

        Ok(body
            .models
            .into_iter()
            .filter(|model| {
                model
                    .supported_generation_methods
                    .iter()
                    .any(|method| method == "generateContent")
            })
            .map(|model| ModelInfo {
                id: model.short_name().to_owned(),
                label: model
                    .display_name
                    .unwrap_or_else(|| model.name.clone())
                    .clone(),
            })
            .collect())
    }

    async fn complete(
        &self,
        request: &CompletionRequest,
        cancel: &CancellationToken,
    ) -> Result<Completion, ProviderError> {
        let url = format!("{}/models/{}:generateContent", self.base_url, request.model);

        let mut body = serde_json::json!({
            "systemInstruction": { "parts": [{ "text": request.prompt.system }] },
            "contents": [{ "role": "user", "parts": [{ "text": request.prompt.user }] }],
            "generationConfig": {
                "temperature": request.prompt.params.temperature,
                "maxOutputTokens": request.prompt.params.max_output_tokens,
            },
        });

        crate::request_options::validate(ID, &self.request_overrides).map_err(|error| {
            ProviderError::RequestParameters {
                provider: ID,
                error,
            }
        })?;
        crate::request_options::merge(&mut body, &self.request_overrides);

        http::with_retry(cancel, |_attempt| {
            let request_future = self
                .client
                .post(&url)
                .header("x-goog-api-key", &self.api_key)
                .json(&body)
                .send();

            async move {
                let response = tokio::select! {
                    _ = cancel.cancelled() => return Err(ProviderError::Cancelled),
                    result = request_future => result.map_err(|err| http::map_transport_error(ID, &err))?,
                };

                let payload: GenerateContentResponse = http::error_for_status(ID, response)
                    .await?
                    .json()
                    .await
                    .map_err(|err| ProviderError::Malformed(err.to_string()))?;

                parse_completion(payload)
            }
        })
        .await
    }
}

fn parse_completion(payload: GenerateContentResponse) -> Result<Completion, ProviderError> {
    if let Some(feedback) = &payload.prompt_feedback {
        if let Some(reason) = &feedback.block_reason {
            return Err(ProviderError::Filtered {
                provider: ID,
                reason: Some(reason.clone()),
            });
        }
    }

    let candidate =
        payload.candidates.into_iter().next().ok_or_else(|| {
            ProviderError::Malformed("response contained no candidates".to_owned())
        })?;

    match candidate.finish_reason.as_deref() {
        Some("MAX_TOKENS") => return Err(ProviderError::Truncated),
        Some("SAFETY" | "PROHIBITED_CONTENT" | "BLOCKLIST") => {
            return Err(ProviderError::Filtered {
                provider: ID,
                reason: candidate.finish_reason,
            })
        }
        _ => {}
    }

    let text: String = candidate
        .content
        .map(|content| {
            content
                .parts
                .into_iter()
                .filter_map(|part| part.text)
                .collect()
        })
        .unwrap_or_default();

    if text.is_empty() {
        return Err(ProviderError::Malformed(
            "response contained no text".to_owned(),
        ));
    }

    Ok(Completion {
        text,
        usage: payload
            .usage_metadata
            .map(|usage| TokenUsage {
                input_tokens: usage.prompt_token_count,
                output_tokens: usage.candidates_token_count,
            })
            .unwrap_or_default(),
    })
}

#[derive(Debug, Deserialize)]
struct ModelListResponse {
    #[serde(default)]
    models: Vec<GeminiModel>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GeminiModel {
    name: String,
    display_name: Option<String>,
    #[serde(default)]
    supported_generation_methods: Vec<String>,
}

impl GeminiModel {
    fn short_name(&self) -> &str {
        self.name.strip_prefix("models/").unwrap_or(&self.name)
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GenerateContentResponse {
    #[serde(default)]
    candidates: Vec<Candidate>,
    usage_metadata: Option<UsageMetadata>,
    prompt_feedback: Option<PromptFeedback>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Candidate {
    content: Option<Content>,
    finish_reason: Option<String>,
}

#[derive(Debug, Deserialize)]
struct Content {
    #[serde(default)]
    parts: Vec<Part>,
}

#[derive(Debug, Deserialize)]
struct Part {
    text: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct UsageMetadata {
    #[serde(default)]
    prompt_token_count: u32,
    #[serde(default)]
    candidates_token_count: u32,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PromptFeedback {
    block_reason: Option<String>,
}

#[cfg(test)]
mod tests {
    use super::*;

    fn parse(json: serde_json::Value) -> Result<Completion, ProviderError> {
        parse_completion(serde_json::from_value(json).expect("fixture parses"))
    }

    #[test]
    fn extracts_text_and_usage() {
        let result = parse(serde_json::json!({
            "candidates": [{
                "content": { "parts": [{ "text": "I don't know." }] },
                "finishReason": "STOP"
            }],
            "usageMetadata": { "promptTokenCount": 12, "candidatesTokenCount": 5 }
        }))
        .expect("parses");

        assert_eq!(result.text, "I don't know.");
        assert_eq!(result.usage.input_tokens, 12);
        assert_eq!(result.usage.output_tokens, 5);
    }

    #[test]
    fn concatenates_multiple_parts() {
        let result = parse(serde_json::json!({
            "candidates": [{
                "content": { "parts": [{ "text": "one " }, { "text": "two" }] },
                "finishReason": "STOP"
            }]
        }))
        .expect("parses");
        assert_eq!(result.text, "one two");
    }

    #[test]
    fn missing_usage_is_zero_rather_than_an_error() {
        let result = parse(serde_json::json!({
            "candidates": [{ "content": { "parts": [{ "text": "hi" }] } }]
        }))
        .expect("parses");
        assert_eq!(result.usage, TokenUsage::default());
    }

    #[test]
    fn truncation_is_an_error_not_a_short_answer() {
        let result = parse(serde_json::json!({
            "candidates": [{
                "content": { "parts": [{ "text": "I don't kn" }] },
                "finishReason": "MAX_TOKENS"
            }]
        }));
        assert!(matches!(result, Err(ProviderError::Truncated)));
    }

    #[test]
    fn a_safety_finish_reason_is_reported_as_filtered() {
        let result = parse(serde_json::json!({
            "candidates": [{ "finishReason": "SAFETY" }]
        }));
        assert!(matches!(result, Err(ProviderError::Filtered { .. })));
    }

    #[test]
    fn a_prompt_level_block_is_reported_as_filtered() {
        let result = parse(serde_json::json!({
            "candidates": [],
            "promptFeedback": { "blockReason": "SAFETY" }
        }));
        assert!(matches!(result, Err(ProviderError::Filtered { .. })));
    }

    #[test]
    fn no_candidates_is_malformed() {
        let result = parse(serde_json::json!({ "candidates": [] }));
        assert!(matches!(result, Err(ProviderError::Malformed(_))));
    }

    #[test]
    fn empty_text_is_malformed() {
        let result = parse(serde_json::json!({
            "candidates": [{ "content": { "parts": [] }, "finishReason": "STOP" }]
        }));
        assert!(matches!(result, Err(ProviderError::Malformed(_))));
    }

    #[test]
    fn model_names_lose_their_prefix() {
        let model = GeminiModel {
            name: "models/gemini-2.5-flash".to_owned(),
            display_name: None,
            supported_generation_methods: vec![],
        };
        assert_eq!(model.short_name(), "gemini-2.5-flash");
    }
}
