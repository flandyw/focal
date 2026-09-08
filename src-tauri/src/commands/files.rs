use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    path::{Component, Path, PathBuf},
    sync::{Mutex, OnceLock},
    time::{Duration, Instant},
};
use tauri::{AppHandle, Emitter};

static PROJECTS_DIR_OVERRIDE: OnceLock<Mutex<Option<PathBuf>>> = OnceLock::new();

fn projects_dir_override() -> &'static Mutex<Option<PathBuf>> {
    PROJECTS_DIR_OVERRIDE.get_or_init(|| Mutex::new(None))
}

fn get_projects_dir() -> Result<PathBuf, String> {
    if let Ok(override_val) = projects_dir_override().lock() {
        if let Some(path) = override_val.as_ref() {
            return Ok(path.clone());
        }
    }
    get_documents_dir()
}

fn project_child_path(root: &Path, name: &str) -> Result<PathBuf, String> {
    if name.is_empty()
        || !Path::new(name)
            .components()
            .all(|component| matches!(component, Component::Normal(_)))
    {
        return Err("Project folder path must stay inside the projects directory".to_string());
    }
    Ok(root.join(name))
}

fn project_file_path(root: &Path, name: &str) -> Result<PathBuf, String> {
    let mut components = Path::new(name).components();
    if name.is_empty()
        || !matches!(components.next(), Some(Component::Normal(_)))
        || components.next().is_some()
    {
        return Err("File name must not contain a path".to_string());
    }
    Ok(root.join(name))
}

fn canonical_existing_path(path: &Path) -> Result<PathBuf, String> {
    std::fs::canonicalize(path)
        .map_err(|e| format!("Failed to resolve path {}: {}", path.display(), e))
}

fn canonical_project_descendant(root: &Path, candidate: &Path) -> Result<PathBuf, String> {
    let unresolved = candidate;
    let root = canonical_existing_path(root)?;
    let candidate = canonical_existing_path(candidate)?;
    if candidate == root || !candidate.starts_with(&root) {
        return Err(format!(
            "Path must stay inside the projects directory: {}",
            candidate.display()
        ));
    }
    Ok(unresolved.to_path_buf())
}

fn project_destination_path(root: &Path, name: &str) -> Result<PathBuf, String> {
    let destination = project_child_path(root, name)?;
    let canonical_root = canonical_existing_path(root)?;
    let mut current = root.to_path_buf();

    for component in Path::new(name).components() {
        let Component::Normal(component) = component else {
            unreachable!("project_child_path already validated components")
        };
        current.push(component);
        if !current.exists() {
            break;
        }
        let resolved = canonical_existing_path(&current)?;
        if resolved == canonical_root || !resolved.starts_with(&canonical_root) {
            return Err(format!(
                "Project path must stay inside the projects directory: {}",
                current.display()
            ));
        }
    }

    Ok(destination)
}

#[tauri::command]
pub fn set_projects_directory(path: String) -> Result<(), String> {
    let normalized = normalize_path(&path);
    let path = PathBuf::from(&normalized);
    if !path.exists() {
        return Err(format!("Directory does not exist: {}", normalized));
    }
    if !path.is_dir() {
        return Err(format!("Projects path is not a directory: {}", normalized));
    }
    if let Ok(mut override_val) = projects_dir_override().lock() {
        *override_val = Some(path);
    }
    Ok(())
}

#[tauri::command]
pub fn get_projects_directory() -> Result<String, String> {
    let dir = get_projects_dir()?;
    Ok(dir.to_string_lossy().to_string())
}

#[tauri::command]
pub fn scan_projects_root() -> Result<Vec<String>, String> {
    let root = get_projects_dir()?;
    if !root.exists() {
        return Err(format!("Projects directory not found: {}", root.display()));
    }
    if !root.is_dir() {
        return Err(format!("Projects path is not a directory: {}", root.display()));
    }
    let mut names = Vec::new();
    let entries = std::fs::read_dir(&root)
        .map_err(|e| format!("Failed to read directory: {}", e))?;
    for entry in entries {
        let entry = entry.map_err(|e| format!("Failed to read entry: {}", e))?;
        let path = entry.path();
        if path.is_dir() {
            let name = entry.file_name().to_string_lossy().to_string();
            if !name.starts_with(".") {
                names.push(name);
            }
        }
    }
    names.sort_by_key(|a| a.to_lowercase());
    Ok(names)
}

#[tauri::command]
pub fn get_default_documents_dir() -> Result<String, String> {
    let dir = get_documents_dir()?;
    Ok(dir.to_string_lossy().to_string())
}

