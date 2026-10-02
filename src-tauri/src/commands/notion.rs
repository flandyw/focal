use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashSet;
use std::sync::LazyLock;
use std::time::Duration;

const NOTION_API_VERSION: &str = "2022-06-28";
const NOTION_BASE_URL: &str = "https://api.notion.com/v1";
const REQUEST_TIMEOUT_SECS: u64 = 30;

static HTTP_CLIENT: LazyLock<reqwest::Client> = LazyLock::new(|| {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(REQUEST_TIMEOUT_SECS))
        .build()
        .expect("failed to build reqwest HTTP client")
});

#[derive(Debug, Serialize, Deserialize)]
pub struct NotionError {
    pub code: String,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub retry_after_ms: Option<u64>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct NotionQueryResponse {
    pub data: Option<Vec<Value>>,
    pub error: Option<NotionError>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct NotionPageResponse {
    pub data: Option<Value>,
    pub error: Option<NotionError>,
}

fn query_error(code: &str, message: &str) -> NotionQueryResponse {
    NotionQueryResponse {
        data: None,
        error: Some(NotionError {
            code: code.to_string(),
            message: message.to_string(),
            retry_after_ms: None,
        }),
    }
}

fn page_error(code: &str, message: &str) -> NotionPageResponse {
    NotionPageResponse {
        data: None,
        error: Some(NotionError {
            code: code.to_string(),
            message: message.to_string(),
            retry_after_ms: None,
        }),
    }
}

async fn parse_notion_response(response: reqwest::Response) -> NotionPageResponse {
    let status = response.status();

    if status == reqwest::StatusCode::UNAUTHORIZED {
        let body = response.text().await.unwrap_or_default();
        let message = if body.is_empty() {
            "Notion rejected the integration token".to_string()
        } else {
            format!("Notion rejected the integration token: {}", body)
        };
        return page_error("NOTION_UNAUTHORIZED", &message);
    }

    if !status.is_success() {
        let retry_after_ms = response
            .headers()
            .get(reqwest::header::RETRY_AFTER)
            .and_then(|value| value.to_str().ok())
            .and_then(|value| value.parse::<f64>().ok())
            .map(|seconds| (seconds * 1000.0).ceil() as u64);
        let body = response.text().await.unwrap_or_default();
        // Try to extract Notion's error code from the JSON body.
        // Notion error shape: {"object":"error","status":404,"code":"object_not_found","message":"..."}
        let notion_code = serde_json::from_str::<Value>(&body)
            .ok()
            .and_then(|v| {
                v.get("code")
                    .and_then(|c| c.as_str())
                    .map(|s| s.to_string())
            })
            .unwrap_or_else(|| {
                if status == reqwest::StatusCode::TOO_MANY_REQUESTS {
                    "rate_limited"
                } else if status == reqwest::StatusCode::REQUEST_TIMEOUT {
                    "gateway_timeout"
                } else if status.is_server_error() {
                    "service_unavailable"
                } else {
                    "NOTION_ERROR"
                }
                .to_string()
            });
        let message = if body.is_empty() {
            format!("Notion returned {}", status)
        } else {
            format!("Notion returned {}: {}", status, body)
        };
        return NotionPageResponse {
            data: None,
            error: Some(NotionError {
                code: notion_code,
                message,
                retry_after_ms,
            }),
        };
    }

    match response.json::<Value>().await {
        Ok(json) => NotionPageResponse {
            data: Some(json),
            error: None,
        },
        Err(e) => page_error("NOTION_ERROR", &format!("Invalid response: {}", e)),
    }
}

#[tauri::command]
pub async fn fetch_notion_page(token: String, page_id: String) -> NotionPageResponse {
    let token = token.trim();
    let page_id = page_id.trim();
    if token.is_empty() {
        return page_error("VALIDATION_ERROR", "Notion integration token is required");
    }
    if page_id.is_empty() {
        return page_error("VALIDATION_ERROR", "Notion page id is required");
    }

    let response = match HTTP_CLIENT
        .get(format!("{}/pages/{}", NOTION_BASE_URL, page_id))
        .bearer_auth(token)
        .header("Notion-Version", NOTION_API_VERSION)
        .send()
        .await
    {
        Ok(response) => response,
        Err(error) => return page_error("NETWORK_ERROR", &format!("Network error: {}", error)),
    };

    parse_notion_response(response).await
}

// -- Fetch schema (lightweight single page) --

#[tauri::command]
pub async fn fetch_notion_schema(token: String, data_source_id: String) -> NotionPageResponse {
    let token = token.trim();
    let data_source_id = data_source_id.trim();
    if token.is_empty() {
        return page_error("VALIDATION_ERROR", "Notion integration token is required");
    }
    if data_source_id.is_empty() {
        return page_error("VALIDATION_ERROR", "Notion database id is required");
    }

    let response = match HTTP_CLIENT
        .get(format!("{}/databases/{}", NOTION_BASE_URL, data_source_id))
        .bearer_auth(token)
        .header("Notion-Version", NOTION_API_VERSION)
        .send()
        .await
    {
        Ok(r) => r,
        Err(e) => return page_error("NETWORK_ERROR", &format!("Network error: {}", e)),
    };

    parse_notion_response(response).await
}

#[tauri::command]
pub async fn ensure_notion_sync_properties(
    token: String,
    data_source_id: String,
) -> NotionPageResponse {
    let token = token.trim();
    let data_source_id = data_source_id.trim();
    if token.is_empty() {
        return page_error("VALIDATION_ERROR", "Notion integration token is required");
    }
    if data_source_id.is_empty() {
        return page_error("VALIDATION_ERROR", "Notion database id is required");
    }

    let response = match HTTP_CLIENT
        .patch(format!("{}/databases/{}", NOTION_BASE_URL, data_source_id))
        .bearer_auth(token)
        .header("Notion-Version", NOTION_API_VERSION)
        .json(&json!({
            "properties": {
                "Focal ID": { "rich_text": {} },
                "Focal Kind": { "rich_text": {} }
            }
        }))
        .send()
        .await
    {
        Ok(response) => response,
        Err(error) => return page_error("NETWORK_ERROR", &format!("Network error: {}", error)),
    };

    parse_notion_response(response).await
}

// -- Query --

#[tauri::command]
pub async fn query_notion_calendar(token: String, data_source_id: String) -> NotionQueryResponse {
    let token = token.trim();
    let data_source_id = data_source_id.trim();
    if token.is_empty() {
        return query_error("VALIDATION_ERROR", "Notion integration token is required");
    }
    if data_source_id.is_empty() {
        return query_error("VALIDATION_ERROR", "Notion database id is required");
    }

    let url = format!("{}/databases/{}/query", NOTION_BASE_URL, data_source_id);
    let mut cursor: Option<String> = None;
    let mut seen_cursors = HashSet::new();
    let mut pages: Vec<Value> = Vec::new();

    loop {
        let body = match &cursor {
            Some(c) => json!({ "start_cursor": c }),
            None => json!({}),
        };

        let response = match HTTP_CLIENT
            .post(&url)
            .bearer_auth(token)
            .header("Notion-Version", NOTION_API_VERSION)
            .json(&body)
            .send()
            .await
        {
            Ok(r) => r,
            Err(e) => return query_error("NETWORK_ERROR", &format!("Network error: {}", e)),
        };

        let parsed = parse_notion_response(response).await;
        let json = match (parsed.data, parsed.error) {
            (Some(data), None) => data,
            (_, Some(error)) => {
                return NotionQueryResponse {
                    data: None,
                    error: Some(error),
                };
            }
            (None, None) => return query_error("NOTION_ERROR", "Invalid response: empty response"),
        };

        if let Some(results) = json.get("results").and_then(|v| v.as_array()) {
            pages.extend(results.iter().cloned());
        }

        let next_cursor = json
            .get("next_cursor")
            .and_then(|v| v.as_str())
            .filter(|s| !s.is_empty())
            .map(|s| s.to_string());
        if let Some(next) = &next_cursor {
            if !seen_cursors.insert(next.clone()) {
                return query_error("NOTION_ERROR", "Notion repeated a pagination cursor");
            }
        }
        cursor = next_cursor;

        if cursor.is_none() {
            break;
        }
    }

    NotionQueryResponse {
        data: Some(pages),
        error: None,
    }
}

// -- Create --

#[tauri::command]
pub async fn create_notion_calendar_page(
    token: String,
    data_source_id: String,
    properties: Value,
    children: Option<Value>,
) -> NotionPageResponse {
    let token = token.trim();
    let data_source_id = data_source_id.trim();
    if token.is_empty() {
        return page_error("VALIDATION_ERROR", "Notion integration token is required");
    }
    if data_source_id.is_empty() {
        return page_error("VALIDATION_ERROR", "Notion database id is required");
    }

    let mut body = json!({
        "parent": { "type": "database_id", "database_id": data_source_id },
        "properties": properties,
    });
    if let Some(children_val) = children {
        body["children"] = children_val;
    }

    let response = match HTTP_CLIENT
        .post(format!("{}/pages", NOTION_BASE_URL))
        .bearer_auth(token)
        .header("Notion-Version", NOTION_API_VERSION)
        .json(&body)
        .send()
        .await
    {
        Ok(r) => r,
        Err(e) => return page_error("NETWORK_ERROR", &format!("Network error: {}", e)),
    };

    parse_notion_response(response).await
}

// -- Update --

#[tauri::command]
pub async fn update_notion_calendar_page(
    token: String,
    page_id: String,
    properties: Value,
    children: Option<Value>,
) -> NotionPageResponse {
    let token = token.trim();
    let page_id = page_id.trim();
    if token.is_empty() {
        return page_error("VALIDATION_ERROR", "Notion integration token is required");
    }
    if page_id.is_empty() {
        return page_error("VALIDATION_ERROR", "Notion page id is required");
    }

    let patch_body = json!({ "properties": properties });
    let response = match HTTP_CLIENT
        .patch(format!("{}/pages/{}", NOTION_BASE_URL, page_id))
        .bearer_auth(token)
        .header("Notion-Version", NOTION_API_VERSION)
        .json(&patch_body)
        .send()
        .await
    {
        Ok(r) => r,
        Err(e) => return page_error("NETWORK_ERROR", &format!("Network error: {}", e)),
    };

    let page_response = parse_notion_response(response).await;
    if page_response.error.is_some() {
        return page_response;
    }

    // Replace page children if new children were provided
    if let Some(children_val) = children {
        if let Err(error) = replace_page_children(token, page_id, children_val).await {
            return NotionPageResponse {
                data: None,
                error: Some(error),
            };
        }

        // Re-read the page so last_edited_time includes the body change. Returning
        // the pre-body timestamp causes a false conflict on the next sync.
        let response = match HTTP_CLIENT
            .get(format!("{}/pages/{}", NOTION_BASE_URL, page_id))
            .bearer_auth(token)
            .header("Notion-Version", NOTION_API_VERSION)
            .send()
            .await
        {
            Ok(r) => r,
            Err(e) => return page_error("NETWORK_ERROR", &format!("Network error: {}", e)),
        };
        return parse_notion_response(response).await;
    }

    page_response
}

async fn replace_page_children(
    token: &str,
    page_id: &str,
    new_children: Value,
) -> Result<(), NotionError> {
    let children_url = format!("{}/blocks/{}/children", NOTION_BASE_URL, page_id);
    let mut block_ids: Vec<String> = Vec::new();
    let mut cursor: Option<String> = None;

    // Fetch every child before deleting; a page may contain more than one API page.
    loop {
        let mut request = HTTP_CLIENT
            .get(&children_url)
            .bearer_auth(token)
            .header("Notion-Version", NOTION_API_VERSION)
            .query(&[("page_size", "100")]);
        if let Some(start_cursor) = &cursor {
            request = request.query(&[("start_cursor", start_cursor)]);
        }

        let response = request.send().await.map_err(|error| NotionError {
            code: "NETWORK_ERROR".to_string(),
            message: format!("Network error: {}", error),
            retry_after_ms: None,
        })?;
        if !response.status().is_success() {
            return Err(parse_notion_response(response)
                .await
                .error
                .unwrap_or(NotionError {
                    code: "NOTION_ERROR".to_string(),
                    message: "Failed to list Notion page content".to_string(),
                    retry_after_ms: None,
                }));
        }
        let response_json = response
            .json::<Value>()
            .await
            .map_err(|error| NotionError {
                code: "NOTION_ERROR".to_string(),
                message: format!("Invalid response: {}", error),
                retry_after_ms: None,
            })?;
        if let Some(results) = response_json
            .get("results")
            .and_then(|value| value.as_array())
        {
            block_ids.extend(results.iter().filter_map(|block| {
                block
                    .get("id")
                    .and_then(|value| value.as_str())
                    .map(str::to_string)
            }));
        }
        cursor = response_json
            .get("next_cursor")
            .and_then(|value| value.as_str())
            .filter(|value| !value.is_empty())
            .map(str::to_string);
        if cursor.is_none() {
            break;
        }
    }

    let clear_body = new_children.as_array().is_some_and(Vec::is_empty);

    // Append the replacement before retiring the previous blocks. A crash or
    // transient failure can temporarily duplicate content, but cannot erase the
    // only durable copy. A retry lists both generations and converges safely.
    if !clear_body {
        let response = HTTP_CLIENT
            .patch(&children_url)
            .bearer_auth(token)
            .header("Notion-Version", NOTION_API_VERSION)
            .json(&json!({ "children": new_children }))
            .send()
            .await
            .map_err(|error| NotionError {
                code: "NETWORK_ERROR".to_string(),
                message: format!("Network error: {}", error),
                retry_after_ms: None,
            })?;
        if let Some(error) = parse_notion_response(response).await.error {
            return Err(error);
        }
    }

    // Sequential deletes avoid creating a burst that Notion rate-limits.
    for block_id in block_ids {
        let response = HTTP_CLIENT
            .delete(format!("{}/blocks/{}", NOTION_BASE_URL, block_id))
            .bearer_auth(token)
            .header("Notion-Version", NOTION_API_VERSION)
            .send()
            .await
            .map_err(|error| NotionError {
                code: "NETWORK_ERROR".to_string(),
                message: format!("Network error: {}", error),
                retry_after_ms: None,
            })?;
        if let Some(error) = parse_notion_response(response).await.error {
            return Err(error);
        }
    }

    Ok(())
}

// -- Delete (archive) --

#[tauri::command]
pub async fn delete_notion_page(token: String, page_id: String) -> NotionPageResponse {
    let token = token.trim();
    let page_id = page_id.trim();
    if token.is_empty() {
        return page_error("VALIDATION_ERROR", "Notion integration token is required");
    }
    if page_id.is_empty() {
        return page_error("VALIDATION_ERROR", "Notion page id is required");
    }

    let response = match HTTP_CLIENT
        .patch(format!("{}/pages/{}", NOTION_BASE_URL, page_id))
        .bearer_auth(token)
        .header("Notion-Version", NOTION_API_VERSION)
        .json(&json!({ "archived": true }))
        .send()
        .await
    {
        Ok(r) => r,
        Err(e) => return page_error("NETWORK_ERROR", &format!("Network error: {}", e)),
    };

    parse_notion_response(response).await
}
