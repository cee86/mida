//! MIDA: game companion sites in one window.
//!
//! The window has layers. The "shell" (src/shell) is our own page: sidebar, toolbar, home page,
//! menus and dialogs. Each module (companion site) of the current profile gets its own page laid
//! over the shell's stage area; the optional floating site controls ("controls", used when the
//! address bar is hidden) sit above the pages. Pages use Windows' built-in browser engine
//! (WebView2), so MIDA doesn't carry a browser of its own. A module loads the first time it's
//! opened and then stays alive in the background, so switching back is instant. Switching
//! profile closes the other profile's pages.
//!
//! Security: module pages are ordinary websites with no way to talk to the app (only our own
//! pages may call the commands below, checked by page label), they can only go to web pages,
//! permission requests (camera, microphone, location, notifications...) are refused, and links
//! to other sites open in your normal browser.
//!
//! Bungie sign-in (src/auth.rs) and the Destiny 2 tabs' data (src/bungie.rs) stay in the app: the
//! shell only ever gets the shaped data, never a token.
//!
//! Threads: pages must be created away from the main thread (WebView2 freezes otherwise), so
//! anything that may create one runs in an async command or `spawn_blocking`. Our own locks are
//! never held while calling a page or the window, so nothing can wait on itself.

mod auth;
mod bungie;
mod modules;
mod store;
#[cfg(windows)]
mod win;

use base64::Engine;
use modules::{
    clean_image, clean_name, clean_text, clean_url, from_catalogue, is_sign_in, is_web, same_site, Module, CATALOGUE,
    CUSTOM_GAME, GAMES, MAX_ICON, MAX_MODULES, MAX_PICTURE, TABS,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use store::{clean_prefs, Prefs, Profile, Store, WindowPlace, HOME, MAX_PROFILES};
use tauri::webview::{NewWindowResponse, PageLoadEvent, PermissionResponse, WebviewBuilder};
use tauri::window::{Color, WindowBuilder};
use tauri::{
    AppHandle, Emitter, EventTarget, LogicalPosition, LogicalSize, Manager, Rect, Webview, WebviewUrl, WindowEvent,
};
use tauri_plugin_opener::OpenerExt;
use tauri_plugin_updater::UpdaterExt;
use url::Url;

const WINDOW: &str = "main";
const SHELL: &str = "shell";
const CONTROLS: &str = "controls";
const BACKGROUND: Color = Color(14, 16, 19, 255);
const UPDATE_CHECK_EVERY: Duration = Duration::from_secs(4 * 60 * 60);
/// The floating site controls box, in shell pixels, and its gap from the stage's corner.
const CONTROLS_SIZE: (f64, f64) = (196.0, 48.0);
const CONTROLS_GAP: f64 = 10.0;

#[derive(Serialize, Clone, Debug)]
pub struct PageError {
    pub kind: String, // offline | not-found | timeout | unreachable | certificate | server | crashed | other
    pub status: i32,  // the site's HTTP status, when it answered with an error
}

#[derive(Serialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
struct Status {
    loading: bool,
    title: String,
    url: String,
    can_go_back: bool,
    can_go_forward: bool,
    error: Option<PageError>,
}

#[derive(Serialize, Clone)]
struct UpdateInfo {
    status: &'static str, // available | downloading | ready | error
    version: String,
    percent: u32,
}

#[derive(Deserialize, Clone, Copy)]
struct StageRect {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}

/// A profile as the shell sends it (new or edited).
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProfileInput {
    name: String,
    image: Option<String>,
    game: String,
    game_name: String,
}

struct Hub {
    store: Mutex<Store>,
    statuses: Mutex<HashMap<String, Status>>, // the current profile's modules that have a page
    panes: Mutex<Vec<StageRect>>,             // where pages go (left to right), in shell pixels
    overlay: Mutex<bool>,                     // a shell menu or dialog is open, so pages are hidden
    update: Mutex<Option<UpdateInfo>>,
    pending: Mutex<Option<tauri_plugin_updater::Update>>,
    creating: Mutex<()>,                   // one page created at a time
    icon_tried: Mutex<HashSet<String>>,    // module ids whose icon was looked for this session
    dir: PathBuf,                          // where settings.json (and the saved sign-in) live
    account: Mutex<Option<auth::Account>>, // the Bungie sign-in, if any
    signing_in: Mutex<bool>,
    account_error: Mutex<Option<String>>,
    manifest: tokio::sync::Mutex<Option<Arc<bungie::Manifest>>>,
    plug_sets: Mutex<Option<(u64, Value)>>, // the account's plug sets and when they were read
    item_parts: Mutex<Option<(u64, Value)>>, // every item's card details (bungie::item_parts) and when they were read
}

fn hub(app: &AppHandle) -> tauri::State<'_, Hub> {
    app.state::<Hub>()
}

fn label_for(id: &str) -> String {
    format!("m-{id}")
}

fn random_id(prefix: &str) -> String {
    let nanos = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0);
    format!("{prefix}-{:x}", (nanos as u64) & 0xff_ffff_ffff)
}

fn current(app: &AppHandle) -> Option<Profile> {
    hub(app).store.lock().unwrap().profile().cloned()
}

fn find_module(app: &AppHandle, id: &str) -> Option<Module> {
    current(app)?.modules.into_iter().find(|m| m.id == id)
}

fn active_id(app: &AppHandle) -> String {
    current(app).map(|p| p.active_id).unwrap_or_else(|| HOME.into())
}

fn prefs(app: &AppHandle) -> Prefs {
    hub(app).store.lock().unwrap().get().prefs.clone()
}

fn open_external(app: &AppHandle, url: &Url) {
    if is_web(url) {
        let _ = app.opener().open_url(url.as_str(), None::<&str>);
    }
}

// ---------- State sent to our own pages ----------

fn public_state(app: &AppHandle) -> Value {
    let hub = hub(app);
    let settings = hub.store.lock().unwrap().get().clone();
    let statuses = hub.statuses.lock().unwrap().clone();
    let update = hub.update.lock().unwrap().clone();
    let profile = settings.profiles.iter().find(|p| Some(&p.id) == settings.current_profile.as_ref()).cloned();
    let profiles: Vec<Value> = settings
        .profiles
        .iter()
        .map(|p| json!({ "id": p.id, "name": p.name, "image": p.image, "game": p.game, "gameName": p.game_name }))
        .collect();
    json!({
        "firstRunDone": settings.first_run_done,
        "profiles": profiles,
        "currentProfile": settings.current_profile,
        "defaultProfile": settings.default_profile,
        "profile": profile.as_ref().map(|p| json!({ "id": p.id, "name": p.name, "image": p.image, "game": p.game, "gameName": p.game_name })),
        "modules": profile.as_ref().map(|p| p.modules.clone()).unwrap_or_default(),
        "activeId": profile.as_ref().map(|p| p.active_id.clone()).unwrap_or_else(|| HOME.into()),
        "panes": profile.as_ref().map(|p| p.panes.clone()).unwrap_or_default(),
        "split": profile.as_ref().map(|p| p.split).unwrap_or(50),
        "tabs": profile.as_ref().map(|p| store::enabled_tabs(&p.game, &p.tabs)).unwrap_or_default(),
        "tabCatalogue": TABS,
        "sidebarExpanded": settings.sidebar_expanded,
        "prefs": settings.prefs,
        "games": GAMES,
        "catalogue": CATALOGUE,
        "maxModules": MAX_MODULES,
        "maxProfiles": MAX_PROFILES,
        "statuses": statuses,
        "platform": std::env::consts::OS,
        "version": app.package_info().version.to_string(),
        "update": update,
        "account": {
            "available": auth::api_key().is_some(),
            "signedIn": hub.account.lock().unwrap().is_some(),
            "name": hub.account.lock().unwrap().as_ref().map(|a| a.name.clone()),
            "busy": *hub.signing_in.lock().unwrap(),
            "error": hub.account_error.lock().unwrap().clone(),
        },
    })
}

fn ours(target: &EventTarget) -> bool {
    matches!(target, EventTarget::Webview { label } if label == SHELL || label == CONTROLS)
}

fn emit_state(app: &AppHandle) {
    let _ = app.emit_filter("state", public_state(app), ours);
}

/// How far along something the shell is waiting for is (its loading bars): `task` is what's loading ("inventory",
/// "activity", "seasonal", "vendors", or "manifest" for the game data every tab shares), `fraction` 0 to 1.
fn progress(app: &AppHandle, task: &str, fraction: f64, label: &str) {
    let _ = app.emit_filter("progress", json!({ "task": task, "fraction": fraction, "label": label }), |t| matches!(t, EventTarget::Webview { label } if label == SHELL));
}

fn update_status(app: &AppHandle, id: &str, change: impl FnOnce(&mut Status)) {
    let status = {
        let hub = hub(app);
        let mut statuses = hub.statuses.lock().unwrap();
        let Some(status) = statuses.get_mut(id) else { return };
        change(status);
        status.clone()
    };
    let _ = app.emit_filter("status", json!({ "id": id, "status": status }), ours);
}

/// A page finished loading (None) or failed (Some). Called from src/win.rs on Windows.
pub(crate) fn page_result(app: &AppHandle, id: &str, error: Option<PageError>) {
    let changed = {
        let hub = hub(app);
        let statuses = hub.statuses.lock().unwrap();
        statuses.get(id).map(|s| s.error.is_some() != error.is_some()).unwrap_or(false)
    };
    update_status(app, id, |s| s.error = error);
    if changed {
        layout(app);
    }
}

