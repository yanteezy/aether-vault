//! A search index over the vault folders (SQLite with full-text search).
//!
//! It lives in the app's cache folder, never in the data folder: synced folders (Dropbox…) corrupt SQLite files.
//! It holds nothing that can't be rebuilt from the note files, so a damaged or outdated one is simply replaced.
//!
//! Notes are parsed in TypeScript only. This side says which files changed (by time and size) and stores what
//! it is given.

use crate::data::{current, DataDir};
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::UNIX_EPOCH;
use tauri::{AppHandle, Manager, State};

/// Raise after changing the tables or what goes into them: old indexes are then rebuilt.
const SCHEMA: i32 = 1;
/// Around a match in a search result; the app turns them into highlighting.
pub const MARK_START: &str = "\u{2}";
pub const MARK_END: &str = "\u{3}";

fn es<E: std::fmt::Display>(e: E) -> String {
  e.to_string()
}

/// A note as TypeScript parsed it.
#[derive(Deserialize)]
pub struct Doc {
  file: String,
  id: String,
  title: String,
  body: String,
  tags: Vec<String>,
  /// titles named by [[links]] in the text
  links: Vec<String>,
}

#[derive(Serialize, Debug, PartialEq)]
pub struct Hit {
  vault: String,
  id: String,
  title: String,
  /// text around the match, with MARK_START / MARK_END around the matched words
  snippet: String,
}

#[derive(Serialize, Debug, PartialEq)]
pub struct NoteRef {
  vault: String,
  id: String,
  title: String,
}

fn create(conn: &Connection) -> rusqlite::Result<()> {
  conn.execute_batch(&format!(
    "CREATE TABLE notes(rid INTEGER PRIMARY KEY, vault TEXT NOT NULL, path TEXT NOT NULL, id TEXT NOT NULL,
       title TEXT NOT NULL, title_key TEXT NOT NULL, mtime INTEGER NOT NULL, size INTEGER NOT NULL,
       kind TEXT NOT NULL DEFAULT 'note', UNIQUE(vault, path));
     CREATE INDEX notes_id ON notes(vault, id);
     CREATE TABLE tags(note INTEGER NOT NULL, tag TEXT NOT NULL);
     CREATE INDEX tags_note ON tags(note);
     CREATE TABLE links(note INTEGER NOT NULL, to_key TEXT NOT NULL, to_name TEXT NOT NULL, kind TEXT NOT NULL);
     CREATE INDEX links_note ON links(note);
     CREATE INDEX links_to ON links(to_key);
     CREATE TABLE canvas_links(vault TEXT NOT NULL, from_id TEXT NOT NULL, to_id TEXT NOT NULL);
     CREATE INDEX canvas_to ON canvas_links(vault, to_id);
     -- for databases (phase 3)
     CREATE TABLE props(note INTEGER NOT NULL, key TEXT NOT NULL, text TEXT, num REAL, date INTEGER, bool INTEGER);
     CREATE VIRTUAL TABLE fts USING fts5(title, body, tokenize = 'unicode61 remove_diacritics 2', prefix = '2 3');
     PRAGMA user_version = {SCHEMA};"
  ))
}

fn usable(conn: &Connection) -> bool {
  // cheap on purpose (it runs at every launch): damage deeper in the file shows up as an error of a later
  // query, and `damaged` then replaces the index
  let version: rusqlite::Result<i32> = conn.query_row("PRAGMA user_version", [], |r| r.get(0));
  matches!(version, Ok(SCHEMA)) && conn.prepare("SELECT rid, vault, path, mtime, size FROM notes").is_ok()
}

fn damaged(error: &str) -> bool {
  error.contains("malformed") || error.contains("not a database")
}

fn remove_files(path: &Path) {
  for suffix in ["", "-wal", "-shm"] {
    let mut p = path.as_os_str().to_owned();
    p.push(suffix);
    let _ = fs::remove_file(PathBuf::from(p));
  }
}

