use serde::Deserialize;
use serde_json::Value;
use sqlx::{sqlite::SqliteConnectOptions, Connection, SqliteConnection};
use tauri::Manager;

#[derive(Deserialize)]
#[serde(tag = "operation", rename_all = "camelCase")]
pub enum EventMutation {
    Put {
        record: Value,
        #[serde(default)]
        overwrite: bool,
    },
    Update {
        id: String,
        patch: Value,
        expected: Option<Value>,
    },
    Delete {
        id: String,
    },
}

// A dedicated connection pins all writes, trigger-generated cloud intents, and
// Notion intents to one transaction. BEGIN/COMMIT through the SQL plugin pool cannot.
#[tauri::command]
pub async fn mutate_events(
    app: tauri::AppHandle,
    mutations: Vec<EventMutation>,
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
        &data_source_id,
        expected_account_id.as_deref(),
    )
    .await
    .map_err(|e| e.to_string())
}

async fn apply(
    db: &mut SqliteConnection,
    mutations: Vec<EventMutation>,
    data_source_id: &str,
    expected_account_id: Option<&str>,
) -> Result<Vec<Value>, Box<dyn std::error::Error>> {
    let mut tx = db.begin().await?;
    mutation_account(&mut tx, expected_account_id).await?;
    let changed = apply_in_transaction(&mut tx, mutations, data_source_id).await?;
    tx.commit().await?;
    Ok(changed)
}

pub(super) async fn mutation_account(
    tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    expected: Option<&str>,
) -> Result<String, Box<dyn std::error::Error>> {
    let account: String =
        sqlx::query_scalar("select account_id from sync_local_context where singleton = 1")
            .fetch_one(&mut **tx)
            .await?;
    if expected.is_some_and(|expected| expected != account) {
        return Err("Account changed; retry after sign-in settles".into());
    }
    Ok(account)
}

pub(super) async fn apply_in_transaction(
    transaction: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    mutations: Vec<EventMutation>,
    data_source_id: &str,
) -> Result<Vec<Value>, Box<dyn std::error::Error>> {
    let tx = &mut **transaction;
    let mut changed = Vec::new();
    for mutation in mutations {
        let id = match &mutation {
            EventMutation::Put { record, .. } => record
                .get("id")
                .and_then(Value::as_str)
                .ok_or("Missing event id")?,
            EventMutation::Update { id, .. } | EventMutation::Delete { id } => id,
        }
        .to_owned();
        if id.trim().is_empty() {
            return Err("Empty event id".into());
        }
        let stored: Option<String> =
            sqlx::query_scalar("select payload from records where kind = 'events' and id = ?")
                .bind(&id)
                .fetch_optional(&mut *tx)
                .await?;
        let current: Option<Value> = stored.as_deref().map(serde_json::from_str).transpose()?;
        let record = match mutation {
            EventMutation::Put { record, overwrite } => {
                if current.is_some() && !overwrite {
                    continue;
                }
                record
            }
            EventMutation::Update {
                patch, expected, ..
            } => {
                let Some(mut record) = current.clone() else {
                    continue;
                };
                if expected
                    .as_ref()
                    .is_some_and(|expected| !same_event(expected, &record))
                {
                    continue;
                }
                let fields = patch.as_object().ok_or("Event patch must be an object")?;
                let object = record
                    .as_object_mut()
                    .ok_or("Stored event must be an object")?;
                for (key, value) in fields {
                    if key == "id" || key == "created_at" {
                        return Err("Cannot patch event identity".into());
                    }
                    object.insert(key.clone(), value.clone());
                }
                record
            }
            EventMutation::Delete { .. } => {
                let Some(record) = current else {
                    continue;
                };
                let source = &record["source"];
                let page_id = if source["type"] == "notion" {
                    source["id"].as_str()
                } else {
                    None
                };
                let payload = page_id.map(|page| serde_json::json!({"notion": {
                    "pageId": page, "kind": "event", "localId": id, "dataSourceId": data_source_id
                }}));
                sqlx::query("insert into sync_cursor (account_id, cursor_seq, lamport, updated_at) select account_id, 0, 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now') from sync_local_context where singleton = 1 on conflict (account_id) do update set lamport = sync_cursor.lamport + 1")
                    .execute(&mut *tx).await?;
                sqlx::query("insert into sync_outbox (change_id, account_id, entity, row_id, operation, payload, created_at, lamport) select lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2, 3) || '-' || substr('89ab', (random() & 3) + 1, 1) || substr(lower(hex(randomblob(2))), 2, 3) || '-' || lower(hex(randomblob(6))), account_id, 'events', ?, 'delete', ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), (select lamport from sync_cursor where account_id = context.account_id) from sync_local_context context where singleton = 1 on conflict (account_id, entity, row_id) do update set change_id = excluded.change_id, operation = excluded.operation, payload = excluded.payload, created_at = excluded.created_at, lamport = excluded.lamport, retry_count = 0, last_error = null, next_attempt_at = null, blocked_at = null, attempted_at = null")
                    .bind(&id).bind(payload.map(|p| p.to_string())).execute(&mut *tx).await?;
                sqlx::query("delete from records where kind = 'events' and id = ?")
                    .bind(&id)
                    .execute(&mut *tx)
                    .await?;
                continue;
            }
        };
        if !record.is_object()
            || record["title"].as_str().is_none()
            || record["startTime"].as_str().is_none()
        {
            return Err("Event requires title and startTime".into());
        }
        let valid_time: bool = sqlx::query_scalar(
            "select julianday(?) is not null and (? is null or julianday(?) is not null)",
        )
        .bind(record["startTime"].as_str())
        .bind(record["endTime"].as_str())
        .bind(record["endTime"].as_str())
        .fetch_one(&mut *tx)
        .await?;
        if !valid_time {
            return Err("Invalid event time".into());
        }
        if current.as_ref() == Some(&record) {
            continue;
        }
        sqlx::query("insert into records (kind, id, payload, position) values ('events', ?, ?, (select coalesce(max(position), -1) + 1 from records where kind = 'events')) on conflict (kind, id) do update set payload = excluded.payload")
            .bind(&id).bind(record.to_string()).execute(&mut *tx).await?;
        // Existing record/ outbox triggers own Notion intents too; never enqueue twice.
        changed.push(record);
    }
    Ok(changed)
}

