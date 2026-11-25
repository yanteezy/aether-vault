//! The data folder: every storage key of the app is one small file, photos sit next to them.
//!
//! <folder>/aether-data.json   marker ("this is an Aether data folder")
//! <folder>/data/<key>.json     one file per key (notes of a workspace, its links, settings…)
//! <folder>/images/<id>.<ext>   photos used by notes
//!
//! The folder is the system app-data folder unless the user picked their own (Settings → General → Data folder);
//! the choice is kept in <app config>/data-location.json.

use serde::Serialize;
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::{AppHandle, Manager, State};

const MANIFEST: &str = "aether-data.json";
const LOCATION: &str = "data-location.json";

#[derive(Default)]
pub struct DataDir(pub Mutex<Option<PathBuf>>);

fn es<E: std::fmt::Display>(e: E) -> String {
  e.to_string()
}

fn default_dir(app: &AppHandle) -> Result<PathBuf, String> {
  Ok(app.path().app_data_dir().map_err(es)?.join("data"))
}

fn location_file(app: &AppHandle) -> Result<PathBuf, String> {
  Ok(app.path().app_config_dir().map_err(es)?.join(LOCATION))
}

/// (folder, picked by the user?)
fn configured_dir(app: &AppHandle) -> Result<(PathBuf, bool), String> {
  if let Ok(text) = fs::read_to_string(location_file(app)?) {
    if let Ok(v) = serde_json::from_str::<serde_json::Value>(&text) {
      if let Some(d) = v.get("dir").and_then(|d| d.as_str()) {
        if !d.is_empty() {
          return Ok((PathBuf::from(d), true));
        }
      }
    }
  }
  Ok((default_dir(app)?, false))
}

pub(crate) fn current(state: &State<'_, DataDir>) -> Result<PathBuf, String> {
  state
    .0
    .lock()
    .map_err(es)?
    .clone()
    .ok_or_else(|| "data folder is not loaded".to_string())
}

/// Storage key -> file name: letters, digits, '-', '_' stay, everything else is %XX.
fn key_to_file(key: &str) -> String {
  let mut out = String::new();
  for b in key.bytes() {
    if b.is_ascii_alphanumeric() || b == b'-' || b == b'_' {
      out.push(b as char);
    } else {
      out.push_str(&format!("%{:02X}", b));
    }
  }
  out.push_str(".json");
  out
}

fn file_to_key(name: &str) -> Option<String> {
  let stem = name.strip_suffix(".json")?;
  let bytes = stem.as_bytes();
  let mut out = Vec::with_capacity(bytes.len());
  let mut i = 0;
  while i < bytes.len() {
    if bytes[i] == b'%' && i + 2 < bytes.len() {
      let hex = std::str::from_utf8(&bytes[i + 1..i + 3]).ok()?;
      out.push(u8::from_str_radix(hex, 16).ok()?);
      i += 3;
    } else {
      out.push(bytes[i]);
      i += 1;
    }
  }
  String::from_utf8(out).ok()
}

fn valid_image_id(id: &str) -> bool {
  !id.is_empty() && id.len() < 80 && id.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
}

/// Write via a temporary file, so a crash never leaves half a file.
fn write_atomic(path: &Path, bytes: &[u8]) -> Result<(), String> {
  if let Some(parent) = path.parent() {
    fs::create_dir_all(parent).map_err(es)?;
  }
  let tmp = path.with_extension("tmp");
  fs::write(&tmp, bytes).map_err(es)?;
  fs::rename(&tmp, path).map_err(|e| {
    let _ = fs::remove_file(&tmp);
    es(e)
  })
}

