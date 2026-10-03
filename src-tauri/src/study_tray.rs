use serde::Deserialize;
use std::{
    sync::{
        atomic::{AtomicBool, Ordering},
        Mutex,
    },
    time::{Duration, SystemTime, UNIX_EPOCH},
};
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

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |d| d.as_millis() as u64)
}

/// A running clock the tray advances itself, so the menu bar keeps counting
/// even when the hidden webview's timers are throttled by macOS.
#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrayClock {
    /// Displayed seconds at `anchor_ms`.
    seconds: i64,
    /// -1 counts down, 1 counts up, 0 is paused.
    direction: i8,
    /// Shown before the time in the menu bar, e.g. "+" or "Ⅱ ".
    prefix: String,
    label: String,
    detail: String,
    /// Epoch milliseconds when `seconds` was displayed in the webview.
    anchor_ms: u64,
}

impl TrayClock {
    fn text(&self) -> (String, String) {
        let now = now_ms();
        let elapsed = if self.direction == 0 {
            0
        } else {
            (now.saturating_sub(self.anchor_ms) / 1000) as i64 * i64::from(self.direction)
        };
        let value = (self.seconds + elapsed).max(0);
        let time = format!("{}:{:02}", value / 60, value % 60);
        (
            format!("{}{time}", self.prefix),
            format!("{} · {time} · {}", self.label, self.detail),
        )
    }
}

pub struct StudyTray {
    clock: Mutex<Option<(TrayClock, String)>>,
    status: MenuItem<tauri::Wry>,
    summary: MenuItem<tauri::Wry>,
    items: Mutex<Option<Vec<TrayItem>>>,
    dirty: AtomicBool,
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
        dirty: AtomicBool::new(false),
        clock: Mutex::new(None),
    };
    let menu = build_menu(app.handle(), &state, &[])?;
    TrayIconBuilder::with_id("study-timer")
        .icon(tauri::include_image!("icons/tray.png"))
        // Template images are tinted by macOS to match the menu bar (white on dark, black on light).
        .icon_as_template(true)
        .title("")
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
                    // Menu updates wait for the main thread; its click handler must never wait for their lock.
                    state.dirty.store(true, Ordering::Relaxed);
                }
                if let Err(error) = app.emit_to("main", "study-tray-action", action) {
                    eprintln!("Could not control study timer: {error}");
                    show_main(app);
                }
            }
        })
        .build(app)?;
    app.manage(state);
    let handle = app.handle().clone();
    std::thread::spawn(move || loop {
        let Some(state) = handle.try_state::<StudyTray>() else {
            std::thread::sleep(Duration::from_millis(500));
            continue;
        };
        // Sleep to the next second boundary of the anchored clock; poll slowly while idle.
        let wait = {
            let Ok(clock) = state.clock.lock() else { return };
            match clock.as_ref().filter(|(clock, _)| clock.direction != 0) {
                Some((clock, _)) => 1000 - now_ms().saturating_sub(clock.anchor_ms) % 1000 + 2,
                None => 500,
            }
        };
        std::thread::sleep(Duration::from_millis(wait));
        let (title, status) = {
            let Ok(mut clock) = state.clock.lock() else { return };
            let Some((clock, shown)) = clock.as_mut() else { continue };
            if clock.direction == 0 {
                continue;
            }
            let (title, status) = clock.text();
            if *shown == title {
                continue;
            }
            shown.clone_from(&title);
            (title, status)
        };
        let _ = state.status.set_text(status);
        if let Some(tray) = handle.tray_by_id("study-timer") {
            let _ = tray.set_title(Some(title));
        }
    });
    Ok(())
}

#[tauri::command]
pub fn update_study_tray(
    app: tauri::AppHandle,
    title: String,
    status: String,
    summary: String,
    items: Vec<TrayItem>,
    clock: Option<TrayClock>,
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
    let (title, status) = clock.as_ref().map_or((title, status), TrayClock::text);
    *state.clock.lock().map_err(|error| error.to_string())? =
        clock.map(|clock| (clock, title.clone()));
    let update = || -> tauri::Result<()> {
        state.status.set_text(status)?;
        state.summary.set_text(summary)?;
        if let Some(tray) = app.tray_by_id("study-timer") {
            // ponytail: only rebuild on control/subject/settings changes, never on clock ticks.
            if state.dirty.swap(false, Ordering::Relaxed) || previous.as_ref() != Some(&items) {
                if let Err(error) =
                    build_menu(&app, &state, &items).and_then(|menu| tray.set_menu(Some(menu)))
                {
                    state.dirty.store(true, Ordering::Relaxed);
                    return Err(error);
                }
            }
            tray.set_title(Some(title))?;
        }
        Ok(())
    };
    update().map_err(|error| error.to_string())?;
    *previous = Some(items);
    Ok(())
}
