//! Vaults as plain folders inside the data folder: a note is a `.md` file, the board a `.canvas` file.
//! Rust only moves text and bytes safely; what is inside the files is made and read in TypeScript
//! (`src/features/formats/`).
//!
//! <data folder>/<vault>/.aether/vault.json
//! <data folder>/<vault>/.aether/canvas-extra/<board>.json
//! <data folder>/<vault>/<board>.canvas, <note>.md
//! <data folder>/<vault>/attachments/<id>.<ext>
//! <data folder>/<vault>/.trash/            nothing is deleted outright
//!
//! shortcut: notes sit directly in the vault folder; subfolders come with opening Obsidian vaults (step 1d).

use crate::data::{current, DataDir};
use serde::Serialize;
use std::collections::{HashMap, HashSet};
use std::fs;
use std::io::{ErrorKind, Write};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::thread::JoinHandle;
use std::time::SystemTime;
use tauri::State;

/// Longest file name stem, in bytes (macOS allows 255; room is left for " 999", the extension and the temp suffix).
const MAX_STEM_BYTES: usize = 180;
/// Windows programs (Explorer, sync clients) still stumble over longer full paths.
const MAX_PATH_UNITS: usize = 240;
const UNTITLED: &str = "Без назви";

fn es<E: std::fmt::Display>(e: E) -> String {
  e.to_string()
}

// ---------- names ----------

fn reserved(stem: &str) -> bool {
  // Windows device names are reserved with any extension: "CON", "con.txt"…
  let base = stem.split('.').next().unwrap_or("").trim_end().to_ascii_uppercase();
  matches!(base.as_str(), "CON" | "PRN" | "AUX" | "NUL" | "CONIN$" | "CONOUT$")
    || (base.len() >= 4
      && (base.starts_with("COM") || base.starts_with("LPT"))
      && matches!(&base[3..], "0" | "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" | "¹" | "²" | "³"))
}

/// Cut at a character boundary so that the text fits both limits.
fn truncate(s: &str, max_bytes: usize, max_units: usize) -> &str {
  let (mut bytes, mut units) = (0, 0);
  for (i, c) in s.char_indices() {
    bytes += c.len_utf8();
    units += c.len_utf16();
    if bytes > max_bytes || units > max_units {
      return &s[..i];
    }
  }
  s
}

/// A title as a file name that Windows, macOS and Obsidian all accept.
pub fn safe_stem(title: &str, max_units: usize) -> String {
  let cleaned: String = title
    .chars()
    // the second group breaks [[links]] in Obsidian
    .map(|c| if c.is_control() || "<>:\"/\\|?*[]#^".contains(c) { '-' } else { c })
    .collect();
  // no leading dot (hidden file), no trailing dot or space (Windows drops them)
  let trim = |s: &str| s.trim().trim_start_matches('.').trim_end_matches(['.', ' ']).trim().to_string();
  let mut stem = trim(truncate(&trim(&cleaned), MAX_STEM_BYTES, max_units));
  if stem.is_empty() {
    stem = UNTITLED.to_string();
  }
  if reserved(&stem) {
    stem.insert(0, '_');
  }
  stem
}

/// A single file name from the app: it must not be able to leave its folder.
fn checked(name: &str) -> Result<&str, String> {
  let bad = name.is_empty()
    || name.starts_with('.')
    || name.ends_with(['.', ' '])
    || name.chars().any(|c| c.is_control() || "<>:\"/\\|?*".contains(c))
    || reserved(name);
  if bad { Err(format!("bad-name:{}", name)) } else { Ok(name) }
}

fn with_ext<'a>(name: &'a str, ext: &str) -> Result<&'a str, String> {
  if checked(name)?.to_lowercase().ends_with(ext) { Ok(name) } else { Err(format!("bad-name:{}", name)) }
}

/// Names already taken in a folder, lower-cased: Windows and macOS ignore case.
fn taken(dir: &Path) -> Result<HashSet<String>, String> {
  match fs::read_dir(dir) {
    Ok(entries) => Ok(entries.flatten().map(|e| e.file_name().to_string_lossy().to_lowercase()).collect()),
    Err(e) if e.kind() == ErrorKind::NotFound => Ok(HashSet::new()),
    Err(e) => Err(es(e)),
  }
}