const DEFAULT_CONTENT_PREVIEW_CHARS: usize = 1200;
const MAX_CONTENT_PREVIEW_CHARS: usize = 4000;
const RECENT_MOVE_TTL: Duration = Duration::from_secs(15);

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct FileInfo {
    pub name: String,
    pub path: String,
    pub size: u64,
    pub modified: u64,
    pub extension: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tags: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub subfolder: Option<String>,
    #[serde(rename = "isFavorite", skip_serializing_if = "Option::is_none")]
    pub is_favorite: Option<bool>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct FileContentPreview {
    pub file_path: String,
    pub content: String,
}

fn is_text_like_extension(extension: &str) -> bool {
    let ext = extension.to_ascii_lowercase();
    matches!(
        ext.as_str(),
        "txt"
            | "md"
            | "markdown"
            | "csv"
            | "ts"
            | "tsx"
            | "js"
            | "jsx"
            | "json"
            | "html"
            | "css"
            | "xml"
            | "yaml"
            | "yml"
            | "toml"
            | "ini"
            | "log"
            | "rs"
            | "py"
            | "java"
            | "kt"
            | "swift"
            | "go"
            | "c"
            | "cpp"
            | "h"
            | "hpp"
            | "sql"
            | "sh"
            | "zsh"
            | "bat"
            | "ps1"
            | "tex"
            | "rtf"
    )
}

fn get_documents_dir() -> Result<PathBuf, String> {
    let home = std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .map_err(|_| "Could not find home directory".to_string())?;
    Ok(PathBuf::from(home).join("Documents").join("Projects"))
}

fn recent_moved_files() -> &'static Mutex<HashMap<String, (PathBuf, Instant)>> {
    static RECENT: OnceLock<Mutex<HashMap<String, (PathBuf, Instant)>>> = OnceLock::new();
    RECENT.get_or_init(|| Mutex::new(HashMap::new()))
}

fn remember_moved_file(src: &str, dest: &Path) {
    if let Ok(mut recent) = recent_moved_files().lock() {
        let now = Instant::now();
        recent.retain(|_, (_, moved_at)| now.duration_since(*moved_at) <= RECENT_MOVE_TTL);
        recent.insert(src.to_string(), (dest.to_path_buf(), now));
    }
}

fn recently_moved_dest(src: &str) -> Option<PathBuf> {
    let mut recent = recent_moved_files().lock().ok()?;
    let now = Instant::now();
    recent.retain(|_, (_, moved_at)| now.duration_since(*moved_at) <= RECENT_MOVE_TTL);
    recent
        .get(src)
        .map(|(dest, _)| dest)
        .filter(|dest| dest.exists())
        .cloned()
}

/// Returns true when the rename/move produced the destination despite
/// reporting an error (common on synced/network filesystems).  We only
/// check `dest.exists()` because `src` may still show as present during
/// a race window, and the important question is whether the move landed.
fn rename_landed_after_error(_src: &Path, dest: &Path) -> bool {
    dest.exists()
}

/// Normalize a path that may come from a drag-and-drop event or file picker.
/// Strips `file://`/`file:///` / `file://localhost/` prefixes and URL-decodes percent-encoded characters.
fn normalize_path(path: &str) -> String {
    if !path.starts_with("file://") {
        return path.to_string();
    }
    tauri::Url::parse(path)
        .ok()
        .and_then(|url| url.to_file_path().ok())
        .map(|path| path.to_string_lossy().into_owned())
        .unwrap_or_else(|| path.to_string())
}

#[tauri::command]
pub async fn move_files_to_project(
    files: Vec<String>,
    project_name: String,
    copy: Option<bool>,
) -> Result<Vec<String>, String> {
    let copy_only = copy.unwrap_or(false);
    let projects_dir = get_projects_dir()?;
    let project_dir = project_destination_path(&projects_dir, &project_name)?;

    // ponytail: offload blocking file I/O to a dedicated thread so the
    // async runtime worker (and the UI) stays responsive.
    tokio::task::spawn_blocking(move || {
        std::fs::create_dir_all(&project_dir)
            .map_err(|e| format!("Failed to create project directory: {}", e))?;

        let mut new_paths = Vec::new();
        let mut skipped = Vec::new();

        for file_path in &files {
            let normalized = normalize_path(file_path);
            let src = PathBuf::from(&normalized);
            let filename = match src.file_name() {
                Some(name) => name.to_string_lossy().to_string(),
                None => {
                    skipped.push(format!("{} (invalid path)", normalized));
                    continue;
                }
            };
            let mut dest = project_dir.join(&filename);
            if dest.exists() {
                let stem = src
                    .file_stem()
                    .map(|s| s.to_string_lossy().to_string())
                    .unwrap_or_default();
                let ext = src
                    .extension()
                    .map(|e| format!(".{}", e.to_string_lossy()))
                    .unwrap_or_default();
                let mut counter = 1;
                while dest.exists() {
                    dest = project_dir.join(format!("{} ({}){}", stem, counter, ext));
                    counter += 1;
                }
            }

            // ponytail: skip .exists() pre-check — on Windows it can falsely return false
            // for locked files or file:// URIs. Try rename first, then copy+delete.
            let mut moved = false;
            if copy_only {
                if let Err(e) = std::fs::copy(&src, &dest) {
                    skipped.push(format!("{} (copy failed: {})", normalized, e));
                } else {
                    moved = true;
                }
            } else {
                moved = true;
                if std::fs::rename(&src, &dest).is_err()
                    && !rename_landed_after_error(&src, &dest)
                    && src.exists()
                {
                    if let Err(e) = std::fs::copy(&src, &dest) {
                        if let Some(previous_dest) = recently_moved_dest(&normalized) {
                            new_paths.push(previous_dest.to_string_lossy().to_string());
                            continue;
                        }
                        if !dest.exists() {
                            skipped.push(format!("{} (move failed: {})", normalized, e));
                            moved = false;
                        }
                        // ponytail: dest exists — rename landed during copy attempt
                    } else {
                        let _ = std::fs::remove_file(&src);
                    }
                    // ponytail: if src no longer exists after a failed rename, the
                    // filesystem driver already moved it — treat as success.
                }
            }
            if moved {
                new_paths.push(dest.to_string_lossy().to_string());
                if !copy_only {
                    remember_moved_file(&normalized, &dest);
                }
            }
        }

        if !skipped.is_empty() {
            return Err(format!(
                "Partially added {} of {} file(s). Skipped {}: {}",
                new_paths.len(),
                new_paths.len() + skipped.len(),
                skipped.len(),
                skipped.join(", ")
            ));
        }

        Ok(new_paths)
    })
    .await
    .map_err(|_| "Blocking task panicked".to_string())?
}