// ---------- Layout ----------

fn scaled(r: StageRect, scale: f64) -> Rect {
    Rect {
        position: LogicalPosition::new(r.x * scale, r.y * scale).into(),
        size: LogicalSize::new((r.width * scale).max(1.0), (r.height * scale).max(1.0)).into(),
    }
}

/// Where a page goes: side by side, pane i of the profile's panes gets the i-th rectangle the
/// shell reported (left to right); otherwise the open page gets the stage.
fn pane_rect(app: &AppHandle, id: &str) -> Option<StageRect> {
    let profile = current(app)?;
    let rects = hub(app).panes.lock().unwrap().clone();
    if profile.panes.len() == 2 {
        let index = profile.panes.iter().position(|p| p == id)?;
        rects.get(index).copied()
    } else if profile.active_id == id {
        rects.first().copied()
    } else {
        None
    }
}

/// Show the open page (or both pages side by side) in place, and only when no menu, dialog or
/// error needs the space. The floating controls follow the open page.
fn layout(app: &AppHandle) {
    let hub = hub(app);
    let active = active_id(app);
    let overlay = *hub.overlay.lock().unwrap();
    let p = prefs(app);
    let scale = p.ui_scale as f64 / 100.0;
    let pages: Vec<(String, bool)> =
        hub.statuses.lock().unwrap().iter().map(|(id, s)| (id.clone(), s.error.is_none())).collect();
    let mut active_rect = None;
    for (id, healthy) in pages {
        let Some(page) = app.get_webview(&label_for(&id)) else { continue };
        let rect = pane_rect(app, &id);
        // A page that isn't in a pane at all (not just under a menu) is in the background.
        #[cfg(windows)]
        win::set_background(&page, rect.is_none());
        match rect {
            Some(r) if !overlay && healthy => {
                let _ = page.set_bounds(scaled(r, scale));
                let _ = page.show();
                if id == active {
                    active_rect = Some(r);
                }
            }
            _ => {
                let _ = page.hide();
            }
        }
    }
    if let Some(controls) = app.get_webview(CONTROLS) {
        match active_rect {
            Some(r) if !p.show_address_bar => {
                let (w, h) = CONTROLS_SIZE;
                let right = p.controls_corner.ends_with("right");
                let bottom = p.controls_corner.starts_with("bottom");
                let x = if right { r.x + r.width - w - CONTROLS_GAP } else { r.x + CONTROLS_GAP };
                let y = if bottom { r.y + r.height - h - CONTROLS_GAP } else { r.y + CONTROLS_GAP };
                let _ = controls.set_bounds(scaled(StageRect { x, y, width: w, height: h }, scale));
                let _ = controls.show();
            }
            _ => {
                let _ = controls.hide();
            }
        }
    }
}

// ---------- Module pages ----------

fn module_page(app: &AppHandle, module: &Module) -> Option<WebviewBuilder<tauri::Wry>> {
    let url = Url::parse(&module.url).ok()?;
    let (on_load, on_title, on_open) = (app.clone(), app.clone(), app.clone());
    let (id_load, id_title, id_open) = (module.id.clone(), module.id.clone(), module.id.clone());
    Some(
        WebviewBuilder::new(label_for(&module.id), WebviewUrl::External(url))
            .background_color(BACKGROUND)
            .zoom_hotkeys_enabled(true)
            // Only web pages: never local files or other programs' links.
            .on_navigation(|url| is_web(url))
            .on_permission_request(|_, _| PermissionResponse::Deny)
            .on_new_window(move |url, _| new_window(&on_open, &id_open, url))
            .on_page_load(move |page, payload| {
                let started = payload.event() == PageLoadEvent::Started;
                let url = payload.url().to_string();
                update_status(&on_load, &id_load, |s| {
                    s.loading = started;
                    s.url = url;
                });
                if !started {
                    find_icon(&on_load, &id_load, &page);
                }
            })
            .on_document_title_changed(move |page, title| {
                // Sites that change pages without reloading (DIM, seals.report) still change
                // their title, so read the address again here too.
                let url = page.url().map(|u| u.to_string()).ok();
                update_status(&on_title, &id_title, |s| {
                    s.title = clean_text(&title, 200);
                    if let Some(url) = url {
                        s.url = url;
                    }
                });
            }),
    )
}

/// A page asked to open a new window (a link with target="_blank" or a pop-up).
fn new_window(app: &AppHandle, id: &str, url: Url) -> NewWindowResponse<tauri::Wry> {
    if !is_web(&url) {
        return NewWindowResponse::Deny;
    }
    // Sign-in pop-ups (Bungie, Steam, Xbox...) stay in the app so they can hand back.
    if is_sign_in(&url) {
        return NewWindowResponse::Allow;
    }
    let modules = current(app).map(|p| p.modules).unwrap_or_default();
    let own = modules.iter().find(|m| m.id == id).is_some_and(|m| same_site(&url, &m.url));
    // Same site: open it right here. Another module's site (light.gg -> DIM): open it there.
    let target = if own {
        Some(id.to_string())
    } else {
        modules.iter().find(|m| same_site(&url, &m.url)).map(|m| m.id.clone())
    };
    match target {
        Some(target) => {
            let app = app.clone();
            tauri::async_runtime::spawn_blocking(move || {
                if active_id(&app) != target {
                    select_module(&app, &target);
                }
                if let Some(page) = app.get_webview(&label_for(&target)) {
                    let _ = page.navigate(url);
                }
            });
        }
        None => open_external(app, &url),
    }
    NewWindowResponse::Deny
}

/// Create the module's page if it doesn't exist yet. Never call on the main thread.
fn ensure_page(app: &AppHandle, module: &Module) -> Option<Webview> {
    let hub_state = hub(app);
    let _one_at_a_time = hub_state.creating.lock().unwrap();
    if let Some(page) = app.get_webview(&label_for(&module.id)) {
        return Some(page);
    }
    let window = app.get_window(WINDOW)?;
    let builder = module_page(app, module)?;
    hub_state.statuses.lock().unwrap().insert(
        module.id.clone(),
        Status {
            loading: true,
            title: module.name.clone(),
            url: module.url.clone(),
            can_go_back: true,
            can_go_forward: true,
            error: None,
        },
    );
    let stage = hub_state.panes.lock().unwrap().first().copied().unwrap_or(StageRect { x: 0.0, y: 0.0, width: 1.0, height: 1.0 });
    let p = prefs(app);
    let r = scaled(stage, p.ui_scale as f64 / 100.0);
    match window.add_child(builder, r.position, r.size) {
        Ok(page) => {
            let _ = page.hide();
            let _ = page.set_zoom(p.site_zoom as f64 / 100.0);
            #[cfg(windows)]
            win::hook(&page, app.clone(), module.id.clone());
            // A new page lands on top of everything, so put the floating controls back above it.
            if app.get_webview(CONTROLS).is_some() {
                close_controls(app);
                ensure_controls(app);
            }
            Some(page)
        }
        Err(err) => {
            eprintln!("Couldn't open {}: {err}", module.name);
            hub_state.statuses.lock().unwrap().remove(&module.id);
            None
        }
    }
}

fn close_page(app: &AppHandle, id: &str) {
    if let Some(page) = app.get_webview(&label_for(id)) {
        let _ = page.close();
    }
    hub(app).statuses.lock().unwrap().remove(id);
}

/// Find the site's icon once (when it first loads) and keep it with the module.
fn find_icon(app: &AppHandle, id: &str, page: &Webview) {
    let needed = find_module(app, id).is_some_and(|m| m.icon.is_none());
    if !needed || !hub(app).icon_tried.lock().unwrap().insert(id.to_string()) {
        return;
    }
    // Ask the page which icon it uses: the large "apple-touch-icon" looks best, then the
    // biggest listed icon, then the classic /favicon.ico.
    const FIND: &str = r#"(() => {
        const links = [...document.querySelectorAll('link[rel~="icon"], link[rel="apple-touch-icon"], link[rel="apple-touch-icon-precomposed"]')];
        const size = (l) => parseInt((l.sizes && l.sizes.value || '0').split('x')[0], 10) || 0;
        const apple = links.find((l) => l.rel.startsWith('apple-touch-icon'));
        const best = links.filter((l) => !l.rel.includes('mask')).sort((a, b) => size(b) - size(a))[0];
        return (apple || best || { href: new URL('/favicon.ico', location.href).href }).href;
    })()"#;
    let (app, id) = (app.clone(), id.to_string());
    let _ = page.eval_with_callback(FIND, move |found| {
        let Some(url) = serde_json::from_str::<String>(&found).ok().and_then(|u| Url::parse(&u).ok()) else { return };
        if url.scheme() != "https" {
            return;
        }
        let (app, id) = (app.clone(), id.clone());
        tauri::async_runtime::spawn(async move {
            if let Some(icon) = download_icon(url).await {
                hub(&app).store.lock().unwrap().update_profile(|p| {
                    if let Some(m) = p.modules.iter_mut().find(|m| m.id == id) {
                        m.icon = Some(icon);
                    }
                });
                emit_state(&app);
            }
        });
    });
}