/// `<title><ext>`, or `<title> 2<ext>`… when taken. `own` is the file's current name: it doesn't count as taken.
pub fn free_name(dir: &Path, title: &str, ext: &str, own: Option<&str>) -> Result<String, String> {
  let used = taken(dir)?;
  let dir_units = dir.to_string_lossy().encode_utf16().count();
  let room = MAX_PATH_UNITS.saturating_sub(dir_units + ext.len() + 5).max(20);
  let stem = safe_stem(title, room);
  let own = own.map(str::to_lowercase);
  let mut name = format!("{}{}", stem, ext);
  let mut n = 2;
  while used.contains(&name.to_lowercase()) && own.as_deref() != Some(name.to_lowercase().as_str()) {
    name = format!("{} {}{}", stem, n, ext);
    n += 1;
  }
  Ok(name)
}

// ---------- files ----------

/// Write through a temporary file, so a crash never leaves half a file. The temporary name keeps the full
/// file name: `X.md` and `X.canvas` must not share one.
fn write_atomic(path: &Path, bytes: &[u8]) -> Result<(), String> {
  let parent = path.parent().ok_or("bad path")?;
  fs::create_dir_all(parent).map_err(es)?;
  let name = path.file_name().ok_or("bad path")?.to_string_lossy();
  let tmp = parent.join(format!(".{}.aether-tmp", name));
  let result = (|| {
    let mut f = fs::File::create(&tmp)?;
    f.write_all(bytes)?;
    f.sync_all()?;
    drop(f);
    fs::rename(&tmp, path)
  })();
  result.map_err(|e| {
    let _ = fs::remove_file(&tmp);
    es(e)
  })
}

/// An existing vault folder inside the data folder.
fn vault_dir(root: &Path, vault: &str) -> Result<PathBuf, String> {
  let dir = root.join(checked(vault)?);
  // never recreate a vault that is gone (unplugged drive, cloud folder not synced yet)
  if !dir.is_dir() {
    return Err(format!("missing-dir:{}", dir.display()));
  }
  Ok(dir)
}

/// Deleting moves the file to the vault's `.trash`, under a free name.
fn trash(vault: &Path, path: &Path) -> Result<(), String> {
  if !path.is_file() {
    return Ok(());
  }
  let bin = vault.join(".trash");
  fs::create_dir_all(&bin).map_err(es)?;
  let name = path.file_name().ok_or("bad path")?.to_string_lossy().into_owned();
  let (stem, ext) = match name.rfind('.') {
    Some(i) => name.split_at(i),
    None => (name.as_str(), ""),
  };
  let target = bin.join(free_name(&bin, stem, ext, None)?);
  fs::rename(path, target).map_err(es)
}

pub fn write_note(vault: &Path, file: &str, text: &str, create: bool) -> Result<(), String> {
  let path = vault.join(with_ext(file, ".md")?);
  if create && taken(vault)?.contains(&file.to_lowercase()) {
    return Err("exists".into());
  }
  write_atomic(&path, text.as_bytes())
}

/// Rename a note after its new title; returns the file name it got. Never replaces another file.
pub fn rename_note(vault: &Path, file: &str, title: &str) -> Result<String, String> {
  let from = vault.join(with_ext(file, ".md")?);
  if !from.is_file() {
    return Err(format!("missing-file:{}", file));
  }
  let to = free_name(vault, title, ".md", Some(file))?;
  if to != file {
    fs::rename(&from, vault.join(&to)).map_err(es)?;
  }
  Ok(to)
}

// ---------- reading a vault ----------

#[derive(Serialize)]
pub struct TextFile {
  file: String,
  text: String,
}

#[derive(Serialize, Default)]
pub struct VaultSnapshot {
  /// `.aether/vault.json`
  meta: String,
  notes: Vec<TextFile>,
  canvases: Vec<TextFile>,
  /// board name → `.aether/canvas-extra/<name>.json`
  extras: HashMap<String, String>,
  attachments: Vec<String>,
  /// files that exist but could not be read (locked, not downloaded from the cloud, not UTF-8):
  /// the app must not treat them as deleted
  unreadable: Vec<String>,
}