#[tauri::command]
pub fn get_project_files(
    project_name: String,
    recursive: Option<bool>,
) -> Result<Vec<FileInfo>, String> {
    let projects_dir = get_projects_dir()?;
    let project_dir = project_destination_path(&projects_dir, &project_name)?;

    get_project_files_for_path(&project_dir, recursive.unwrap_or(false))
}

fn get_project_files_for_path(
    project_dir: &Path,
    recursive: bool,
) -> Result<Vec<FileInfo>, String> {
    if !project_dir.exists() {
        return Ok(Vec::new());
    }

    let mut files = Vec::new();

    if recursive {
        collect_project_files_recursive(project_dir, project_dir, &mut files)?;
        return Ok(files);
    }

    let mut dir_entries: Vec<_> = std::fs::read_dir(project_dir)
        .map_err(|e| format!("Failed to read directory: {}", e))?
        .filter_map(|e| e.ok())
        .filter(|e| e.file_type().map(|t| t.is_file()).unwrap_or(false))
        .collect();

    dir_entries.sort_by_key(|e| e.file_name());

    for entry in dir_entries {
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().to_string();
        if name == ".DS_Store" {
            continue;
        }
        files.push(file_info_from_path(&path, name, None)?);
    }

    Ok(files)
}

fn collect_project_files_recursive(
    dir: &Path,
    root_dir: &Path,
    files: &mut Vec<FileInfo>,
) -> Result<(), String> {
    let mut entries: Vec<_> = std::fs::read_dir(dir)
        .map_err(|e| format!("Failed to read directory: {}", e))?
        .filter_map(|e| e.ok())
        .collect();

    entries.sort_by_key(|e| e.path());

    for entry in entries {
        let file_type = entry
            .file_type()
            .map_err(|e| format!("Failed to read file type: {}", e))?;
        let path = entry.path();

        if file_type.is_dir() {
            collect_project_files_recursive(&path, root_dir, files)?;
        } else if file_type.is_file() {
            let name = entry.file_name().to_string_lossy().to_string();
            if name == ".DS_Store" {
                continue;
            }
            let subfolder = path
                .parent()
                .and_then(|parent| parent.strip_prefix(root_dir).ok())
                .filter(|relative| !relative.as_os_str().is_empty())
                .map(|relative| relative.to_string_lossy().to_string().replace('\\', "/"));

            files.push(file_info_from_path(&path, name, subfolder)?);
        }
    }

    Ok(())
}

fn file_info_from_path(
    path: &Path,
    name: String,
    subfolder: Option<String>,
) -> Result<FileInfo, String> {
    let metadata =
        std::fs::metadata(path).map_err(|e| format!("Failed to read metadata: {}", e))?;
    let extension = path
        .extension()
        .map(|e| e.to_string_lossy().to_string())
        .unwrap_or_default();
    let modified = metadata
        .modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_secs())
        .unwrap_or(0);

    Ok(FileInfo {
        name,
        path: path.to_string_lossy().to_string(),
        size: metadata.len(),
        modified,
        extension,
        tags: None,
        subfolder,
        is_favorite: None,
    })
}

#[tauri::command]
pub fn get_project_file_count(project_name: String) -> Result<usize, String> {
    let projects_dir = get_projects_dir()?;
    let project_dir = project_destination_path(&projects_dir, &project_name)?;
    let files = get_project_files_for_path(&project_dir, true)?;
    Ok(files.len())
}

