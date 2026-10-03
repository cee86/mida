//! Settings saved on this computer only (settings.json in the app's data folder). Everything
//! read back is cleaned, so a damaged or hand-edited file can't break the app.
//!
//! Version 2 (MIDA 0.2): modules live inside profiles (one per game), plus app preferences.
//! Version 1 files (MIDA 0.1: one list of modules) are moved into a Destiny 2 profile.

use crate::modules::{clean_image, clean_modules, clean_text, tabs_for, Module, CUSTOM_GAME, GAMES, MAX_PICTURE};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

pub const HOME: &str = "home";
pub const MAX_PROFILES: usize = 12;

#[derive(Serialize, Deserialize, Clone, Copy, Debug, Default)]
pub struct WindowPlace {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
    #[serde(default)]
    pub maximized: bool,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct Profile {
    pub id: String,
    pub name: String,
    /// A small square picture (data URL), or none for the initial letter.
    pub image: Option<String>,
    /// A game id from GAMES, or "custom".
    pub game: String,
    /// The game's name as the user typed it (custom games only).
    pub game_name: String,
    pub modules: Vec<Module>,
    /// The open page: "home", a module's id or a built-in tab's id.
    pub active_id: String,
    /// Built-in tabs switched on, in order (games that have them). None: all of them.
    pub tabs: Option<Vec<String>>,
    /// Every built-in tab that existed when `tabs` was last saved: a tab added to MIDA later isn't in it, so it's
    /// switched on once (added at the end) instead of staying hidden in a list saved before it existed.
    pub tabs_known: Vec<String>,
    /// Two pages side by side: their ids, left then right (empty: one page). The open page is
    /// always one of them.
    pub panes: Vec<String>,
    /// The left pane's share of the width, in percent.
    pub split: u32,
}

/// The built-in tabs that existed before profiles noted which tabs they knew about (v0.8.5).
const TABS_BEFORE_KNOWN: &[&str] = &["tab-inventory", "tab-seasonal", "tab-quests", "tab-rad", "tab-featured"];

/// The built-in tabs a profile shows.
pub fn enabled_tabs(game: &str, tabs: &Option<Vec<String>>) -> Vec<String> {
    let all = tabs_for(game);
    match tabs {
        None => all.iter().map(|t| t.to_string()).collect(),
        Some(list) => {
            let mut out: Vec<String> = Vec::new();
            for t in list {
                if all.contains(&t.as_str()) && !out.contains(t) {
                    out.push(t.clone());
                }
            }
            out
        }
    }
}

impl Profile {
    /// Whether `id` is something this profile can show: Home, one of its modules or tabs.
    pub fn has_page(&self, id: &str) -> bool {
        id == HOME || self.modules.iter().any(|m| m.id == id) || enabled_tabs(&self.game, &self.tabs).iter().any(|t| t == id)
    }
}

/// App preferences (Settings). Every value is checked in `clean_prefs`.
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase", default)]
pub struct Prefs {
    pub theme: String,            // dark | black | light | foundry | retro
    pub colorway: String,         // a preset id or "custom"
    pub custom_colors: Vec<String>, // 2-3 gradient stops, #rrggbb
    pub custom_accent: String,    // #rrggbb
    pub custom_angle: u32,        // 0-360
    pub show_address_bar: bool,
    pub controls_corner: String,  // top-right | top-left | bottom-right | bottom-left
    pub controls_autohide: bool,
    pub reduce_motion: String,    // system | on | off
    pub ui_scale: u32,            // percent
    pub high_contrast: bool,
    pub site_zoom: u32,           // percent
    pub foundry_mode: String,     // light | dark (the Foundry theme's own light/dark)
    pub foundry_glow: String,     // #rrggbb: Foundry's lights (accent)
    pub foundry_mark: String,     // #rrggbb: Foundry's markings
    pub sidebar_flyout: bool,     // collapsed sidebar opens over the page on hover
    pub sidebar_fit: bool,        // sidebar only as tall as its contents
}

impl Default for Prefs {
    fn default() -> Self {
        Self {
            theme: "dark".into(),
            colorway: "sunrise".into(),
            custom_colors: vec!["#0d1624".into(), "#2a1a12".into()],
            custom_accent: "#f19a3f".into(),
            custom_angle: 160,
            show_address_bar: true,
            controls_corner: "top-right".into(),
            controls_autohide: false,
            reduce_motion: "system".into(),
            ui_scale: 100,
            high_contrast: false,
            site_zoom: 80,
            foundry_mode: "light".into(),
            foundry_glow: "#52f2e2".into(),
            foundry_mark: "#d8473a".into(),
            sidebar_flyout: true,
            sidebar_fit: false,
        }
    }
}

pub const COLORWAYS: &[&str] = &["sunrise", "arc", "void", "solar", "strand", "stasis", "crimson", "custom"];
pub const UI_SCALES: &[u32] = &[90, 100, 110, 125, 150];

fn is_hex(value: &str) -> bool {
    value.len() == 7 && value.starts_with('#') && value[1..].chars().all(|c| c.is_ascii_hexdigit())
}

pub fn clean_prefs(p: Prefs) -> Prefs {
    let d = Prefs::default();
    let pick = |value: String, allowed: &[&str], fallback: String| {
        if allowed.contains(&value.as_str()) { value } else { fallback }
    };
    let colors: Vec<String> = p.custom_colors.into_iter().filter(|c| is_hex(c)).take(3).map(|c| c.to_lowercase()).collect();
    Prefs {
        theme: pick(p.theme, &["dark", "black", "light", "foundry", "retro"], d.theme),
        colorway: pick(p.colorway, COLORWAYS, d.colorway),
        custom_colors: if colors.len() >= 2 { colors } else { d.custom_colors },
        custom_accent: if is_hex(&p.custom_accent) { p.custom_accent.to_lowercase() } else { d.custom_accent },
        custom_angle: p.custom_angle.min(360),
        show_address_bar: p.show_address_bar,
        controls_corner: pick(p.controls_corner, &["top-right", "top-left", "bottom-right", "bottom-left"], d.controls_corner),
        controls_autohide: p.controls_autohide,
        reduce_motion: pick(p.reduce_motion, &["system", "on", "off"], d.reduce_motion),
        ui_scale: if UI_SCALES.contains(&p.ui_scale) { p.ui_scale } else { d.ui_scale },
        high_contrast: p.high_contrast,
        site_zoom: if (50..=150).contains(&p.site_zoom) && p.site_zoom % 10 == 0 { p.site_zoom } else { d.site_zoom },
        foundry_mode: pick(p.foundry_mode, &["light", "dark"], d.foundry_mode),
        foundry_glow: if is_hex(&p.foundry_glow) { p.foundry_glow.to_lowercase() } else { d.foundry_glow },
        foundry_mark: if is_hex(&p.foundry_mark) { p.foundry_mark.to_lowercase() } else { d.foundry_mark },
        sidebar_flyout: p.sidebar_flyout,
        sidebar_fit: p.sidebar_fit,
    }
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    pub version: u32,
    pub first_run_done: bool,
    pub profiles: Vec<Profile>,
    pub default_profile: Option<String>,
    pub current_profile: Option<String>,
    pub sidebar_expanded: bool,
    pub window: Option<WindowPlace>,
    pub prefs: Prefs,
    // Version 1 fields, read once for moving into a profile and never written again.
    #[serde(skip_serializing)]
    pub modules: Vec<Module>,
    #[serde(skip_serializing)]
    pub active_id: Option<String>,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            version: 2,
            first_run_done: false,
            profiles: vec![],
            default_profile: None,
            current_profile: None,
            sidebar_expanded: true,
            window: None,
            prefs: Prefs::default(),
            modules: vec![],
            active_id: None,
        }
    }
}

