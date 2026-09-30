use tokio_util::sync::CancellationToken;
use zyntax_core::{
    auto_language, builtin_personas, clean_model_output, PromptSpec, ProviderId, ProviderProfile,
    Speed,
};
use zyntax_providers::CompletionRequest;

const DEFAULT_INPUT: &str = "hey so i was thinking maybe we could possibly meet up sometime next \
                             week to talk about the thing we discussed, if thats ok with you \
                             obviously";

#[tokio::main]
async fn main() {
    let language = auto_language();
    let profile = ProviderProfile {
        id: ProviderId::Ollama,
        base_url: None,
        model: std::env::args()
            .nth(1)
            .unwrap_or_else(|| "qwen2.5:7b".to_owned()),
        request_overrides: serde_json::json!({}),
    };

    let input = std::env::args()
        .nth(2)
        .unwrap_or_else(|| DEFAULT_INPUT.to_owned());

    println!("model:  {}", profile.model);
    println!("input:  {input}\n");
    println!("{}", "=".repeat(78));

    for persona in builtin_personas() {
        let prompt = PromptSpec {
            persona: &persona,
            language: &language,
            translate: false,
            speed: Speed::Normal,
        }
        .build(&input)
        .expect("prompt builds");

        let provider = zyntax_providers::build(&profile, None).expect("provider builds");
        let started = std::time::Instant::now();

        let result = provider
            .complete(
                &CompletionRequest {
                    model: profile.model.clone(),
                    prompt,
                },
                &CancellationToken::new(),
            )
            .await;

        match result {
            Ok(completion) => {
                let text = clean_model_output(&completion.text, &input);
                println!(
                    "\n### {} ({:.1}s)",
                    persona.name,
                    started.elapsed().as_secs_f32()
                );
                println!("{text}");
            }
            Err(err) => println!("\n### {} — FAILED: {err}", persona.name),
        }
    }

    println!("\n{}", "=".repeat(78));
}