#[tauri::command]
pub fn create_project_folder(project_name: String) -> Result<String, String> {
    let projects_dir = get_projects_dir()?;
    let project_dir = project_destination_path(&projects_dir, &project_name)?;
    std::fs::create_dir_all(&project_dir)
        .map_err(|e| format!("Failed to create project directory: {}", e))?;
    Ok(project_dir.to_string_lossy().to_string())
}

#[tauri::command]
pub fn create_project_with_subfolders(
    project_name: String,
    subfolders: Vec<String>,
) -> Result<String, String> {
    let projects_dir = get_projects_dir()?;
    let project_dir = project_destination_path(&projects_dir, &project_name)?;
    for subfolder in &subfolders {
        project_child_path(&project_dir, subfolder)?;
    }

    std::fs::create_dir_all(&project_dir)
        .map_err(|e| format!("Failed to create project directory: {}", e))?;

    for subfolder in subfolders {
        let subfolder_path = project_destination_path(&project_dir, &subfolder)?;
        std::fs::create_dir_all(&subfolder_path)
            .map_err(|e| format!("Failed to create subfolder {}: {}", subfolder, e))?;
    }

    Ok(project_dir.to_string_lossy().to_string())
}

#[derive(Debug, Serialize, Deserialize)]
pub struct SearchResult {
    pub file: FileInfo,
    #[serde(rename = "projectFolder")]
    pub project_folder: String,
}

#[tauri::command]
pub fn delete_files(file_paths: Vec<String>) -> Result<usize, String> {
    let projects_dir = get_projects_dir()?;
    let mut deleted = 0;
    for path in &file_paths {
        let normalized = normalize_path(path);
        let unresolved = PathBuf::from(&normalized);
        if !unresolved.exists() {
            continue;
        }
        let p = canonical_project_descendant(&projects_dir, &unresolved)?;
        if p.exists() && p.is_file() {
            if let Err(e) = std::fs::remove_file(&p) {
                if e.kind() != std::io::ErrorKind::NotFound {
                    return Err(format!("Failed to delete {}: {}", path, e));
                }
            }
            deleted += 1;
        } else if p.exists() && p.is_dir() {
            if let Err(e) = std::fs::remove_dir_all(&p) {
                if e.kind() != std::io::ErrorKind::NotFound {
                    return Err(format!("Failed to delete {}: {}", path, e));
                }
            }
            deleted += 1;
        }
    }
    Ok(deleted)
}
#[tauri::command]
pub fn rename_file(file_path: String, new_name: String) -> Result<String, String> {
    let projects_dir = get_projects_dir()?;
    let normalized = normalize_path(&file_path);
    let src = canonical_project_descendant(&projects_dir, Path::new(&normalized))?;
    let parent = src.parent().ok_or("Failed to resolve parent directory")?;
    let dest = project_file_path(parent, &new_name)?;
    if dest.exists() {
        return Err(format!(
            "A file named \"{}\" already exists in this directory",
            new_name
        ));
    }

    // ponytail: try rename first; if it fails (e.g. cloud placeholder), fall
    // back to copy+delete.  Both checks are re-checked after the copy because
    // synced filesystem drivers can move the file between the check and the copy.
    if std::fs::rename(&src, &dest).is_err()
        && !rename_landed_after_error(&src, &dest)
        && src.exists()
    {
        if let Err(e) = std::fs::copy(&src, &dest) {
            if !dest.exists() {
                return Err(format!("Failed to rename file: {}", e));
            }
            // dest exists — rename landed during the copy attempt
        } else {
            let _ = std::fs::remove_file(&src);
        }
        // ponytail: if src didn't exist before the fallback, the filesystem
        // driver already moved it — treat as success.
    }

    Ok(dest.to_string_lossy().to_string())
}

#[tauri::command]
pub fn move_file_to_folder(file_path: String, dest_folder: String) -> Result<String, String> {
    let projects_dir = get_projects_dir()?;
    let normalized = normalize_path(&file_path);
    let src = canonical_project_descendant(&projects_dir, Path::new(&normalized))?;
    let normalized_dest = normalize_path(&dest_folder);
    let dest_dir = canonical_project_descendant(&projects_dir, Path::new(&normalized_dest))?;
    let file_name = src.file_name().ok_or("Failed to resolve file name")?;
    let dest = dest_dir.join(file_name);
    if dest.exists() {
        return Err("A file with the same name already exists in the destination".to_string());
    }
    if let Err(e) = std::fs::rename(&src, &dest) {
        if !rename_landed_after_error(&src, &dest) && src.exists() {
            return Err(format!("Failed to move file: {}", e));
            // ponytail: src gone after failed rename — filesystem driver already
            // moved it; treat as success.
        }
    }
    Ok(dest.to_string_lossy().to_string())
}

