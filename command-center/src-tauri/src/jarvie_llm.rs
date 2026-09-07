// Jarvie — the native side of the LLM seam. Specs: docs/JARVIE-PHASE-C.md (the seam + the
// Claude backend), docs/JARVIE-PHASE-E.md (the local-model backend).
//
// This module is the ONLY place the Anthropic API key is read, and the ONLY place an outbound
// request is made (Claude over HTTPS, or a user-run local model over HTTP). The renderer never
// persists the key and never makes the network call (see jarvieLLM.js). Every command here
// degrades to a plain error result the renderer treats as "answer locally" — the LLM is never
// on Jarvie's critical path.

use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

fn data_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path().app_local_data_dir().map_err(|e| e.to_string())
}
fn p(app: &AppHandle, name: &str) -> Result<PathBuf, String> {
    Ok(data_dir(app)?.join(name))
}

fn read_trim(path: &PathBuf) -> Option<String> {
    std::fs::read_to_string(path).ok().map(|s| s.trim().to_string()).filter(|s| !s.is_empty())
}
fn write_file(path: &PathBuf, contents: &str) -> Result<(), String> {
    if let Some(d) = path.parent() {
        std::fs::create_dir_all(d).map_err(|e| e.to_string())?;
    }
    std::fs::write(path, contents).map_err(|e| e.to_string())
}
#[cfg(unix)]
fn lock_down(path: &PathBuf) {
    use std::os::unix::fs::PermissionsExt;
    let _ = std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600));
}
#[cfg(not(unix))]
fn lock_down(_path: &PathBuf) {}

fn model_id(short: &str) -> &'static str {
    match short {
        "sonnet" => "claude-sonnet-5",
        "opus" => "claude-opus-5",
        _ => "claude-haiku-4-5",
    }
}

const DEFAULT_LOCAL_URL: &str = "http://localhost:11434/v1";
const DEFAULT_LOCAL_MODEL: &str = "llama3.2";

// backend: "off" | "claude" | "local". Missing file → "claude" if a key exists (preserves the
// Phase C default), else "off".
fn backend(app: &AppHandle) -> String {
    if let Some(b) = read_trim(&p(app, "jarvie-backend.txt").unwrap_or_default()) {
        return b;
    }
    if read_trim(&p(app, "jarvie-anthropic.key").unwrap_or_default()).is_some() {
        "claude".to_string()
    } else {
        "off".to_string()
    }
}
fn local_url(app: &AppHandle) -> String {
    read_trim(&p(app, "jarvie-local-url.txt").unwrap_or_default())
        .unwrap_or_else(|| DEFAULT_LOCAL_URL.to_string())
        .trim_end_matches('/')
        .to_string()
}
fn local_model(app: &AppHandle) -> String {
    read_trim(&p(app, "jarvie-local-model.txt").unwrap_or_default())
        .unwrap_or_else(|| DEFAULT_LOCAL_MODEL.to_string())
}

// ---------------------------------------------------------------- config commands

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LlmStatus {
    has_key: bool,
    model: String,
    enabled: bool,
    backend: String,
    local_url: String,
    local_model: String,
}

#[tauri::command]
pub fn jarvie_llm_status(app: AppHandle) -> Result<LlmStatus, String> {
    Ok(LlmStatus {
        has_key: read_trim(&p(&app, "jarvie-anthropic.key")?).is_some(),
        model: read_trim(&p(&app, "jarvie-model.txt")?).unwrap_or_else(|| "haiku".to_string()),
        enabled: read_trim(&p(&app, "jarvie-enabled.txt")?).map(|s| s == "1").unwrap_or(false),
        backend: backend(&app),
        local_url: local_url(&app),
        local_model: local_model(&app),
    })
}

#[tauri::command]
pub fn jarvie_llm_set_key(app: AppHandle, key: String) -> Result<(), String> {
    let key = key.trim();
    if key.is_empty() {
        return Err("Key is empty.".to_string());
    }
    let path = p(&app, "jarvie-anthropic.key")?;
    write_file(&path, key)?;
    lock_down(&path);
    Ok(())
}

