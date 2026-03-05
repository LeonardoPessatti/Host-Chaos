// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
use serde::Serialize;
use std::sync::OnceLock;
use std::time::Instant;
use tauri::Manager;
use tauri_plugin_global_shortcut::ShortcutState;

#[derive(Serialize)]
struct RequestProbeResult {
    status_code: Option<u16>,
    elapsed_ms: f64,
    error: Option<String>,
}

static HTTP_CLIENT: OnceLock<reqwest::Client> = OnceLock::new();

fn http_client() -> &'static reqwest::Client {
    HTTP_CLIENT.get_or_init(|| {
        reqwest::Client::builder()
            .user_agent("bewindow-nettest/1.0")
            .build()
            .expect("failed to build reqwest client")
    })
}

#[tauri::command]
fn get_platform() -> String {
    std::env::consts::OS.to_string()
}

#[tauri::command]
async fn perform_request(url: String) -> RequestProbeResult {
    let start = Instant::now();

    match http_client().get(url).send().await {
        Ok(response) => RequestProbeResult {
            status_code: Some(response.status().as_u16()),
            elapsed_ms: start.elapsed().as_secs_f64() * 1000.0,
            error: None,
        },
        Err(error) => RequestProbeResult {
            status_code: None,
            elapsed_ms: start.elapsed().as_secs_f64() * 1000.0,
            error: Some(error.to_string()),
        },
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
fn main() -> Result<(), Box<dyn std::error::Error>> {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_shortcut("Shift+CmdOrCtrl+T")?
                .with_handler(|app, _shortcut, event| {
                    if event.state == ShortcutState::Pressed {
                        if let Some(window) = app.get_webview_window("main") {
                            match window.is_visible() {
                                Ok(true) => {
                                    let _ = window.hide();
                                }
                                Ok(false) => {
                                    let _ = window.show();
                                    let _ = window.set_focus();
                                }
                                Err(_) => {}
                            }
                        }
                    }
                })
                .build(),
        )
        .invoke_handler(tauri::generate_handler![get_platform, perform_request])
        .setup(|app| {
            let window = app.get_webview_window("main").unwrap();
            
            #[cfg(target_os = "macos")]
            {
                use window_vibrancy::{apply_vibrancy, NSVisualEffectMaterial, NSVisualEffectState};
                
                // Apply native macOS vibrancy effect with Menu material and custom radius
                apply_vibrancy(
                    &window,
                    NSVisualEffectMaterial::Menu,
                    Some(NSVisualEffectState::Active),
                    Some(6.0)
                ).expect("Unsupported platform! 'apply_vibrancy' is only supported on macOS");
            }
            
            #[cfg(target_os = "windows")]
            {
                use window_vibrancy::apply_acrylic;
                apply_acrylic(&window, Some((0x00, 0x00, 0x00, 0x80)))
                    .expect("Acrylic not supported on this Windows version");
            }

            #[cfg(target_os = "linux")]
            {
                use window_vibrancy::apply_blur;
                apply_blur(&window, Some((0, 0, 0, 128)))
                    .expect("Blur not supported on this Linux version");
            }
            
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
    
    Ok(())
}