pub fn clean_profile(p: Profile) -> Option<Profile> {
    let id_ok = !p.id.is_empty() && p.id.len() <= 24 && p.id.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-');
    if !id_ok {
        return None;
    }
    let game = if GAMES.iter().any(|g| g.id == p.game) { p.game } else { CUSTOM_GAME.to_string() };
    let all_tabs = tabs_for(&game);
    let tabs = if all_tabs.is_empty() {
        None
    } else {
        p.tabs.as_ref().map(|_| {
            let mut list = enabled_tabs(&game, &p.tabs);
            // Files from before `tabs_known` (v0.8.5 and earlier) knew the tabs up to Rotators.
            let known: Vec<&str> = if p.tabs_known.is_empty() { TABS_BEFORE_KNOWN.to_vec() } else { p.tabs_known.iter().map(String::as_str).collect() };
            for t in &all_tabs {
                if !known.contains(t) && !list.iter().any(|l| l == t) {
                    list.push(t.to_string());
                }
            }
            list
        })
    };
    let tabs_known = all_tabs.iter().map(|t| t.to_string()).collect();
    let name = clean_text(&p.name, 32);
    let mut out = Profile {
        id: p.id,
        name: if name.is_empty() { "Profile".into() } else { name },
        image: clean_image(p.image.as_deref(), false, MAX_PICTURE),
        game_name: if game == CUSTOM_GAME { clean_text(&p.game_name, 40) } else { String::new() },
        game,
        modules: clean_modules(&p.modules),
        active_id: HOME.to_string(),
        tabs,
        tabs_known,
        panes: Vec::new(),
        split: if (20..=80).contains(&p.split) { p.split } else { 50 },
    };
    if out.has_page(&p.active_id) {
        out.active_id = p.active_id;
    }
    // Side by side only with two different pages that both still exist, one of them open.
    // Otherwise (a module removed, a tab switched off) the open page is shown alone.
    let panes_ok = p.panes.len() == 2
        && p.panes[0] != p.panes[1]
        && p.panes.iter().all(|id| out.has_page(id))
        && p.panes.contains(&out.active_id);
    if panes_ok {
        out.panes = p.panes;
    }
    Some(out)
}