async fn download_icon(url: Url) -> Option<String> {
    let client = reqwest::Client::builder().timeout(Duration::from_secs(10)).build().ok()?;
    let response = client.get(url.clone()).send().await.ok()?;
    if !response.status().is_success() {
        return None;
    }
    let declared = response
        .headers()
        .get("content-type")
        .and_then(|v| v.to_str().ok())
        .map(|v| v.split(';').next().unwrap_or("").trim().to_lowercase())
        .unwrap_or_default();
    let path = url.path().to_lowercase();
    let kind = match declared.strip_prefix("image/") {
        Some(kind) => kind.to_string(),
        None if path.ends_with(".ico") => "x-icon".into(),
        None if path.ends_with(".png") => "png".into(),
        None if path.ends_with(".svg") => "svg+xml".into(),
        None => return None,
    };
    let bytes = response.bytes().await.ok()?;
    if bytes.is_empty() || bytes.len() > MAX_ICON * 3 / 4 {
        return None;
    }
    let data = format!("data:image/{kind};base64,{}", base64::engine::general_purpose::STANDARD.encode(&bytes));
    clean_image(Some(&data), true, MAX_ICON)
}

// ---------- Floating site controls (when the address bar is hidden) ----------

fn ensure_controls(app: &AppHandle) {
    if prefs(app).show_address_bar || app.get_webview(CONTROLS).is_some() {
        return;
    }
    let Some(window) = app.get_window(WINDOW) else { return };
    let builder = WebviewBuilder::new(CONTROLS, WebviewUrl::App("controls.html".into()))
        .transparent(true)
        .background_color(Color(0, 0, 0, 0))
        .zoom_hotkeys_enabled(false)
        .on_navigation(|url| url.scheme() == "tauri" || url.host_str() == Some("tauri.localhost"))
        .on_new_window(|_, _| NewWindowResponse::Deny)
        .on_permission_request(|_, _| PermissionResponse::Deny);
    if let Ok(controls) = window.add_child(builder, LogicalPosition::new(0.0, 0.0), LogicalSize::new(1.0, 1.0)) {
        let _ = controls.hide();
        let scale = prefs(app).ui_scale;
        if scale != 100 {
            let _ = controls.set_zoom(scale as f64 / 100.0);
        }
    }
}

fn close_controls(app: &AppHandle) {
    if let Some(controls) = app.get_webview(CONTROLS) {
        let _ = controls.close();
    }
}

// ---------- Actions ----------

/// Make sure every module showing (the open one, or both side by side) has its page.
fn ensure_pane_pages(app: &AppHandle) {
    let Some(profile) = current(app) else { return };
    let ids = if profile.panes.len() == 2 { profile.panes.clone() } else { vec![profile.active_id.clone()] };
    for id in ids {
        if let Some(module) = profile.modules.iter().find(|m| m.id == id) {
            ensure_page(app, module);
        }
    }
}

/// Open a page: Home, a built-in tab or a module. Side by side, it replaces the open pane
/// (unless it's already showing in the other one, which then becomes the open one).
fn select_module(app: &AppHandle, id: &str) {
    let Some(profile) = current(app) else { return };
    if !profile.has_page(id) {
        return;
    }
    hub(app).store.lock().unwrap().update_profile(|p| {
        if p.panes.len() == 2 && !p.panes.iter().any(|x| x == id) {
            if let Some(slot) = p.panes.iter_mut().find(|x| **x == p.active_id) {
                *slot = id.to_string();
            }
        }
        p.active_id = id.to_string();
    });
    ensure_pane_pages(app);
    layout(app);
    emit_state(app);
    let overlay = *hub(app).overlay.lock().unwrap();
    if let (Some(page), false) = (app.get_webview(&label_for(id)), overlay) {
        let _ = page.set_focus();
    }
}

/// Show `id` side by side with the open page, on the given side ("left" or "right"). Already
/// side by side: it takes that side.
fn split_with(app: &AppHandle, id: &str, side: &str) {
    let Some(profile) = current(app) else { return };
    if !profile.has_page(id) || (profile.panes.len() != 2 && profile.active_id == id) {
        return;
    }
    let left = side == "left";
    hub(app).store.lock().unwrap().update_profile(|p| {
        if p.panes.len() == 2 {
            let (here, there) = if left { (0, 1) } else { (1, 0) };
            if p.panes[there] == id {
                p.panes.swap(0, 1);
            } else {
                p.panes[here] = id.to_string();
            }
        } else {
            let open = p.active_id.clone();
            p.panes = if left { vec![id.to_string(), open] } else { vec![open, id.to_string()] };
        }
        p.active_id = id.to_string();
    });
    ensure_pane_pages(app);
    layout(app);
    emit_state(app);
}

/// Back to one page: `keep` stays open.
fn unsplit(app: &AppHandle, keep: &str) {
    hub(app).store.lock().unwrap().update_profile(|p| {
        if p.panes.iter().any(|x| x == keep) {
            p.active_id = keep.to_string();
        }
        p.panes.clear();
    });
    layout(app);
    emit_state(app);
}

/// The user clicked into a page that's showing side by side: it becomes the open one (for the
/// address bar, shortcuts and the floating controls). Called from src/win.rs on Windows.
#[cfg_attr(not(windows), allow(dead_code))]
pub(crate) fn page_focused(app: &AppHandle, id: &str) {
    let Some(profile) = current(app) else { return };
    if profile.panes.len() != 2 || profile.active_id == id || !profile.panes.iter().any(|p| p == id) {
        return;
    }
    hub(app).store.lock().unwrap().update_profile(|p| p.active_id = id.to_string());
    layout(app);
    emit_state(app);
}

fn select_offset(app: &AppHandle, step: isize) {
    let Some(profile) = current(app) else { return };
    // Home counts as the first stop, then the built-in tabs, then the modules.
    let mut stops: Vec<String> = vec![HOME.into()];
    stops.extend(store::enabled_tabs(&profile.game, &profile.tabs));
    stops.extend(profile.modules.iter().map(|m| m.id.clone()));
    let index = stops.iter().position(|id| *id == profile.active_id).unwrap_or(0) as isize;
    let len = stops.len() as isize;
    let next = ((index + step) % len + len) % len;
    select_module(app, &stops[next as usize]);
}

fn navigate(app: &AppHandle, action: &str) {
    let active = active_id(app);
    let Some(module) = find_module(app, &active) else { return };
    let Some(page) = app.get_webview(&label_for(&active)) else { return };
    match action {
        "back" => {
            let _ = page.eval("history.back()");
        }
        "forward" => {
            let _ = page.eval("history.forward()");
        }
        "reload" | "retry" => {
            let _ = page.reload();
        }
        "home" => {
            if let Ok(url) = Url::parse(&module.url) {
                let _ = page.navigate(url);
            }
        }
        "external" => {
            let current = hub(app).statuses.lock().unwrap().get(&active).map(|s| s.url.clone());
            let url = current.and_then(|u| Url::parse(&u).ok()).or_else(|| Url::parse(&module.url).ok());
            if let Some(url) = url {
                open_external(app, &url);
            }
        }
        // The site answered with an error page: show it anyway.
        "show-anyway" => page_result(app, &active, None),
        _ => {}
    }
}

fn toggle_sidebar_now(app: &AppHandle) {
    hub(app).store.lock().unwrap().update(|s| s.sidebar_expanded = !s.sidebar_expanded);
    emit_state(app);
}

fn fail(message: &str) -> Value {
    json!({ "ok": false, "error": message })
}

fn add_module(app: &AppHandle, module: Module) -> Value {
    let Some(profile) = current(app) else { return fail("Something went wrong.") };
    if profile.modules.len() >= MAX_MODULES {
        return fail(&format!("You can have up to {MAX_MODULES} modules."));
    }
    if let Some(dupe) = profile.modules.iter().find(|m| m.id == module.id || m.url == module.url) {
        return fail(&format!("{} is already in your sidebar.", dupe.name));
    }
    let id = module.id.clone();
    hub(app).store.lock().unwrap().update_profile(|p| p.modules.push(module));
    select_module(app, &id);
    json!({ "ok": true })
}

fn move_module(app: &AppHandle, id: &str, step: isize) {
    hub(app).store.lock().unwrap().update_profile(|p| {
        let Some(from) = p.modules.iter().position(|m| m.id == id) else { return };
        let to = from as isize + step;
        if to >= 0 && (to as usize) < p.modules.len() {
            p.modules.swap(from, to as usize);
        }
    });
    emit_state(app);
}

fn remove_module(app: &AppHandle, id: &str) {
    let Some(profile) = current(app) else { return };
    let Some(index) = profile.modules.iter().position(|m| m.id == id) else { return };
    let was_active = profile.active_id == id;
    let rest: Vec<&Module> = profile.modules.iter().filter(|m| m.id != id).collect();
    // Side by side, the other pane stays; otherwise the next module down (or up, or Home).
    let other_pane = profile.panes.iter().find(|p| *p != id && profile.panes.iter().any(|q| q == id)).cloned();
    let next = other_pane.unwrap_or_else(|| {
        rest.get(index)
            .or_else(|| index.checked_sub(1).and_then(|i| rest.get(i)))
            .map(|m| m.id.clone())
            .unwrap_or_else(|| HOME.into())
    });
    close_page(app, id);
    hub(app).icon_tried.lock().unwrap().remove(id);
    hub(app).store.lock().unwrap().update_profile(|p| p.modules.retain(|m| m.id != id));
    if was_active {
        select_module(app, &next);
    } else {
        layout(app);
        emit_state(app);
    }
}

