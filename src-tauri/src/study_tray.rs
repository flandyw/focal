use serde::Deserialize;
use std::sync::Mutex;
use tauri::{
    menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem, Submenu},
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

#[derive(Clone, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum TrayGroup {
    Controls,
    Subjects,
    Presets,
    WorkMinutes,
    BreakMinutes,
    LongBreakMinutes,
    Preferences,
}

#[derive(Clone, Deserialize, PartialEq)]
pub struct TrayItem {
    id: String,
    label: String,
    enabled: bool,
    checked: Option<bool>,
    group: TrayGroup,
}

pub struct StudyTray {
    status: MenuItem<tauri::Wry>,
    summary: MenuItem<tauri::Wry>,
    items: Mutex<Option<Vec<TrayItem>>>,
}

fn build_menu(
    app: &tauri::AppHandle,
    state: &StudyTray,
    items: &[TrayItem],
) -> tauri::Result<Menu<tauri::Wry>> {
    let menu = Menu::with_items(
        app,
        &[
            &state.status,
            &state.summary,
            &PredefinedMenuItem::separator(app)?,
        ],
    )?;
    for item in items
        .iter()
        .filter(|item| item.group == TrayGroup::Controls)
    {
        menu.append(&MenuItem::with_id(
            app,
            &item.id,
            &item.label,
            item.enabled,
            None::<&str>,
        )?)?;
    }
    menu.append(&PredefinedMenuItem::separator(app)?)?;
    for (group, label) in [
        (TrayGroup::Subjects, "Subject"),
        (TrayGroup::Presets, "Timer preset"),
        (TrayGroup::WorkMinutes, "Focus duration"),
        (TrayGroup::BreakMinutes, "Short break duration"),
        (TrayGroup::LongBreakMinutes, "Long break duration"),
        (TrayGroup::Preferences, "Preferences"),
    ] {
        let entries: Vec<_> = items.iter().filter(|item| item.group == group).collect();
        let submenu = Submenu::new(app, label, entries.iter().any(|item| item.enabled))?;
        for item in entries {
            submenu.append(&CheckMenuItem::with_id(
                app,
                &item.id,
                &item.label,
                item.enabled,
                item.checked.unwrap_or(false),
                None::<&str>,
            )?)?;
        }
        menu.append(&submenu)?;
    }
    menu.append(&PredefinedMenuItem::separator(app)?)?;
    for (id, label) in [
        ("timer-focus-view", "Open focus view"),
        ("timer-open", "Open Focal"),
        ("timer-quit", "Quit Focal"),
    ] {
        menu.append(&MenuItem::with_id(app, id, label, true, None::<&str>)?)?;
    }
    Ok(menu)
}

pub fn setup(app: &tauri::App) -> tauri::Result<()> {
    let state = StudyTray {
        status: MenuItem::with_id(
            app,
            "timer-status",
            "Study timer loading…",
            false,
            None::<&str>,
        )?,
        summary: MenuItem::with_id(app, "timer-summary", "Today’s study", false, None::<&str>)?,
        items: Mutex::new(None),
    };
    let menu = build_menu(app.handle(), &state, &[])?;
    TrayIconBuilder::with_id("study-timer")
        .title("Focal")
        .tooltip("Focal study timer")
        .menu(&menu)
        .on_menu_event(|app, event| {
            let action = event.id.as_ref();
            if action == "timer-quit" {
                app.exit(0);
                return;
            }
            if action == "timer-open" || action == "timer-focus-view" {
                show_main(app);
            }
            if action.starts_with("timer-") {
                if let Some(state) = app.try_state::<StudyTray>() {
                    if let Ok(mut previous) = state.items.lock() {
                        *previous = None;
                    }
                }
                if let Err(error) = app.emit_to("main", "study-tray-action", action) {
                    eprintln!("Could not control study timer: {error}");
                    show_main(app);
                }
            }
        })
        .build(app)?;
    app.manage(state);
    Ok(())
}

#[tauri::command]
pub fn update_study_tray(
    app: tauri::AppHandle,
    title: String,
    status: String,
    summary: String,
    items: Vec<TrayItem>,
) -> Result<(), String> {
    let Some(state) = app.try_state::<StudyTray>() else {
        return Ok(());
    };
    if title.len() > 100
        || status.len() > 1000
        || summary.len() > 500
        || items.len() > 512
        || items.iter().any(|item| {
            !item.id.starts_with("timer-") || item.id.len() > 500 || item.label.len() > 1000
        })
    {
        return Err("Invalid timer menu".into());
    }
    let mut previous = state.items.lock().map_err(|error| error.to_string())?;
    let update = || -> tauri::Result<()> {
        state.status.set_text(status)?;
        state.summary.set_text(summary)?;
        if let Some(tray) = app.tray_by_id("study-timer") {
            // ponytail: only rebuild on control/subject/settings changes, never on clock ticks.
            if previous.as_ref() != Some(&items) {
                tray.set_menu(Some(build_menu(&app, &state, &items)?))?;
            }
            tray.set_title(Some(title))?;
        }
        Ok(())
    };
    update().map_err(|error| error.to_string())?;
    *previous = Some(items);
    Ok(())
}