/// Open the index, starting over when the file is missing, outdated or damaged.
pub fn open(path: &Path) -> Result<Connection, String> {
  if let Some(parent) = path.parent() {
    fs::create_dir_all(parent).map_err(es)?;
  }
  if path.exists() {
    if let Ok(conn) = Connection::open(path) {
      if usable(&conn) {
        return Ok(conn);
      }
    }
    remove_files(path);
  }
  let conn = Connection::open(path).map_err(es)?;
  let _ = conn.query_row("PRAGMA journal_mode = WAL", [], |_| Ok(()));
  create(&conn).map_err(es)?;
  Ok(conn)
}

fn stamp(meta: std::io::Result<fs::Metadata>) -> Option<(i64, i64)> {
  let meta = meta.ok()?;
  let time = meta.modified().ok()?.duration_since(UNIX_EPOCH).ok()?;
  Some((time.as_nanos() as i64, meta.len() as i64))
}

fn delete_rows(conn: &Connection, rid: i64) -> rusqlite::Result<()> {
  for sql in [
    "DELETE FROM notes WHERE rid = ?1",
    "DELETE FROM tags WHERE note = ?1",
    "DELETE FROM links WHERE note = ?1",
    "DELETE FROM props WHERE note = ?1",
    "DELETE FROM fts WHERE rowid = ?1",
  ] {
    conn.execute(sql, [rid])?;
  }
  Ok(())
}

fn rid_of(conn: &Connection, vault: &str, file: &str) -> rusqlite::Result<Option<i64>> {
  let mut st = conn.prepare_cached("SELECT rid FROM notes WHERE vault = ?1 AND path = ?2")?;
  let mut rows = st.query(params![vault, file])?;
  Ok(match rows.next()? {
    Some(row) => Some(row.get(0)?),
    None => None,
  })
}

/// Compare the folder with the index: forget vanished files, return the ones to (re)index.
pub fn plan(conn: &mut Connection, dir: &Path, vault: &str) -> Result<Vec<String>, String> {
  let mut known: HashMap<String, (i64, i64, i64)> = HashMap::new();
  {
    let mut st = conn.prepare("SELECT path, rid, mtime, size FROM notes WHERE vault = ?1").map_err(es)?;
    let rows = st.query_map([vault], |r| Ok((r.get::<_, String>(0)?, (r.get(1)?, r.get(2)?, r.get(3)?)))).map_err(es)?;
    for row in rows {
      let (path, value) = row.map_err(es)?;
      known.insert(path, value);
    }
  }
  let mut stale = Vec::new();
  // a folder that can't be listed is an error, not "every note was deleted"
  for entry in fs::read_dir(dir).map_err(es)? {
    let entry = entry.map_err(es)?;
    let name = entry.file_name().to_string_lossy().into_owned();
    if name.starts_with('.') || !name.to_lowercase().ends_with(".md") {
      continue;
    }
    // on Windows the directory listing already carries these: no extra call per file
    let now = stamp(entry.metadata());
    let before = known.remove(&name).map(|(_, m, s)| (m, s));
    if now.is_none() || now != before {
      stale.push(name);
    }
  }
  let tx = conn.transaction().map_err(es)?;
  for (rid, _, _) in known.into_values() {
    delete_rows(&tx, rid).map_err(es)?;
  }
  tx.commit().map_err(es)?;
  stale.sort();
  Ok(stale)
}

