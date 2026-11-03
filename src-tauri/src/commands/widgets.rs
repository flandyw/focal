use std::sync::Mutex;
#[cfg(target_os = "macos")]
use tauri::{Emitter, Manager};

#[derive(Default)]
pub struct WidgetNavigation(pub Mutex<Option<String>>);

#[tauri::command]
pub fn take_widget_navigation(
    state: tauri::State<'_, WidgetNavigation>,
) -> Result<Option<String>, String> {
    Ok(state
        .0
        .lock()
        .map_err(|_| "Widget navigation is unavailable")?
        .take())
}

#[cfg(target_os = "macos")]
pub fn open(app: &tauri::AppHandle, urls: &[tauri::Url]) {
    for url in urls {
        let view = url.path().trim_matches('/');
        if url.scheme() != "focal"
            || url.host_str() != Some("view")
            || ![
                "calendar",
                "timetable",
                "exams",
                "sacs",
                "focus",
                "mistakes",
                "settings",
            ]
            .contains(&view)
        {
            continue;
        }
        if let Ok(mut pending) = app.state::<WidgetNavigation>().0.lock() {
            *pending = Some(view.to_owned());
        }
        let _ = app.emit("focal:widget-open", view);
        if let Some(window) = app.get_webview_window("main") {
            let _ = window.show();
            let _ = window.unminimize();
            let _ = window.set_focus();
        }
    }
}

#[tauri::command]
pub async fn publish_widget_snapshot(snapshot: String) -> Result<(), String> {
    if snapshot.len() > 512 * 1024 {
        return Err("Widget snapshot is too large".into());
    }
    #[cfg(target_os = "macos")]
    {
        tauri::async_runtime::spawn_blocking(move || {
            use std::{
                io::Write,
                process::{Command, Stdio},
            };
            let mut helper = std::env::current_exe()
                .map_err(|e| e.to_string())?
                .with_file_name("focal-widget-publisher");
            if !helper.exists() && cfg!(debug_assertions) {
                helper = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
                    .join("target/widget/focal-widget-publisher");
            }
            let mut child = Command::new(helper)
                .stdin(Stdio::piped())
                .stdout(Stdio::null())
                .stderr(Stdio::piped())
                .spawn()
                .map_err(|e| format!("Could not start widget publisher: {e}"))?;
            let write = child
                .stdin
                .take()
                .ok_or("Widget publisher input is unavailable")?
                .write_all(snapshot.as_bytes());
            let result = child.wait_with_output().map_err(|e| e.to_string())?;
            write.map_err(|e| e.to_string())?;
            if !result.status.success() {
                return Err(String::from_utf8_lossy(&result.stderr).trim().to_owned());
            }
            Ok(())
        })
        .await
        .map_err(|e| e.to_string())?
    }
    #[cfg(not(target_os = "macos"))]
    Ok(())
}