#[tauri::command]
pub fn get_file_content_previews(
    file_paths: Vec<String>,
    max_chars_per_file: Option<usize>,
) -> Result<Vec<FileContentPreview>, String> {
    let max_chars = max_chars_per_file
        .unwrap_or(DEFAULT_CONTENT_PREVIEW_CHARS)
        .clamp(200, MAX_CONTENT_PREVIEW_CHARS);

    let mut previews = Vec::new();
    let projects_dir = get_projects_dir()?;

    for file_path in file_paths {
        let normalized = normalize_path(&file_path);
        let unresolved = PathBuf::from(&normalized);
        if !unresolved.exists() || !unresolved.is_file() {
            continue;
        }
        let path = canonical_project_descendant(&projects_dir, &unresolved)?;

        let extension = path
            .extension()
            .and_then(|ext| ext.to_str())
            .unwrap_or_default();

        if !is_text_like_extension(extension) {
            continue;
        }

        let bytes = match std::fs::read(&path) {
            Ok(contents) => contents,
            Err(_) => continue,
        };

        if bytes.iter().take(2048).any(|byte| *byte == 0) {
            continue;
        }

        let text = match String::from_utf8(bytes) {
            Ok(text) => text,
            Err(_) => continue,
        };

        let trimmed = text.trim();
        if trimmed.is_empty() {
            continue;
        }

        let mut chars = trimmed.chars();
        let mut content: String = chars.by_ref().take(max_chars).collect();
        if chars.next().is_some() {
            content.push('…');
        }

        previews.push(FileContentPreview { file_path, content });
    }

    Ok(previews)
}

#[tauri::command]
pub fn search_files_all_projects(query: String) -> Result<Vec<SearchResult>, String> {
    let projects_dir = get_projects_dir()?;
    let query_lower = query.to_lowercase();
    let mut results = Vec::new();

    if !projects_dir.exists() {
        return Ok(results);
    }

    let project_dirs = std::fs::read_dir(&projects_dir)
        .map_err(|e| format!("Failed to read projects directory: {}", e))?;

    for project_entry in project_dirs {
        let project_entry =
            project_entry.map_err(|e| format!("Failed to read project entry: {}", e))?;
        let project_path = project_entry.path();

        if !project_path.is_dir() {
            continue;
        }

        let project_name = project_entry.file_name().to_string_lossy().to_string();

        if let Ok(files) = read_project_files_recursive(&project_path, &query_lower, &project_name)
        {
            results.extend(files);
        }
    }

    results.sort_by(|a, b| a.file.name.cmp(&b.file.name));
    Ok(results)
}

#[derive(Serialize, Clone)]
struct ImportProgress {
    completed: usize,
    total: usize,
}

fn count_files(dir: &Path) -> usize {
    let mut count = 0;
    if let Ok(entries) = std::fs::read_dir(dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                count += count_files(&path);
            } else {
                count += 1;
            }
        }
    }
    count
}

fn copy_dir_recursive(src: &Path, dest: &Path) -> Result<(), std::io::Error> {
    std::fs::create_dir_all(dest)?;
    for entry in std::fs::read_dir(src)? {
        let entry = entry?;
        let path = entry.path();
        let dest_path = dest.join(entry.file_name());
        if path.is_dir() {
            copy_dir_recursive(&path, &dest_path)?;
        } else {
            std::fs::copy(&path, &dest_path)?;
        }
    }
    Ok(())
}

fn copy_dir_recursive_with_progress(
    src: &Path,
    dest: &Path,
    completed: &mut usize,
    total: usize,
    app: &AppHandle,
) -> Result<(), std::io::Error> {
    std::fs::create_dir_all(dest)?;
    for entry in std::fs::read_dir(src)? {
        let entry = entry?;
        let path = entry.path();
        let dest_path = dest.join(entry.file_name());
        if path.is_dir() {
            copy_dir_recursive_with_progress(&path, &dest_path, completed, total, app)?;
        } else {
            std::fs::copy(&path, &dest_path)?;
            *completed += 1;
            let _ = app.emit("import-progress", ImportProgress { completed: *completed, total });
        }
    }
    Ok(())
}

#[derive(Debug, Serialize)]
pub struct FolderDropResult {
    pub folder_path: String,
    pub is_linked: bool,
}