/// Store parsed notes. A file that is gone by now is removed from the index instead.
pub fn put(conn: &mut Connection, dir: &Path, vault: &str, docs: &[Doc]) -> Result<(), String> {
  let tx = conn.transaction().map_err(es)?;
  for doc in docs {
    if let Some(rid) = rid_of(&tx, vault, &doc.file).map_err(es)? {
      delete_rows(&tx, rid).map_err(es)?;
    }
    if doc.file.contains(['/', '\\']) {
      return Err(format!("bad-name:{}", doc.file));
    }
    let Some((mtime, size)) = stamp(fs::metadata(dir.join(&doc.file))) else { continue };
    tx.prepare_cached("INSERT INTO notes(vault, path, id, title, title_key, mtime, size) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)")
      .map_err(es)?
      .execute(params![vault, doc.file, doc.id, doc.title, doc.title.to_lowercase(), mtime, size])
      .map_err(es)?;
    let rid = tx.last_insert_rowid();
    tx.prepare_cached("INSERT INTO fts(rowid, title, body) VALUES (?1, ?2, ?3)")
      .map_err(es)?
      .execute(params![rid, doc.title, doc.body])
      .map_err(es)?;
    for tag in &doc.tags {
      tx.prepare_cached("INSERT INTO tags(note, tag) VALUES (?1, ?2)").map_err(es)?.execute(params![rid, tag]).map_err(es)?;
    }
    for name in &doc.links {
      tx.prepare_cached("INSERT INTO links(note, to_key, to_name, kind) VALUES (?1, ?2, ?3, 'wiki')")
        .map_err(es)?
        .execute(params![rid, name.to_lowercase(), name])
        .map_err(es)?;
    }
  }
  tx.commit().map_err(es)
}

/// The arrows of a vault's board.
pub fn set_canvas_links(conn: &mut Connection, vault: &str, links: &[(String, String)]) -> Result<(), String> {
  let tx = conn.transaction().map_err(es)?;
  tx.execute("DELETE FROM canvas_links WHERE vault = ?1", [vault]).map_err(es)?;
  for (from, to) in links {
    tx.prepare_cached("INSERT INTO canvas_links(vault, from_id, to_id) VALUES (?1, ?2, ?3)")
      .map_err(es)?
      .execute(params![vault, from, to])
      .map_err(es)?;
  }
  tx.commit().map_err(es)
}

/// Forget vaults that no longer exist.
pub fn keep_vaults(conn: &mut Connection, vaults: &[String]) -> Result<(), String> {
  let indexed: Vec<String> = {
    let mut st = conn.prepare("SELECT vault FROM notes UNION SELECT vault FROM canvas_links").map_err(es)?;
    let rows = st.query_map([], |r| r.get(0)).map_err(es)?;
    rows.collect::<Result<_, _>>().map_err(es)?
  };
  let tx = conn.transaction().map_err(es)?;
  for vault in indexed.iter().filter(|v| !vaults.contains(v)) {
    let rids: Vec<i64> = {
      let mut st = tx.prepare("SELECT rid FROM notes WHERE vault = ?1").map_err(es)?;
      let rows = st.query_map([vault], |r| r.get(0)).map_err(es)?;
      rows.collect::<Result<_, _>>().map_err(es)?
    };
    for rid in rids {
      delete_rows(&tx, rid).map_err(es)?;
    }
    tx.execute("DELETE FROM canvas_links WHERE vault = ?1", [vault]).map_err(es)?;
  }
  tx.commit().map_err(es)
}

/// What the user typed as a full-text query: every word must appear, each may be just its beginning.
/// Nothing typed can be read as query syntax.
fn fts_query(text: &str) -> Option<String> {
  let words: Vec<String> = text
    .split(|c: char| !c.is_alphanumeric())
    .filter(|w| !w.is_empty())
    .take(12)
    .map(|w| format!("\"{}\"*", w))
    .collect();
  if words.is_empty() { None } else { Some(words.join(" ")) }
}

