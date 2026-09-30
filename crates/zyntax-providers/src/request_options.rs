//! Strict draft parsing, provider-specific validation and request-body merging.
use serde::de::{self, DeserializeSeed, MapAccess, SeqAccess, Visitor};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::fmt;
use ts_rs::TS;
use zyntax_core::ProviderId;

pub const MAX_BYTES: usize = 64 * 1024;
pub const MAX_DEPTH: usize = 16;
const MAX_SAFE_INTEGER: f64 = 9_007_199_254_740_991.0;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS, thiserror::Error)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
#[error("{path}: {message}")]
pub struct RequestParameterError {
    pub path: String,
    pub message: String,
    pub line: Option<usize>,
    pub column: Option<usize>,
}

fn invalid(path: &str, message: &str) -> RequestParameterError {
    RequestParameterError {
        path: path.to_owned(),
        message: message.to_owned(),
        line: None,
        column: None,
    }
}

pub fn parse(provider: ProviderId, draft: &str) -> Result<Value, RequestParameterError> {
    if draft.len() > MAX_BYTES {
        return Err(invalid("$", "Use at most 64 KiB of UTF-8 JSON."));
    }
    if draft.trim().is_empty() {
        return Ok(serde_json::json!({}));
    }
    let mut parser = serde_json::Deserializer::from_str(draft);
    let value = StrictValue {
        depth: 0,
        path: "$".to_owned(),
    }
    .deserialize(&mut parser)
    .and_then(|value| {
        parser.end()?;
        Ok(value)
    })
    .map_err(|err| RequestParameterError {
        path: "$".to_owned(),
        // Parser diagnostics describe syntax or field paths, never the draft.
        message: if err.to_string().starts_with("Duplicate key")
            || err.to_string().starts_with("Nesting")
        {
            err.to_string()
        } else {
            "Invalid JSON. Use an object without comments or trailing commas.".to_owned()
        },
        line: Some(err.line()),
        column: Some(err.column()),
    })?;
    validate(provider, &value)?;
    Ok(value)
}

struct StrictValue {
    depth: usize,
    path: String,
}

impl<'de> DeserializeSeed<'de> for StrictValue {
    type Value = Value;
    fn deserialize<D: de::Deserializer<'de>>(self, deserializer: D) -> Result<Value, D::Error> {
        deserializer.deserialize_any(self)
    }
}

impl<'de> Visitor<'de> for StrictValue {
    type Value = Value;
    fn expecting(&self, f: &mut fmt::Formatter) -> fmt::Result {
        f.write_str("a JSON value")
    }
    fn visit_bool<E: de::Error>(self, v: bool) -> Result<Value, E> {
        Ok(Value::Bool(v))
    }
    fn visit_i64<E: de::Error>(self, v: i64) -> Result<Value, E> {
        Ok(v.into())
    }
    fn visit_u64<E: de::Error>(self, v: u64) -> Result<Value, E> {
        Ok(v.into())
    }
    fn visit_f64<E: de::Error>(self, v: f64) -> Result<Value, E> {
        serde_json::Number::from_f64(v)
            .map(Value::Number)
            .ok_or_else(|| E::custom("Non-finite number"))
    }
    fn visit_str<E: de::Error>(self, v: &str) -> Result<Value, E> {
        Ok(Value::String(v.to_owned()))
    }
    fn visit_string<E: de::Error>(self, v: String) -> Result<Value, E> {
        Ok(Value::String(v))
    }
    fn visit_unit<E: de::Error>(self) -> Result<Value, E> {
        Ok(Value::Null)
    }
    fn visit_seq<A: SeqAccess<'de>>(self, mut seq: A) -> Result<Value, A::Error> {
        if self.depth >= MAX_DEPTH {
            return Err(de::Error::custom("Nesting exceeds 16 levels"));
        }
        let mut values = Vec::new();
        while let Some(value) = seq.next_element_seed(StrictValue {
            depth: self.depth + 1,
            path: format!("{}[{}]", self.path, values.len()),
        })? {
            values.push(value);
        }
        Ok(Value::Array(values))
    }
    fn visit_map<A: MapAccess<'de>>(self, mut map: A) -> Result<Value, A::Error> {
        if self.depth >= MAX_DEPTH {
            return Err(de::Error::custom("Nesting exceeds 16 levels"));
        }
        let mut values = Map::new();
        while let Some(key) = map.next_key::<String>()? {
            let path = format!("{}.{}", self.path, key);
            if values.contains_key(&key) {
                return Err(de::Error::custom(format!("Duplicate key at {path}")));
            }
            let value = map.next_value_seed(StrictValue {
                depth: self.depth + 1,
                path,
            })?;
            values.insert(key, value);
        }
        Ok(Value::Object(values))
    }
}

