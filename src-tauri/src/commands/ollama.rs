use futures_util::future::{AbortHandle, Abortable};
use reqwest::{Client, Url};
use serde::Serialize;
use serde_json::Value;
use std::{
    collections::{hash_map::Entry, HashMap},
    sync::{LazyLock, Mutex},
    time::Duration,
};
use tauri::State;

static HTTP_CLIENT: LazyLock<Client> = LazyLock::new(|| {
    Client::builder()
        .connect_timeout(Duration::from_secs(10))
        .build()
        .expect("failed to build Ollama HTTP client")
});

#[derive(Default)]
pub struct OllamaRequests(Mutex<HashMap<String, AbortHandle>>);

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OllamaResponse {
    status: u16,
    body: String,
}

fn endpoint_url(base_url: &str, endpoint: &str) -> Result<Url, String> {
    if !matches!(
        endpoint,
        "/api/tags" | "/api/chat" | "/api/show" | "/api/version" | "/api/pull"
    ) {
        return Err("Unsupported Ollama endpoint".into());
    }

    let mut url = Url::parse(base_url.trim()).map_err(|_| "Invalid Ollama server URL")?;
    if !matches!(url.scheme(), "http" | "https") || url.host_str().is_none() {
        return Err("Ollama server URL must use HTTP or HTTPS".into());
    }
    if !url.username().is_empty() || url.password().is_some() {
        return Err("Ollama server URL must not contain credentials".into());
    }

    let path = format!(
        "{}/{}",
        url.path().trim_end_matches('/'),
        endpoint.trim_start_matches('/')
    );
    url.set_path(&path);
    url.set_query(None);
    url.set_fragment(None);
    Ok(url)
}

#[tauri::command]
pub async fn ollama_request(
    state: State<'_, OllamaRequests>,
    request_id: String,
    base_url: String,
    endpoint: String,
    body: Option<Value>,
) -> Result<OllamaResponse, String> {
    let url = endpoint_url(&base_url, &endpoint)?;
    let request = match (endpoint.as_str(), body) {
        ("/api/tags" | "/api/version", None) => HTTP_CLIENT.get(url),
        ("/api/chat" | "/api/show" | "/api/pull", Some(body)) => HTTP_CLIENT.post(url).json(&body),
        ("/api/tags" | "/api/version", Some(_)) => {
            return Err("Ollama GET request must not have a body".into())
        }
        ("/api/chat" | "/api/show" | "/api/pull", None) => {
            return Err("Ollama POST request requires a body".into())
        }
        _ => unreachable!(),
    };

    let (abort_handle, abort_registration) = AbortHandle::new_pair();
    {
        let mut requests = state
            .0
            .lock()
            .map_err(|_| "Ollama request state is unavailable")?;
        match requests.entry(request_id.clone()) {
            Entry::Vacant(entry) => {
                entry.insert(abort_handle);
            }
            Entry::Occupied(_) => return Err("Duplicate Ollama request id".into()),
        }
    }

    let result = Abortable::new(
        async {
            let response = request.send().await?;
            let status = response.status().as_u16();
            let body = response.text().await?;
            Ok::<_, reqwest::Error>(OllamaResponse { status, body })
        },
        abort_registration,
    )
    .await;

    state
        .0
        .lock()
        .map_err(|_| "Ollama request state is unavailable")?
        .remove(&request_id);

    match result {
        Ok(Ok(response)) => Ok(response),
        Ok(Err(error)) => Err(format!("Network error reaching Ollama: {error}")),
        Err(_) => Err("Ollama request cancelled".into()),
    }
}

#[tauri::command]
pub fn cancel_ollama_request(state: State<'_, OllamaRequests>, request_id: String) {
    if let Ok(mut requests) = state.0.lock() {
        if let Some(handle) = requests.remove(&request_id) {
            handle.abort();
        }
    }
}
