use crate::error::ProviderError;
use crate::http;
use crate::{Completion, CompletionRequest, ModelInfo, Provider};
use async_trait::async_trait;
use serde::Deserialize;
use tokio_util::sync::CancellationToken;
use zyntax_core::{ProviderId, TokenUsage};

const ID: ProviderId = ProviderId::OpenAiCompatible;

pub struct OpenAiCompatible {
    client: reqwest::Client,
    base_url: String,
    request_overrides: serde_json::Value,
    api_key: String,
}

impl OpenAiCompatible {
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
impl Provider for OpenAiCompatible {
    fn id(&self) -> ProviderId {
        ID
    }

    async fn list_models(&self) -> Result<Vec<ModelInfo>, ProviderError> {
        let response = self
            .client
            .get(format!("{}/models", self.base_url))
            .bearer_auth(&self.api_key)
            .send()
            .await
            .map_err(|err| http::map_transport_error(ID, &err))?;

        let body: ModelListResponse = http::error_for_status(ID, response)
            .await?
            .json()
            .await
            .map_err(|err| ProviderError::Malformed(err.to_string()))?;

        let mut models: Vec<ModelInfo> = body
            .data
            .into_iter()
            .map(|m| ModelInfo::new(m.id))
            .collect();

        models.sort_by(|a, b| a.id.cmp(&b.id));
        Ok(models)
    }

    async fn complete(
        &self,
        request: &CompletionRequest,
        cancel: &CancellationToken,
    ) -> Result<Completion, ProviderError> {
        let url = format!("{}/chat/completions", self.base_url);

        let mut body = serde_json::json!({
            "model": request.model,
            "messages": [
                { "role": "system", "content": request.prompt.system },
                { "role": "user", "content": request.prompt.user },
            ],
            "temperature": request.prompt.params.temperature,


            "max_tokens": request.prompt.params.max_output_tokens,
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
                .bearer_auth(&self.api_key)
                .json(&body)
                .send();

            async move {
                let response = tokio::select! {
                    _ = cancel.cancelled() => return Err(ProviderError::Cancelled),
                    result = request_future => result.map_err(|err| http::map_transport_error(ID, &err))?,
                };

                let payload: ChatCompletionResponse = http::error_for_status(ID, response)
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

fn parse_completion(payload: ChatCompletionResponse) -> Result<Completion, ProviderError> {
    let choice = payload
        .choices
        .into_iter()
        .next()
        .ok_or_else(|| ProviderError::Malformed("response contained no choices".to_owned()))?;

    match choice.finish_reason.as_deref() {
        Some("length") => return Err(ProviderError::Truncated),
        Some("content_filter") => {
            return Err(ProviderError::Filtered {
                provider: ID,
                reason: Some("content_filter".to_owned()),
            })
        }
        _ => {}
    }

    let text = choice
        .message
        .and_then(|message| message.content)
        .unwrap_or_default();

    if text.is_empty() {
        return Err(ProviderError::Malformed(
            "response contained no text".to_owned(),
        ));
    }

    Ok(Completion {
        text,
        usage: payload
            .usage
            .map(|usage| TokenUsage {
                input_tokens: usage.prompt_tokens,
                output_tokens: usage.completion_tokens,
            })
            .unwrap_or_default(),
    })
}

#[derive(Debug, Deserialize)]
struct ModelListResponse {
    #[serde(default)]
    data: Vec<ModelEntry>,
}

#[derive(Debug, Deserialize)]
struct ModelEntry {
    id: String,
}

#[derive(Debug, Deserialize)]
struct ChatCompletionResponse {
    #[serde(default)]
    choices: Vec<Choice>,
    usage: Option<Usage>,
}

#[derive(Debug, Deserialize)]
struct Choice {
    message: Option<Message>,
    finish_reason: Option<String>,
}

#[derive(Debug, Deserialize)]
struct Message {
    content: Option<String>,
}

#[derive(Debug, Deserialize)]
struct Usage {
    #[serde(default)]
    prompt_tokens: u32,
    #[serde(default)]
    completion_tokens: u32,
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
            "choices": [{
                "message": { "role": "assistant", "content": "I don't know." },
                "finish_reason": "stop"
            }],
            "usage": { "prompt_tokens": 20, "completion_tokens": 6 }
        }))
        .expect("parses");

        assert_eq!(result.text, "I don't know.");
        assert_eq!(result.usage.input_tokens, 20);
        assert_eq!(result.usage.output_tokens, 6);
    }

    #[test]
    fn a_length_finish_reason_is_truncation() {
        let result = parse(serde_json::json!({
            "choices": [{
                "message": { "content": "I don't kn" },
                "finish_reason": "length"
            }]
        }));
        assert!(matches!(result, Err(ProviderError::Truncated)));
    }

    #[test]
    fn a_content_filter_is_reported_as_filtered() {
        let result = parse(serde_json::json!({
            "choices": [{ "finish_reason": "content_filter" }]
        }));
        assert!(matches!(result, Err(ProviderError::Filtered { .. })));
    }

    #[test]
    fn no_choices_is_malformed() {
        assert!(matches!(
            parse(serde_json::json!({ "choices": [] })),
            Err(ProviderError::Malformed(_))
        ));
    }

    #[test]
    fn empty_content_is_malformed() {
        let result = parse(serde_json::json!({
            "choices": [{ "message": { "content": "" }, "finish_reason": "stop" }]
        }));
        assert!(matches!(result, Err(ProviderError::Malformed(_))));
    }

    #[test]
    fn missing_usage_is_tolerated() {
        let result = parse(serde_json::json!({
            "choices": [{ "message": { "content": "ok" }, "finish_reason": "stop" }]
        }))
        .expect("parses");
        assert_eq!(result.usage, TokenUsage::default());
    }
}