pub fn validate(provider: ProviderId, value: &Value) -> Result<(), RequestParameterError> {
    let object = value
        .as_object()
        .ok_or_else(|| invalid("$", "Request parameters must be a JSON object."))?;
    if serde_json::to_vec(value)
        .map_err(|_| invalid("$", "Invalid JSON."))?
        .len()
        > MAX_BYTES
    {
        return Err(invalid("$", "Use at most 64 KiB of UTF-8 JSON."));
    }
    validate_tree(value, "$", 0)?;
    let reserved: &[&str] = match provider {
        ProviderId::OpenAiCompatible => &[
            "model",
            "messages",
            "stream",
            "stream_options",
            "n",
            "tools",
            "tool_choice",
            "parallel_tool_calls",
            "functions",
            "function_call",
            "modalities",
            "audio",
            "response_format",
        ],
        ProviderId::Ollama => &["model", "messages", "stream", "tools", "format"],
        ProviderId::Gemini => &[
            "model",
            "contents",
            "systemInstruction",
            "tools",
            "toolConfig",
        ],
    };
    for key in object.keys() {
        if reserved.contains(&key.as_str()) {
            return Err(invalid(
                &format!("$.{key}"),
                "This field is managed by the application or changes the response protocol.",
            ));
        }
        if [
            "headers",
            "Authorization",
            "authorization",
            "api_key",
            "apiKey",
            "endpoint",
            "base_url",
            "baseUrl",
            "extra_body",
        ]
        .contains(&key.as_str())
        {
            return Err(invalid(&format!("$.{key}"), "Enter body fields directly; use Authentication and Endpoint for credentials and URLs."));
        }
    }
    let (fields, prefix) = match provider {
        ProviderId::OpenAiCompatible => (object, "$"),
        ProviderId::Ollama => (object_field(object, "options")?, "$.options"),
        ProviderId::Gemini => (
            object_field(object, "generationConfig")?,
            "$.generationConfig",
        ),
    };
    let (temperature, top_p, tokens) = match provider {
        ProviderId::OpenAiCompatible => (
            "temperature",
            "top_p",
            &["max_tokens", "max_completion_tokens"][..],
        ),
        ProviderId::Ollama => ("temperature", "top_p", &["num_predict"][..]),
        ProviderId::Gemini => ("temperature", "topP", &["maxOutputTokens"][..]),
    };
    for key in [temperature, top_p] {
        if fields.get(key).is_some_and(|v| !v.is_number()) {
            return Err(invalid(
                &format!("{prefix}.{key}"),
                "Use a finite JSON number.",
            ));
        }
    }
    for key in tokens {
        if fields
            .get(*key)
            .is_some_and(|v| !v.as_f64().is_some_and(|n| n > 0.0 && n.fract() == 0.0))
        {
            return Err(invalid(
                &format!("{prefix}.{key}"),
                "Use a positive integer token budget.",
            ));
        }
    }
    if provider == ProviderId::Gemini {
        for key in [
            "candidateCount",
            "responseModalities",
            "responseMimeType",
            "responseSchema",
            "responseJsonSchema",
        ] {
            if fields.contains_key(key) {
                return Err(invalid(
                    &format!("{prefix}.{key}"),
                    "Multiple candidates and alternative response protocols are not supported.",
                ));
            }
        }
    }
    Ok(())
}

fn object_field<'a>(
    object: &'a Map<String, Value>,
    key: &str,
) -> Result<&'a Map<String, Value>, RequestParameterError> {
    match object.get(key) {
        Some(Value::Object(fields)) => Ok(fields),
        Some(_) => Err(invalid(&format!("$.{key}"), "Use a JSON object.")),
        None => {
            static EMPTY: std::sync::OnceLock<Map<String, Value>> = std::sync::OnceLock::new();
            Ok(EMPTY.get_or_init(Map::new))
        }
    }
}

fn validate_tree(value: &Value, path: &str, depth: usize) -> Result<(), RequestParameterError> {
    match value {
        Value::Object(object) => {
            if depth >= MAX_DEPTH {
                return Err(invalid(path, "Nesting exceeds 16 levels."));
            }
            for (key, child) in object {
                validate_tree(child, &format!("{path}.{key}"), depth + 1)?;
            }
        }
        Value::Array(values) => {
            if depth >= MAX_DEPTH {
                return Err(invalid(path, "Nesting exceeds 16 levels."));
            }
            for (index, child) in values.iter().enumerate() {
                validate_tree(child, &format!("{path}[{index}]"), depth + 1)?;
            }
        }
        Value::Number(number) => {
            let n = number
                .as_f64()
                .ok_or_else(|| invalid(path, "Use a finite number."))?;
            if !n.is_finite() || (n.fract() == 0.0 && n.abs() > MAX_SAFE_INTEGER) {
                return Err(invalid(
                    path,
                    "Integers must be within JavaScript's safe integer range.",
                ));
            }
        }
        _ => {}
    }
    Ok(())
}