fn write_manifest(dir: &Path) -> Result<(), String> {
  write_atomic(&dir.join(MANIFEST), br#"{"app":"Aether","format":1}"#)
}

#[derive(Serialize)]
pub struct Loaded {
  dir: String,
  custom: bool,
  /// no marker yet: the first launch with a data folder (the app then copies its old data in)
  fresh: bool,
  entries: HashMap<String, String>,
}

#[tauri::command]
pub fn data_load(app: AppHandle, state: State<'_, DataDir>) -> Result<Loaded, String> {
  let (dir, custom) = configured_dir(&app)?;
  // a picked folder that is gone (unplugged drive, Dropbox not running…): never start empty over it
  if custom && !dir.is_dir() {
    return Err(format!("missing-dir:{}", dir.display()));
  }
  fs::create_dir_all(dir.join("data")).map_err(es)?;
  let fresh = !dir.join(MANIFEST).exists();
  let mut entries = HashMap::new();
  for e in fs::read_dir(dir.join("data")).map_err(es)?.flatten() {
    let name = e.file_name().to_string_lossy().into_owned();
    if let Some(key) = file_to_key(&name) {
      if let Ok(text) = fs::read_to_string(e.path()) {
        entries.insert(key, text);
      }
    }
  }
  *state.0.lock().map_err(es)? = Some(dir.clone());
  Ok(Loaded { dir: dir.to_string_lossy().into_owned(), custom, fresh, entries })
}

#[tauri::command]
pub fn data_ready(state: State<'_, DataDir>) -> Result<(), String> {
  write_manifest(&current(&state)?)
}

#[tauri::command]
pub fn data_write(state: State<'_, DataDir>, key: String, value: String) -> Result<(), String> {
  let dir = current(&state)?;
  if !dir.is_dir() {
    return Err(format!("missing-dir:{}", dir.display()));
  }
  write_atomic(&dir.join("data").join(key_to_file(&key)), value.as_bytes())
}

#[tauri::command]
pub fn data_remove(state: State<'_, DataDir>, key: String) -> Result<(), String> {
  let path = current(&state)?.join("data").join(key_to_file(&key));
  match fs::remove_file(path) {
    Ok(()) => Ok(()),
    Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
    Err(e) => Err(es(e)),
  }
}

// ---------- photos ----------

fn find_image(dir: &Path, id: &str) -> Option<PathBuf> {
  for ext in ["jpg", "png", "webp", "gif", "img"] {
    let p = dir.join("images").join(format!("{}.{}", id, ext));
    if p.is_file() {
      return Some(p);
    }
  }
  None
}

#[tauri::command]
pub fn image_write(state: State<'_, DataDir>, request: tauri::ipc::Request<'_>) -> Result<(), String> {
  let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
    return Err("expected image bytes".into());
  };
  let header = |name: &str| request.headers().get(name).and_then(|v| v.to_str().ok()).map(|s| s.to_string());
  let id = header("x-image-id").ok_or("missing image id")?;
  if !valid_image_id(&id) {
    return Err("bad image id".into());
  }
  let ext = match header("x-image-ext").as_deref() {
    Some("png") => "png",
    Some("webp") => "webp",
    Some("gif") => "gif",
    _ => "jpg",
  };
  let dir = current(&state)?;
  if let Some(old) = find_image(&dir, &id) {
    let _ = fs::remove_file(old);
  }
  write_atomic(&dir.join("images").join(format!("{}.{}", id, ext)), bytes)
}

#[tauri::command]
pub fn image_read(state: State<'_, DataDir>, id: String) -> Result<tauri::ipc::Response, String> {
  if !valid_image_id(&id) {
    return Err("bad image id".into());
  }
  let bytes = match find_image(&current(&state)?, &id) {
    Some(p) => fs::read(p).map_err(es)?,
    None => Vec::new(),
  };
  Ok(tauri::ipc::Response::new(bytes))
}

#[tauri::command]
pub fn image_delete(state: State<'_, DataDir>, id: String) -> Result<(), String> {
  if !valid_image_id(&id) {
    return Err("bad image id".into());
  }
  if let Some(p) = find_image(&current(&state)?, &id) {
    fs::remove_file(p).map_err(es)?;
  }
  Ok(())
}

#[tauri::command]
pub fn image_list(state: State<'_, DataDir>) -> Result<Vec<String>, String> {
  let dir = current(&state)?.join("images");
  let mut out = Vec::new();
  if let Ok(rd) = fs::read_dir(dir) {
    for e in rd.flatten() {
      let name = e.file_name().to_string_lossy().into_owned();
      if let Some((stem, _)) = name.rsplit_once('.') {
        if valid_image_id(stem) {
          out.push(stem.to_string());
        }
      }
    }
  }
  Ok(out)
}

// ---------- choosing the folder ----------

/// The folder the data really goes to: the picked one when it is ours / empty / called "Aether",
/// otherwise a new "Aether" folder inside it (so picking "Documents" does not scatter files there).
fn resolve_target(p: &Path) -> PathBuf {
  if p.join(MANIFEST).exists() {
    return p.to_path_buf();
  }
  let sub = p.join("Aether");
  if sub.join(MANIFEST).exists() {
    return sub;
  }
  let empty = fs::read_dir(p).map(|mut d| d.next().is_none()).unwrap_or(true);
  let named = p.file_name().map(|n| n.eq_ignore_ascii_case("aether")).unwrap_or(false);
  if empty || named {
    p.to_path_buf()
  } else {
    sub
  }
}

