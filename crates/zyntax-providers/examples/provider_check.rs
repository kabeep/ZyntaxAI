use tokio_util::sync::CancellationToken;
use zyntax_core::{
    auto_language, builtin_persona, clean_model_output, PromptSpec, ProviderId, ProviderProfile,
    Speed, DEFAULT_PERSONA_ID,
};
use zyntax_providers::CompletionRequest;

const INPUT: &str = "she dont know weather its correct, but their going too try it anyway";

#[tokio::main]
async fn main() {
    let mut failures = 0;

    failures += check(
        "Ollama (native API)",
        ProviderProfile {
            id: ProviderId::Ollama,
            base_url: None,
            model: "qwen2.5:7b".to_owned(),
            request_overrides: serde_json::json!({}),
        },
        None,
    )
    .await;

    failures += check(
        "OpenAI-compatible (via Ollama /v1)",
        ProviderProfile {
            id: ProviderId::OpenAiCompatible,
            base_url: Some("http://localhost:11434/v1".to_owned()),
            model: "qwen2.5:7b".to_owned(),
            request_overrides: serde_json::json!({}),
        },
        Some("ollama-ignores-this".to_owned()),
    )
    .await;

    match std::env::var("GEMINI_API_KEY") {
        Ok(key) if !key.trim().is_empty() => {
            failures += check(
                "Google Gemini",
                ProviderProfile {
                    id: ProviderId::Gemini,
                    base_url: None,
                    model: std::env::var("GEMINI_MODEL")
                        .unwrap_or_else(|_| "gemini-2.5-flash".to_owned()),
                    request_overrides: serde_json::json!({}),
                },
                Some(key),
            )
            .await;
        }
        _ => println!(
            "\n### Google Gemini — SKIPPED (set GEMINI_API_KEY to include it; it is NOT verified \
             live without one)"
        ),
    }

    println!("\n{}", "=".repeat(78));
    if failures == 0 {
        println!("all attempted providers succeeded");
    } else {
        println!("{failures} provider(s) FAILED");
        std::process::exit(1);
    }
}

async fn check(label: &str, profile: ProviderProfile, api_key: Option<String>) -> u32 {
    println!("\n{}", "=".repeat(78));
    println!("### {label}");
    println!("endpoint: {}", profile.base_url());

    let provider = match zyntax_providers::build(&profile, api_key) {
        Ok(provider) => provider,
        Err(err) => {
            println!("  build FAILED: {err}\n  remedy: {}", err.remedy());
            return 1;
        }
    };

    match provider.list_models().await {
        Ok(models) => {
            let names: Vec<&str> = models.iter().take(5).map(|m| m.id.as_str()).collect();
            println!(
                "  list_models: {} model(s) — {}",
                models.len(),
                names.join(", ")
            );
        }
        Err(err) => {
            println!("  list_models FAILED: {err}\n  remedy: {}", err.remedy());
            return 1;
        }
    }

    let persona = builtin_persona(DEFAULT_PERSONA_ID).expect("default persona");
    let language = auto_language();
    let prompt = PromptSpec {
        persona: &persona,
        language: &language,
        translate: false,
        speed: Speed::Normal,
    }
    .build(INPUT)
    .expect("prompt builds");

    let started = std::time::Instant::now();
    match provider
        .complete(
            &CompletionRequest {
                model: profile.model.clone(),
                prompt,
            },
            &CancellationToken::new(),
        )
        .await
    {
        Ok(completion) => {
            println!(
                "  complete:    {} in / {} out tokens, {:.1}s",
                completion.usage.input_tokens,
                completion.usage.output_tokens,
                started.elapsed().as_secs_f32()
            );
            println!("  in:  {INPUT}");
            println!("  out: {}", clean_model_output(&completion.text, INPUT));
            0
        }
        Err(err) => {
            println!("  complete FAILED: {err}\n  remedy: {}", err.remedy());
            1
        }
    }
}