fn files(dir: &Path) -> Result<Vec<String>, String> {
  let entries = match fs::read_dir(dir) {
    Ok(e) => e,
    Err(e) if e.kind() == ErrorKind::NotFound => return Ok(Vec::new()),
    Err(e) => return Err(es(e)),
  };
  let mut out = Vec::new();
  for entry in entries {
    let entry = entry.map_err(es)?;
    let name = entry.file_name().to_string_lossy().into_owned();
    // the listing already says what each entry is (a separate check per file took 1 s for 10 000 notes);
    // only a link needs a look at what it points to
    let kind = entry.file_type().map_err(es)?;
    if !name.starts_with('.') && (kind.is_file() || (kind.is_symlink() && entry.path().is_file())) {
      out.push(name);
    }
  }
  out.sort();
  Ok(out)
}

/// Most of the time goes into opening many small files (antivirus included), so several threads share them.
/// The answers keep the order of `names`; `None` = the file could not be read.
fn read_all(dir: &Path, names: &[String]) -> Vec<Option<String>> {
  let threads = std::thread::available_parallelism().map(|n| n.get() * 2).unwrap_or(4).min(32);
  let size = names.len().div_ceil(threads).max(1);
  std::thread::scope(|scope| {
    let parts: Vec<_> = names
      .chunks(size)
      .map(|part| (part.len(), scope.spawn(move || part.iter().map(|n| fs::read_to_string(dir.join(n)).ok()).collect::<Vec<_>>())))
      .collect();
    parts
      .into_iter()
      // a failed thread must not make files look deleted: they count as unreadable
      .flat_map(|(len, part)| part.join().unwrap_or_else(|_| vec![None; len]))
      .collect()
  })
}

pub fn read_vault(vault: &Path) -> Result<VaultSnapshot, String> {
  let mut out = VaultSnapshot { meta: fs::read_to_string(vault.join(".aether").join("vault.json")).map_err(es)?, ..Default::default() };
  let wanted: Vec<String> = files(vault)?
    .into_iter()
    .filter(|n| {
      let lower = n.to_lowercase();
      lower.ends_with(".md") || lower.ends_with(".canvas")
    })
    .collect();
  for (name, text) in wanted.iter().zip(read_all(vault, &wanted)) {
    match text {
      Some(text) => {
        let list = if name.to_lowercase().ends_with(".md") { &mut out.notes } else { &mut out.canvases };
        list.push(TextFile { file: name.clone(), text });
      }
      None => out.unreadable.push(name.clone()),
    }
  }
  let extra_dir = vault.join(".aether").join("canvas-extra");
  for name in files(&extra_dir)? {
    if let Some(board) = name.strip_suffix(".json") {
      match fs::read_to_string(extra_dir.join(&name)) {
        Ok(text) => {
          out.extras.insert(board.to_string(), text);
        }
        Err(_) => out.unreadable.push(format!(".aether/canvas-extra/{}", name)),
      }
    }
  }
  out.attachments = files(&vault.join("attachments"))?;
  Ok(out)
}

// ---------- reading early ----------

/// Every file `read_vault` reads, with its size and time: a different answer means something changed.
type Print = Vec<(String, u64, Option<SystemTime>)>;

fn fingerprint(vault: &Path) -> Print {
  let mut out = Print::new();
  for sub in ["", ".aether", ".aether/canvas-extra", "attachments"] {
    for entry in fs::read_dir(vault.join(sub)).into_iter().flatten().flatten() {
      // on Windows the listing carries these: no extra call per file
      let meta = entry.metadata().ok();
      let name = format!("{}/{}", sub, entry.file_name().to_string_lossy());
      out.push((name, meta.as_ref().map(|m| m.len()).unwrap_or(0), meta.and_then(|m| m.modified().ok())));
    }
  }
  out.sort();
  out
}

struct Early {
  dir: PathBuf,
  print: Print,
  snap: VaultSnapshot,
}

/// The app's vault folders, read while the window is still starting (about a third of a second on Windows).
/// Each copy is handed out once, and only if its folder still looks exactly as it did; otherwise it is read again.
#[derive(Default)]
pub struct EarlyReads {
  thread: Mutex<Option<JoinHandle<Vec<Early>>>>,
  done: Mutex<Vec<Early>>,
}