pub fn search(conn: &Connection, text: &str, limit: u32) -> Result<Vec<Hit>, String> {
  let Some(query) = fts_query(text) else { return Ok(Vec::new()) };
  let mut st = conn
    .prepare_cached(
      "SELECT n.vault, n.id, n.title, snippet(fts, -1, ?3, ?4, '…', 12)
       FROM fts JOIN notes n ON n.rid = fts.rowid
       WHERE fts MATCH ?1 ORDER BY bm25(fts, 8.0, 1.0) LIMIT ?2",
    )
    .map_err(es)?;
  let rows = st
    .query_map(params![query, limit.min(200), MARK_START, MARK_END], |r| {
      Ok(Hit { vault: r.get(0)?, id: r.get(1)?, title: r.get(2)?, snippet: r.get(3)? })
    })
    .map_err(es)?;
  rows.collect::<Result<_, _>>().map_err(es)
}

/// Notes of the same vault that link to this one: by [[its title]] or by an arrow on the board.
pub fn backlinks(conn: &Connection, vault: &str, id: &str) -> Result<Vec<NoteRef>, String> {
  let mut st = conn
    .prepare_cached(
      "SELECT n.vault, n.id, n.title FROM notes n
       WHERE n.vault = ?1 AND n.id <> ?2 AND (
         n.rid IN (SELECT l.note FROM links l JOIN notes t ON t.title_key = l.to_key WHERE t.vault = ?1 AND t.id = ?2)
         OR n.id IN (SELECT from_id FROM canvas_links WHERE vault = ?1 AND to_id = ?2))
       ORDER BY n.title_key",
    )
    .map_err(es)?;
  let rows = st
    .query_map(params![vault, id], |r| Ok(NoteRef { vault: r.get(0)?, id: r.get(1)?, title: r.get(2)? }))
    .map_err(es)?;
  rows.collect::<Result<_, _>>().map_err(es)
}

/// Every tag with the number of notes that carry it, most used first.
pub fn tags(conn: &Connection) -> Result<Vec<(String, u32)>, String> {
  let mut st = conn.prepare_cached("SELECT tag, COUNT(DISTINCT note) AS n FROM tags GROUP BY tag ORDER BY n DESC, tag").map_err(es)?;
  let rows = st.query_map([], |r| Ok((r.get(0)?, r.get(1)?))).map_err(es)?;
  rows.collect::<Result<_, _>>().map_err(es)
}

// ---------- commands (all run off the main thread, so the window never waits for the index) ----------

#[derive(Default)]
pub struct IndexState(Mutex<Option<(PathBuf, Connection)>>);

/// One index per data folder, named after its path.
fn index_path(cache: &Path, data: &Path) -> PathBuf {
  // FNV-1a: stable across Rust versions, unlike the standard hasher
  let hash = data.to_string_lossy().bytes().fold(0xcbf29ce484222325u64, |h, b| (h ^ b as u64).wrapping_mul(0x100000001b3));
  cache.join("index").join(format!("{:016x}.sqlite", hash))
}

fn with_index<T>(
  app: &AppHandle,
  data: &State<'_, DataDir>,
  index: &State<'_, IndexState>,
  run: impl FnOnce(&mut Connection, &Path) -> Result<T, String>,
) -> Result<T, String> {
  let root = current(data)?;
  let path = index_path(&app.path().app_cache_dir().map_err(es)?, &root);
  let mut guard = index.0.lock().map_err(es)?;
  if guard.as_ref().map(|(p, _)| p != &path).unwrap_or(true) || !path.exists() {
    *guard = None;
    *guard = Some((path.clone(), open(&path)?));
  }
  let result = run(&mut guard.as_mut().ok_or("no index")?.1, &root);
  if result.as_ref().is_err_and(|e| damaged(e)) {
    // the next call starts a fresh one, and the next sync fills it
    *guard = None;
    remove_files(&path);
  }
  result
}

fn folder(root: &Path, vault: &str) -> Result<PathBuf, String> {
  if vault.is_empty() || vault.starts_with('.') || vault.contains(['/', '\\', ':']) {
    return Err(format!("bad-name:{}", vault));
  }
  Ok(root.join(vault))
}

#[tauri::command(async)]
pub fn index_plan(app: AppHandle, data: State<'_, DataDir>, index: State<'_, IndexState>, vault: String) -> Result<Vec<String>, String> {
  with_index(&app, &data, &index, |c, root| plan(c, &folder(root, &vault)?, &vault))
}