#[tauri::command]
pub fn jarvie_llm_clear_key(app: AppHandle) -> Result<(), String> {
    let path = p(&app, "jarvie-anthropic.key")?;
    if path.exists() {
        std::fs::remove_file(&path).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn jarvie_llm_set_model(app: AppHandle, model: String) -> Result<(), String> {
    match model.as_str() {
        "haiku" | "sonnet" | "opus" => write_file(&p(&app, "jarvie-model.txt")?, &model),
        _ => Err("Unknown model.".to_string()),
    }
}

#[tauri::command]
pub fn jarvie_llm_set_enabled(app: AppHandle, enabled: bool) -> Result<(), String> {
    write_file(&p(&app, "jarvie-enabled.txt")?, if enabled { "1" } else { "0" })
}

#[tauri::command]
pub fn jarvie_llm_set_backend(app: AppHandle, backend: String) -> Result<(), String> {
    match backend.as_str() {
        "off" | "claude" | "local" => write_file(&p(&app, "jarvie-backend.txt")?, &backend),
        _ => Err("backend must be off, claude, or local".to_string()),
    }
}

#[tauri::command]
pub fn jarvie_llm_set_local(app: AppHandle, url: String, model: String) -> Result<(), String> {
    let url = url.trim();
    let model = model.trim();
    if url.is_empty() || !(url.starts_with("http://") || url.starts_with("https://")) {
        return Err("Endpoint must be an http(s) URL.".to_string());
    }
    if model.is_empty() {
        return Err("Give the local model a name.".to_string());
    }
    write_file(&p(&app, "jarvie-local-url.txt")?, url)?;
    write_file(&p(&app, "jarvie-local-model.txt")?, model)?;
    Ok(())
}

#[derive(Serialize)]
pub struct PingResp {
    ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
}

// Cheap reachability check for the settings-card "Test connection" button (Phase E §3).
#[tauri::command]
pub async fn jarvie_llm_ping_local(app: AppHandle) -> Result<PingResp, String> {
    let url = format!("{}/models", local_url(&app));
    let client = match reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(5))
        .build()
    {
        Ok(c) => c,
        Err(e) => return Ok(PingResp { ok: false, error: Some(e.to_string()) }),
    };
    match client.get(&url).send().await {
        Ok(r) if r.status().is_success() => Ok(PingResp { ok: true, error: None }),
        Ok(r) => Ok(PingResp { ok: false, error: Some(format!("server returned {}", r.status().as_u16())) }),
        Err(e) => Ok(PingResp {
            ok: false,
            error: Some(if e.is_timeout() { "timed out".to_string() } else { "not reachable".to_string() }),
        }),
    }
}

// ---------------------------------------------------------------- the model call

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
    match backend(&app).as_str() {
        "claude" => ask_claude(&app, req).await,
        "local" => ask_local(&app, req).await,
        _ => Ok(fail("off", None)),
    }
}

async fn ask_claude(app: &AppHandle, req: AskReq) -> Result<AskResp, String> {
    let key = match read_trim(&p(app, "jarvie-anthropic.key")?) {
        Some(k) => k,
        None => return Ok(fail("no key", None)),
    };
    let model = model_id(&read_trim(&p(app, "jarvie-model.txt")?).unwrap_or_default());

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
            blocks.iter().filter(|b| b["type"] == "text").filter_map(|b| b["text"].as_str()).collect::<Vec<_>>().join("")
        })
        .unwrap_or_default();
    Ok(AskResp { ok: true, text: Some(text), usage: Some(json["usage"].clone()), error: None, status: Some(status) })
}

// Phase E §4 — a user-run OpenAI-compatible server (Ollama :11434/v1, llama.cpp :8080/v1,
// LM Studio :1234/v1, …). No auth, no cache_control, longer timeout, plain chat format.
async fn ask_local(app: &AppHandle, req: AskReq) -> Result<AskResp, String> {
    let url = format!("{}/chat/completions", local_url(app));
    let model = local_model(app);

    let body = serde_json::json!({
        "model": model,
        "messages": [
            { "role": "system", "content": req.system },
            { "role": "user", "content": req.user },
        ],
        "temperature": 0,
        "stream": false,
        "max_tokens": req.max_tokens,
    });

    let client = match reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(20))
        .build()
    {
        Ok(c) => c,
        Err(e) => return Ok(fail(&format!("client: {e}"), None)),
    };
    let resp = client.post(&url).header("content-type", "application/json").json(&body).send().await;

    let resp = match resp {
        Ok(r) => r,
        Err(e) => {
            let msg = if e.is_timeout() { "model timed out".to_string() } else { "model unreachable".to_string() };
            return Ok(fail(&msg, None));
        }
    };
    let status = resp.status().as_u16();
    let json: serde_json::Value = match resp.json().await {
        Ok(j) => j,
        Err(e) => return Ok(fail(&format!("bad json: {e}"), Some(status))),
    };
    if !(200..300).contains(&status) {
        let msg = json["error"]["message"].as_str()
            .or_else(|| json["error"].as_str())
            .unwrap_or("model error")
            .to_string();
        return Ok(fail(&msg, Some(status)));
    }
    let text = json["choices"][0]["message"]["content"].as_str().unwrap_or_default().to_string();
    Ok(AskResp { ok: true, text: Some(text), usage: Some(json["usage"].clone()), error: None, status: Some(status) })
}