impl EarlyReads {
  /// `dirs`: the vault folders the app is going to open.
  pub fn start(root: PathBuf, dirs: Vec<String>) -> EarlyReads {
    let thread = std::thread::spawn(move || {
      dirs
        .iter()
        .filter_map(|d| {
          let dir = root.join(checked(d).ok()?);
          // taken before reading: a change during the read makes it differ later
          let print = fingerprint(&dir);
          read_vault(&dir).ok().map(|snap| Early { dir, print, snap })
        })
        .collect()
    });
    EarlyReads { thread: Mutex::new(Some(thread)), done: Mutex::default() }
  }

  fn take(&self, dir: &Path) -> Option<VaultSnapshot> {
    if let Some(thread) = self.thread.lock().ok()?.take() {
      self.done.lock().ok()?.extend(thread.join().ok()?);
    }
    let mut done = self.done.lock().ok()?;
    let at = done.iter().position(|e| e.dir == dir)?;
    let early = done.swap_remove(at);
    (early.print == fingerprint(dir)).then_some(early.snap)
  }
}

/// The folders named by the app's `storage-format` key, once the data folder keeps vaults as folders.
pub fn app_vault_dirs(root: &Path) -> Vec<String> {
  let text = fs::read_to_string(root.join("data").join("storage-format.json")).unwrap_or_default();
  let value: serde_json::Value = serde_json::from_str(&text).unwrap_or_default();
  value["dirs"].as_object().map(|d| d.values().filter_map(|v| v.as_str().map(String::from)).collect()).unwrap_or_default()
}

#[derive(Serialize)]
pub struct VaultEntry {
  dir: String,
  meta: String,
}

/// Every folder of the data folder that is a vault.
pub fn list_vaults(root: &Path) -> Result<Vec<VaultEntry>, String> {
  let mut out = Vec::new();
  for entry in fs::read_dir(root).map_err(es)? {
    let entry = entry.map_err(es)?;
    let marker = entry.path().join(".aether").join("vault.json");
    if marker.is_file() {
      // an unreadable marker is an error, not "no vault"
      let meta = fs::read_to_string(&marker).map_err(es)?;
      out.push(VaultEntry { dir: entry.file_name().to_string_lossy().into_owned(), meta });
    }
  }
  out.sort_by(|a, b| a.dir.cmp(&b.dir));
  Ok(out)
}

/// Write `vault.json`. Without `dir` a new vault folder is made, named after `name`.
pub fn write_meta(root: &Path, dir: Option<&str>, name: &str, meta: &str) -> Result<String, String> {
  let dir = match dir {
    Some(d) => {
      vault_dir(root, d)?;
      d.to_string()
    }
    None => {
      if !root.is_dir() {
        return Err(format!("missing-dir:{}", root.display()));
      }
      // folders the data folder itself uses
      let title = match name.to_lowercase().as_str() {
        "data" | "images" | "backups" => format!("{} (vault)", name),
        _ => name.to_string(),
      };
      let d = free_name(root, &title, "", None)?;
      fs::create_dir(root.join(&d)).map_err(es)?;
      d
    }
  };
  write_atomic(&root.join(&dir).join(".aether").join("vault.json"), meta.as_bytes())?;
  Ok(dir)
}

/// A deleted workspace goes to the data folder's own `.trash`, whole.
pub fn trash_vault(root: &Path, vault: &str) -> Result<(), String> {
  let from = vault_dir(root, vault)?;
  if !from.join(".aether").join("vault.json").is_file() {
    return Err(format!("not-a-vault:{}", vault));
  }
  let bin = root.join(".trash");
  fs::create_dir_all(&bin).map_err(es)?;
  let to = bin.join(free_name(&bin, vault, "", None)?);
  fs::rename(from, to).map_err(es)
}

/// A safety copy kept in `<data folder>/backups`; an existing one is never replaced.
pub fn write_backup(root: &Path, name: &str, contents: &str) -> Result<String, String> {
  if !root.is_dir() {
    return Err(format!("missing-dir:{}", root.display()));
  }
  let dir = root.join("backups");
  fs::create_dir_all(&dir).map_err(es)?;
  let (stem, ext) = match checked(name)?.rfind('.') {
    Some(i) => name.split_at(i),
    None => (name, ""),
  };
  let file = free_name(&dir, stem, ext, None)?;
  write_atomic(&dir.join(&file), contents.as_bytes())?;
  Ok(file)
}

