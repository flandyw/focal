use serde::Deserialize;
use serde_json::Value;
use sqlx::{sqlite::SqliteConnectOptions, Connection, SqliteConnection};
use tauri::Manager;

#[derive(Deserialize)]
#[serde(tag = "operation", rename_all = "camelCase")]
pub enum SessionMutation {
    Put {
        record: Value,
        expected: Option<String>,
    },
    Delete {
        id: String,
    },
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Conversion {
    event_id: String,
    expected_event: Value,
    session: Value,
}

#[tauri::command]
pub async fn mutate_sessions(
    app: tauri::AppHandle,
    mutations: Vec<SessionMutation>,
    conversion: Option<Conversion>,
    data_source_id: String,
    expected_account_id: Option<String>,
) -> Result<Vec<Value>, String> {
    let path = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("focal.db");
    let options = SqliteConnectOptions::new()
        .filename(path)
        .create_if_missing(false);
    let mut db = SqliteConnection::connect_with(&options)
        .await
        .map_err(|e| e.to_string())?;
    apply(
        &mut db,
        mutations,
        conversion,
        &data_source_id,
        expected_account_id.as_deref(),
    )
    .await
    .map_err(|e| e.to_string())
}

async fn apply(
    db: &mut SqliteConnection,
    mut mutations: Vec<SessionMutation>,
    conversion: Option<Conversion>,
    data_source_id: &str,
    expected_account_id: Option<&str>,
) -> Result<Vec<Value>, Box<dyn std::error::Error>> {
    let mut tx = db.begin().await?;
    let account = super::events::mutation_account(&mut tx, expected_account_id).await?;
    if let Some(convert) = &conversion {
        if !mutations.is_empty() {
            return Err("Conversion must be a separate operation".into());
        }
        let receipt: Option<String> = sqlx::query_scalar(
            "select payload from event_conversions where account_id = ? and event_id = ?",
        )
        .bind(&account)
        .bind(&convert.event_id)
        .fetch_optional(&mut *tx)
        .await?;
        let event: Option<String> =
            sqlx::query_scalar("select payload from records where kind = 'events' and id = ?")
                .bind(&convert.event_id)
                .fetch_optional(&mut *tx)
                .await?;
        if event.is_none() {
            if let Some(receipt) = receipt {
                return Ok(vec![serde_json::from_str(&receipt)?]);
            }
        }
        // A restored event is a new conversion, not a replay of its old receipt.
        let event: Value = serde_json::from_str(&event.ok_or("Event no longer exists")?)?;
        if !super::events::same_event(&convert.expected_event, &event) {
            return Err("Event changed; reopen conversion".into());
        }
        let id = convert.session["id"].as_str().ok_or("Missing session id")?;
        let exists: i64 = sqlx::query_scalar(
            "select count(*) from records where kind = 'study_sessions' and id = ?",
        )
        .bind(id)
        .fetch_one(&mut *tx)
        .await?;
        if exists != 0 {
            return Err("Session id already exists".into());
        }
        mutations.push(SessionMutation::Put {
            record: convert.session.clone(),
            expected: None,
        });
    }
    let mut changed = Vec::new();
    for mutation in mutations {
        let id = match &mutation {
            SessionMutation::Put { record, .. } => {
                record["id"].as_str().ok_or("Missing session id")?
            }
            SessionMutation::Delete { id } => id,
        }
        .to_owned();
        if id.trim().is_empty() {
            return Err("Empty session id".into());
        }
        let current: Option<String> = sqlx::query_scalar(
            "select payload from records where kind = 'study_sessions' and id = ?",
        )
        .bind(&id)
        .fetch_optional(&mut *tx)
        .await?;
        let (record, operation) = match mutation {
            SessionMutation::Put { record, expected } => {
                if expected.is_none() && current.is_some() {
                    continue;
                }
                if expected != current {
                    return Err("Session changed; retry the edit".into());
                }
                validate(&mut tx, &record).await?;
                if current
                    .as_deref()
                    .map(serde_json::from_str::<Value>)
                    .transpose()?
                    .as_ref()
                    == Some(&record)
                {
                    continue;
                }
                sqlx::query("insert into records (kind, id, payload, position) values ('study_sessions', ?, ?, (select coalesce(max(position), -1) + 1 from records where kind = 'study_sessions')) on conflict (kind, id) do update set payload = excluded.payload")
                    .bind(&id).bind(record.to_string()).execute(&mut *tx).await?;
                changed.push(record.clone());
                (record, "put")
            }
            SessionMutation::Delete { .. } => {
                let Some(current) = current else {
                    continue;
                };
                let mut record: Value = serde_json::from_str(&current)?;
                let deleted_at: String =
                    sqlx::query_scalar("select strftime('%Y-%m-%dT%H:%M:%fZ', 'now')")
                        .fetch_one(&mut *tx)
                        .await?;
                record["deleted_at"] = Value::String(deleted_at);
                let source = if record["integrations"]["notion"].is_object() {
                    &record["integrations"]["notion"]
                } else {
                    &record["source"]
                };
                if source["type"] == "notion" {
                    if let Some(page) = source["id"].as_str() {
                        sqlx::query("insert into notion_outbox (data_source_id, kind, local_id, operation, page_id, created_at, not_before, retry_count) values (?, 'session', ?, 'archive', ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '+8 seconds'), 0) on conflict (data_source_id, kind, local_id) do update set operation = excluded.operation, page_id = excluded.page_id, created_at = excluded.created_at, not_before = excluded.not_before, retry_count = 0, last_error = null, next_attempt_at = null")
                            .bind(data_source_id).bind(&id).bind(page).execute(&mut *tx).await?;
                    }
                }
                sqlx::query("delete from records where kind = 'study_sessions' and id = ?")
                    .bind(&id)
                    .execute(&mut *tx)
                    .await?;
                (record, "delete")
            }
        };
        sqlx::query("insert into session_outbox (account_id, session_id, intent_id, operation, payload) values (?, ?, lower(hex(randomblob(16))), ?, ?) on conflict (account_id, session_id) do update set intent_id = excluded.intent_id, created_at = excluded.created_at, operation = excluded.operation, payload = excluded.payload")
            .bind(&account).bind(&id).bind(operation).bind(record.to_string()).execute(&mut *tx).await?;
    }
    if let Some(convert) = conversion {
        super::events::apply_in_transaction(
            &mut tx,
            vec![super::events::EventMutation::Delete {
                id: convert.event_id.clone(),
            }],
            data_source_id,
        )
        .await?;
        sqlx::query("insert into event_conversions (account_id, event_id, session_id, payload) values (?, ?, ?, ?) on conflict (account_id, event_id) do update set session_id = excluded.session_id, payload = excluded.payload")
            .bind(&account).bind(convert.event_id).bind(convert.session["id"].as_str()).bind(convert.session.to_string()).execute(&mut *tx).await?;
    }
    tx.commit().await?;
    Ok(changed)
}

async fn validate(
    tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    record: &Value,
) -> Result<(), Box<dyn std::error::Error>> {
    if record["schemaVersion"] != 2
        || record["title"].as_str().is_none()
        || !record["subjectIds"].is_array()
        || !record["execution"]["intervals"].is_array()
    {
        return Err("Invalid canonical study session".into());
    }
    let state = record["execution"]["state"]
        .as_str()
        .ok_or("Missing execution state")?;
    if !["planned", "in-progress", "completed"].contains(&state) {
        return Err("Invalid execution state".into());
    }
    let blocks = record["schedule"]["blocks"]
        .as_array()
        .ok_or("Missing planned blocks")?;
    if blocks.is_empty() {
        return Err("Session requires planned blocks".into());
    }
    for (ranges, allow_open) in [
        (blocks, false),
        (record["execution"]["intervals"].as_array().unwrap(), true),
    ] {
        for (index, range) in ranges.iter().enumerate() {
            let start = range["start"].as_str().ok_or("Missing interval start")?;
            let end = range["end"].as_str();
            if !range["end"].is_null() && end.is_none() {
                return Err("Invalid interval end".into());
            }
            if allow_open
                && !["manual", "pomodoro", "imported"]
                    .contains(&range["source"].as_str().unwrap_or(""))
            {
                return Err("Invalid interval source".into());
            }
            if end.is_none() && (!allow_open || index + 1 != ranges.len() || state != "in-progress")
            {
                return Err("Invalid open interval".into());
            }
            let valid: bool = sqlx::query_scalar(
                "select julianday(?) is not null and (? is null or julianday(?) > julianday(?) or (? and julianday(?) = julianday(?))) and (? is null or julianday(?) >= julianday(?))",
            )
            .bind(start)
            .bind(end)
            .bind(end)
            .bind(start)
            .bind(allow_open)
            .bind(end)
            .bind(start)
            .bind(if allow_open && index > 0 { ranges[index - 1]["end"].as_str() } else { None })
            .bind(start)
            .bind(if allow_open && index > 0 { ranges[index - 1]["end"].as_str() } else { None })
            .fetch_one(&mut **tx)
            .await?;
            if !valid {
                return Err("Invalid interval time".into());
            }
        }
    }
    Ok(())
}