/// Close every page (switching profile or starting over).
fn close_all_pages(app: &AppHandle) {
    let ids: Vec<String> = hub(app).statuses.lock().unwrap().keys().cloned().collect();
    for id in ids {
        close_page(app, &id);
    }
    hub(app).icon_tried.lock().unwrap().clear();
}

fn switch_profile_now(app: &AppHandle, id: &str) {
    let exists = hub(app).store.lock().unwrap().get().profiles.iter().any(|p| p.id == id);
    if !exists {
        return;
    }
    close_all_pages(app);
    hub(app).store.lock().unwrap().update(|s| s.current_profile = Some(id.to_string()));
    let active = active_id(app);
    select_module(app, &active);
}

fn new_profile(input: &ProfileInput, module_ids: &[String]) -> Option<Profile> {
    let game = if GAMES.iter().any(|g| g.id == input.game) { input.game.clone() } else { CUSTOM_GAME.to_string() };
    let mut modules: Vec<Module> = Vec::new();
    for id in module_ids.iter().take(MAX_MODULES) {
        if let Some(m) = from_catalogue(&game, id) {
            if !modules.iter().any(|x| x.id == m.id) {
                modules.push(m);
            }
        }
    }
    let name = clean_text(&input.name, 32);
    if name.is_empty() {
        return None;
    }
    // New profiles open on their Home page.
    let active_id = HOME.to_string();
    store::clean_profile(Profile {
        id: random_id("p"),
        name,
        image: clean_image(input.image.as_deref(), false, MAX_PICTURE),
        game,
        game_name: input.game_name.clone(),
        modules,
        active_id,
        ..Profile::default()
    })
}

fn shortcut_action(key: &str, ctrl: bool, shift: bool, alt: bool) -> Option<Box<dyn FnOnce(&AppHandle) + Send>> {
    Some(match (ctrl, shift, alt, key) {
        (true, false, false, "b") => Box::new(toggle_sidebar_now),
        (true, _, false, "r") | (_, _, _, "f5") => Box::new(|a| navigate(a, "reload")),
        (false, _, true, "arrowleft") => Box::new(|a| navigate(a, "back")),
        (false, _, true, "arrowright") => Box::new(|a| navigate(a, "forward")),
        (true, back, false, "tab") => Box::new(move |a| select_offset(a, if back { -1 } else { 1 })),
        (true, false, false, ",") => Box::new(|a| {
            if let Some(shell) = a.get_webview(SHELL) {
                let _ = shell.set_focus();
            }
            let _ = a.emit_to(EventTarget::webview(SHELL), "command", "settings");
        }),
        (true, false, false, digit) if digit.len() == 1 && ("1"..="9").contains(&digit) => {
            let n: usize = digit.parse().unwrap_or(1);
            Box::new(move |a| {
                let target = current(a).and_then(|p| p.modules.get(n - 1).map(|m| m.id.clone()));
                if let Some(target) = target {
                    select_module(a, &target);
                }
            })
        }
        _ => return None,
    })
}

/// Shared by our own pages (reported by src/shell/bridge.js) and, on Windows, module pages
/// (src-tauri/src/win.rs). Returns true when the keys were a MIDA shortcut.
pub(crate) fn shortcut(app: &AppHandle, key: &str, ctrl: bool, shift: bool, alt: bool) -> bool {
    let Some(action) = shortcut_action(&key.to_lowercase(), ctrl, shift, alt) else { return false };
    let app = app.clone();
    tauri::async_runtime::spawn_blocking(move || action(&app));
    true
}

fn apply_prefs(app: &AppHandle, before: &Prefs) {
    let now = prefs(app);
    if now.site_zoom != before.site_zoom {
        let ids: Vec<String> = hub(app).statuses.lock().unwrap().keys().cloned().collect();
        for id in ids {
            if let Some(page) = app.get_webview(&label_for(&id)) {
                let _ = page.set_zoom(now.site_zoom as f64 / 100.0);
            }
        }
    }
    if now.ui_scale != before.ui_scale {
        for label in [SHELL, CONTROLS] {
            if let Some(view) = app.get_webview(label) {
                let _ = view.set_zoom(now.ui_scale as f64 / 100.0);
            }
        }
    }
    if now.show_address_bar {
        close_controls(app);
    } else {
        ensure_controls(app);
    }
    emit_state(app);
    layout(app);
}

// ---------- Updates ----------
//
// New versions are published as GitHub releases of cee86/mida, signed with MIDA's update key
// (the public half is in tauri.conf.json, so a download that isn't ours is refused). The app
// only *checks* by itself, at start and every few hours; nothing downloads or installs until the
// user chooses Update. Then it downloads with progress (shown in MIDA's own window), installs
// silently into the same folder and MIDA reopens. Only the installed app checks; running from the code never does.

fn set_update(app: &AppHandle, info: Option<UpdateInfo>) {
    *hub(app).update.lock().unwrap() = info;
    emit_state(app);
}

fn short_version(version: &str) -> String {
    version.chars().take(32).collect()
}

/// "available", "none", "busy" or "error".
async fn check_for_update(app: &AppHandle) -> &'static str {
    let status = hub(app).update.lock().unwrap().as_ref().map(|u| u.status);
    if matches!(status, Some("downloading" | "ready")) {
        return "busy";
    }
    if tauri::is_dev() {
        return "none";
    }
    let Ok(updater) = app.updater() else { return "error" };
    match updater.check().await {
        Ok(Some(update)) => {
            let version = short_version(&update.version);
            *hub(app).pending.lock().unwrap() = Some(update);
            set_update(app, Some(UpdateInfo { status: "available", version, percent: 0 }));
            "available"
        }
        Ok(None) => "none",
        // No internet, GitHub down...: try again at the next check.
        Err(err) => {
            eprintln!("Update check failed: {err}");
            "error"
        }
    }
}

async fn download_update_now(app: AppHandle) {
    let Some(update) = hub(&app).pending.lock().unwrap().clone() else { return };
    let version = short_version(&update.version);
    set_update(&app, Some(UpdateInfo { status: "downloading", version: version.clone(), percent: 0 }));
    let mut received: u64 = 0;
    let mut shown: u32 = 0;
    let progress_app = app.clone();
    let progress_version = version.clone();
    let bytes = update
        .download(
            move |chunk, total| {
                received += chunk as u64;
                let percent = total.filter(|t| *t > 0).map(|t| (received * 100 / t).min(100) as u32).unwrap_or(0);
                if percent != shown {
                    shown = percent;
                    let info = UpdateInfo { status: "downloading", version: progress_version.clone(), percent };
                    set_update(&progress_app, Some(info));
                }
            },
            || {},
        )
        .await;
    let bytes = match bytes {
        Ok(b) => b,
        Err(err) => {
            eprintln!("Update failed: {err}");
            set_update(&app, Some(UpdateInfo { status: "error", version, percent: 0 }));
            return;
        }
    };
    // Downloaded and checked: say so in MIDA's own window for a moment, then the installer runs
    // silently (installMode "quiet" in tauri.conf.json) and reopens MIDA.
    set_update(&app, Some(UpdateInfo { status: "ready", version: version.clone(), percent: 100 }));
    tokio::time::sleep(Duration::from_millis(1500)).await;
    if let Err(err) = update.install(bytes) {
        eprintln!("Update failed: {err}");
        set_update(&app, Some(UpdateInfo { status: "error", version, percent: 0 }));
    }
}

// ---------- Commands (only our own pages may call these) ----------

fn from_shell(page: &Webview) -> bool {
    page.label() == SHELL
}

fn from_ours(page: &Webview) -> bool {
    page.label() == SHELL || page.label() == CONTROLS
}

// ---------- Bungie sign-in and the Destiny 2 tabs ----------

fn set_account_status(app: &AppHandle, busy: bool, error: Option<String>) {
    *hub(app).signing_in.lock().unwrap() = busy;
    *hub(app).account_error.lock().unwrap() = error;
    emit_state(app);
}

/// The whole sign-in: listen on this computer, open the browser, wait for the code, swap it for
/// tokens (through seals.report), find the Destiny account, save it.
async fn sign_in_now(app: AppHandle) {
    if *hub(&app).signing_in.lock().unwrap() {
        return;
    }
    if auth::api_key().is_none() {
        set_account_status(&app, false, Some("This copy of MIDA was built without a Bungie API key, so it can't sign in.".into()));
        return;
    }
    set_account_status(&app, true, None);
    let result: Result<auth::Account, String> = async {
        let state = auth::random_state().ok_or("Couldn't start sign-in. Try again.")?;
        let (listener, port) = auth::listen().ok_or("Couldn't start sign-in. Try again.")?;
        let url = Url::parse(&format!("{}/api/mida/login?port={port}&state={state}", auth::SITE)).map_err(|_| "Couldn't start sign-in.")?;
        let _ = app.opener().open_url(url.as_str(), None::<&str>);
        let code = tauri::async_runtime::spawn_blocking(move || auth::wait_for_code(listener, &state))
            .await
            .map_err(|_| "Sign-in stopped unexpectedly. Try again.".to_string())??;
        let t = auth::exchange("code", &code).await?;
        // Which Destiny account this is: Bungie's public lookup by the Bungie.net account number
        // that comes with the tokens (needs no extra permission), else asking with the sign-in.
        let user = if is_id(&t.bungie_id) {
            bungie::get(&format!("/User/GetMembershipsById/{}/254/", t.bungie_id), None).await?
        } else {
            bungie::get("/User/GetMembershipsForCurrentUser/", Some(&t.access)).await?
        };
        let (membership_type, membership_id, name) =
            auth::pick_membership(&user).ok_or("That Bungie account has no Destiny 2 characters.")?;
        Ok(auth::Account {
            access: t.access,
            access_until: t.access_until,
            refresh: t.refresh,
            refresh_until: t.refresh_until,
            name,
            membership_type,
            membership_id,
        })
    }
    .await;
    match result {
        Ok(account) => {
            auth::save(&hub(&app).dir, &account);
            *hub(&app).account.lock().unwrap() = Some(account);
            set_account_status(&app, false, None);
        }
        Err(error) => set_account_status(&app, false, Some(error)),
    }
}