#[tauri::command(async)]
pub fn index_put(app: AppHandle, data: State<'_, DataDir>, index: State<'_, IndexState>, vault: String, docs: Vec<Doc>) -> Result<(), String> {
  with_index(&app, &data, &index, |c, root| put(c, &folder(root, &vault)?, &vault, &docs))
}

#[tauri::command(async)]
pub fn index_canvas_links(
  app: AppHandle,
  data: State<'_, DataDir>,
  index: State<'_, IndexState>,
  vault: String,
  links: Vec<(String, String)>,
) -> Result<(), String> {
  with_index(&app, &data, &index, |c, _| set_canvas_links(c, &vault, &links))
}

#[tauri::command(async)]
pub fn index_keep(app: AppHandle, data: State<'_, DataDir>, index: State<'_, IndexState>, vaults: Vec<String>) -> Result<(), String> {
  with_index(&app, &data, &index, |c, _| keep_vaults(c, &vaults))
}

#[tauri::command(async)]
pub fn index_search(app: AppHandle, data: State<'_, DataDir>, index: State<'_, IndexState>, query: String, limit: u32) -> Result<Vec<Hit>, String> {
  with_index(&app, &data, &index, |c, _| search(c, &query, limit))
}

#[tauri::command(async)]
pub fn index_backlinks(
  app: AppHandle,
  data: State<'_, DataDir>,
  index: State<'_, IndexState>,
  vault: String,
  note_id: String,
) -> Result<Vec<NoteRef>, String> {
  with_index(&app, &data, &index, |c, _| backlinks(c, &vault, &note_id))
}

#[tauri::command(async)]
pub fn index_tags(app: AppHandle, data: State<'_, DataDir>, index: State<'_, IndexState>) -> Result<Vec<(String, u32)>, String> {
  with_index(&app, &data, &index, |c, _| tags(c))
}

/// Empty the index; the app then plans and fills every vault again.
#[tauri::command(async)]
pub fn index_rebuild(app: AppHandle, data: State<'_, DataDir>, index: State<'_, IndexState>) -> Result<(), String> {
  with_index(&app, &data, &index, |c, _| keep_vaults(c, &[]))
}

#[cfg(test)]
mod tests {
  use super::*;

  struct Temp(PathBuf);
  impl Temp {
    fn new(label: &str) -> Temp {
      let dir = std::env::temp_dir().join(format!("aether-index-{}-{}", std::process::id(), label));
      let _ = fs::remove_dir_all(&dir);
      fs::create_dir_all(dir.join("V")).unwrap();
      Temp(dir)
    }
    fn vault(&self) -> PathBuf {
      self.0.join("V")
    }
    fn write(&self, file: &str, text: &str) {
      fs::write(self.vault().join(file), text).unwrap();
    }
  }
  impl Drop for Temp {
    fn drop(&mut self) {
      let _ = fs::remove_dir_all(&self.0);
    }
  }

  fn doc(file: &str, id: &str, title: &str, body: &str, links: &[&str]) -> Doc {
    Doc {
      file: file.into(),
      id: id.into(),
      title: title.into(),
      body: body.into(),
      tags: vec!["тег".into()],
      links: links.iter().map(|s| s.to_string()).collect(),
    }
  }

  fn ids(hits: Vec<Hit>) -> Vec<String> {
    hits.into_iter().map(|h| h.id).collect()
  }