/// Handle a folder dropped onto the sidebar. If the folder is already inside
/// the projects directory, link it in-place. Otherwise, copy it in.
#[tauri::command]
pub async fn handle_folder_drop(source_path: String) -> Result<FolderDropResult, String> {
    let normalized = normalize_path(&source_path);
    let src = canonical_existing_path(Path::new(&normalized))?;
    if !src.exists() {
        return Err(format!("Source folder not found: {}", source_path));
    }
    if !src.is_dir() {
        return Err(format!("Source path is not a directory: {}", source_path));
    }

    let projects_dir = canonical_existing_path(&get_projects_dir()?)?;
    if src == projects_dir {
        return Err("Select a project folder, not the projects directory itself".to_string());
    }

    // If already inside the projects directory, link it in-place
    if src.starts_with(&projects_dir) {
        let relative = src
            .strip_prefix(&projects_dir)
            .map_err(|_| "Could not compute relative path")?;
        let folder_path = relative.to_string_lossy().to_string().replace('\\', "/");
        return Ok(FolderDropResult {
            folder_path,
            is_linked: true,
        });
    }

    // Otherwise, import (copy) the folder into the projects directory
    let folder_name = src
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .ok_or("Could not determine folder name")?;

    let mut dest = projects_dir.join(&folder_name);
    if dest.exists() {
        let mut counter = 1;
        while dest.exists() {
            dest = projects_dir.join(format!("{} ({})", folder_name, counter));
            counter += 1;
        }
    }

    let dest_clone = dest.clone();
    tokio::task::spawn_blocking(move || copy_dir_recursive(&src, &dest_clone))
        .await
        .map_err(|_| "Blocking task panicked".to_string())?
        .map_err(|e| format!("Failed to copy folder: {}", e))?;

    let folder_path = dest
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_default();

    Ok(FolderDropResult {
        folder_path,
        is_linked: false,
    })
}

/// Link a folder in-place as a project (no copy). Returns the relative path
/// from the projects directory, or the folder name if outside.
#[tauri::command]
pub fn link_folder_as_project(source_path: String) -> Result<String, String> {
    let normalized = normalize_path(&source_path);
    let src = canonical_existing_path(Path::new(&normalized))?;
    if !src.exists() {
        return Err(format!("Source folder not found: {}", source_path));
    }
    if !src.is_dir() {
        return Err(format!("Source path is not a directory: {}", source_path));
    }

    let projects_dir = canonical_existing_path(&get_projects_dir()?)?;
    if src == projects_dir {
        return Err("Select a project folder, not the projects directory itself".to_string());
    }

    // ponytail: if the source is already inside the projects directory, preserve
    // the relative path so nested folders work correctly.
    if src.starts_with(&projects_dir) {
        let relative = src
            .strip_prefix(&projects_dir)
            .map_err(|_| "Could not compute relative path")?;
        // ponytail: normalize to forward slashes so the path works cross-platform
        return Ok(relative.to_string_lossy().to_string().replace('\\', "/"));
    }

    // ponytail: reject folders outside the projects directory — file lookups
    // expect the folder to be inside projects_dir.
    Err(format!(
        "Please select a folder inside the projects directory ({}). \
You can change the projects directory above, or use \"Import folder\" to copy it in.",
        projects_dir.display()
    ))
}

#[tauri::command]
pub async fn import_folder_to_project(
    app: AppHandle,
    source_path: String,
) -> Result<String, String> {
    let normalized = normalize_path(&source_path);
    let src = canonical_existing_path(Path::new(&normalized))?;
    if !src.exists() {
        return Err(format!("Source folder not found: {}", source_path));
    }
    if !src.is_dir() {
        return Err(format!("Source path is not a directory: {}", source_path));
    }

    let folder_name = src
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .ok_or("Could not determine folder name")?;

    let projects_dir = canonical_existing_path(&get_projects_dir()?)?;
    if src == projects_dir {
        return Err("Select a project folder, not the projects directory itself".to_string());
    }

    // ponytail: if the source is already inside the projects directory, there is
    // nothing to copy — preserve its relative path so nested folders still work.
    if src.starts_with(&projects_dir) {
        return src
            .strip_prefix(&projects_dir)
            .map(|path| path.to_string_lossy().to_string().replace('\\', "/"))
            .map_err(|_| "Could not compute relative path".to_string());
    }

    let mut dest = projects_dir.join(&folder_name);

    if dest.exists() {
        let mut counter = 1;
        while dest.exists() {
            dest = projects_dir.join(format!("{} ({})", folder_name, counter));
            counter += 1;
        }
    }

    let total = count_files(&src);
    let app_for_progress = app.clone();
    let _ = app_for_progress.emit("import-progress", ImportProgress { completed: 0, total });

    // ponytail: offload blocking recursive copy to a spawn_blocking task so the
    // async runtime worker (and the UI) stays responsive.
    let dest_clone = dest.clone();
    let app_clone = app.clone();
    let copy_result = tokio::task::spawn_blocking(move || {
        let mut completed = 0;
        copy_dir_recursive_with_progress(&src, &dest_clone, &mut completed, total, &app_clone)
    })
    .await
    .map_err(|_| "Blocking task panicked".to_string())?;
    copy_result.map_err(|e| format!("Failed to copy folder: {}", e))?;

    let _ = app.emit("import-progress", ImportProgress { completed: total, total });

    Ok(dest
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_default())
}

