use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::{Emitter, Manager};
use tauri_plugin_shell::{
    process::{CommandChild, CommandEvent},
    ShellExt,
};
use uuid::Uuid;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RuntimeHandshake {
    protocol_version: u8,
    kind: String,
    host: String,
    port: u16,
    bearer_token: String,
    pid: u32,
}

#[derive(Debug, Clone)]
struct PrivateRuntimeConnection {
    public: PublicRuntimeConnection,
    bearer_token: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct PublicRuntimeConnection {
    handle: String,
    host: String,
    port: u16,
    pid: u32,
}

#[derive(Default)]
struct RuntimeState {
    connection: Mutex<Option<PrivateRuntimeConnection>>,
    child: Mutex<Option<CommandChild>>,
}

#[tauri::command]
fn runtime_connection(state: tauri::State<'_, RuntimeState>) -> Option<PublicRuntimeConnection> {
    state
        .connection
        .lock()
        .ok()
        .and_then(|connection| connection.as_ref().map(|value| value.public.clone()))
}

fn start_runtime(app: &tauri::AppHandle) -> Result<(), String> {
    let resources = app
        .path()
        .resource_dir()
        .map_err(|error| error.to_string())?
        .join("nw-runtime-resources");
    let command = app
        .shell()
        .sidecar("nw-runtime")
        .map_err(|error| error.to_string())?
        .args([
            "--resources".to_string(),
            resources.to_string_lossy().into_owned(),
        ]);
    let (mut events, child) = command.spawn().map_err(|error| error.to_string())?;
    let state = app.state::<RuntimeState>();
    *state.child.lock().map_err(|error| error.to_string())? = Some(child);
    let app_handle = app.clone();

    tauri::async_runtime::spawn(async move {
        while let Some(event) = events.recv().await {
            if let CommandEvent::Stdout(line) = event {
                let Ok(handshake) = serde_json::from_slice::<RuntimeHandshake>(&line) else {
                    continue;
                };
                if handshake.protocol_version != 1
                    || handshake.kind != "noneedwork.runtime.ready"
                    || handshake.host != "127.0.0.1"
                    || handshake.bearer_token.len() != 64
                {
                    continue;
                }

                let public = PublicRuntimeConnection {
                    handle: Uuid::new_v4().to_string(),
                    host: handshake.host,
                    port: handshake.port,
                    pid: handshake.pid,
                };
                let private = PrivateRuntimeConnection {
                    public: public.clone(),
                    bearer_token: handshake.bearer_token,
                };
                let state = app_handle.state::<RuntimeState>();
                if let Ok(mut connection) = state.connection.lock() {
                    *connection = Some(private);
                }
                let _ = app_handle.emit("noneedwork://runtime-ready", public);
                break;
            }
        }
    });
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .manage(RuntimeState::default())
        .invoke_handler(tauri::generate_handler![runtime_connection])
        .setup(|app| {
            start_runtime(app.handle()).map_err(std::io::Error::other)?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("NoNeedWork desktop failed to start");
}
