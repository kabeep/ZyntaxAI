const MARKERS: [&str; 2] = ["<<<ZYNTAX_TEXT>>>", "<<</ZYNTAX_TEXT>>>"];

/// Custom instructions own formatting; default personas retain correction cleanup.
pub fn process_model_output(raw: &str, original: &str, custom_instructions: bool) -> String {
    if custom_instructions {
        raw.to_owned()
    } else {
        clean_model_output(raw, original)
    }
}

pub fn clean_model_output(raw: &str, original: &str) -> String {
    if original.trim().is_empty() {
        return original.to_owned();
    }

    let mut text = raw.to_owned();

    for marker in MARKERS {
        text = text.replace(marker, "");
    }

    let mut body = text.trim();

    if !original.trim_start().starts_with("```") {
        if let Some(unfenced) = strip_code_fence(body) {
            body = unfenced;
        }
    }

    let leading = &original[..original.len() - original.trim_start().len()];
    let trailing = &original[original.trim_end().len()..];

    format!("{leading}{body}{trailing}")
}

fn strip_code_fence(text: &str) -> Option<&str> {
    let rest = text.strip_prefix("```")?;

    let (_, after_first_line) = rest.split_once('\n')?;
    let inner = after_first_line.strip_suffix("```")?;
    Some(inner.trim_end_matches('\n'))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn passes_clean_output_through() {
        assert_eq!(
            clean_model_output("I don't know.", "i dont know."),
            "I don't know."
        );
    }

    #[test]
    fn strips_echoed_delimiters() {
        let raw = "<<<ZYNTAX_TEXT>>>\nI don't know.\n<<</ZYNTAX_TEXT>>>";
        assert_eq!(clean_model_output(raw, "i dont know."), "I don't know.");
    }

    #[test]
    fn strips_a_fence_the_model_added() {
        let raw = "```\nI don't know.\n```";
        assert_eq!(clean_model_output(raw, "i dont know."), "I don't know.");
    }

    #[test]
    fn strips_a_fence_with_a_language_tag() {
        let raw = "```text\nI don't know.\n```";
        assert_eq!(clean_model_output(raw, "i dont know."), "I don't know.");
    }

    #[test]
    fn keeps_a_fence_the_user_selected() {
        let original = "```rust\nfn mian() {}\n```";
        let raw = "```rust\nfn main() {}\n```";
        assert_eq!(clean_model_output(raw, original), raw);
    }

    #[test]
    fn restores_surrounding_whitespace_of_the_selection() {
        let original = "  i dont know  ";
        assert_eq!(
            clean_model_output("I don't know", original),
            "  I don't know  "
        );
    }

    #[test]
    fn restores_a_trailing_newline() {
        let original = "first line\nsecond lien\n";
        let cleaned = clean_model_output("first line\nsecond line", original);
        assert_eq!(cleaned, "first line\nsecond line\n");
    }

    #[test]
    fn preserves_interior_structure() {
        let original = "- one\n- tow\n- three";
        let raw = "- one\n- two\n- three";
        assert_eq!(clean_model_output(raw, original), raw);
    }

    #[test]
    fn handles_empty_response() {
        assert_eq!(clean_model_output("", "  x  "), "    ");
    }

    #[test]
    fn whitespace_only_original_is_returned_untouched() {
        assert_eq!(clean_model_output("anything", "   "), "   ");
    }

    #[test]
    fn handles_multibyte_leading_whitespace() {
        let original = "\u{00a0}ich hab kein zeit ";
        let cleaned = clean_model_output("ich habe keine Zeit", original);
        assert_eq!(cleaned, "\u{00a0}ich habe keine Zeit ");
    }
}

#[cfg(test)]
mod custom_output_tests {
    use super::*;
    #[test]
    fn custom_output_preserves_fences_markers_and_whitespace() {
        let raw = " \n```text\n<<<ZYNTAX_TEXT>>> whats up\n```\n ";
        assert_eq!(process_model_output(raw, "original", true), raw);
        assert_eq!(process_model_output(raw, "original", false), " whats up");
    }
}
