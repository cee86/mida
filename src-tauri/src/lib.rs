//! Mida: Destiny 2 companion sites in one window.
//!
//! The window has two layers. The "shell" (src/shell) is our own page: sidebar, toolbar and
//! dialogs. Each module (companion site) gets its own page laid over the shell's stage area.
//! Pages use Windows' built-in browser engine (WebView2, the engine behind Edge), so Mida
//! doesn't carry a browser of its own. A module loads the first time it's opened and then stays
//! alive in the background, so switching back is instant and the site keeps its place.
//!
//! Security: module pages are ordinary websites with no way to talk to the app (only the shell
//! may call the commands below, checked by page label), they can only go to web pages,
//! permission requests (camera, microphone, location, notifications...) are refused, and links
//! to other sites open in your normal browser.
//!
//! Threads: pages must be created away from the main thread (WebView2 freezes otherwise), so
//! anything that may create one runs in an async command or `spawn_blocking`. Our own locks are
//! never held while calling a page or the window, so nothing can wait on itself.

mod modules;
mod store;
#[cfg(windows)]
mod win_keys;

use modules::{
    clean_name, clean_url, from_catalogue, is_sign_in, is_web, same_site, Module, CATALOGUE, MAX_MODULES,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use store::{Store, WindowPlace};
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::webview::{NewWindowResponse, PageLoadEvent, PermissionResponse, WebviewBuilder};
use tauri::window::{Color, WindowBuilder};
use tauri::{
    AppHandle, Emitter, EventTarget, LogicalPosition, LogicalSize, Manager, Rect, Webview, WebviewUrl,
    WindowEvent,
};
use tauri_plugin_opener::OpenerExt;
use tauri_plugin_updater::UpdaterExt;
use url::Url;

const WINDOW: &str = "main";
const SHELL: &str = "shell";
const BACKGROUND: Color = Color(14, 16, 19, 255);
const UPDATE_CHECK_EVERY: Duration = Duration::from_secs(4 * 60 * 60);

#[derive(Serialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
struct Status {
    loading: bool,
    title: String,
    url: String,
    can_go_back: bool,
    can_go_forward: bool,
    error: Option<String>,
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

struct Hub {
    store: Mutex<Store>,
    statuses: Mutex<HashMap<String, Status>>, // modules that have a page
    stage: Mutex<Option<StageRect>>,          // where module pages go, in shell pixels
    overlay: Mutex<bool>,                     // a shell dialog is open, so pages are hidden
    update: Mutex<Option<UpdateInfo>>,
    pending: Mutex<Option<tauri_plugin_updater::Update>>,
    creating: Mutex<()>, // one page created at a time
}

fn hub(app: &AppHandle) -> tauri::State<'_, Hub> {
    app.state::<Hub>()
}

fn label_for(id: &str) -> String {
    format!("m-{id}")
}

fn find_module(app: &AppHandle, id: &str) -> Option<Module> {
    hub(app).store.lock().unwrap().get().modules.iter().find(|m| m.id == id).cloned()
}

fn active_id(app: &AppHandle) -> Option<String> {
    hub(app).store.lock().unwrap().get().active_id.clone()
}

fn open_external(app: &AppHandle, url: &Url) {
    if is_web(url) {
        let _ = app.opener().open_url(url.as_str(), None::<&str>);
    }
}

// ---------- State sent to the shell ----------

fn public_state(app: &AppHandle) -> Value {
    let hub = hub(app);
    let settings = hub.store.lock().unwrap().get().clone();
    let statuses = hub.statuses.lock().unwrap().clone();
    let update = hub.update.lock().unwrap().clone();
    json!({
        "firstRunDone": settings.first_run_done,
        "modules": settings.modules,
        "activeId": settings.active_id,
        "sidebarExpanded": settings.sidebar_expanded,
        "catalogue": CATALOGUE,
        "maxModules": MAX_MODULES,
        "statuses": statuses,
        "platform": std::env::consts::OS,
        "version": app.package_info().version.to_string(),
        "update": update,
    })
}

fn emit_state(app: &AppHandle) {
    let _ = app.emit_to(EventTarget::webview(SHELL), "state", public_state(app));
}

fn update_status(app: &AppHandle, id: &str, change: impl FnOnce(&mut Status)) {
    let status = {
        let hub = hub(app);
        let mut statuses = hub.statuses.lock().unwrap();
        let Some(status) = statuses.get_mut(id) else { return };
        change(status);
        status.clone()
    };
    let _ = app.emit_to(EventTarget::webview(SHELL), "status", json!({ "id": id, "status": status }));
}

// ---------- Module pages ----------

/// Show only the active module's page, sized to the stage, and only when no dialog needs the space.
fn layout(app: &AppHandle) {
    let hub = hub(app);
    let active = active_id(app);
    let stage = *hub.stage.lock().unwrap();
    let overlay = *hub.overlay.lock().unwrap();
    let ids: Vec<String> = hub.statuses.lock().unwrap().keys().cloned().collect();
    for id in ids {
        let Some(page) = app.get_webview(&label_for(&id)) else { continue };
        match stage {
            Some(r) if Some(&id) == active.as_ref() && !overlay => {
                let _ = page.set_bounds(Rect {
                    position: LogicalPosition::new(r.x, r.y).into(),
                    size: LogicalSize::new(r.width.max(1.0), r.height.max(1.0)).into(),
                });
                let _ = page.show();
            }
            _ => {
                let _ = page.hide();
            }
        }
    }
}

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
            .on_page_load(move |_, payload| {
                let loading = payload.event() == PageLoadEvent::Started;
                let url = payload.url().to_string();
                update_status(&on_load, &id_load, |s| {
                    s.loading = loading;
                    s.url = url;
                });
            })
            .on_document_title_changed(move |page, title| {
                // Sites that change pages without reloading (DIM, seals.report) still change
                // their title, so read the address again here too.
                let url = page.url().map(|u| u.to_string()).ok();
                update_status(&on_title, &id_title, |s| {
                    s.title = title;
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
    let modules = hub(app).store.lock().unwrap().get().modules.clone();
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
                if active_id(&app).as_deref() != Some(target.as_str()) {
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
    hub(app).statuses.lock().unwrap().insert(
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
    let stage = hub(app).stage.lock().unwrap().unwrap_or(StageRect { x: 0.0, y: 0.0, width: 1.0, height: 1.0 });
    let position = LogicalPosition::new(stage.x, stage.y);
    let size = LogicalSize::new(stage.width.max(1.0), stage.height.max(1.0));
    match window.add_child(builder, position, size) {
        Ok(page) => {
            #[cfg(windows)]
            win_keys::hook(&page, app.clone());
            Some(page)
        }
        Err(err) => {
            eprintln!("Couldn't open {}: {err}", module.name);
            hub(app).statuses.lock().unwrap().remove(&module.id);
            None
        }
    }
}

// ---------- Actions ----------

fn select_module(app: &AppHandle, id: &str) {
    let Some(module) = find_module(app, id) else { return };
    hub(app).store.lock().unwrap().update(|s| s.active_id = Some(id.to_string()));
    let page = ensure_page(app, &module);
    layout(app);
    emit_state(app);
    let overlay = *hub(app).overlay.lock().unwrap();
    if let (Some(page), false) = (page, overlay) {
        let _ = page.set_focus();
    }
}

fn select_offset(app: &AppHandle, step: isize) {
    let modules = hub(app).store.lock().unwrap().get().modules.clone();
    if modules.is_empty() {
        return;
    }
    let active = active_id(app);
    let index = modules.iter().position(|m| Some(&m.id) == active.as_ref()).unwrap_or(0) as isize;
    let len = modules.len() as isize;
    let next = ((index + step) % len + len) % len;
    select_module(app, &modules[next as usize].id);
}

fn navigate(app: &AppHandle, action: &str) {
    let Some(active) = active_id(app) else { return };
    let Some(module) = find_module(app, &active) else { return };
    let Some(page) = app.get_webview(&label_for(&active)) else { return };
    match action {
        "back" => {
            let _ = page.eval("history.back()");
        }
        "forward" => {
            let _ = page.eval("history.forward()");
        }
        "reload" | "hard-reload" | "retry" => {
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
    let id = module.id.clone();
    {
        let hub = hub(app);
        let mut store = hub.store.lock().unwrap();
        let modules = &store.get().modules;
        if modules.len() >= MAX_MODULES {
            return fail(&format!("You can have up to {MAX_MODULES} modules."));
        }
        if let Some(dupe) = modules.iter().find(|m| m.id == module.id || m.url == module.url) {
            return fail(&format!("{} is already in your sidebar.", dupe.name));
        }
        store.update(|s| s.modules.push(module));
    }
    select_module(app, &id);
    json!({ "ok": true })
}

fn move_module(app: &AppHandle, id: &str, step: isize) {
    hub(app).store.lock().unwrap().update(|s| {
        let Some(from) = s.modules.iter().position(|m| m.id == id) else { return };
        let to = from as isize + step;
        if to >= 0 && (to as usize) < s.modules.len() {
            s.modules.swap(from, to as usize);
        }
    });
    emit_state(app);
}

fn remove_module(app: &AppHandle, id: &str) {
    let (next, was_active) = {
        let hub = hub(app);
        let store = hub.store.lock().unwrap();
        let modules = &store.get().modules;
        let Some(index) = modules.iter().position(|m| m.id == id) else { return };
        let rest: Vec<&Module> = modules.iter().filter(|m| m.id != id).collect();
        let next = rest.get(index).or_else(|| index.checked_sub(1).and_then(|i| rest.get(i))).map(|m| m.id.clone());
        (next, store.get().active_id.as_deref() == Some(id))
    };
    if let Some(page) = app.get_webview(&label_for(id)) {
        let _ = page.close();
    }
    hub(app).statuses.lock().unwrap().remove(id);
    hub(app).store.lock().unwrap().update(|s| {
        s.modules.retain(|m| m.id != id);
        if was_active {
            s.active_id = next.clone();
        }
    });
    match next.filter(|_| was_active) {
        Some(next) => select_module(app, &next),
        None => {
            layout(app);
            emit_state(app);
        }
    }
}

fn module_menu(app: &AppHandle, id: &str) -> tauri::Result<()> {
    let modules = hub(app).store.lock().unwrap().get().modules.clone();
    let Some(index) = modules.iter().position(|m| m.id == id) else { return Ok(()) };
    let name = &modules[index].name;
    let has_page = app.get_webview(&label_for(id)).is_some();
    let item = |action: &str, text: String, enabled: bool| {
        MenuItem::with_id(app, format!("{action}|{id}"), text, enabled, None::<&str>)
    };
    let menu = Menu::with_items(
        app,
        &[
            &item("open", format!("Open {name}"), true)?,
            &item("reload", "Reload".into(), has_page)?,
            &item("browser", "Open in your browser".into(), true)?,
            &PredefinedMenuItem::separator(app)?,
            &item("up", "Move up".into(), index > 0)?,
            &item("down", "Move down".into(), index + 1 < modules.len())?,
            &PredefinedMenuItem::separator(app)?,
            &item("remove", format!("Remove {name}"), true)?,
        ],
    )?;
    if let Some(window) = app.get_window(WINDOW) {
        window.popup_menu(&menu)?;
    }
    Ok(())
}

fn menu_action(app: &AppHandle, action: &str, id: &str) {
    match action {
        "open" => select_module(app, id),
        "reload" => {
            if let Some(page) = app.get_webview(&label_for(id)) {
                let _ = page.reload();
            }
        }
        "browser" => {
            let current = hub(app).statuses.lock().unwrap().get(id).map(|s| s.url.clone());
            let fallback = find_module(app, id).map(|m| m.url);
            if let Some(url) = current.or(fallback).and_then(|u| Url::parse(&u).ok()) {
                open_external(app, &url);
            }
        }
        "up" => move_module(app, id, -1),
        "down" => move_module(app, id, 1),
        "remove" => remove_module(app, id),
        _ => {}
    }
}

// ---------- Keyboard shortcuts ----------

/// Shared by the shell (reported by src/shell/bridge.js) and, on Windows, module pages
/// (src-tauri/src/win_keys.rs). Returns true when the keys were a Mida shortcut.
pub(crate) fn shortcut(app: &AppHandle, key: &str, ctrl: bool, shift: bool, alt: bool) -> bool {
    let key = key.to_lowercase();
    let action: Box<dyn FnOnce(&AppHandle) + Send> = match (ctrl, shift, alt, key.as_str()) {
        (true, false, false, "b") => Box::new(toggle_sidebar_now),
        (true, true, false, "r") => Box::new(|a| navigate(a, "hard-reload")),
        (true, false, false, "r") | (_, _, _, "f5") => Box::new(|a| navigate(a, "reload")),
        (false, _, true, "arrowleft") => Box::new(|a| navigate(a, "back")),
        (false, _, true, "arrowright") => Box::new(|a| navigate(a, "forward")),
        (true, back, false, "tab") => Box::new(move |a| select_offset(a, if back { -1 } else { 1 })),
        (true, false, false, digit) if digit.len() == 1 && ("1"..="9").contains(&digit) => {
            let n: usize = digit.parse().unwrap_or(1);
            Box::new(move |a| {
                let target = hub(a).store.lock().unwrap().get().modules.get(n - 1).map(|m| m.id.clone());
                if let Some(target) = target {
                    select_module(a, &target);
                }
            })
        }
        _ => return false,
    };
    let app = app.clone();
    tauri::async_runtime::spawn_blocking(move || action(&app));
    true
}

// ---------- Updates ----------
//
// New versions are published as GitHub releases of cee86/mida, signed with Mida's update key
// (the public half is in tauri.conf.json, so a download that isn't ours is refused). The app
// only *checks* by itself, at start and every few hours; nothing downloads or installs until the
// user chooses Update. Then it downloads with progress, installs into the same folder and Mida
// reopens. Only the installed app checks; running from the code never does.

fn set_update(app: &AppHandle, info: Option<UpdateInfo>) {
    *hub(app).update.lock().unwrap() = info;
    emit_state(app);
}

fn short_version(version: &str) -> String {
    version.chars().take(32).collect()
}

async fn check_for_update(app: &AppHandle) {
    let status = hub(app).update.lock().unwrap().as_ref().map(|u| u.status);
    if matches!(status, Some("downloading" | "ready")) || tauri::is_dev() {
        return;
    }
    let Ok(updater) = app.updater() else { return };
    match updater.check().await {
        Ok(Some(update)) => {
            let version = short_version(&update.version);
            *hub(app).pending.lock().unwrap() = Some(update);
            set_update(app, Some(UpdateInfo { status: "available", version, percent: 0 }));
        }
        Ok(None) => {}
        // No internet, GitHub down...: try again at the next check; nothing to tell the user.
        Err(err) => eprintln!("Update check failed: {err}"),
    }
}

async fn download_update_now(app: AppHandle) {
    let Some(update) = hub(&app).pending.lock().unwrap().clone() else { return };
    let version = short_version(&update.version);
    set_update(&app, Some(UpdateInfo { status: "downloading", version: version.clone(), percent: 0 }));
    let mut received: u64 = 0;
    let mut shown: u32 = 0;
    let (progress_app, done_app) = (app.clone(), app.clone());
    let (progress_version, done_version) = (version.clone(), version.clone());
    let result = update
        .download_and_install(
            move |chunk, total| {
                received += chunk as u64;
                let percent = total.filter(|t| *t > 0).map(|t| (received * 100 / t).min(100) as u32).unwrap_or(0);
                if percent != shown {
                    shown = percent;
                    let info = UpdateInfo { status: "downloading", version: progress_version.clone(), percent };
                    set_update(&progress_app, Some(info));
                }
            },
            // Downloaded and checked: the installer takes over and reopens Mida.
            move || set_update(&done_app, Some(UpdateInfo { status: "ready", version: done_version, percent: 100 })),
        )
        .await;
    if let Err(err) = result {
        eprintln!("Update failed: {err}");
        set_update(&app, Some(UpdateInfo { status: "error", version, percent: 0 }));
    }
}

// ---------- Commands (only the shell may call these) ----------

fn from_shell(page: &Webview) -> bool {
    page.label() == SHELL
}

#[tauri::command]
async fn get_state(webview: Webview, app: AppHandle) -> Option<Value> {
    from_shell(&webview).then(|| public_state(&app))
}

#[tauri::command]
async fn set_stage_rect(webview: Webview, app: AppHandle, rect: StageRect) {
    let nums = [rect.x, rect.y, rect.width, rect.height];
    let valid = nums.iter().all(|n| n.is_finite() && *n >= 0.0 && *n < 100_000.0);
    if from_shell(&webview) && valid {
        *hub(&app).stage.lock().unwrap() = Some(rect);
        layout(&app);
    }
}

#[tauri::command]
async fn set_overlay(webview: Webview, app: AppHandle, open: bool) {
    if !from_shell(&webview) {
        return;
    }
    *hub(&app).overlay.lock().unwrap() = open;
    layout(&app);
    if !open {
        if let Some(page) = active_id(&app).and_then(|id| app.get_webview(&label_for(&id))) {
            let _ = page.set_focus();
        }
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
    if from_shell(&webview) {
        navigate(&app, &action);
    }
}

#[tauri::command]
async fn open_module_menu(webview: Webview, app: AppHandle, id: String) {
    if from_shell(&webview) {
        let _ = module_menu(&app, &id);
    }
}

#[tauri::command]
async fn toggle_sidebar(webview: Webview, app: AppHandle) {
    if from_shell(&webview) {
        toggle_sidebar_now(&app);
    }
}

#[tauri::command]
async fn download_update(webview: Webview, app: AppHandle) {
    let status = hub(&app).update.lock().unwrap().as_ref().map(|u| u.status);
    if from_shell(&webview) && matches!(status, Some("available" | "error")) {
        download_update_now(app).await;
    }
}

#[tauri::command]
async fn key(webview: Webview, app: AppHandle, key: String, ctrl: bool, shift: bool, alt: bool) -> bool {
    from_shell(&webview) && shortcut(&app, &key, ctrl, shift, alt)
}

#[tauri::command]
async fn finish_first_run(webview: Webview, app: AppHandle, ids: Vec<String>) -> Value {
    if !from_shell(&webview) {
        return fail("Something went wrong.");
    }
    let mut chosen: Vec<Module> = Vec::new();
    for id in ids.iter().take(MAX_MODULES) {
        if let Some(module) = from_catalogue(id) {
            if !chosen.iter().any(|m| m.id == module.id) {
                chosen.push(module);
            }
        }
    }
    let Some(first) = chosen.first().map(|m| m.id.clone()) else {
        return fail("Pick at least one module to start with.");
    };
    hub(&app).store.lock().unwrap().update(|s| {
        s.first_run_done = true;
        s.modules = chosen;
    });
    select_module(&app, &first);
    json!({ "ok": true })
}

#[tauri::command]
async fn add_from_catalogue(webview: Webview, app: AppHandle, id: String) -> Value {
    if !from_shell(&webview) {
        return fail("Something went wrong.");
    }
    match from_catalogue(&id) {
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
    let nanos = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0);
    let id = format!("custom-{:x}", (nanos as u64) & 0xff_ffff_ffff);
    add_module(&app, Module { id, name: clean_name(&name, &url), url, icon: None })
}

// ---------- Window ----------

fn create_window(app: &AppHandle) -> tauri::Result<()> {
    let saved = hub(app).store.lock().unwrap().get().window;
    let (width, height) = saved.map(|w| (w.width, w.height)).unwrap_or((1440.0, 900.0));
    let mut builder = WindowBuilder::new(app, WINDOW)
        .title("Mida")
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
        // The shell never goes anywhere but our own page.
        .on_navigation(|url| url.scheme() == "tauri" || url.host_str() == Some("tauri.localhost"))
        .on_new_window(|_, _| NewWindowResponse::Deny)
        .on_permission_request(|_, _| PermissionResponse::Deny);
    let shell = window.add_child(shell, LogicalPosition::new(0.0, 0.0), LogicalSize::new(width, height))?;
    window.show()?;
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
                store: Mutex::new(Store::open(dir)),
                statuses: Mutex::new(HashMap::new()),
                stage: Mutex::new(None),
                overlay: Mutex::new(false),
                update: Mutex::new(None),
                pending: Mutex::new(None),
                creating: Mutex::new(()),
            });
            let handle = app.handle().clone();
            create_window(&handle)?;

            // Start loading the last module straight away, alongside the shell, to save time.
            let first_run_done = hub(&handle).store.lock().unwrap().get().first_run_done;
            if let (true, Some(active)) = (first_run_done, active_id(&handle)) {
                let app = handle.clone();
                tauri::async_runtime::spawn_blocking(move || select_module(&app, &active));
            }

            let app = handle.clone();
            tauri::async_runtime::spawn(async move {
                loop {
                    check_for_update(&app).await;
                    tokio::time::sleep(UPDATE_CHECK_EVERY).await;
                }
            });
            Ok(())
        })
        .on_menu_event(|app, event| {
            if let Some((action, id)) = event.id().as_ref().split_once('|') {
                let (app, action, id) = (app.clone(), action.to_string(), id.to_string());
                tauri::async_runtime::spawn_blocking(move || menu_action(&app, &action, &id));
            }
        })
        .invoke_handler(tauri::generate_handler![
            get_state,
            set_stage_rect,
            set_overlay,
            select,
            nav,
            open_module_menu,
            toggle_sidebar,
            download_update,
            key,
            finish_first_run,
            add_from_catalogue,
            add_custom,
        ])
        .run(tauri::generate_context!())
        .expect("Mida couldn't start");
}
