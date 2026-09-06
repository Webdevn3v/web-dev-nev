// Jarvie — Phase C: the native side of the LLM seam. Spec: docs/JARVIE-PHASE-C.md.
//
// This module is the ONLY place the Anthropic API key is read, and the ONLY place an outbound
// HTTPS request is made. The renderer never persists the key and never makes the network call
// (see jarvieLLM.js). Every command here degrades to a plain error result the renderer treats
// as "answer locally" — the LLM is never on Jarvie's critical path.

use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

fn data_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path().app_local_data_dir().map_err(|e| e.to_string())
}
fn key_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(data_dir(app)?.join("jarvie-anthropic.key"))
}
fn model_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(data_dir(app)?.join("jarvie-model.txt"))
}
fn enabled_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(data_dir(app)?.join("jarvie-enabled.txt"))
}

fn read_trim(p: &PathBuf) -> Option<String> {
    std::fs::read_to_string(p)
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

fn write_file(p: &PathBuf, contents: &str) -> Result<(), String> {
    if let Some(d) = p.parent() {
        std::fs::create_dir_all(d).map_err(|e| e.to_string())?;
    }
    std::fs::write(p, contents).map_err(|e| e.to_string())
}

#[cfg(unix)]
fn lock_down(p: &PathBuf) {
    use std::os::unix::fs::PermissionsExt;
    let _ = std::fs::set_permissions(p, std::fs::Permissions::from_mode(0o600));
}
#[cfg(not(unix))]
fn lock_down(_p: &PathBuf) {}

fn model_id(short: &str) -> &'static str {
    match short {
        "sonnet" => "claude-sonnet-5",
        "opus" => "claude-opus-5",
        _ => "claude-haiku-4-5",
    }
}

// ---------------------------------------------------------------- config commands

#[derive(Serialize)]
pub struct LlmStatus {
    has_key: bool,
    model: String,
    enabled: bool,
}

#[tauri::command]
pub fn jarvie_llm_status(app: AppHandle) -> Result<LlmStatus, String> {
    let has_key = read_trim(&key_path(&app)?).is_some();
    let model = read_trim(&model_path(&app)?).unwrap_or_else(|| "haiku".to_string());
    let enabled = read_trim(&enabled_path(&app)?).map(|s| s == "1").unwrap_or(false);
    Ok(LlmStatus { has_key, model, enabled })
}

#[tauri::command]
pub fn jarvie_llm_set_key(app: AppHandle, key: String) -> Result<(), String> {
    let key = key.trim();
    if key.is_empty() {
        return Err("Key is empty.".to_string());
    }
    let p = key_path(&app)?;
    write_file(&p, key)?;
    lock_down(&p);
    Ok(())
}

#[tauri::command]
pub fn jarvie_llm_clear_key(app: AppHandle) -> Result<(), String> {
    let p = key_path(&app)?;
    if p.exists() {
        std::fs::remove_file(&p).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn jarvie_llm_set_model(app: AppHandle, model: String) -> Result<(), String> {
    match model.as_str() {
        "haiku" | "sonnet" | "opus" => write_file(&model_path(&app)?, &model),
        _ => Err("Unknown model.".to_string()),
    }
}

#[tauri::command]
pub fn jarvie_llm_set_enabled(app: AppHandle, enabled: bool) -> Result<(), String> {
    write_file(&enabled_path(&app)?, if enabled { "1" } else { "0" })
}

// ---------------------------------------------------------------- the API call

#[derive(Deserialize)]
pub struct AskReq {
    system: String,
    user: String,
    max_tokens: u32,
    #[serde(default)]
    format: Option<serde_json::Value>,
}

#[derive(Serialize)]
pub struct AskResp {
    ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    text: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    usage: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    status: Option<u16>,
}

fn fail(error: &str, status: Option<u16>) -> AskResp {
    AskResp { ok: false, text: None, usage: None, error: Some(error.to_string()), status }
}

#[tauri::command]
pub async fn jarvie_llm_ask(app: AppHandle, req: AskReq) -> Result<AskResp, String> {
    let key = match read_trim(&key_path(&app)?) {
        Some(k) => k,
        None => return Ok(fail("no key", None)),
    };
    let model = model_id(&read_trim(&model_path(&app)?).unwrap_or_default());

    let mut body = serde_json::json!({
        "model": model,
        "max_tokens": req.max_tokens,
        "system": [ { "type": "text", "text": req.system, "cache_control": { "type": "ephemeral" } } ],
        "messages": [ { "role": "user", "content": req.user } ],
    });
    if let Some(format) = req.format {
        body["output_config"] = serde_json::json!({ "format": format });
    }

    let client = match reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()
    {
        Ok(c) => c,
        Err(e) => return Ok(fail(&format!("client: {e}"), None)),
    };

    let resp = client
        .post("https://api.anthropic.com/v1/messages")
        .header("x-api-key", key)
        .header("anthropic-version", "2023-06-01")
        .header("content-type", "application/json")
        .json(&body)
        .send()
        .await;

    let resp = match resp {
        Ok(r) => r,
        Err(e) => {
            let msg = if e.is_timeout() { "timeout".to_string() } else { format!("transport: {e}") };
            return Ok(fail(&msg, None));
        }
    };
    let status = resp.status().as_u16();
    let json: serde_json::Value = match resp.json().await {
        Ok(j) => j,
        Err(e) => return Ok(fail(&format!("bad json: {e}"), Some(status))),
    };

    if !(200..300).contains(&status) {
        let msg = json["error"]["message"].as_str().unwrap_or("api error").to_string();
        return Ok(fail(&msg, Some(status)));
    }
    if json["stop_reason"].as_str() == Some("refusal") {
        return Ok(fail("refusal", Some(status)));
    }

    let text = json["content"]
        .as_array()
        .map(|blocks| {
            blocks
                .iter()
                .filter(|b| b["type"] == "text")
                .filter_map(|b| b["text"].as_str())
                .collect::<Vec<_>>()
                .join("")
        })
        .unwrap_or_default();

    Ok(AskResp {
        ok: true,
        text: Some(text),
        usage: Some(json["usage"].clone()),
        error: None,
        status: Some(status),
    })
}