// The desktop read boundary represents absent optional metadata as null.
pub(super) fn same_event(expected: &Value, current: &Value) -> bool {
    let without_nulls = |value: &Value| {
        let mut value = value.clone();
        if let Some(fields) = value.as_object_mut() {
            fields.retain(|_, value| !value.is_null());
        }
        value
    };
    without_nulls(expected) == without_nulls(current)
}

#[cfg(test)]
mod tests {
    use super::*;

    async fn apply(
        db: &mut SqliteConnection,
        mutations: Vec<EventMutation>,
        data_source_id: &str,
    ) -> Result<Vec<Value>, Box<dyn std::error::Error>> {
        super::apply(db, mutations, data_source_id, None).await
    }

    #[test]
    fn row_writes_and_intents_rollback_together() {
        tauri::async_runtime::block_on(async {
            let mut db = SqliteConnection::connect("sqlite::memory:").await.unwrap();
            for migration in [
                include_str!("../../migrations/0001_local_database.sql"),
                include_str!("../../migrations/0002_rebuild_sync_outbox.sql"),
                include_str!("../../migrations/0003_sync_reliability.sql"),
                include_str!("../../migrations/0004_change_log.sql"),
                include_str!("../../migrations/0005_study_session_commands.sql"),
                include_str!("../../migrations/0006_direct_session_publish.sql"),
            ] {
                sqlx::raw_sql(migration).execute(&mut db).await.unwrap();
            }
            sqlx::query("insert into preferences (key, value, updated_at) values ('focal-notion-data-source-id', '\"notion\"', '2026-01-01T00:00:00Z')").execute(&mut db).await.unwrap();
            let event = serde_json::json!({"id":"one", "title":"Original", "startTime":"2026-01-01T10:00:00Z"});
            apply(
                &mut db,
                vec![EventMutation::Put {
                    record: event.clone(),
                    overwrite: false,
                }],
                "notion",
            )
            .await
            .unwrap();
            // Signed-out writes still have exactly one durable cloud intent.
            let count: i64 = sqlx::query_scalar("select count(*) from sync_outbox")
                .fetch_one(&mut db)
                .await
                .unwrap();
            assert_eq!(count, 1);
            let notions: i64 = sqlx::query_scalar("select count(*) from notion_outbox")
                .fetch_one(&mut db)
                .await
                .unwrap();
            assert_eq!(notions, 1);
            assert!(same_event(
                &serde_json::json!({"id":"one", "title":"Original", "startTime":"2026-01-01T10:00:00Z", "deleted_at":null, "last_modified_device_id":null}),
                &event
            ));
            // Failure in the Notion trigger must roll back the record and cloud intent.
            sqlx::raw_sql("create trigger fail_notion before update on notion_outbox begin select raise(abort, 'injected failure'); end;").execute(&mut db).await.unwrap();
            assert!(apply(
                &mut db,
                vec![EventMutation::Update {
                    id: "one".into(),
                    patch: serde_json::json!({"title":"Must rollback"}),
                    expected: None,
                }],
                "notion"
            )
            .await
            .is_err());
            sqlx::raw_sql("drop trigger fail_notion")
                .execute(&mut db)
                .await
                .unwrap();
            let result = apply(
                &mut db,
                vec![
                    EventMutation::Delete { id: "one".into() },
                    EventMutation::Put {
                        record: serde_json::json!({"id":"bad"}),
                        overwrite: false,
                    },
                ],
                "notion",
            )
            .await;
            assert!(result.is_err());
            let payload: String =
                sqlx::query_scalar("select payload from records where id = 'one'")
                    .fetch_one(&mut db)
                    .await
                    .unwrap();
            assert_eq!(serde_json::from_str::<Value>(&payload).unwrap(), event);
            let operation: String =
                sqlx::query_scalar("select operation from sync_outbox where row_id = 'one'")
                    .fetch_one(&mut db)
                    .await
                    .unwrap();
            assert_eq!(operation, "put");
            // A stale integration snapshot must not overwrite a newer local field.
            apply(
                &mut db,
                vec![EventMutation::Update {
                    id: "one".into(),
                    patch: serde_json::json!({"title":"New"}),
                    expected: None,
                }],
                "notion",
            )
            .await
            .unwrap();
            let changed = apply(
                &mut db,
                vec![EventMutation::Update {
                    id: "one".into(),
                    patch: serde_json::json!({"title":"Stale"}),
                    expected: Some(event),
                }],
                "notion",
            )
            .await
            .unwrap();
            assert!(changed.is_empty());
            apply(
                &mut db,
                vec![EventMutation::Delete { id: "one".into() }],
                "notion",
            )
            .await
            .unwrap();
            let remaining: i64 = sqlx::query_scalar("select count(*) from records")
                .fetch_one(&mut db)
                .await
                .unwrap();
            assert_eq!(remaining, 0);
            let operation: String =
                sqlx::query_scalar("select operation from sync_outbox where row_id = 'one'")
                    .fetch_one(&mut db)
                    .await
                    .unwrap();
            assert_eq!(operation, "delete");
        });
    }
}