#[tauri::command]
pub async fn rename_project_folder(old_name: String, new_name: String) -> Result<(), String> {
    let projects_dir = get_projects_dir()?;
    let old_path = project_destination_path(&projects_dir, &old_name)?;
    let new_path = project_destination_path(&projects_dir, &new_name)?;

    if !old_path.exists() {
        return Err(format!("Folder not found: {}", old_name));
    }
    if !old_path.is_dir() {
        return Err(format!("Path is not a directory: {}", old_name));
    }
    if new_path.exists() {
        return Err(format!(
            "A folder named \"{}\" already exists",
            new_name
        ));
    }

    let old_clone = old_path.clone();
    let new_clone = new_path.clone();
    let name_for_error = new_name.clone();
    tokio::task::spawn_blocking(move || {
        // ponytail: try a fast atomic rename first. On the same filesystem
        // this moves all files and subdirectories instantly.
        if let Err(e) = std::fs::rename(&old_clone, &new_clone) {
            if !rename_landed_after_error(&old_clone, &new_clone) && old_clone.exists() {
                    // ponytail: fallback to recursive copy + delete when the OS
                    // refuses a direct rename (e.g. locked files on Windows).
                    // This is slower but guarantees all contents move across.
                    if let Err(copy_err) = copy_dir_recursive(&old_clone, &new_clone) {
                        return Err(format!(
                            "Failed to rename folder: {}. Copy fallback also failed: {}",
                            e, copy_err
                        ));
                    }
                    if let Err(remove_err) = std::fs::remove_dir_all(&old_clone) {
                        return Err(format!(
                            "Folder copied to \"{}\" but could not remove old folder: {}. Please delete it manually.",
                            name_for_error, remove_err
                        ));
                    }
                // ponytail: src gone after failed rename — filesystem driver already
                // moved it; treat as success.
            }
        }
        Ok(())
    })
    .await
    .map_err(|_| "Blocking task panicked".to_string())?
}

/// Copy an entire project folder (recursive) within the projects directory.
#[tauri::command]
pub async fn copy_project_folder(source_name: String, dest_name: String) -> Result<(), String> {
    let projects_dir = get_projects_dir()?;
    let src = project_destination_path(&projects_dir, &source_name)?;
    let dest = project_destination_path(&projects_dir, &dest_name)?;

    if !src.exists() {
        return Err(format!("Source folder not found: {}", source_name));
    }
    if !src.is_dir() {
        return Err(format!("Source path is not a directory: {}", source_name));
    }
    if dest.exists() {
        return Err(format!("A folder named \"{}\" already exists", dest_name));
    }

    let dest_clone = dest.clone();
    tokio::task::spawn_blocking(move || {
        std::fs::create_dir_all(&dest_clone)
            .map_err(|e| format!("Failed to create destination: {}", e))?;
        copy_dir_recursive(&src, &dest_clone)
            .map_err(|e| format!("Failed to copy folder contents: {}", e))
    })
    .await
    .map_err(|_| "Blocking task panicked".to_string())??;

    Ok(())
}