fn copy_all(from: &Path, to: &Path) -> Result<(), String> {
  fs::create_dir_all(to).map_err(es)?;
  for entry in fs::read_dir(from).map_err(es)? {
    let entry = entry.map_err(es)?;
    let (src, dst) = (entry.path(), to.join(entry.file_name()));
    if entry.file_type().map_err(es)?.is_dir() {
      copy_all(&src, &dst)?;
    } else if !entry.file_name().to_string_lossy().ends_with(".aether-tmp") {
      fs::copy(&src, &dst).map_err(es)?;
    }
  }
  Ok(())
}

/// Moving the data folder: every vault folder (with everything in it) and the backups go along.
pub(crate) fn copy_vaults(from: &Path, to: &Path) -> Result<(), String> {
  for vault in list_vaults(from)? {
    copy_all(&from.join(&vault.dir), &to.join(&vault.dir))?;
  }
  if from.join("backups").is_dir() {
    copy_all(&from.join("backups"), &to.join("backups"))?;
  }
  Ok(())
}

/// Notes of a data folder that keeps them in vault folders.
pub(crate) fn count_vault_notes(root: &Path) -> usize {
  let vaults = list_vaults(root).unwrap_or_default();
  vaults
    .iter()
    .map(|v| files(&root.join(&v.dir)).unwrap_or_default().iter().filter(|f| f.to_lowercase().ends_with(".md")).count())
    .sum()
}

pub fn write_canvas(vault: &Path, file: &str, canvas: &str, extra: &str) -> Result<(), String> {
  let board = &with_ext(file, ".canvas")?[..file.len() - ".canvas".len()];
  // the extra file first: if the second write fails, the old board is still whole
  write_atomic(&vault.join(".aether").join("canvas-extra").join(format!("{}.json", board)), extra.as_bytes())?;
  write_atomic(&vault.join(file), canvas.as_bytes())
}

fn percent_decode(s: &str) -> Option<String> {
  let b = s.as_bytes();
  let mut out = Vec::with_capacity(b.len());
  let mut i = 0;
  while i < b.len() {
    if b[i] == b'%' {
      out.push(u8::from_str_radix(s.get(i + 1..i + 3)?, 16).ok()?);
      i += 3;
    } else {
      out.push(b[i]);
      i += 1;
    }
  }
  String::from_utf8(out).ok()
}

// ---------- commands ----------

#[tauri::command]
pub fn vault_list(state: State<'_, DataDir>) -> Result<Vec<VaultEntry>, String> {
  list_vaults(&current(&state)?)
}

#[tauri::command]
pub fn vault_read(state: State<'_, DataDir>, early: State<'_, EarlyReads>, vault: String) -> Result<VaultSnapshot, String> {
  let dir = vault_dir(&current(&state)?, &vault)?;
  match early.take(&dir) {
    Some(snap) => Ok(snap),
    None => read_vault(&dir),
  }
}

#[tauri::command]
pub fn vault_meta_write(state: State<'_, DataDir>, vault: Option<String>, name: String, meta: String) -> Result<String, String> {
  write_meta(&current(&state)?, vault.as_deref(), &name, &meta)
}

#[tauri::command]
pub fn vault_delete(state: State<'_, DataDir>, vault: String) -> Result<(), String> {
  trash_vault(&current(&state)?, &vault)
}

#[tauri::command]
pub fn data_backup(state: State<'_, DataDir>, name: String, contents: String) -> Result<String, String> {
  write_backup(&current(&state)?, &name, &contents)
}

/// The file name a note with this title would get (`current` = its file now).
#[tauri::command]
pub fn note_name(state: State<'_, DataDir>, vault: String, title: String, current_file: Option<String>) -> Result<String, String> {
  free_name(&vault_dir(&current(&state)?, &vault)?, &title, ".md", current_file.as_deref())
}

#[tauri::command]
pub fn note_write(state: State<'_, DataDir>, vault: String, file: String, text: String, create: bool) -> Result<(), String> {
  write_note(&vault_dir(&current(&state)?, &vault)?, &file, &text, create)
}

#[tauri::command]
pub fn note_rename(state: State<'_, DataDir>, vault: String, file: String, title: String) -> Result<String, String> {
  rename_note(&vault_dir(&current(&state)?, &vault)?, &file, &title)
}

