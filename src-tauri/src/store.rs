//! Settings saved on this computer only (settings.json in the app's data folder). Everything
//! read back is cleaned, so a damaged or hand-edited file can't break the app.

use crate::modules::{clean_modules, Module};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

#[derive(Serialize, Deserialize, Clone, Copy, Debug, Default)]
pub struct WindowPlace {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
    #[serde(default)]
    pub maximized: bool,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    pub first_run_done: bool,
    pub modules: Vec<Module>,
    pub active_id: Option<String>,
    pub sidebar_expanded: bool,
    pub window: Option<WindowPlace>,
}

impl Default for Settings {
    fn default() -> Self {
        Self { first_run_done: false, modules: vec![], active_id: None, sidebar_expanded: true, window: None }
    }
}

fn clean(mut s: Settings) -> Settings {
    s.modules = clean_modules(&s.modules);
    if !s.modules.iter().any(|m| Some(&m.id) == s.active_id.as_ref()) {
        s.active_id = s.modules.first().map(|m| m.id.clone());
    }
    s.window = s.window.filter(|w| {
        [w.x, w.y, w.width, w.height].iter().all(|n| n.is_finite()) && w.width >= 400.0 && w.height >= 300.0
    });
    s
}

pub struct Store {
    file: PathBuf,
    data: Settings,
}

impl Store {
    pub fn open(dir: PathBuf) -> Self {
        let file = dir.join("settings.json");
        let data = fs::read_to_string(&file)
            .ok()
            .and_then(|text| serde_json::from_str::<Settings>(&text).ok())
            .map(clean)
            .unwrap_or_default();
        Self { file, data }
    }

    pub fn get(&self) -> &Settings {
        &self.data
    }

    /// Change the settings, clean them, and save straight away (the file is tiny).
    pub fn update(&mut self, change: impl FnOnce(&mut Settings)) {
        change(&mut self.data);
        self.data = clean(self.data.clone());
        self.save();
    }

    fn save(&self) {
        let Some(dir) = self.file.parent() else { return };
        let result = fs::create_dir_all(dir).and_then(|_| {
            // Write to a temporary file first, then swap it in, so a crash mid-save never
            // leaves a half-written settings file.
            let tmp = self.file.with_extension("json.tmp");
            fs::write(&tmp, serde_json::to_vec_pretty(&self.data).unwrap_or_default())?;
            fs::rename(&tmp, &self.file)
        });
        if let Err(err) = result {
            eprintln!("Couldn't save settings: {err}");
        }
    }
}