fn read_project_files_recursive(
    dir: &Path,
    query: &str,
    project_prefix: &str,
) -> Result<Vec<SearchResult>, String> {
    let mut results = Vec::new();

    let entries = std::fs::read_dir(dir).map_err(|e| format!("Failed to read directory: {}", e))?;

    for entry in entries {
        let entry = entry.map_err(|e| format!("Failed to read entry: {}", e))?;
        let path = entry.path();
        let file_name = entry.file_name().to_string_lossy().to_string();

        if file_name == ".DS_Store" {
            continue;
        }
        if path.is_file() && file_name.to_lowercase().contains(query) {
            let metadata = entry
                .metadata()
                .map_err(|e| format!("Failed to read metadata: {}", e))?;
            let extension = path
                .extension()
                .map(|e| e.to_string_lossy().to_string())
                .unwrap_or_default();
            let modified = metadata
                .modified()
                .ok()
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| d.as_secs())
                .unwrap_or(0);

            let file_info = FileInfo {
                name: file_name,
                path: path.to_string_lossy().to_string(),
                size: metadata.len(),
                modified,
                extension,
                tags: None,
                subfolder: None,
                is_favorite: None,
            };

            results.push(SearchResult {
                file: file_info,
                project_folder: project_prefix.to_string(),
            });
        } else if path.is_dir() {
            // Recursively search subdirectories
            if let Ok(mut subresults) = read_project_files_recursive(&path, query, project_prefix) {
                results.append(&mut subresults);
            }
        }
    }

    Ok(results)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn inbox_copy_preserves_source_and_reports_failure() {
        let base = std::env::temp_dir().join(format!(
            "focal-inbox-{}",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let root = base.join("projects");
        std::fs::create_dir_all(&root).unwrap();
        let source = base.join("Chemistry 100%20complete.txt");
        std::fs::write(&source, "assessment material").unwrap();
        let source_path = source.to_string_lossy().to_string();
        assert_eq!(normalize_path(&source_path), source_path);
        assert_eq!(
            normalize_path(tauri::Url::from_file_path(&source).unwrap().as_str()),
            source_path
        );
        *projects_dir_override().lock().unwrap() = Some(root.clone());
        let runtime = tokio::runtime::Builder::new_current_thread()
            .build()
            .unwrap();
        runtime.block_on(async {
            let copied =
                move_files_to_project(vec![source_path.clone()], "Chemistry".into(), Some(true))
                    .await
                    .unwrap();
            assert_eq!(copied.len(), 1);
            assert_eq!(
                std::fs::read(&copied[0]).unwrap(),
                std::fs::read(&source).unwrap()
            );
            let duplicate =
                move_files_to_project(vec![source_path.clone()], "Chemistry".into(), Some(true))
                    .await
                    .unwrap();
            assert_ne!(copied, duplicate);
            remember_moved_file(&source_path, Path::new(&copied[0]));
            std::fs::remove_file(&source).unwrap();
            assert!(move_files_to_project(
                vec![source_path],
                "Other assessment".into(),
                Some(true)
            )
            .await
            .is_err());
            assert_eq!(
                std::fs::read_dir(root.join("Other assessment"))
                    .unwrap()
                    .count(),
                0
            );
        });
        *projects_dir_override().lock().unwrap() = None;
        std::fs::remove_dir_all(base).unwrap();
    }

    #[test]
    fn project_child_path_rejects_paths() {
        let root = Path::new("projects");
        assert_eq!(
            project_child_path(root, "Chemistry/Unit 3").unwrap(),
            root.join("Chemistry/Unit 3")
        );
        for unsafe_name in [
            "",
            ".",
            "..",
            "../outside",
            "Chemistry/../../outside",
            "/outside",
        ] {
            assert!(
                project_child_path(root, unsafe_name).is_err(),
                "accepted {unsafe_name:?}"
            );
        }
        #[cfg(windows)]
        assert!(project_child_path(root, r"C:\outside").is_err());
        assert!(project_file_path(root, "notes.txt").is_ok());
        assert!(project_file_path(root, "../notes.txt").is_err());
        assert!(project_file_path(root, "folder/notes.txt").is_err());
    }

    #[test]
    fn canonical_project_descendant_rejects_root_and_outside() {
        let base = std::env::temp_dir().join(format!(
            "focal-path-test-{}",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let root = base.join("projects");
        let inside = root.join("notes.txt");
        let outside = base.join("outside.txt");
        std::fs::create_dir_all(&root).unwrap();
        std::fs::write(&inside, "inside").unwrap();
        std::fs::write(&outside, "outside").unwrap();

        assert_eq!(canonical_project_descendant(&root, &inside).unwrap(), inside);
        assert!(canonical_project_descendant(&root, &root).is_err());
        assert!(canonical_project_descendant(&root, &outside).is_err());

        let _ = std::fs::remove_dir_all(base);
    }

    #[test]
    fn projects_directory_rejects_file() {
        let file = std::env::temp_dir().join(format!(
            "focal-projects-root-test-{}",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::write(&file, "not a directory").unwrap();

        assert!(set_projects_directory(file.to_string_lossy().to_string()).is_err());

        let _ = std::fs::remove_file(file);
    }

    #[test]
    fn search_result_serializes_for_frontend() {
        let result = SearchResult {
            file: FileInfo {
                name: "notes.txt".into(),
                path: "Chemistry/notes.txt".into(),
                size: 4,
                modified: 0,
                extension: "txt".into(),
                tags: None,
                subfolder: None,
                is_favorite: Some(true),
            },
            project_folder: "Chemistry".into(),
        };
        let value = serde_json::to_value(result).unwrap();
        assert_eq!(value["projectFolder"], "Chemistry");
        assert_eq!(value["file"]["isFavorite"], true);
        assert!(value.get("project_folder").is_none());
    }

    #[test]
    fn rename_landed_after_error_dest_exists() {
        let base = std::env::temp_dir().join(format!(
            "rename_landed_after_error_dest_exists-{}",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir(&base).unwrap();
        let src = base.join("old.txt");
        let dest = base.join("new.txt");
        std::fs::write(&dest, "moved").unwrap();

        // dest exists, src does not — typical "rename landed after error"
        assert!(rename_landed_after_error(&src, &dest));

        let _ = std::fs::remove_dir_all(base);
    }

    #[test]
    fn rename_landed_after_error_both_exist() {
        let base = std::env::temp_dir().join(format!(
            "rename_landed_after_error_both_exist-{}",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir(&base).unwrap();
        let src = base.join("old.txt");
        let dest = base.join("new.txt");
        std::fs::write(&src, "original").unwrap();
        std::fs::write(&dest, "moved").unwrap();

        // dest exists even though src also exists — the rename landed
        assert!(rename_landed_after_error(&src, &dest));

        let _ = std::fs::remove_dir_all(base);
    }

    #[test]
    fn rename_landed_after_error_neither_exist() {
        let base = std::env::temp_dir().join(format!(
            "rename_landed_after_error_neither_exist-{}",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir(&base).unwrap();
        let src = base.join("old.txt");
        let dest = base.join("new.txt");

        // neither exists — rename did not land
        assert!(!rename_landed_after_error(&src, &dest));

        let _ = std::fs::remove_dir_all(base);
    }
}
