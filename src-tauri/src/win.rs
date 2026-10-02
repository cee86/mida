//! Windows only: things WebView2 (Windows' browser engine) can do that Tauri doesn't expose.
//! - Mida's shortcuts (Ctrl+B, Ctrl+1-9, Ctrl+Tab, Ctrl+,) while a module page has the keyboard.
//!   Browser keys (reload, back/forward, zoom) are handled by the page itself.
//! - Whether a page loaded, so Mida can show its own "couldn't load" panel instead of the
//!   browser's error page, and notice when a page crashes.
//! - Which page was clicked into, so side by side the open page follows the one in use.
//! - A picture of the page, shown behind Mida's menus and pop-ups (pages always sit above the
//!   app's own screen, so the app hides the page and shows this picture in its place).
//! - Telling the engine a page is in the background, so it gives memory back while unseen.

use crate::PageError;
use std::collections::HashMap;
use std::sync::{mpsc, Mutex, OnceLock};
use std::time::Duration;
use tauri::{AppHandle, Webview};
use webview2_com::Microsoft::Web::WebView2::Win32::*;
use webview2_com::{
    AcceleratorKeyPressedEventHandler, CapturePreviewCompletedHandler, FocusChangedEventHandler,
    NavigationCompletedEventHandler, ProcessFailedEventHandler,
};
use windows::core::Interface;
use windows::Win32::System::Com::{IStream, STATFLAG_NONAME, STATSTG, STREAM_SEEK_SET};
use windows::Win32::UI::Input::KeyboardAndMouse::{GetKeyState, VIRTUAL_KEY, VK_CONTROL, VK_MENU, VK_SHIFT};
use windows::Win32::UI::Shell::SHCreateMemStream;

pub fn hook(page: &Webview, app: AppHandle, id: String) {
    let _ = page.with_webview(move |platform| unsafe {
        let controller = platform.controller();
        let mut token = 0i64;

        let keys_app = app.clone();
        let keys = AcceleratorKeyPressedEventHandler::create(Box::new(move |_, args| {
            let Some(args) = args else { return Ok(()) };
            let mut kind = COREWEBVIEW2_KEY_EVENT_KIND::default();
            args.KeyEventKind(&mut kind)?;
            if kind != COREWEBVIEW2_KEY_EVENT_KIND_KEY_DOWN && kind != COREWEBVIEW2_KEY_EVENT_KIND_SYSTEM_KEY_DOWN {
                return Ok(());
            }
            let mut code = 0u32;
            args.VirtualKey(&mut code)?;
            let key = match code {
                0x42 => "b".to_string(),
                0x31..=0x39 => char::from(code as u8).to_string(),
                0x09 => "tab".to_string(),
                0xBC => ",".to_string(),
                _ => return Ok(()),
            };
            let down = |k: VIRTUAL_KEY| GetKeyState(k.0 as i32) < 0;
            if crate::shortcut(&keys_app, &key, down(VK_CONTROL), down(VK_SHIFT), down(VK_MENU)) {
                args.SetHandled(true)?;
            }
            Ok(())
        }));
        let _ = controller.add_AcceleratorKeyPressed(&keys, &mut token);

        // Run after the event: the app moves pages around, which shouldn't happen inside it.
        let (focus_app, focus_id) = (app.clone(), id.clone());
        let focused = FocusChangedEventHandler::create(Box::new(move |_, _| {
            let (app, id) = (focus_app.clone(), focus_id.clone());
            tauri::async_runtime::spawn(async move { crate::page_focused(&app, &id) });
            Ok(())
        }));
        let _ = controller.add_GotFocus(&focused, &mut token);

        let Ok(core) = controller.CoreWebView2() else { return };

        let (nav_app, nav_id) = (app.clone(), id.clone());
        let navigated = NavigationCompletedEventHandler::create(Box::new(move |_, args| {
            let Some(args) = args else { return Ok(()) };
            let mut ok = windows::core::BOOL::default();
            args.IsSuccess(&mut ok)?;
            let mut status = COREWEBVIEW2_WEB_ERROR_STATUS::default();
            args.WebErrorStatus(&mut status)?;
            let http = args
                .cast::<ICoreWebView2NavigationCompletedEventArgs2>()
                .ok()
                .and_then(|a| {
                    let mut code = 0i32;
                    a.HttpStatusCode(&mut code).ok().map(|_| code)
                })
                .unwrap_or(0);
            let result = if ok.as_bool() {
                // 503 is left alone: sites use it for their own maintenance and "checking your
                // browser" pages, which the user needs to see.
                matches!(http, 500 | 502 | 504).then(|| PageError { kind: "server".into(), status: http })
            } else {
                match error_kind(status) {
                    Some(kind) => Some(PageError { kind: kind.into(), status: http }),
                    None => return Ok(()), // cancelled (another link was clicked, a download...)
                }
            };
            crate::page_result(&nav_app, &nav_id, result);
            Ok(())
        }));
        let _ = core.add_NavigationCompleted(&navigated, &mut token);

        let (crash_app, crash_id) = (app.clone(), id.clone());
        let failed = ProcessFailedEventHandler::create(Box::new(move |_, args| {
            let Some(args) = args else { return Ok(()) };
            let mut kind = COREWEBVIEW2_PROCESS_FAILED_KIND::default();
            args.ProcessFailedKind(&mut kind)?;
            if kind == COREWEBVIEW2_PROCESS_FAILED_KIND_RENDER_PROCESS_EXITED
                || kind == COREWEBVIEW2_PROCESS_FAILED_KIND_RENDER_PROCESS_UNRESPONSIVE
            {
                crate::page_result(&crash_app, &crash_id, Some(PageError { kind: "crashed".into(), status: 0 }));
            }
            Ok(())
        }));
        let _ = core.add_ProcessFailed(&failed, &mut token);
    });
}

