mod commands;
mod study_tray;

use sqlx::{sqlite::SqliteConnectOptions, Connection, SqliteConnection};
use tauri::Manager;
use tauri_plugin_sql::{Migration, MigrationKind};

const WINDOWS_MIGRATION_CHECKSUM_REPAIRS: &[(i64, &str, &str)] = &[
    (
        1,
        "a010286e4783f54b80254d3929ecb0e88072183fd4882cbdce75bb58de56bd83bcf3dda0b9b1829df22e4e375d1d73aa",
        "d0cdde6e2ac639e0f491d2115fa805c22cfc79246991ab98a51058c6187ca96ffbe35a886ed3eb3e53f32029dc6a7cb7",
    ),
    (
        2,
        "b8ad94c6e2e3458cc2d7e2c5faa1c887a8072680aaed8fab1e56b6d9227741e38f8f7996808acfba0a984fcb8bdc445e",
        "cce4c2acad2eecd1a074bac73d23fda5408be1e78aaf5c1532e7ef2a295f6504005a9e51cd29ab4d1ed3f1ad133da3fa",
    ),
    (
        3,
        "ba7d5f384a02942133256e841be645c06d5d0d98019f09b9965b8ef797613b139847406f504f5835d289aec25b4efa5b",
        "f76aabc65a5903a3fc058b181057b7a2c19defddfc265ca0e0a23bc1c1d4c42889fa4cef3a8edb4cac542c51b88232ce",
    ),
];

fn checksum_bytes(checksum: &str) -> Vec<u8> {
    checksum
        .as_bytes()
        .chunks_exact(2)
        .map(|pair| {
            u8::from_str_radix(std::str::from_utf8(pair).expect("ASCII checksum"), 16)
                .expect("hex checksum")
        })
        .collect()
}

async fn normalize_windows_migration_checksum(
    app: &tauri::AppHandle,
) -> Result<(), Box<dyn std::error::Error>> {
    let database_path = app.path().app_data_dir()?.join("focal.db");
    if !database_path.exists() {
        return Ok(());
    }

    let options = SqliteConnectOptions::new()
        .filename(database_path)
        .create_if_missing(false);
    let mut database = SqliteConnection::connect_with(&options).await?;
    let has_migration_table = sqlx::query_scalar::<_, i64>(
        "select count(*) from sqlite_master where type = 'table' and name = '_sqlx_migrations'",
    )
    .fetch_one(&mut database)
    .await?;
    if has_migration_table == 0 {
        return Ok(());
    }

    // ponytail: accept only the checksums produced by Git's CRLF checkout.
    // Add another exact pair only if a released build creates a new variant.
    for (version, windows_checksum, canonical_checksum) in WINDOWS_MIGRATION_CHECKSUM_REPAIRS {
        sqlx::query(
            "update _sqlx_migrations set checksum = ? where version = ? and checksum = ? and success = 1",
        )
            .bind(checksum_bytes(canonical_checksum))
            .bind(version)
            .bind(checksum_bytes(windows_checksum))
            .execute(&mut database)
            .await?;
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn released_migration_checksums_are_sha384_values() {
        for (_, windows_checksum, canonical_checksum) in WINDOWS_MIGRATION_CHECKSUM_REPAIRS {
            assert_eq!(checksum_bytes(windows_checksum).len(), 48);
            assert_eq!(checksum_bytes(canonical_checksum).len(), 48);
            assert_ne!(windows_checksum, canonical_checksum);
        }
    }
}

fn database_migrations() -> Vec<Migration> {
    vec![
        Migration {
            version: 1,
            description: "initialize_local_database",
            // Migration 1 shipped inline with this exact trailing indentation.
            // Keep its checksum immutable; all schema changes start at version 2.
            sql: concat!(
                include_str!("../migrations/0001_local_database.sql"),
                "        "
            ),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 2,
            description: "rebuild_sync_outbox",
            sql: include_str!("../migrations/0002_rebuild_sync_outbox.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 3,
            description: "sync_reliability",
            sql: include_str!("../migrations/0003_sync_reliability.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 4,
            description: "change_log",
            sql: include_str!("../migrations/0004_change_log.sql"),
            kind: MigrationKind::Up,
        },
    ]
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            if let Err(error) =
                tauri::async_runtime::block_on(normalize_windows_migration_checksum(app.handle()))
            {
                eprintln!("could not normalize the legacy migration checksum: {error}");
            }
            commands::chatgpt::start(app.handle()).map_err(std::io::Error::other)?;
            #[cfg(target_os = "macos")]
            study_tray::setup(app)?;
            Ok(())
        })
        .on_window_event(|window, event| {
            #[cfg(target_os = "macos")]
            if window.label() == "main" {
                if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                    // ponytail: retain the timer/session writer in the hidden webview.
                    // Reliable background execution needs macOS 14+; older systems
                    // need a native timer engine if support is extended.
                    if window.hide().is_ok() { api.prevent_close(); }
                }
            }
        })
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_os::init())
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations("sqlite:focal.db", database_migrations())
                .build(),
        )
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_shell::init())
        .manage(commands::chatgpt::ChatGptSidecar::default())
        .manage(commands::ollama::OllamaRequests::default())
        .invoke_handler(tauri::generate_handler![
            commands::files::move_files_to_project,
            commands::files::get_project_files,
            commands::files::get_project_file_count,
            commands::files::create_project_folder,
            commands::files::create_project_with_subfolders,
            commands::files::search_files_all_projects,
            commands::files::delete_files,
            commands::files::rename_file,
            commands::files::get_file_content_previews,
            commands::files::move_file_to_folder,
            commands::files::import_folder_to_project,
            commands::files::link_folder_as_project,
            commands::files::handle_folder_drop,
            commands::files::set_projects_directory,
            commands::files::get_projects_directory,
            commands::files::get_default_documents_dir,
            commands::files::rename_project_folder,
            commands::files::copy_project_folder,
            commands::files::scan_projects_root,
            commands::credits::get_credits,
            commands::notion::query_notion_calendar,
            commands::notion::fetch_notion_page,
            commands::notion::fetch_notion_schema,
            commands::notion::ensure_notion_sync_properties,
            commands::notion::create_notion_calendar_page,
            commands::notion::delete_notion_page,
            commands::notion::update_notion_calendar_page,
            commands::chatgpt::stop_chatgpt_sidecar,
            commands::ollama::ollama_request,
            commands::ollama::cancel_ollama_request,
            commands::window::window_set_zoom,
            study_tray::update_study_tray,
            commands::vcaa::fetch_vcaa_exam_timetable,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            #[cfg(target_os = "macos")]
            if matches!(event, tauri::RunEvent::Reopen { .. }) {
                study_tray::show_main(app);
            }
            if matches!(event, tauri::RunEvent::ExitRequested { .. } | tauri::RunEvent::Exit) {
                if let Err(error) = commands::chatgpt::stop(app) {
                    eprintln!("could not stop ChatGPT sidecar on exit: {error}");
                }
            }
        });
}
