mod jarvie_llm;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_sql::Builder::default().build())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            jarvie_llm::jarvie_llm_status,
            jarvie_llm::jarvie_llm_set_key,
            jarvie_llm::jarvie_llm_clear_key,
            jarvie_llm::jarvie_llm_set_model,
            jarvie_llm::jarvie_llm_set_enabled,
            jarvie_llm::jarvie_llm_set_backend,
            jarvie_llm::jarvie_llm_set_local,
            jarvie_llm::jarvie_llm_ping_local,
            jarvie_llm::jarvie_llm_ask,
        ])
        .setup(|app| {
            use tauri::Manager;
            let salt_path = app
                .path()
                .app_local_data_dir()
                .expect("could not resolve app local data path")
                .join("stronghold-salt.txt");
            app.handle().plugin(
                tauri_plugin_stronghold::Builder::with_argon2(&salt_path).build()
            )?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running TDS Command Center");
}