fn error_kind(status: COREWEBVIEW2_WEB_ERROR_STATUS) -> Option<&'static str> {
    Some(match status {
        COREWEBVIEW2_WEB_ERROR_STATUS_DISCONNECTED => "offline",
        COREWEBVIEW2_WEB_ERROR_STATUS_HOST_NAME_NOT_RESOLVED => "not-found",
        COREWEBVIEW2_WEB_ERROR_STATUS_TIMEOUT => "timeout",
        COREWEBVIEW2_WEB_ERROR_STATUS_CANNOT_CONNECT
        | COREWEBVIEW2_WEB_ERROR_STATUS_SERVER_UNREACHABLE
        | COREWEBVIEW2_WEB_ERROR_STATUS_CONNECTION_ABORTED
        | COREWEBVIEW2_WEB_ERROR_STATUS_CONNECTION_RESET => "unreachable",
        COREWEBVIEW2_WEB_ERROR_STATUS_CERTIFICATE_COMMON_NAME_IS_INCORRECT
        | COREWEBVIEW2_WEB_ERROR_STATUS_CERTIFICATE_EXPIRED
        | COREWEBVIEW2_WEB_ERROR_STATUS_CLIENT_CERTIFICATE_CONTAINS_ERRORS
        | COREWEBVIEW2_WEB_ERROR_STATUS_CERTIFICATE_REVOKED
        | COREWEBVIEW2_WEB_ERROR_STATUS_CERTIFICATE_IS_INVALID => "certificate",
        COREWEBVIEW2_WEB_ERROR_STATUS_REDIRECT_FAILED | COREWEBVIEW2_WEB_ERROR_STATUS_UNEXPECTED_ERROR => "other",
        // Unknown and cancelled: not treated as failures (downloads and interrupted loads end this way).
        _ => return None,
    })
}

/// A JPEG picture of the page as it looks now, or None. Never call on the main thread.
pub fn capture(page: &Webview) -> Option<Vec<u8>> {
    let (tx, rx) = mpsc::channel::<Option<Vec<u8>>>();
    let fail = tx.clone();
    page.with_webview(move |platform| unsafe {
        let start = || -> windows::core::Result<()> {
            let core = platform.controller().CoreWebView2()?;
            let stream: IStream = SHCreateMemStream(None).ok_or_else(windows::core::Error::empty)?;
            let reader = stream.clone();
            let done = CapturePreviewCompletedHandler::create(Box::new(move |result| {
                let bytes = result.ok().and_then(|_| read_all(&reader).ok());
                let _ = tx.send(bytes);
                Ok(())
            }));
            core.CapturePreview(COREWEBVIEW2_CAPTURE_PREVIEW_IMAGE_FORMAT_JPEG, &stream, &done)
        };
        if start().is_err() {
            let _ = fail.send(None);
        }
    })
    .ok()?;
    rx.recv_timeout(Duration::from_millis(1500)).ok().flatten()
}

unsafe fn read_all(stream: &IStream) -> windows::core::Result<Vec<u8>> {
    let mut stat = STATSTG::default();
    stream.Stat(&mut stat, STATFLAG_NONAME)?;
    let len = (stat.cbSize as usize).min(16 * 1024 * 1024);
    stream.Seek(0, STREAM_SEEK_SET, None)?;
    let mut bytes = vec![0u8; len];
    let mut read = 0u32;
    stream.Read(bytes.as_mut_ptr().cast(), len as u32, Some(&mut read)).ok()?;
    bytes.truncate(read as usize);
    Ok(bytes)
}

/// Pages not on screen (another module is open) ask the engine to use as little memory as it can;
/// pages coming back go back to normal. Only calls the engine when the state changes.
pub fn set_background(page: &Webview, background: bool) {
    static LEVELS: OnceLock<Mutex<HashMap<String, bool>>> = OnceLock::new();
    {
        let mut levels = LEVELS.get_or_init(Default::default).lock().unwrap();
        if levels.get(page.label()) == Some(&background) {
            return;
        }
        levels.insert(page.label().to_string(), background);
    }
    let _ = page.with_webview(move |platform| unsafe {
        let run = || -> windows::core::Result<()> {
            let core: ICoreWebView2_19 = platform.controller().CoreWebView2()?.cast()?;
            core.SetMemoryUsageTargetLevel(if background { COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_LOW } else { COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_NORMAL })
        };
        // Older engines without this setting simply keep their memory.
        let _ = run();
    });
}