#[tauri::command]
pub fn note_delete(state: State<'_, DataDir>, vault: String, file: String) -> Result<(), String> {
  let dir = vault_dir(&current(&state)?, &vault)?;
  trash(&dir, &dir.join(with_ext(&file, ".md")?))
}

#[tauri::command]
pub fn canvas_write(state: State<'_, DataDir>, vault: String, file: String, canvas: String, extra: String) -> Result<(), String> {
  write_canvas(&vault_dir(&current(&state)?, &vault)?, &file, &canvas, &extra)
}

/// Raw bytes in the body; the vault and file name travel percent-encoded in headers.
#[tauri::command]
pub fn attachment_write(state: State<'_, DataDir>, request: tauri::ipc::Request<'_>) -> Result<(), String> {
  let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
    return Err("expected bytes".into());
  };
  let header = |name: &str| -> Result<String, String> {
    let value = request.headers().get(name).and_then(|v| v.to_str().ok()).ok_or_else(|| format!("missing {}", name))?;
    percent_decode(value).ok_or_else(|| format!("bad {}", name))
  };
  let dir = vault_dir(&current(&state)?, &header("x-vault")?)?;
  write_atomic(&dir.join("attachments").join(checked(&header("x-name")?)?), bytes)
}

#[tauri::command]
pub fn attachment_read(state: State<'_, DataDir>, vault: String, name: String) -> Result<tauri::ipc::Response, String> {
  let path = vault_dir(&current(&state)?, &vault)?.join("attachments").join(checked(&name)?);
  match fs::read(path) {
    Ok(bytes) => Ok(tauri::ipc::Response::new(bytes)),
    Err(e) if e.kind() == ErrorKind::NotFound => Ok(tauri::ipc::Response::new(Vec::new())),
    Err(e) => Err(es(e)),
  }
}

#[tauri::command]
pub fn attachment_delete(state: State<'_, DataDir>, vault: String, name: String) -> Result<(), String> {
  let dir = vault_dir(&current(&state)?, &vault)?;
  trash(&dir, &dir.join("attachments").join(checked(&name)?))
}

#[cfg(test)]
mod tests {
  use super::*;

  struct Temp(PathBuf);
  impl Temp {
    fn new(label: &str) -> Temp {
      let dir = std::env::temp_dir().join(format!("aether-test-{}-{}", std::process::id(), label));
      let _ = fs::remove_dir_all(&dir);
      fs::create_dir_all(&dir).unwrap();
      Temp(dir)
    }
  }
  impl Drop for Temp {
    fn drop(&mut self) {
      let _ = fs::remove_dir_all(&self.0);
    }
  }

  #[test]
  fn many_files_are_read_in_order_and_failures_stay_visible() {
    let t = Temp::new("many");
    let dir = write_meta(&t.0, None, "V", "{}").unwrap();
    let v = t.0.join(&dir);
    for i in 0..500 {
      fs::write(v.join(format!("{:03}.md", i)), format!("text {}", i)).unwrap();
    }
    fs::write(v.join("250.md"), [0xff, 0xfe]).unwrap();
    let snap = read_vault(&v).unwrap();
    assert_eq!(snap.unreadable, ["250.md"]);
    assert_eq!(snap.notes.len(), 499);
    assert!(snap.notes.iter().all(|n| n.text == format!("text {}", n.file[..3].parse::<u32>().unwrap())));
  }

  #[test]
  fn titles_become_safe_file_names() {
    assert_eq!(safe_stem("A/B: що?", 200), "A-B- що-");
    assert_eq!(safe_stem("a<>\"\\|*[]#^\n", 200), "a-----------");
    assert_eq!(safe_stem("  ..прихований. . ", 200), "прихований");
    assert_eq!(safe_stem("", 200), UNTITLED);
    assert_eq!(safe_stem("...", 200), UNTITLED);
    for name in ["CON", "nul", "com1", "LPT9", "Aux.txt", "con .md"] {
      assert!(safe_stem(name, 200).starts_with('_'), "{}", name);
    }
    for name in ["CONCERT", "COM10", "Консоль", "lpt"] {
      assert_eq!(safe_stem(name, 200), name);
    }
  }