fn count_notes(dir: &Path) -> usize {
  let mut n = 0;
  if let Ok(rd) = fs::read_dir(dir.join("data")) {
    for e in rd.flatten() {
      let name = e.file_name().to_string_lossy().into_owned();
      if name == "notes.json" || name.ends_with("%3Anotes.json") {
        if let Ok(text) = fs::read_to_string(e.path()) {
          if let Ok(serde_json::Value::Array(a)) = serde_json::from_str::<serde_json::Value>(&text) {
            n += a.len();
          }
        }
      }
    }
  }
  n
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FolderInfo {
  target: String,
  has_data: bool,
  notes: usize,
}

#[tauri::command]
pub async fn data_pick_dir(app: AppHandle) -> Option<String> {
  use tauri_plugin_dialog::DialogExt;
  let picked = app.dialog().file().blocking_pick_folder()?;
  picked.into_path().ok().map(|p| p.to_string_lossy().into_owned())
}

#[tauri::command]
pub fn data_default_dir(app: AppHandle) -> Result<String, String> {
  let d = default_dir(&app)?;
  fs::create_dir_all(&d).map_err(es)?;
  Ok(d.to_string_lossy().into_owned())
}

#[tauri::command]
pub fn data_inspect_dir(path: String) -> Result<FolderInfo, String> {
  let p = PathBuf::from(&path);
  if !p.is_dir() {
    return Err(format!("missing-dir:{}", path));
  }
  let target = resolve_target(&p);
  let has_data = target.join(MANIFEST).exists();
  let notes = if has_data { count_notes(&target) } else { 0 };
  Ok(FolderInfo { target: target.to_string_lossy().into_owned(), has_data, notes })
}

fn copy_tree(from: &Path, to: &Path) -> Result<(), String> {
  if !from.is_dir() {
    return Ok(());
  }
  fs::create_dir_all(to).map_err(es)?;
  for e in fs::read_dir(from).map_err(es)?.flatten() {
    let src = e.path();
    if src.is_file() && src.extension().map(|x| x != "tmp").unwrap_or(true) {
      fs::copy(&src, to.join(e.file_name())).map_err(es)?;
    }
  }
  Ok(())
}

/// Switch folders. adopt: use the data already in it; otherwise copy the current data there.
/// The previous folder is left untouched (a safety copy).
#[tauri::command]
pub fn data_set_dir(app: AppHandle, state: State<'_, DataDir>, path: String, adopt: bool) -> Result<String, String> {
  let p = PathBuf::from(&path);
  if !p.is_dir() {
    return Err(format!("missing-dir:{}", path));
  }
  let target = resolve_target(&p);
  // None: the previous folder could not be opened (the "folder is missing" screen) — nothing to copy then
  let from = current(&state).ok();
  if from.as_ref() != Some(&target) {
    if adopt {
      if !target.join(MANIFEST).exists() {
        return Err("no-data".into());
      }
    } else {
      if target.join(MANIFEST).exists() {
        return Err("has-data".into());
      }
      if let Some(from) = &from {
        copy_tree(&from.join("data"), &target.join("data"))?;
        copy_tree(&from.join("images"), &target.join("images"))?;
      }
    }
    fs::create_dir_all(target.join("data")).map_err(es)?;
    write_manifest(&target)?;
  }
  let loc = location_file(&app)?;
  if target == default_dir(&app)? {
    let _ = fs::remove_file(&loc);
  } else {
    let text = serde_json::json!({ "dir": target.to_string_lossy() }).to_string();
    write_atomic(&loc, text.as_bytes())?;
  }
  *state.0.lock().map_err(es)? = Some(target.clone());
  Ok(target.to_string_lossy().into_owned())
}

/// The picked folder is gone: go back to the default one (its data stays as it was).
#[tauri::command]
pub fn data_use_default(app: AppHandle) -> Result<(), String> {
  let loc = location_file(&app)?;
  match fs::remove_file(loc) {
    Ok(()) => Ok(()),
    Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
    Err(e) => Err(es(e)),
  }
}