fn sign_out_now(app: &AppHandle) {
    *hub(app).account.lock().unwrap() = None;
    auth::forget(&hub(app).dir);
    set_account_status(app, false, None);
}

/// The signed-in account with a fresh access token (refreshed through seals.report when it's
/// about to run out; signed out if Bungie ended the sign-in).
async fn account(app: &AppHandle) -> Result<auth::Account, String> {
    let current = hub(app).account.lock().unwrap().clone().ok_or("Sign in with Bungie first.")?;
    let now = auth::now();
    if current.access_until > now + 60 {
        return Ok(current);
    }
    if current.refresh.is_empty() || current.refresh_until <= now {
        sign_out_now(app);
        return Err("Your Bungie sign-in has ended. Sign in again.".into());
    }
    match auth::exchange("refresh", &current.refresh).await {
        Ok(t) => {
            let fresh = auth::Account {
                access: t.access,
                access_until: t.access_until,
                refresh: if t.refresh.is_empty() { current.refresh.clone() } else { t.refresh },
                refresh_until: if t.refresh_until == 0 { current.refresh_until } else { t.refresh_until },
                ..current
            };
            auth::save(&hub(app).dir, &fresh);
            *hub(app).account.lock().unwrap() = Some(fresh.clone());
            Ok(fresh)
        }
        Err(error) if error.contains("Sign in again") => {
            sign_out_now(app);
            Err(error)
        }
        Err(error) => Err(error),
    }
}

/// Destiny's item list, loaded once per run (from disk when the game hasn't updated).
async fn manifest(app: &AppHandle) -> Result<Arc<bungie::Manifest>, String> {
    let hub = hub(app);
    let mut slot = hub.manifest.lock().await;
    if let Some(m) = slot.as_ref() {
        return Ok(m.clone());
    }
    let m = Arc::new(bungie::load_manifest(&hub.dir).await?);
    *slot = Some(m.clone());
    Ok(m)
}

fn answer(result: Result<Value, String>) -> Value {
    match result {
        Ok(data) => json!({ "ok": true, "data": data }),
        Err(error) => json!({ "ok": false, "error": error }),
    }
}

fn is_id(value: &str) -> bool {
    !value.is_empty() && value.len() <= 20 && value.chars().all(|c| c.is_ascii_digit())
}

/// An item move as the shell sends it, checked.
#[derive(Deserialize)]
struct ItemRef {
    hash: u32,
    instance: Option<String>,
    owner: String,
    quantity: Option<i64>,
}

fn checked_move(item: ItemRef) -> Option<bungie::Move> {
    let owner_ok = item.owner == "vault" || is_id(&item.owner);
    let instance_ok = item.instance.as_deref().map(is_id).unwrap_or(true);
    (owner_ok && instance_ok).then(|| bungie::Move {
        hash: item.hash,
        instance: item.instance,
        owner: item.owner,
        quantity: item.quantity.unwrap_or(1).clamp(1, 9999),
    })
}

#[tauri::command]
async fn sign_in(webview: Webview, app: AppHandle) {
    if from_shell(&webview) {
        sign_in_now(app).await;
    }
}

#[tauri::command]
async fn sign_out(webview: Webview, app: AppHandle) {
    if from_shell(&webview) {
        sign_out_now(&app);
    }
}

#[tauri::command]
async fn d2_inventory(webview: Webview, app: AppHandle) -> Value {
    if !from_shell(&webview) {
        return fail("Something went wrong.");
    }
    answer(
        async {
            progress(&app, "inventory", 0.05, "Checking your sign-in");
            let a = account(&app).await?;
            progress(&app, "inventory", 0.15, "Reading Destiny's game data");
            let m = manifest(&app).await?;
            progress(&app, "inventory", 0.35, "Reading your characters and vault from Bungie");
            let profile = bungie::profile(a.membership_type, &a.membership_id, &a.access, "100,102,103,200,201,205,300,305").await?;
            progress(&app, "inventory", 0.8, "Sorting your items");
            let mut data = bungie::shape_inventory(&profile, &m);
            bungie::decorate_inventory(&mut data).await;
            read_cards_ahead(&app, &a, &m);
            Ok(data)
        }
        .await,
    )
}

#[tauri::command]
async fn d2_activity(webview: Webview, app: AppHandle) -> Value {
    if !from_shell(&webview) {
        return fail("Something went wrong.");
    }
    answer(
        async {
            progress(&app, "activity", 0.05, "Checking your sign-in");
            let a = account(&app).await?;
            progress(&app, "activity", 0.15, "Reading Destiny's game data");
            let m = manifest(&app).await?;
            progress(&app, "activity", 0.35, "Reading your quests and bounties from Bungie");
            let profile = bungie::profile(a.membership_type, &a.membership_id, &a.access, "100,104,200,201,202,300,301").await?;
            progress(&app, "activity", 0.7, "Reading quest details");
            let mut data = bungie::shape_activity(&profile, &m);
            bungie::enrich_quests(&mut data, &m).await;
            data["season"] = bungie::season(&profile, &a.access).await;
            data["alerts"] = Value::Array(bungie::alerts().await);
            Ok(data)
        }
        .await,
    )
}

#[tauri::command]
async fn d2_transfer(webview: Webview, app: AppHandle, item: ItemRef, to: String) -> Value {
    if !from_shell(&webview) {
        return fail("Something went wrong.");
    }
    let Some(mv) = checked_move(item).filter(|_| to == "vault" || is_id(&to)) else { return fail("That move isn't possible.") };
    answer(
        async {
            let a = account(&app).await?;
            bungie::transfer(a.membership_type, &a.access, &mv, &to).await?;
            Ok(Value::Null)
        }
        .await,
    )
}

/// The Inventory side panel: a character's stats and armor set bonuses.
#[tauri::command]
async fn d2_character(webview: Webview, app: AppHandle, character: String) -> Value {
    if !from_shell(&webview) || !is_id(&character) {
        return fail("Something went wrong.");
    }
    answer(
        async {
            let a = account(&app).await?;
            let profile = bungie::profile(a.membership_type, &a.membership_id, &a.access, "200,205,206").await?;
            Ok(bungie::character_details(&profile, &character).await)
        }
        .await,
    )
}

/// The account's plug sets (owned mods etc.), read at most every ten minutes.
async fn plug_sets(app: &AppHandle, a: &auth::Account) -> Value {
    {
        let cached = hub(app).plug_sets.lock().unwrap().clone();
        if let Some((at, v)) = cached {
            if auth::now() < at + 600 {
                return v;
            }
        }
    }
    let v = bungie::profile(a.membership_type, &a.membership_id, &a.access, "105").await.unwrap_or(Value::Null);
    *hub(app).plug_sets.lock().unwrap() = Some((auth::now(), v.clone()));
    v
}

/// Right after the inventory loads, in the background: every item's card details in one profile read, the account's
/// plug sets, and the definitions the weapon and armor cards need, so cards open without waiting on Bungie.
fn read_cards_ahead(app: &AppHandle, a: &auth::Account, m: &Arc<bungie::Manifest>) {
    let (app, a, m) = (app.clone(), a.clone(), m.clone());
    tauri::async_runtime::spawn(async move {
        let fresh = hub(&app).item_parts.lock().unwrap().as_ref().is_some_and(|(at, _)| auth::now() < at + 120);
        if fresh {
            return;
        }
        if let Ok(profile) = bungie::profile(a.membership_type, &a.membership_id, &a.access, "102,201,205,300,304,305,309,310").await {
            *hub(&app).item_parts.lock().unwrap() = Some((auth::now(), bungie::item_parts(&profile)));
            plug_sets(&app, &a).await;
            bungie::prefetch_cards(&profile, &m).await;
        }
    });
}

/// After a lock or a perk/mod change, that item's saved details are out of date: the next card asks Bungie.
fn forget_card(app: &AppHandle, instance: &str) {
    if let Some((_, parts)) = hub(app).item_parts.lock().unwrap().as_mut() {
        if let Some(sockets) = parts["sockets"].as_object_mut() {
            sockets.remove(instance);
        }
    }
}

/// An item's card (hover/click in Inventory).
#[tauri::command]
async fn d2_item(webview: Webview, app: AppHandle, instance: String, hash: u32) -> Value {
    if !from_shell(&webview) || !is_id(&instance) {
        return fail("Something went wrong.");
    }
    answer(
        async {
            let a = account(&app).await?;
            let m = manifest(&app).await?;
            // From the profile read made right after the inventory loaded, when it has this item; else ask Bungie.
            let cached = {
                let state = hub(&app);
                let parts = state.item_parts.lock().unwrap();
                parts.as_ref().filter(|(at, _)| auth::now() < at + 900).and_then(|(_, p)| bungie::item_from_parts(p, &instance))
            };
            let item = match cached {
                Some(item) => item,
                None => bungie::item(a.membership_type, &a.membership_id, &a.access, &instance).await?,
            };
            let sets = plug_sets(&app, &a).await;
            Ok(bungie::item_details(&item, hash as u64, &sets, &m).await)
        }
        .await,
    )
}

