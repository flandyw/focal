use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::TrayIconBuilder,
    Emitter, Manager,
};

pub fn show_main(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        if let Err(error) = window
            .unminimize()
            .and_then(|_| window.show())
            .and_then(|_| window.set_focus())
        {
            eprintln!("Could not show Focal: {error}");
        }
    }
}

pub struct StudyTray {
    status: MenuItem<tauri::Wry>,
    toggle: MenuItem<tauri::Wry>,
    finish: MenuItem<tauri::Wry>,
    skip: MenuItem<tauri::Wry>,
    reset: MenuItem<tauri::Wry>,
}

pub fn setup(app: &tauri::App) -> tauri::Result<()> {
    let status = MenuItem::with_id(
        app,
        "timer-status",
        "Study timer loading…",
        false,
        None::<&str>,
    )?;
    let toggle = MenuItem::with_id(app, "timer-toggle", "Start focus", false, None::<&str>)?;
    let finish = MenuItem::with_id(
        app,
        "timer-finish",
        "Finish study session",
        false,
        None::<&str>,
    )?;
    let skip = MenuItem::with_id(app, "timer-skip", "Skip break", false, None::<&str>)?;
    let reset = MenuItem::with_id(app, "timer-reset", "Reset timer", false, None::<&str>)?;
    let open = MenuItem::with_id(
        app,
        "timer-open",
        "Open Focal / choose subject…",
        true,
        None::<&str>,
    )?;
    let quit = MenuItem::with_id(app, "timer-quit", "Quit Focal", true, None::<&str>)?;
    let separator = PredefinedMenuItem::separator(app)?;
    let menu = Menu::with_items(
        app,
        &[
            &status, &toggle, &finish, &skip, &reset, &separator, &open, &quit,
        ],
    )?;
    TrayIconBuilder::with_id("study-timer")
        .title("Focal")
        .tooltip("Focal study timer")
        .menu(&menu)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "timer-open" => {
                show_main(app);
                let _ = app.emit_to("main", "study-tray-action", "open");
            }
            "timer-quit" => app.exit(0),
            "timer-toggle" | "timer-finish" | "timer-skip" | "timer-reset" => {
                if let Err(error) = app.emit_to("main", "study-tray-action", event.id.as_ref()) {
                    eprintln!("Could not control study timer: {error}");
                    show_main(app);
                }
            }
            _ => {}
        })
        .build(app)?;
    app.manage(StudyTray {
        status,
        toggle,
        finish,
        skip,
        reset,
    });
    Ok(())
}

#[tauri::command]
pub fn update_study_tray(
    app: tauri::AppHandle,
    title: String,
    status: String,
    toggle_label: String,
    can_toggle: bool,
    can_finish: bool,
    can_skip: bool,
    can_reset: bool,
) -> Result<(), String> {
    let Some(items) = app.try_state::<StudyTray>() else {
        return Ok(());
    };
    if title.len() > 100 || status.len() > 500 || toggle_label.len() > 100 {
        return Err("Invalid timer menu text".into());
    }
    let update = || -> tauri::Result<()> {
        items.status.set_text(status)?;
        items.toggle.set_text(toggle_label)?;
        items.toggle.set_enabled(can_toggle)?;
        items.finish.set_enabled(can_finish)?;
        items.skip.set_enabled(can_skip)?;
        items.reset.set_enabled(can_reset)?;
        if let Some(tray) = app.tray_by_id("study-timer") {
            tray.set_title(Some(title))?;
        }
        Ok(())
    };
    update().map_err(|error| error.to_string())
}
