use crate::error::ProviderError;
use crate::http;
use crate::{Completion, CompletionRequest, ModelInfo, Provider};
use async_trait::async_trait;
use serde::Deserialize;
use tokio_util::sync::CancellationToken;
use zyntax_core::{ProviderId, TokenUsage};

const ID: ProviderId = ProviderId::Ollama;

pub struct Ollama {
    client: reqwest::Client,
    base_url: String,
    request_overrides: serde_json::Value,
}

impl Ollama {
    pub fn new(
        base_url: String,
        request_overrides: serde_json::Value,
    ) -> Result<Self, ProviderError> {
        Ok(Self {
            client: http::client()?,
            base_url,
            request_overrides,
        })
    }
}

#[async_trait]
impl Provider for Ollama {
    fn id(&self) -> ProviderId {
        ID
    }

    async fn list_models(&self) -> Result<Vec<ModelInfo>, ProviderError> {
        let response = self
            .client
            .get(format!("{}/api/tags", self.base_url))
            .send()
            .await
            .map_err(|err| http::map_transport_error(ID, &err))?;

        let body: TagsResponse = http::error_for_status(ID, response)
            .await?
            .json()
            .await
            .map_err(|err| ProviderError::Malformed(err.to_string()))?;

        let mut models: Vec<ModelInfo> = body
            .models
            .into_iter()
            .map(|model| ModelInfo::new(model.name))
            .collect();
        models.sort_by(|a, b| a.id.cmp(&b.id));
        Ok(models)
    }

    async fn complete(
        &self,
        request: &CompletionRequest,
        cancel: &CancellationToken,
    ) -> Result<Completion, ProviderError> {
        let url = format!("{}/api/chat", self.base_url);

        let mut body = serde_json::json!({
            "model": request.model,
            "messages": [
                { "role": "system", "content": request.prompt.system },
                { "role": "user", "content": request.prompt.user },
            ],
            "stream": false,
            "options": {
                "temperature": request.prompt.params.temperature,
                "num_predict": request.prompt.params.max_output_tokens,
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
            let request_future = self.client.post(&url).json(&body).send();

            async move {
                let response = tokio::select! {
                    _ = cancel.cancelled() => return Err(ProviderError::Cancelled),
                    result = request_future => result.map_err(|err| http::map_transport_error(ID, &err))?,
                };

                let payload: ChatResponse = http::error_for_status(ID, response)
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

fn parse_completion(payload: ChatResponse) -> Result<Completion, ProviderError> {
    if payload.done_reason.as_deref() == Some("length") {
        return Err(ProviderError::Truncated);
    }

    let text = payload
        .message
        .map(|message| message.content)
        .unwrap_or_default();

    if text.is_empty() {
        return Err(ProviderError::Malformed(
            "response contained no text".to_owned(),
        ));
    }

    Ok(Completion {
        text,
        usage: TokenUsage {
            input_tokens: payload.prompt_eval_count,
            output_tokens: payload.eval_count,
        },
    })
}

#[derive(Debug, Deserialize)]
struct TagsResponse {
    #[serde(default)]
    models: Vec<TagEntry>,
}

#[derive(Debug, Deserialize)]
struct TagEntry {
    name: String,
}

#[derive(Debug, Deserialize)]
struct ChatResponse {
    message: Option<ChatMessage>,
    done_reason: Option<String>,
    #[serde(default)]
    prompt_eval_count: u32,
    #[serde(default)]
    eval_count: u32,
}

#[derive(Debug, Deserialize)]
struct ChatMessage {
    content: String,
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
            "message": { "role": "assistant", "content": "I don't know." },
            "done": true,
            "done_reason": "stop",
            "prompt_eval_count": 18,
            "eval_count": 7
        }))
        .expect("parses");

        assert_eq!(result.text, "I don't know.");
        assert_eq!(result.usage.input_tokens, 18);
        assert_eq!(result.usage.output_tokens, 7);
    }

    #[test]
    fn a_length_stop_is_truncation() {
        let result = parse(serde_json::json!({
            "message": { "content": "I don't kn" },
            "done_reason": "length"
        }));
        assert!(matches!(result, Err(ProviderError::Truncated)));
    }

    #[test]
    fn a_missing_message_is_malformed() {
        assert!(matches!(
            parse(serde_json::json!({ "done": true })),
            Err(ProviderError::Malformed(_))
        ));
    }

    #[test]
    fn counts_default_to_zero_when_absent() {
        let result = parse(serde_json::json!({
            "message": { "content": "ok" }
        }))
        .expect("parses");
        assert_eq!(result.usage, TokenUsage::default());
    }
}
