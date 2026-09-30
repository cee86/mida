//! Windows only: Mida's own shortcuts (Ctrl+B, Ctrl+1-9, Ctrl+Tab) while a module page has the
//! keyboard. Browser keys (reload, back/forward, zoom) are handled by the page itself.

use tauri::{AppHandle, Webview};
use webview2_com::AcceleratorKeyPressedEventHandler;
use webview2_com::Microsoft::Web::WebView2::Win32::{
    COREWEBVIEW2_KEY_EVENT_KIND, COREWEBVIEW2_KEY_EVENT_KIND_KEY_DOWN, COREWEBVIEW2_KEY_EVENT_KIND_SYSTEM_KEY_DOWN,
};
use windows::Win32::UI::Input::KeyboardAndMouse::{GetKeyState, VIRTUAL_KEY, VK_CONTROL, VK_MENU, VK_SHIFT};

pub fn hook(page: &Webview, app: AppHandle) {
    let _ = page.with_webview(move |platform| unsafe {
        let handler = AcceleratorKeyPressedEventHandler::create(Box::new(move |_, args| {
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
                _ => return Ok(()),
            };
            let down = |k: VIRTUAL_KEY| GetKeyState(k.0 as i32) < 0;
            if crate::shortcut(&app, &key, down(VK_CONTROL), down(VK_SHIFT), down(VK_MENU)) {
                args.SetHandled(true)?;
            }
            Ok(())
        }));
        let mut token = 0i64;
        let _ = platform.controller().add_AcceleratorKeyPressed(&handler, &mut token);
    });
}