  #[test]
  fn long_titles_are_cut_between_characters() {
    let stem = safe_stem(&"ї".repeat(500), 200);
    assert!(stem.len() <= MAX_STEM_BYTES && stem.chars().all(|c| c == 'ї'));
    let emoji = safe_stem(&"👋".repeat(100), 21);
    assert_eq!(emoji.encode_utf16().count(), 20);
  }

  #[test]
  fn names_cannot_leave_the_folder() {
    for bad in ["", ".", "..", "../x.md", "a/b.md", "a\\b.md", "C:x.md", ".hidden.md", "x.md ", "NUL.md"] {
      assert!(checked(bad).is_err(), "{:?}", bad);
    }
    assert!(checked("Нотатка 👋.md").is_ok());
    let t = Temp::new("ext");
    assert!(write_note(&t.0, "x.exe", "", false).is_err());
    assert!(write_note(&t.0, "../x.md", "", false).is_err());
  }

  #[test]
  fn a_taken_name_gets_a_number_ignoring_case() {
    let t = Temp::new("free");
    write_note(&t.0, "Нотатка.md", "1", true).unwrap();
    assert_eq!(free_name(&t.0, "нотатка", ".md", None).unwrap(), "нотатка 2.md");
    assert_eq!(free_name(&t.0, "нотатка", ".md", Some("Нотатка.md")).unwrap(), "нотатка.md");
    assert_eq!(write_note(&t.0, "НОТАТКА.md", "2", true), Err("exists".to_string()));
    assert_eq!(fs::read_to_string(t.0.join("Нотатка.md")).unwrap(), "1");
  }

  #[test]
  fn renaming_never_replaces_another_note() {
    let t = Temp::new("rename");
    write_note(&t.0, "A.md", "a", true).unwrap();
    write_note(&t.0, "B.md", "b", true).unwrap();
    assert_eq!(rename_note(&t.0, "A.md", "B").unwrap(), "B 2.md");
    assert_eq!(fs::read_to_string(t.0.join("B.md")).unwrap(), "b");
    assert_eq!(fs::read_to_string(t.0.join("B 2.md")).unwrap(), "a");
    // only the case changes
    assert_eq!(rename_note(&t.0, "B.md", "b").unwrap(), "b.md");
    assert!(files(&t.0).unwrap().contains(&"b.md".to_string()));
    assert!(rename_note(&t.0, "немає.md", "x").is_err());
  }

  #[test]
  fn deleting_moves_to_the_trash() {
    let t = Temp::new("trash");
    for text in ["перша", "друга"] {
      write_note(&t.0, "X.md", text, true).unwrap();
      trash(&t.0, &t.0.join("X.md")).unwrap();
    }
    assert_eq!(fs::read_to_string(t.0.join(".trash").join("X.md")).unwrap(), "перша");
    assert_eq!(fs::read_to_string(t.0.join(".trash").join("X 2.md")).unwrap(), "друга");
    assert!(trash(&t.0, &t.0.join("X.md")).is_ok());
  }

  #[test]
  fn a_vault_is_created_listed_and_read_back() {
    let t = Temp::new("vault");
    let dir = write_meta(&t.0, None, "Моя: дошка", "{}").unwrap();
    assert_eq!(dir, "Моя- дошка");
    assert_eq!(write_meta(&t.0, None, "data", "{}").unwrap(), "data (vault)");
    let vault = t.0.join(&dir);
    write_note(&vault, "N.md", "текст", true).unwrap();
    write_canvas(&vault, "Дошка.canvas", "{\"nodes\":[]}", "{\"version\":1}").unwrap();
    write_atomic(&vault.join("attachments").join("img-1.png"), &[1, 2, 3]).unwrap();
    fs::write(vault.join("bad.md"), [0xff, 0xfe, 0x00]).unwrap();

    let snap = read_vault(&vault).unwrap();
    assert_eq!(snap.meta, "{}");
    assert_eq!((snap.notes.len(), snap.notes[0].file.as_str(), snap.notes[0].text.as_str()), (1, "N.md", "текст"));
    assert_eq!(snap.canvases[0].file, "Дошка.canvas");
    assert_eq!(snap.extras["Дошка"], "{\"version\":1}");
    assert_eq!(snap.attachments, ["img-1.png"]);
    assert_eq!(snap.unreadable, ["bad.md"]);
    assert_eq!(list_vaults(&t.0).unwrap().len(), 2);
    // no temporary files stay behind
    assert!(fs::read_dir(&vault).unwrap().flatten().all(|e| !e.file_name().to_string_lossy().ends_with(".aether-tmp")));
  }