  #[test]
  fn only_new_changed_and_deleted_files_are_planned() {
    let t = Temp::new("plan");
    let mut c = open(&t.0.join("i.sqlite")).unwrap();
    t.write("A.md", "a");
    t.write("B.md", "b");
    t.write("x.txt", "ні");
    assert_eq!(plan(&mut c, &t.vault(), "V").unwrap(), ["A.md", "B.md"]);
    put(&mut c, &t.vault(), "V", &[doc("A.md", "a", "A", "один", &[]), doc("B.md", "b", "B", "два", &[])]).unwrap();
    assert!(plan(&mut c, &t.vault(), "V").unwrap().is_empty());

    t.write("A.md", "змінено, довше");
    fs::remove_file(t.vault().join("B.md")).unwrap();
    assert_eq!(plan(&mut c, &t.vault(), "V").unwrap(), ["A.md"]);
    assert!(search(&c, "два", 10).unwrap().is_empty());
    assert!(plan(&mut c, &t.0.join("немає"), "V").is_err());
  }

  #[test]
  fn search_finds_beginnings_of_words_in_any_case_titles_first() {
    let t = Temp::new("search");
    let mut c = open(&t.0.join("i.sqlite")).unwrap();
    for f in ["1.md", "2.md"] {
      t.write(f, "x");
    }
    put(
      &mut c,
      &t.vault(),
      "V",
      &[doc("1.md", "body", "Інше", "тут згадано ПОЛОТНО та café", &[]), doc("2.md", "title", "Полотно", "порожньо", &[])],
    )
    .unwrap();
    assert_eq!(ids(search(&c, "полот", 10).unwrap()), ["title", "body"]);
    assert_eq!(ids(search(&c, "cafe", 10).unwrap()), ["body"]);
    assert_eq!(ids(search(&c, "згад полот", 10).unwrap()), ["body"]);
    assert!(search(&c, "згад", 10).unwrap()[0].snippet.contains(&format!("{}згадано{}", MARK_START, MARK_END)));
    // query syntax typed by the user is just text
    for odd in ["\"", "AND OR NOT", "a* (", "title:x", "—", ""] {
      search(&c, odd, 10).unwrap();
    }
  }

  #[test]
  fn backlinks_come_from_wiki_links_and_board_arrows() {
    let t = Temp::new("links");
    let mut c = open(&t.0.join("i.sqlite")).unwrap();
    for f in ["a.md", "b.md", "c.md"] {
      t.write(f, "x");
    }
    put(
      &mut c,
      &t.vault(),
      "V",
      &[doc("a.md", "a", "Ціль", "", &["Ціль"]), doc("b.md", "b", "Б", "", &["ЦІЛЬ"]), doc("c.md", "c", "В", "", &[])],
    )
    .unwrap();
    set_canvas_links(&mut c, "V", &[("c".into(), "a".into())]).unwrap();
    let names: Vec<String> = backlinks(&c, "V", "a").unwrap().into_iter().map(|n| n.id).collect();
    assert_eq!(names, ["b", "c"]);
    assert!(backlinks(&c, "інше сховище", "a").unwrap().is_empty());
    assert_eq!(tags(&c).unwrap(), [("тег".to_string(), 3)]);
    keep_vaults(&mut c, &[]).unwrap();
    assert!(tags(&c).unwrap().is_empty() && backlinks(&c, "V", "a").unwrap().is_empty());
  }

  #[test]
  fn a_damaged_or_outdated_index_is_replaced() {
    let t = Temp::new("broken");
    let path = t.0.join("i.sqlite");
    fs::write(&path, "це не база даних".repeat(100)).unwrap();
    let c = open(&path).unwrap();
    assert!(usable(&c));
    c.execute_batch("PRAGMA user_version = 999").unwrap();
    drop(c);
    assert!(usable(&open(&path).unwrap()));
    assert!(damaged("database disk image is malformed") && !damaged("bad-name:x"));
  }

  #[test]
  fn each_data_folder_gets_its_own_index_outside_it() {
    let cache = Path::new("/cache");
    let a = index_path(cache, Path::new("/data/a"));
    assert!(a.starts_with(cache));
    assert_ne!(a, index_path(cache, Path::new("/data/b")));
    assert_eq!(a, index_path(cache, Path::new("/data/a")));
  }
}