fn clean(mut s: Settings) -> Settings {
    // MIDA 0.1 kept one list of modules: move it into a Destiny 2 profile (all its sites were).
    if s.profiles.is_empty() && (s.first_run_done || !s.modules.is_empty()) {
        let active = s.active_id.clone().unwrap_or_else(|| HOME.to_string());
        s.profiles.push(Profile {
            id: "p-main".into(),
            name: "My profile".into(),
            image: None,
            game: "destiny2".into(),
            game_name: String::new(),
            modules: std::mem::take(&mut s.modules),
            active_id: active,
            ..Profile::default()
        });
        s.first_run_done = true;
    }
    s.modules.clear();
    s.active_id = None;
    s.version = 2;

    let mut profiles: Vec<Profile> = Vec::new();
    for p in s.profiles.drain(..) {
        if let Some(p) = clean_profile(p) {
            if !profiles.iter().any(|q| q.id == p.id) && profiles.len() < MAX_PROFILES {
                profiles.push(p);
            }
        }
    }
    s.profiles = profiles;
    let exists = |id: &Option<String>| id.as_ref().is_some_and(|id| s.profiles.iter().any(|p| &p.id == id));
    if !exists(&s.default_profile) {
        s.default_profile = s.profiles.first().map(|p| p.id.clone());
    }
    if !exists(&s.current_profile) {
        s.current_profile = s.default_profile.clone();
    }
    if s.profiles.is_empty() {
        s.first_run_done = false;
    }
    s.window = s.window.filter(|w| {
        [w.x, w.y, w.width, w.height].iter().all(|n| n.is_finite()) && w.width >= 400.0 && w.height >= 300.0
    });
    s.prefs = clean_prefs(s.prefs);
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
            .unwrap_or_else(|| clean(Settings::default()));
        Self { file, data }
    }

    pub fn get(&self) -> &Settings {
        &self.data
    }

    /// The profile being shown.
    pub fn profile(&self) -> Option<&Profile> {
        let id = self.data.current_profile.as_ref()?;
        self.data.profiles.iter().find(|p| &p.id == id)
    }

    /// Change the settings, clean them, and save straight away (the file is small).
    pub fn update(&mut self, change: impl FnOnce(&mut Settings)) {
        change(&mut self.data);
        self.data = clean(self.data.clone());
        self.save();
    }

    /// Change the current profile (if there is one).
    pub fn update_profile(&mut self, change: impl FnOnce(&mut Profile)) {
        self.update(|s| {
            let id = s.current_profile.clone();
            if let Some(p) = s.profiles.iter_mut().find(|p| Some(&p.id) == id.as_ref()) {
                change(p);
            }
        });
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn moves_version_one_into_a_profile() {
        let old = r#"{"firstRunDone":true,"modules":[{"id":"dim","name":"DIM","url":"https://app.destinyitemmanager.com/"}],"activeId":"dim","sidebarExpanded":false}"#;
        let s = clean(serde_json::from_str(old).unwrap());
        assert_eq!(s.profiles.len(), 1);
        assert_eq!(s.profiles[0].game, "destiny2");
        assert_eq!(s.profiles[0].modules[0].id, "dim");
        assert_eq!(s.profiles[0].active_id, "dim");
        assert_eq!(s.current_profile.as_deref(), Some("p-main"));
        assert!(!s.sidebar_expanded && s.first_run_done);
        // The old top-level fields are never written back.
        let saved: serde_json::Value = serde_json::to_value(&s).unwrap();
        assert!(saved.get("modules").is_none() && saved.get("activeId").is_none());
    }

    #[test]
    fn new_tabs_appear_once() {
        // A list saved before Vendors existed (no tabs_known): Vendors is added at the end, order kept.
        let old = Profile { id: "p-1".into(), game: "destiny2".into(), tabs: Some(vec!["tab-featured".into(), "tab-inventory".into()]), ..Profile::default() };
        let p = clean_profile(old).unwrap();
        assert_eq!(p.tabs.as_deref().unwrap(), ["tab-featured", "tab-inventory", "tab-vendors"]);
        // Hidden after that (it's known now): it stays hidden.
        let hidden = Profile { tabs: Some(vec!["tab-featured".into()]), ..p };
        assert_eq!(clean_profile(hidden).unwrap().tabs.as_deref().unwrap(), ["tab-featured"]);
    }

    #[test]
    fn cleans_prefs_and_profiles() {
        let p = clean_prefs(Prefs { theme: "neon".into(), ui_scale: 333, site_zoom: 85, custom_colors: vec!["#zzz".into()], ..Prefs::default() });
        assert_eq!((p.theme.as_str(), p.ui_scale, p.site_zoom, p.custom_colors.len()), ("dark", 100, 80, 2));
        assert_eq!(clean_prefs(Prefs { theme: "foundry".into(), ..Prefs::default() }).theme, "foundry");
        let f = clean_prefs(Prefs { foundry_mode: "neon".into(), foundry_glow: "red".into(), foundry_mark: "#ABCDEF".into(), ..Prefs::default() });
        assert_eq!((f.foundry_mode.as_str(), f.foundry_glow.as_str(), f.foundry_mark.as_str()), ("light", "#52f2e2", "#abcdef"));
        let bad = Profile { id: "Bad Id".into(), ..Profile::default() };
        assert!(clean_profile(bad).is_none());
        let custom = clean_profile(Profile { id: "p-1".into(), game: "halo".into(), game_name: " Halo ".into(), ..Profile::default() }).unwrap();
        assert_eq!((custom.game.as_str(), custom.game_name.as_str(), custom.active_id.as_str()), ("custom", "Halo", "home"));
        let fresh = clean(Settings::default());
        assert!(!fresh.first_run_done && fresh.profiles.is_empty());
    }
}