/// Objects merge recursively; arrays, scalars and null replace their path.
pub fn merge(base: &mut Value, overrides: &Value) {
    if let (Some(base), Some(overrides)) = (base.as_object_mut(), overrides.as_object()) {
        for (key, value) in overrides {
            merge(base.entry(key.clone()).or_insert(Value::Null), value);
        }
    } else {
        *base = overrides.clone();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    const ID: ProviderId = ProviderId::OpenAiCompatible;

    #[test]
    fn blank_and_empty_objects_do_not_change_defaults() {
        for draft in ["", " \n\t", "{}"] {
            let overrides = parse(ID, draft).expect("empty");
            let mut body = json!({"temperature": 0.3, "max_tokens": 1024});
            let original = body.clone();
            merge(&mut body, &overrides);
            assert_eq!(body, original);
        }
    }

    #[test]
    fn only_strict_root_objects_are_accepted() {
        for draft in [
            "null",
            "[]",
            "1",
            "\"text\"",
            "{\"x\":1,}",
            "{/*comment*/}",
            "```json\n{}\n```",
            "{} {}",
        ] {
            assert!(parse(ID, draft).is_err(), "{draft}");
        }
        let error = parse(ID, "{\n  \"x\":\n}").expect_err("invalid");
        assert!(error.line.is_some());
        assert!(error.column.is_some());
    }

    #[test]
    fn duplicate_keys_including_escaped_and_nested_keys_are_rejected() {
        for draft in [
            r#"{"temperature":1,"temperature":2}"#,
            r#"{"custom":{"x":1,"\u0078":2}}"#,
            r#"{"custom":[{"x":1,"x":2}]}"#,
        ] {
            assert!(parse(ID, draft)
                .expect_err("duplicate")
                .message
                .contains("Duplicate key"));
        }
        assert!(parse(ID, r#"{"a":{"x":1},"b":{"x":2}}"#).is_ok());
    }

    #[test]
    fn byte_limit_counts_utf8_and_depth_counts_containers() {
        assert!(parse(
            ID,
            &format!(r#"{{"note":"{}"}}"#, "文".repeat(MAX_BYTES / 3))
        )
        .is_err());
        let mut value = json!(0);
        for _ in 0..MAX_DEPTH {
            value = json!({"x":value});
        }
        assert!(validate(ID, &value).is_ok());
        assert!(parse(ID, &value.to_string()).is_ok());
        let too_deep = json!({"x":value});
        assert!(validate(ID, &too_deep).is_err());
        assert!(parse(ID, &too_deep.to_string()).is_err());
    }

    #[test]
    fn unsafe_numbers_are_rejected_before_ipc_round_trips() {
        for draft in [
            r#"{"x":9007199254740992}"#,
            r#"{"x":-9007199254740992}"#,
            r#"{"x":1e400}"#,
        ] {
            assert!(parse(ID, draft).is_err());
        }
        assert!(parse(ID, r#"{"x":9007199254740991,"fraction":0.75}"#).is_ok());
    }

    #[test]
    fn managed_fields_and_credential_wrappers_are_rejected_by_path() {
        for id in ProviderId::ALL {
            for key in [
                "model",
                "headers",
                "Authorization",
                "api_key",
                "endpoint",
                "extra_body",
            ] {
                assert_eq!(
                    validate(id, &json!({key: null}))
                        .expect_err("reserved")
                        .path,
                    format!("$.{key}")
                );
                assert!(validate(id, &json!({"custom": {key: "data"}})).is_ok());
            }
        }
        for key in ["messages", "stream", "n", "tools", "response_format"] {
            assert!(validate(ID, &json!({key: null})).is_err());
        }
        assert!(validate(ProviderId::Ollama, &json!({"stream":false})).is_err());
        assert!(validate(
            ProviderId::Gemini,
            &json!({"generationConfig":{"candidateCount":1}})
        )
        .is_err());
        assert!(validate(ProviderId::Gemini, &json!({"systemInstruction":{}})).is_err());
    }

    #[test]
    fn known_fields_use_provider_specific_types_without_a_temperature_cap() {
        for (id, valid, invalid) in [
            (
                ID,
                json!({"temperature":4.0,"max_tokens":2048}),
                json!({"temperature":"0.7"}),
            ),
            (
                ProviderId::Ollama,
                json!({"think":false,"options":{"temperature":0.0,"num_predict":2048}}),
                json!({"options":null}),
            ),
            (
                ProviderId::Gemini,
                json!({"generationConfig":{"temperature":0.7,"maxOutputTokens":2048,"thinkingConfig":{"thinkingBudget":0}}}),
                json!({"generationConfig":{"maxOutputTokens":0}}),
            ),
        ] {
            assert!(validate(id, &valid).is_ok());
            assert!(validate(id, &invalid).is_err());
        }
        for tokens in [json!(null), json!(0), json!(-1), json!(1.5), json!("1024")] {
            assert!(validate(ID, &json!({"max_tokens":tokens})).is_err());
        }
    }

    #[test]
    fn merging_preserves_unspecified_defaults_and_literal_values() {
        let mut base =
            json!({"options":{"temperature":0.3,"num_predict":1024},"custom":[1,2],"keep":true});
        let overrides = json!({"options":{"temperature":0},"custom":[false,null],"note":"a  b\nc 日本語","unset":null});
        merge(&mut base, &overrides);
        assert_eq!(
            base,
            json!({"options":{"temperature":0,"num_predict":1024},"custom":[false,null],"keep":true,"note":"a  b\nc 日本語","unset":null})
        );
        assert_eq!(overrides["options"]["temperature"], 0);
    }
}
