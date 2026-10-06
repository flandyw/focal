#[cfg(desktop)]
use std::{
    sync::{Condvar, Mutex},
    time::Duration,
};

use tauri::Manager;

#[cfg(desktop)]
use tauri_plugin_shell::{
    process::{CommandChild, CommandEvent},
    ShellExt,
};

pub struct ChatGptSidecar {
    #[cfg(desktop)]
    process: Mutex<ChatGptProcess>,
    #[cfg(desktop)]
    terminated: Condvar,
}

#[cfg(desktop)]
#[derive(Default)]
struct ChatGptProcess {
    child: Option<CommandChild>,
    pid: Option<u32>,
    running: bool,
}

impl Default for ChatGptSidecar {
    fn default() -> Self {
        Self {
            #[cfg(desktop)]
            process: Mutex::new(ChatGptProcess::default()),
            #[cfg(desktop)]
            terminated: Condvar::new(),
        }
    }
}

#[cfg(desktop)]
pub fn start(app: &tauri::AppHandle) -> Result<(), String> {
    let data_directory = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("could not resolve ChatGPT data directory: {error}"))?;
    std::fs::create_dir_all(&data_directory)
        .map_err(|error| format!("could not create ChatGPT data directory: {error}"))?;

    let state = app
        .try_state::<ChatGptSidecar>()
        .ok_or_else(|| "ChatGPT sidecar state is unavailable".to_owned())?;
    let mut process = state
        .process
        .lock()
        .map_err(|_| "ChatGPT sidecar state is unavailable")?;
    if process.running {
        return Ok(());
    }

    let (mut events, child) = app
        .shell()
        .sidecar("focal-chatgpt")
        .map_err(|error| format!("could not configure ChatGPT sidecar: {error}"))?
        .env("FOCAL_CHATGPT_DATA_DIR", data_directory)
        .env("FOCAL_CHATGPT_MANAGED", "1")
        .spawn()
        .map_err(|error| format!("could not start ChatGPT sidecar: {error}"))?;

    let pid = child.pid();
    process.child = Some(child);
    process.pid = Some(pid);
    process.running = true;
    drop(process);

    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        while let Some(event) = events.recv().await {
            match event {
                CommandEvent::Stdout(line) | CommandEvent::Stderr(line) => {
                    eprintln!("[focal-chatgpt] {}", String::from_utf8_lossy(&line).trim())
                }
                CommandEvent::Error(error) => eprintln!("[focal-chatgpt] {error}"),
                CommandEvent::Terminated(status) => {
                    eprintln!("[focal-chatgpt] terminated: {status:?}");
                    if let Some(state) = app.try_state::<ChatGptSidecar>() {
                        if let Ok(mut process) = state.process.lock() {
                            if process.pid == Some(pid) {
                                process.child.take();
                                process.pid = None;
                                process.running = false;
                                state.terminated.notify_all();
                            }
                        }
                    }
                }
                _ => {}
            }
        }
    });

    Ok(())
}

#[cfg(not(desktop))]
pub fn start(_app: &tauri::AppHandle) -> Result<(), String> {
    Ok(())
}

#[cfg(desktop)]
pub fn stop(app: &tauri::AppHandle) -> Result<(), String> {
    let state = app
        .try_state::<ChatGptSidecar>()
        .ok_or_else(|| "ChatGPT sidecar state is unavailable".to_owned())?;
    let mut process = state
        .process
        .lock()
        .map_err(|_| "ChatGPT sidecar state is unavailable".to_owned())?;
    if let Some(child) = process.child.take() {
        child
            .kill()
            .map_err(|error| format!("could not stop ChatGPT sidecar: {error}"))?;
    }
    if process.running {
        let (next, timeout) = state
            .terminated
            .wait_timeout_while(process, Duration::from_secs(5), |process| process.running)
            .map_err(|_| "ChatGPT sidecar state is unavailable".to_owned())?;
        process = next;
        if timeout.timed_out() && process.running {
            return Err("ChatGPT sidecar did not stop within 5 seconds".to_owned());
        }
    }
    Ok(())
}

#[cfg(not(desktop))]
pub fn stop(_app: &tauri::AppHandle) -> Result<(), String> {
    Ok(())
}

#[tauri::command]
pub fn stop_chatgpt_sidecar(app: tauri::AppHandle) -> Result<(), String> {
    stop(&app)
}

#[tauri::command]
pub fn start_chatgpt_sidecar(app: tauri::AppHandle) -> Result<(), String> {
    start(&app)
}
