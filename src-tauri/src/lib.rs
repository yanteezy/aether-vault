use tauri::Manager;

mod data;
mod vault_fs;

/// Save a backup (.aether) into the user's Downloads folder (Documents / home as fallbacks)
/// without overwriting an existing file. Returns the full path of the saved file.
#[tauri::command]
fn save_backup(app: tauri::AppHandle, name: String, contents: String) -> Result<String, String> {
  let dir = app
    .path()
    .download_dir()
    .or_else(|_| app.path().document_dir())
    .or_else(|_| app.path().home_dir())
    .map_err(|e| e.to_string())?;
  std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
  // keep the file name plain: letters, digits, '-', '_' and '.'
  let mut safe: String = name
    .chars()
    .filter(|c| c.is_ascii_alphanumeric() || *c == '-' || *c == '_' || *c == '.')
    .collect();
  if safe.is_empty() || safe.starts_with('.') {
    safe = format!("aether-backup{}", safe);
  }
  let (stem, ext) = match safe.rfind('.') {
    Some(i) if i > 0 => (safe[..i].to_string(), safe[i..].to_string()),
    _ => (safe.clone(), String::new()),
  };
  let mut path = dir.join(&safe);
  let mut n = 2;
  while path.exists() {
    path = dir.join(format!("{} ({}){}", stem, n, ext));
    n += 1;
  }
  std::fs::write(&path, contents).map_err(|e| e.to_string())?;
  Ok(path.to_string_lossy().into_owned())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  let mut builder = tauri::Builder::default();
  // must be the first plugin: a second launch (e.g. clicking an aether:// board link while Aether is open)
  // passes its link to this window — the deep-link plugin then reports it — instead of opening a second app
  #[cfg(desktop)]
  {
    builder = builder.plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
      if let Some(w) = app.get_webview_window("main") {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
      }
    }));
  }
  builder
    // shared board links: aether://open#…
    .plugin(tauri_plugin_deep_link::init())
    // open links (YouTube, GitHub…) in the system browser
    .plugin(tauri_plugin_opener::init())
    // the data folder picker (Settings → General → Data folder)
    .plugin(tauri_plugin_dialog::init())
    // notes, settings and photos as files in the data folder
    .manage(data::DataDir::default())
    // backups: Settings → General → Export
    .invoke_handler(tauri::generate_handler![
      save_backup,
      data::data_load,
      data::data_ready,
      data::data_write,
      data::data_remove,
      data::image_write,
      data::image_read,
      data::image_delete,
      data::image_list,
      data::data_pick_dir,
      data::data_default_dir,
      data::data_inspect_dir,
      data::data_set_dir,
      data::data_use_default,
      vault_fs::vault_list,
      vault_fs::vault_read,
      vault_fs::vault_meta_write,
      vault_fs::note_name,
      vault_fs::note_write,
      vault_fs::note_rename,
      vault_fs::note_delete,
      vault_fs::canvas_write,
      vault_fs::attachment_write,
      vault_fs::attachment_read,
      vault_fs::attachment_delete
    ])
    .setup(|app| {
      // Windows / Linux: make sure aether:// points at this copy of the app (macOS reads it from Info.plist)
      #[cfg(any(windows, target_os = "linux"))]
      {
        use tauri_plugin_deep_link::DeepLinkExt;
        let _ = app.deep_link().register_all();
      }
      // online updates: check / download / install, then relaunch
      #[cfg(desktop)]
      {
        app.handle().plugin(tauri_plugin_updater::Builder::new().build())?;
        app.handle().plugin(tauri_plugin_process::init())?;
      }
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("error while building tauri application");
}