  #[test]
  fn a_missing_vault_is_never_recreated() {
    let t = Temp::new("missing");
    assert!(vault_dir(&t.0, "Немає").unwrap_err().starts_with("missing-dir:"));
    assert!(write_meta(&t.0, Some("Немає"), "x", "{}").is_err());
    assert!(!t.0.join("Немає").exists());
  }

  #[test]
  fn moving_the_data_folder_takes_vaults_and_backups_along() {
    let from = Temp::new("move-from");
    let to = Temp::new("move-to");
    let dir = write_meta(&from.0, None, "Дошка", "{}").unwrap();
    write_note(&from.0.join(&dir), "N.md", "текст", true).unwrap();
    write_atomic(&from.0.join(&dir).join("attachments").join("a.png"), &[1]).unwrap();
    write_backup(&from.0, "b.aether", "{}").unwrap();
    fs::create_dir_all(from.0.join("чужа папка")).unwrap();

    copy_vaults(&from.0, &to.0).unwrap();
    assert_eq!(fs::read_to_string(to.0.join(&dir).join("N.md")).unwrap(), "текст");
    assert!(to.0.join(&dir).join("attachments").join("a.png").is_file());
    assert!(to.0.join(&dir).join(".aether").join("vault.json").is_file());
    assert!(to.0.join("backups").join("b.aether").is_file());
    assert!(!to.0.join("чужа папка").exists());
    assert_eq!(count_vault_notes(&to.0), 1);
  }

  #[test]
  fn deleted_vaults_and_backups_are_never_overwritten() {
    let t = Temp::new("vault-trash");
    for _ in 0..2 {
      let dir = write_meta(&t.0, None, "V", "{}").unwrap();
      trash_vault(&t.0, &dir).unwrap();
    }
    assert!(t.0.join(".trash").join("V").is_dir() && t.0.join(".trash").join("V 2").is_dir());
    fs::create_dir_all(t.0.join("data")).unwrap();
    assert!(trash_vault(&t.0, "data").unwrap_err().starts_with("not-a-vault:"));
    assert_eq!(write_backup(&t.0, "b.aether", "1").unwrap(), "b.aether");
    assert_eq!(write_backup(&t.0, "b.aether", "2").unwrap(), "b 2.aether");
    assert!(write_backup(&t.0, "../x", "3").is_err());
  }

  #[test]
  fn an_early_read_is_used_only_while_the_folder_is_unchanged() {
    let t = Temp::new("early");
    let dir = write_meta(&t.0, None, "V", "{}").unwrap();
    let v = t.0.join(&dir);
    write_note(&v, "A.md", "перша", true).unwrap();
    fs::create_dir_all(t.0.join("data")).unwrap();
    fs::write(t.0.join("data").join("storage-format.json"), format!("{{\"format\":\"files\",\"dirs\":{{\"default\":\"{}\"}}}}", dir)).unwrap();
    assert_eq!(app_vault_dirs(&t.0), [dir.clone()]);
    assert!(app_vault_dirs(&t.0.join("немає")).is_empty());

    let early = EarlyReads::start(t.0.clone(), app_vault_dirs(&t.0));
    assert_eq!(early.take(&v).unwrap().notes[0].text, "перша");
    // handed out once
    assert!(early.take(&v).is_none());

    let early = EarlyReads::start(t.0.clone(), vec![dir.clone(), "../x".into()]);
    early.thread.lock().unwrap().take().map(|h| early.done.lock().unwrap().extend(h.join().unwrap()));
    // a longer text: the size differs even where the clock is coarse
    write_note(&v, "A.md", "змінена", false).unwrap();
    assert!(early.take(&v).is_none());
    assert!(EarlyReads::default().take(&v).is_none());
  }

    #[test]
  fn header_values_are_decoded() {
    assert_eq!(percent_decode("%D0%94%D0%BE%D1%88%D0%BA%D0%B0%201").unwrap(), "Дошка 1");
    assert!(percent_decode("%G1").is_none());
    assert!(percent_decode("%2").is_none());
  }
}