#[tauri::command]
async fn d2_lock(webview: Webview, app: AppHandle, instance: String, character: String, locked: bool) -> Value {
    if !from_shell(&webview) || !is_id(&instance) || !is_id(&character) {
        return fail("Something went wrong.");
    }
    answer(
        async {
            let a = account(&app).await?;
            bungie::set_lock(a.membership_type, &a.access, &instance, &character, locked).await?;
            forget_card(&app, &instance);
            Ok(Value::Null)
        }
        .await,
    )
}

#[tauri::command]
async fn d2_plug(webview: Webview, app: AppHandle, instance: String, character: String, socket: u32, plug: u32) -> Value {
    if !from_shell(&webview) || !is_id(&instance) || !is_id(&character) || socket > 64 {
        return fail("Something went wrong.");
    }
    answer(
        async {
            let a = account(&app).await?;
            bungie::insert_plug(a.membership_type, &a.access, &instance, &character, socket as u64, plug as u64).await?;
            forget_card(&app, &instance);
            Ok(Value::Null)
        }
        .await,
    )
}

/// Take an item out of a character's postmaster (it goes to that character).
#[tauri::command]
async fn d2_pull(webview: Webview, app: AppHandle, item: ItemRef) -> Value {
    if !from_shell(&webview) {
        return fail("Something went wrong.");
    }
    let Some(mv) = checked_move(item).filter(|m| m.owner != "vault") else { return fail("That can't be pulled.") };
    answer(
        async {
            let a = account(&app).await?;
            bungie::pull_from_postmaster(a.membership_type, &a.access, &mv).await?;
            Ok(Value::Null)
        }
        .await,
    )
}

/// Equip an item on a character, bringing it over first if it's somewhere else.
#[tauri::command]
async fn d2_equip(webview: Webview, app: AppHandle, item: ItemRef, character: String) -> Value {
    if !from_shell(&webview) {
        return fail("Something went wrong.");
    }
    let Some(mv) = checked_move(item).filter(|m| m.instance.is_some() && is_id(&character)) else { return fail("That can't be equipped.") };
    answer(
        async {
            let a = account(&app).await?;
            bungie::transfer(a.membership_type, &a.access, &mv, &character).await?;
            bungie::equip(a.membership_type, &a.access, mv.instance.as_deref().unwrap_or(""), &character).await?;
            Ok(Value::Null)
        }
        .await,
    )
}

/// The Seasonal Hub for a character: pass track, past passes, claimable rewards, objectives,
/// vendors with objectives, other reward tracks. Vendors are read separately and may fail (then
/// the rest still shows).
#[tauri::command]
async fn d2_seasonal(webview: Webview, app: AppHandle, character: String) -> Value {
    if !from_shell(&webview) || !is_id(&character) {
        return fail("Something went wrong.");
    }
    answer(
        async {
            progress(&app, "seasonal", 0.05, "Checking your sign-in");
            let a = account(&app).await?;
            progress(&app, "seasonal", 0.15, "Reading Destiny's game data");
            let m = manifest(&app).await?;
            progress(&app, "seasonal", 0.3, "Reading your season from Bungie");
            let profile = bungie::profile(a.membership_type, &a.membership_id, &a.access, "100,102,104,201,202,300,301,900").await?;
            progress(&app, "seasonal", 0.55, "Reading the hub's vendors");
            let vendors = bungie::character_vendors(a.membership_type, &a.membership_id, &character, &a.access).await.unwrap_or(Value::Null);
            progress(&app, "seasonal", 0.8, "Putting the hub together");
            Ok(bungie::seasonal(&profile, &vendors, &character, &m).await)
        }
        .await,
    )
}

/// The Weekly planner: each character's weekly checklist.
#[tauri::command]
async fn d2_planner(webview: Webview, app: AppHandle) -> Value {
    if !from_shell(&webview) {
        return fail("Something went wrong.");
    }
    answer(
        async {
            progress(&app, "planner", 0.05, "Checking your sign-in");
            let a = account(&app).await?;
            progress(&app, "planner", 0.15, "Reading Destiny's game data");
            let m = manifest(&app).await?;
            progress(&app, "planner", 0.35, "Reading your characters' weeks from Bungie");
            let profile = bungie::profile(a.membership_type, &a.membership_id, &a.access, "100,200,202").await?;
            progress(&app, "planner", 0.7, "Reading the weekly milestones");
            Ok(bungie::planner(&profile, &m).await)
        }
        .await,
    )
}

/// The Vendors tab: every vendor the character can visit and what they sell.
#[tauri::command]
async fn d2_vendors(webview: Webview, app: AppHandle, character: String) -> Value {
    if !from_shell(&webview) || !is_id(&character) {
        return fail("Something went wrong.");
    }
    answer(
        async {
            progress(&app, "vendors", 0.05, "Checking your sign-in");
            let a = account(&app).await?;
            progress(&app, "vendors", 0.15, "Reading Destiny's game data");
            let m = manifest(&app).await?;
            progress(&app, "vendors", 0.3, "Reading the vendors from Bungie");
            let vendors = bungie::character_vendors(a.membership_type, &a.membership_id, &character, &a.access).await?;
            progress(&app, "vendors", 0.6, "Reading what they sell");
            Ok(bungie::vendor_screen(&vendors, &m).await)
        }
        .await,
    )
}

/// A past (or current) season pass's track, for the Seasonal Hub's dropdown.
#[tauri::command]
async fn d2_pass(webview: Webview, app: AppHandle, character: String, pass: u64, season: u64) -> Value {
    if !from_shell(&webview) || !is_id(&character) || pass == 0 || pass > u32::MAX as u64 || season > u32::MAX as u64 {
        return fail("Something went wrong.");
    }
    answer(
        async {
            let a = account(&app).await?;
            let m = manifest(&app).await?;
            let profile = bungie::profile(a.membership_type, &a.membership_id, &a.access, "202").await?;
            Ok(bungie::pass_track(pass, season, &profile["characterProgressions"]["data"][character.as_str()]["progressions"], &m).await)
        }
        .await,
    )
}

/// Claims a season pass reward for a character.
#[tauri::command]
async fn d2_claim(webview: Webview, app: AppHandle, character: String, season: u64, index: u32) -> Value {
    if !from_shell(&webview) || !is_id(&character) || season == 0 || season > u32::MAX as u64 || index > 1000 {
        return fail("Something went wrong.");
    }
    answer(
        async {
            let a = account(&app).await?;
            bungie::claim_reward(a.membership_type, &a.access, &character, season, index).await?;
            Ok(Value::Null)
        }
        .await,
    )
}

/// Equips one of a character's in-game loadouts.
#[tauri::command]
async fn d2_loadout(webview: Webview, app: AppHandle, character: String, index: u32) -> Value {
    if !from_shell(&webview) || !is_id(&character) || index > 20 {
        return fail("Something went wrong.");
    }
    answer(
        async {
            let a = account(&app).await?;
            bungie::equip_loadout(a.membership_type, &a.access, index, &character).await?;
            Ok(Value::Null)
        }
        .await,
    )
}

/// seals.report's answer for the Rotators tab (public data; empty when offline): `{ saved: {...}, art: { activity
/// name: bungie.net picture address }, week: {...} }`, `week` being this week as the site works it out with Bungie's
/// live list (rotators, events, weekend cards). It's only ever shown as text; answers over 1 MB are ignored.
#[tauri::command]
async fn d2_rotators(webview: Webview) -> Value {
    let empty = json!({ "saved": {}, "art": {}, "week": null });
    if !from_shell(&webview) {
        return empty;
    }
    let res = reqwest::Client::new().get(format!("{}/api/mida/rotators", auth::SITE)).timeout(Duration::from_secs(10)).send().await;
    let Ok(res) = res else { return empty };
    let Ok(bytes) = res.bytes().await else { return empty };
    if bytes.len() > 1_000_000 {
        return empty;
    }
    let Ok(body) = serde_json::from_slice::<Value>(&bytes) else { return empty };
    json!({
        "saved": body["saved"].as_object().map(|o| Value::Object(o.clone())).unwrap_or_else(|| json!({})),
        "art": rotator_art(&body["art"]),
        "week": if body["week"]["rotators"].is_array() && body["week"]["at"].is_string() { body["week"].clone() } else { Value::Null },
    })
}

/// Only Bungie picture addresses get through (the shell's security policy would block others anyway).
fn rotator_art(art: &Value) -> Value {
    let kept: serde_json::Map<String, Value> = art
        .as_object()
        .into_iter()
        .flatten()
        .filter(|(name, url)| name.len() <= 120 && url.as_str().is_some_and(|u| u.starts_with("https://www.bungie.net/") && u.len() < 400 && !u.contains(['"', '\\', ')', '(', ' '])))
        .take(300)
        .map(|(name, url)| (name.clone(), url.clone()))
        .collect();
    Value::Object(kept)
}

#[tauri::command]
async fn get_state(webview: Webview, app: AppHandle) -> Option<Value> {
    from_ours(&webview).then(|| public_state(&app))
}

/// Where pages go: one rectangle, or two side by side (left, right), in shell pixels.
#[tauri::command]
async fn set_panes(webview: Webview, app: AppHandle, rects: Vec<StageRect>) {
    let valid = rects.len() <= 2
        && rects.iter().all(|r| [r.x, r.y, r.width, r.height].iter().all(|n| n.is_finite() && *n >= 0.0 && *n < 100_000.0));
    if from_shell(&webview) && valid {
        *hub(&app).panes.lock().unwrap() = rects;
        layout(&app);
    }
}

#[tauri::command]
async fn split(webview: Webview, app: AppHandle, id: String, side: String) {
    if from_shell(&webview) {
        split_with(&app, &id, &side);
    }
}

#[tauri::command]
async fn close_pane(webview: Webview, app: AppHandle, keep: String) {
    if from_shell(&webview) {
        unsplit(&app, &keep);
    }
}

#[tauri::command]
async fn swap_panes(webview: Webview, app: AppHandle) {
    if from_shell(&webview) {
        hub(&app).store.lock().unwrap().update_profile(|p| p.panes.reverse());
        layout(&app);
        emit_state(&app);
    }
}

/// The left pane's share, in percent (saved when the divider is let go).
#[tauri::command]
async fn set_split(webview: Webview, app: AppHandle, percent: u32) {
    if from_shell(&webview) && (20..=80).contains(&percent) {
        hub(&app).store.lock().unwrap().update_profile(|p| p.split = percent);
        emit_state(&app);
    }
}

/// Which built-in tabs the current profile shows, in order.
#[tauri::command]
async fn set_tabs(webview: Webview, app: AppHandle, ids: Vec<String>) {
    if from_shell(&webview) && ids.len() <= 16 {
        hub(&app).store.lock().unwrap().update_profile(|p| {
            p.tabs = Some(ids);
            p.tabs_known = modules::tabs_for(&p.game).iter().map(|t| t.to_string()).collect();
        });
        ensure_pane_pages(&app);
        layout(&app);
        emit_state(&app);
    }
}

#[tauri::command]
async fn set_overlay(webview: Webview, app: AppHandle, open: bool) {
    if !from_shell(&webview) {
        return;
    }
    *hub(&app).overlay.lock().unwrap() = open;
    layout(&app);
    if open {
        // The keyboard may still be with the (now hidden) site, e.g. after Ctrl+, pressed inside it;
        // give it to the app's screen so Esc and Tab work in the menu or pop-up.
        let _ = webview.set_focus();
    } else if let Some(page) = app.get_webview(&label_for(&active_id(&app))) {
        let _ = page.set_focus();
    }
}

/// A picture of a visible page (a JPEG data URL), shown in its place while a menu or dialog is
/// open. None when that page isn't showing or the picture can't be taken.
#[tauri::command]
async fn freeze_page(webview: Webview, app: AppHandle, id: String) -> Option<String> {
    if !from_shell(&webview) || *hub(&app).overlay.lock().unwrap() {
        return None;
    }
    pane_rect(&app, &id)?;
    let healthy = hub(&app).statuses.lock().unwrap().get(&id).is_some_and(|s| s.error.is_none());
    let page = app.get_webview(&label_for(&id)).filter(|_| healthy)?;
    #[cfg(windows)]
    {
        let bytes = tauri::async_runtime::spawn_blocking(move || win::capture(&page)).await.ok().flatten()?;
        Some(format!("data:image/jpeg;base64,{}", base64::engine::general_purpose::STANDARD.encode(bytes)))
    }
    #[cfg(not(windows))]
    {
        let _ = page;
        None
    }
}

#[tauri::command]
async fn select(webview: Webview, app: AppHandle, id: String) {
    if from_shell(&webview) {
        select_module(&app, &id);
    }
}

#[tauri::command]
async fn nav(webview: Webview, app: AppHandle, action: String) {
    if from_ours(&webview) {
        navigate(&app, &action);
    }
}

#[tauri::command]
async fn toggle_sidebar(webview: Webview, app: AppHandle) {
    if from_shell(&webview) {
        toggle_sidebar_now(&app);
    }
}

#[tauri::command]
async fn module_action(webview: Webview, app: AppHandle, id: String, action: String) {
    if !from_shell(&webview) {
        return;
    }
    match action.as_str() {
        "reload" => {
            if let Some(page) = app.get_webview(&label_for(&id)) {
                let _ = page.reload();
            }
        }
        "browser" => {
            let current = hub(&app).statuses.lock().unwrap().get(&id).map(|s| s.url.clone());
            let fallback = find_module(&app, &id).map(|m| m.url);
            if let Some(url) = current.or(fallback).and_then(|u| Url::parse(&u).ok()) {
                open_external(&app, &url);
            }
        }
        // The site answered with an error page: show it anyway.
        "show-anyway" => page_result(&app, &id, None),
        "up" => move_module(&app, &id, -1),
        "down" => move_module(&app, &id, 1),
        "remove" => remove_module(&app, &id),
        "refresh-icon" => {
            hub(&app).icon_tried.lock().unwrap().remove(&id);
            hub(&app).store.lock().unwrap().update_profile(|p| {
                if let Some(m) = p.modules.iter_mut().find(|m| m.id == id) {
                    m.icon = None;
                }
            });
            emit_state(&app);
            if let Some(page) = app.get_webview(&label_for(&id)) {
                find_icon(&app, &id, &page);
            }
        }
        _ => {}
    }
}

#[tauri::command]
async fn rename_module(webview: Webview, app: AppHandle, id: String, name: String) -> Value {
    if !from_shell(&webview) {
        return fail("Something went wrong.");
    }
    let Some(module) = find_module(&app, &id) else { return fail("That module is gone.") };
    let name = clean_name(&name, &module.url);
    hub(&app).store.lock().unwrap().update_profile(|p| {
        if let Some(m) = p.modules.iter_mut().find(|m| m.id == id) {
            m.name = name;
        }
    });
    emit_state(&app);
    json!({ "ok": true })
}

/// New module order from dragging in the sidebar: must be exactly the same modules.
#[tauri::command]
async fn reorder(webview: Webview, app: AppHandle, ids: Vec<String>) {
    if !from_shell(&webview) {
        return;
    }
    hub(&app).store.lock().unwrap().update_profile(|p| {
        let same = ids.len() == p.modules.len()
            && ids.iter().collect::<HashSet<_>>().len() == ids.len()
            && ids.iter().all(|id| p.modules.iter().any(|m| &m.id == id));
        if same {
            p.modules.sort_by_key(|m| ids.iter().position(|id| *id == m.id).unwrap_or(usize::MAX));
        }
    });
    emit_state(&app);
}

#[tauri::command]
async fn download_update(webview: Webview, app: AppHandle) {
    let status = hub(&app).update.lock().unwrap().as_ref().map(|u| u.status);
    if from_shell(&webview) && matches!(status, Some("available" | "error")) {
        download_update_now(app).await;
    }
}

#[tauri::command]
async fn check_update(webview: Webview, app: AppHandle) -> &'static str {
    if !from_shell(&webview) {
        return "error";
    }
    check_for_update(&app).await
}

#[tauri::command]
async fn key(webview: Webview, app: AppHandle, key: String, ctrl: bool, shift: bool, alt: bool) -> bool {
    from_ours(&webview) && shortcut(&app, &key, ctrl, shift, alt)
}

#[tauri::command]
async fn set_prefs(webview: Webview, app: AppHandle, prefs: Prefs) {
    if !from_shell(&webview) {
        return;
    }
    let before = self::prefs(&app);
    hub(&app).store.lock().unwrap().update(|s| s.prefs = clean_prefs(prefs));
    apply_prefs(&app, &before);
}

/// Only our own fixed links (never an address from a page).
#[tauri::command]
async fn open_link(webview: Webview, app: AppHandle, which: String) {
    let url = match which.as_str() {
        "releases" => "https://github.com/cee86/mida/releases",
        "project" => "https://github.com/cee86/mida",
        _ => return,
    };
    if from_shell(&webview) {
        if let Ok(url) = Url::parse(url) {
            open_external(&app, &url);
        }
    }
}

#[tauri::command]
async fn finish_first_run(webview: Webview, app: AppHandle, profile: ProfileInput, modules: Vec<String>) -> Value {
    if !from_shell(&webview) {
        return fail("Something went wrong.");
    }
    let Some(profile) = new_profile(&profile, &modules) else { return fail("Give your profile a name.") };
    let (id, active) = (profile.id.clone(), profile.active_id.clone());
    hub(&app).store.lock().unwrap().update(|s| {
        s.first_run_done = true;
        s.profiles = vec![profile];
        s.default_profile = Some(id.clone());
        s.current_profile = Some(id.clone());
    });
    select_module(&app, &active);
    json!({ "ok": true })
}

#[tauri::command]
async fn create_profile(webview: Webview, app: AppHandle, profile: ProfileInput, modules: Vec<String>) -> Value {
    if !from_shell(&webview) {
        return fail("Something went wrong.");
    }
    if hub(&app).store.lock().unwrap().get().profiles.len() >= MAX_PROFILES {
        return fail(&format!("You can have up to {MAX_PROFILES} profiles."));
    }
    let Some(profile) = new_profile(&profile, &modules) else { return fail("Give your profile a name.") };
    let id = profile.id.clone();
    hub(&app).store.lock().unwrap().update(|s| s.profiles.push(profile));
    switch_profile_now(&app, &id);
    json!({ "ok": true })
}

#[tauri::command]
async fn update_profile(webview: Webview, app: AppHandle, id: String, profile: ProfileInput) -> Value {
    if !from_shell(&webview) {
        return fail("Something went wrong.");
    }
    let name = clean_text(&profile.name, 32);
    if name.is_empty() {
        return fail("Give your profile a name.");
    }
    let game = if GAMES.iter().any(|g| g.id == profile.game) { profile.game } else { CUSTOM_GAME.to_string() };
    hub(&app).store.lock().unwrap().update(|s| {
        if let Some(p) = s.profiles.iter_mut().find(|p| p.id == id) {
            p.name = name;
            p.image = clean_image(profile.image.as_deref(), false, MAX_PICTURE);
            p.game = game;
            p.game_name = profile.game_name;
        }
    });
    emit_state(&app);
    json!({ "ok": true })
}

#[tauri::command]
async fn delete_profile(webview: Webview, app: AppHandle, id: String) {
    if !from_shell(&webview) {
        return;
    }
    let (count, was_current) = {
        let hub = hub(&app);
        let store = hub.store.lock().unwrap();
        (store.get().profiles.len(), store.get().current_profile.as_deref() == Some(id.as_str()))
    };
    if count <= 1 {
        return;
    }
    if was_current {
        close_all_pages(&app);
    }
    hub(&app).store.lock().unwrap().update(|s| {
        s.profiles.retain(|p| p.id != id);
        if s.current_profile.as_deref() == Some(id.as_str()) {
            s.current_profile = None; // cleaned to the default profile
        }
    });
    let active = active_id(&app);
    select_module(&app, &active);
}

#[tauri::command]
async fn switch_profile(webview: Webview, app: AppHandle, id: String) {
    if from_shell(&webview) {
        switch_profile_now(&app, &id);
    }
}

#[tauri::command]
async fn set_default_profile(webview: Webview, app: AppHandle, id: String) {
    if from_shell(&webview) {
        hub(&app).store.lock().unwrap().update(|s| {
            if s.profiles.iter().any(|p| p.id == id) {
                s.default_profile = Some(id);
            }
        });
        emit_state(&app);
    }
}

#[tauri::command]
async fn add_from_catalogue(webview: Webview, app: AppHandle, id: String) -> Value {
    if !from_shell(&webview) {
        return fail("Something went wrong.");
    }
    let game = current(&app).map(|p| p.game).unwrap_or_default();
    match from_catalogue(&game, &id) {
        Some(module) => add_module(&app, module),
        None => fail("That module isn't in the list."),
    }
}

#[tauri::command]
async fn add_custom(webview: Webview, app: AppHandle, name: String, url: String) -> Value {
    if !from_shell(&webview) {
        return fail("Something went wrong.");
    }
    let Some(url) = clean_url(&url) else {
        return fail("Enter a web address starting with https://, like https://example.com");
    };
    add_module(&app, Module { id: random_id("custom"), name: clean_name(&name, &url), url, icon: None })
}

// ---------- Window ----------

fn create_window(app: &AppHandle) -> tauri::Result<()> {
    let saved = hub(app).store.lock().unwrap().get().window;
    let (width, height) = saved.map(|w| (w.width, w.height)).unwrap_or((1440.0, 900.0));
    let mut builder = WindowBuilder::new(app, WINDOW)
        .title("MIDA")
        .inner_size(width, height)
        .min_inner_size(760.0, 520.0)
        .background_color(BACKGROUND)
        .visible(false);
    builder = match saved {
        Some(w) => builder.position(w.x, w.y),
        None => builder.center(),
    };
    let window = builder.build()?;

    // Put the window back on screen if the monitor it was last on is gone.
    if let (Some(w), Ok(monitors)) = (saved, window.available_monitors()) {
        let visible = monitors.iter().any(|m| {
            let scale = m.scale_factor();
            let (mx, my) = (m.position().x as f64 / scale, m.position().y as f64 / scale);
            let (mw, mh) = (m.size().width as f64 / scale, m.size().height as f64 / scale);
            w.x < mx + mw && w.x + w.width > mx && w.y < my + mh && w.y + w.height > my
        });
        if !visible {
            let _ = window.center();
        }
        if w.maximized {
            let _ = window.maximize();
        }
    }

    let shell = WebviewBuilder::new(SHELL, WebviewUrl::App("index.html".into()))
        .background_color(BACKGROUND)
        .zoom_hotkeys_enabled(false)
        // Lets the sidebar's own drag and drop (reordering modules) work; MIDA takes no file drops.
        .disable_drag_drop_handler()
        // The shell never goes anywhere but our own page.
        .on_navigation(|url| url.scheme() == "tauri" || url.host_str() == Some("tauri.localhost"))
        .on_new_window(|_, _| NewWindowResponse::Deny)
        .on_permission_request(|_, _| PermissionResponse::Deny);
    let shell = window.add_child(shell, LogicalPosition::new(0.0, 0.0), LogicalSize::new(width, height))?;
    window.show()?;
    // Interface size, only when changed (zooming before the page is on screen can leave it blank).
    let scale = prefs(app).ui_scale;
    if scale != 100 {
        let _ = shell.set_zoom(scale as f64 / 100.0);
    }
    // The shell always fills the window. (Sized by hand: Tauri's automatic resizing keeps the
    // proportions of the first size, which can be wrong before the window is on screen.)
    let _ = shell.set_size(window.inner_size()?);

    let app_handle = app.clone();
    window.on_window_event(move |event| match event {
        WindowEvent::Resized(size) => {
            if let Some(shell) = app_handle.get_webview(SHELL) {
                let _ = shell.set_size(*size);
            }
        }
        WindowEvent::CloseRequested { .. } => save_window_place(&app_handle),
        _ => {}
    });
    Ok(())
}

fn save_window_place(app: &AppHandle) {
    let Some(window) = app.get_window(WINDOW) else { return };
    let maximized = window.is_maximized().unwrap_or(false);
    let (Ok(scale), Ok(position), Ok(size)) = (window.scale_factor(), window.outer_position(), window.inner_size())
    else {
        return;
    };
    let previous = hub(app).store.lock().unwrap().get().window;
    // While maximized, keep the size it goes back to.
    let place = match (maximized, previous) {
        (true, Some(prev)) => WindowPlace { maximized: true, ..prev },
        _ => {
            let pos = position.to_logical::<f64>(scale);
            let size = size.to_logical::<f64>(scale);
            WindowPlace { x: pos.x, y: pos.y, width: size.width, height: size.height, maximized }
        }
    };
    hub(app).store.lock().unwrap().update(|s| s.window = Some(place));
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _, _| {
            if let Some(window) = app.get_window(WINDOW) {
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            let dir = app.path().app_config_dir()?;
            app.manage(Hub {
                account: Mutex::new(auth::load(&dir)),
                signing_in: Mutex::new(false),
                account_error: Mutex::new(None),
                manifest: tokio::sync::Mutex::new(None),
                plug_sets: Mutex::new(None),
                item_parts: Mutex::new(None),
                dir: dir.clone(),
                store: Mutex::new(Store::open(dir)),
                statuses: Mutex::new(HashMap::new()),
                panes: Mutex::new(Vec::new()),
                overlay: Mutex::new(false),
                update: Mutex::new(None),
                pending: Mutex::new(None),
                creating: Mutex::new(()),
                icon_tried: Mutex::new(HashSet::new()),
            });
            // The game data download reports its progress to the shell's loading bars.
            let reporter = app.handle().clone();
            bungie::set_reporter(Box::new(move |task, fraction, label| progress(&reporter, task, fraction, label)));
            let handle = app.handle().clone();
            create_window(&handle)?;

            // Open the default profile where it was left, straight away, to save time.
            let app = handle.clone();
            tauri::async_runtime::spawn_blocking(move || {
                let default = hub(&app).store.lock().unwrap().get().default_profile.clone();
                if let Some(default) = default {
                    hub(&app).store.lock().unwrap().update(|s| s.current_profile = Some(default));
                    ensure_controls(&app);
                    let active = active_id(&app);
                    select_module(&app, &active);
                }
            });

            let app = handle.clone();
            tauri::async_runtime::spawn(async move {
                loop {
                    check_for_update(&app).await;
                    tokio::time::sleep(UPDATE_CHECK_EVERY).await;
                }
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_state,
            set_panes,
            sign_in,
            sign_out,
            d2_inventory,
            d2_activity,
            d2_transfer,
            d2_equip,
            d2_character,
            d2_pull,
            d2_item,
            d2_lock,
            d2_plug,
            d2_loadout,
            d2_seasonal,
            d2_vendors,
            d2_planner,
            d2_pass,
            d2_claim,
            d2_rotators,
            split,
            close_pane,
            swap_panes,
            set_split,
            set_tabs,
            set_overlay,
            freeze_page,
            select,
            nav,
            toggle_sidebar,
            module_action,
            rename_module,
            reorder,
            download_update,
            check_update,
            key,
            set_prefs,
            open_link,
            finish_first_run,
            create_profile,
            update_profile,
            delete_profile,
            switch_profile,
            set_default_profile,
            add_from_catalogue,
            add_custom,
        ])
        .run(tauri::generate_context!())
        .expect("MIDA couldn't start");
}
