//! Bungie sign-in, for the Destiny 2 tabs that read the player's own characters.
//!
//! How it works (and why):
//! - Mida has its own Bungie app. Its client secret can't be kept safe inside a program anyone can
//!   download, so it lives only on the seals.report server, which swaps codes and refresh tokens for
//!   Mida (`/api/mida/token`) and stores nothing.
//! - Signing in happens in the player's normal browser (they can see it's really bungie.net). Mida
//!   listens once on this computer only (127.0.0.1, a random port) for the one-time code Bungie hands
//!   back through seals.report, and checks it carries the random `state` Mida made.
//! - The tokens are kept in `account.bin` next to settings.json, encrypted by Windows for this
//!   Windows user (DPAPI), so other users and copied files can't read them. Elsewhere (Linux test
//!   builds) they're only kept in memory.
//! - The API key (identifies Mida to Bungie, not a password) is built in from the
//!   MIDA_BUNGIE_API_KEY build secret; builds without it can't sign in.

use base64::Engine;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::Path;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use url::Url;

pub const SITE: &str = "https://d2-seals-report.vercel.app";
pub const API_KEY: Option<&str> = option_env!("MIDA_BUNGIE_API_KEY");

/// The API key without any spaces or line breaks pasted around it; None if there isn't one.
pub fn api_key() -> Option<&'static str> {
    API_KEY.map(str::trim).filter(|k| !k.is_empty())
}
/// How long the browser sign-in may take before Mida stops listening.
const SIGN_IN_WAIT: Duration = Duration::from_secs(300);

#[derive(Serialize, Deserialize, Clone)]
pub struct Account {
    pub access: String,
    pub access_until: u64,
    pub refresh: String,
    pub refresh_until: u64,
    pub name: String,
    pub membership_type: i64,
    pub membership_id: String,
}

pub fn now() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0)
}

// ---------- Random state ----------

#[cfg(windows)]
fn random_bytes(buf: &mut [u8]) -> bool {
    use windows::Win32::Security::Cryptography::{BCryptGenRandom, BCRYPT_USE_SYSTEM_PREFERRED_RNG};
    unsafe { BCryptGenRandom(None, buf, BCRYPT_USE_SYSTEM_PREFERRED_RNG).is_ok() }
}

#[cfg(not(windows))]
fn random_bytes(buf: &mut [u8]) -> bool {
    std::fs::File::open("/dev/urandom").and_then(|mut f| f.read_exact(buf)).is_ok()
}

/// A random value proving the code that comes back belongs to this sign-in.
pub fn random_state() -> Option<String> {
    let mut buf = [0u8; 24];
    random_bytes(&mut buf).then(|| base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(buf))
}

// ---------- Saved sign-in ----------

const FILE: &str = "account.bin";

#[cfg(windows)]
fn protect(data: &[u8], encrypt: bool) -> Option<Vec<u8>> {
    use windows::core::PCWSTR;
    use windows::Win32::Foundation::{LocalFree, HLOCAL};
    use windows::Win32::Security::Cryptography::{
        CryptProtectData, CryptUnprotectData, CRYPTPROTECT_UI_FORBIDDEN, CRYPT_INTEGER_BLOB,
    };
    unsafe {
        let input = CRYPT_INTEGER_BLOB { cbData: data.len() as u32, pbData: data.as_ptr() as *mut u8 };
        let mut output = CRYPT_INTEGER_BLOB::default();
        let result = if encrypt {
            CryptProtectData(&input, PCWSTR::null(), None, None, None, CRYPTPROTECT_UI_FORBIDDEN, &mut output)
        } else {
            CryptUnprotectData(&input, None, None, None, None, CRYPTPROTECT_UI_FORBIDDEN, &mut output)
        };
        result.ok()?;
        let bytes = std::slice::from_raw_parts(output.pbData, output.cbData as usize).to_vec();
        let _ = LocalFree(Some(HLOCAL(output.pbData as _)));
        Some(bytes)
    }
}

pub fn load(dir: &Path) -> Option<Account> {
    #[cfg(windows)]
    {
        let bytes = std::fs::read(dir.join(FILE)).ok()?;
        serde_json::from_slice(&protect(&bytes, false)?).ok()
    }
    #[cfg(not(windows))]
    {
        let _ = dir;
        None
    }
}

pub fn save(dir: &Path, account: &Account) {
    #[cfg(windows)]
    {
        let Ok(json) = serde_json::to_vec(account) else { return };
        if let Some(bytes) = protect(&json, true) {
            let _ = std::fs::create_dir_all(dir);
            let _ = std::fs::write(dir.join(FILE), bytes);
        }
    }
    #[cfg(not(windows))]
    {
        let _ = (dir, account);
    }
}

pub fn forget(dir: &Path) {
    let _ = std::fs::remove_file(dir.join(FILE));
}

// ---------- The one-time listener ----------

pub fn listen() -> Option<(TcpListener, u16)> {
    let listener = TcpListener::bind(("127.0.0.1", 0)).ok()?;
    let port = listener.local_addr().ok()?.port();
    listener.set_nonblocking(true).ok()?;
    Some((listener, port))
}

fn reply(stream: &mut TcpStream, status: &str, title: &str, text: &str) {
    let body = format!(
        "<!doctype html><meta charset=\"utf-8\"><title>Mida</title>\
         <body style=\"font:16px system-ui;background:#111416;color:#e6ecee;display:grid;place-items:center;height:100vh;margin:0\">\
         <div style=\"text-align:center\"><h1 style=\"font-weight:400\">{title}</h1><p>{text}</p></div>"
    );
    let _ = write!(
        stream,
        "HTTP/1.1 {status}\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n{body}",
        body.len()
    );
}

/// Waits (blocking, up to five minutes) for the browser to come back with the code. Anything
/// that isn't the sign-in callback with the right state is turned away.
pub fn wait_for_code(listener: TcpListener, state: &str) -> Result<String, String> {
    let started = Instant::now();
    while started.elapsed() < SIGN_IN_WAIT {
        let mut stream = match listener.accept() {
            Ok((stream, _)) => stream,
            Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                std::thread::sleep(Duration::from_millis(150));
                continue;
            }
            Err(_) => return Err("Sign-in stopped unexpectedly. Try again.".into()),
        };
        let _ = stream.set_nonblocking(false);
        let _ = stream.set_read_timeout(Some(Duration::from_secs(5)));
        let mut buf = [0u8; 8192];
        let n = stream.read(&mut buf).unwrap_or(0);
        let request = String::from_utf8_lossy(&buf[..n]);
        let path = request.lines().next().and_then(|line| line.split(' ').nth(1)).unwrap_or("");
        let Ok(url) = Url::parse(&format!("http://127.0.0.1{path}")) else { continue };
        if url.path() != "/callback" {
            reply(&mut stream, "404 Not Found", "Not here", "");
            continue;
        }
        let get = |key: &str| url.query_pairs().find(|(k, _)| k == key).map(|(_, v)| v.into_owned());
        if get("state").as_deref() != Some(state) {
            reply(&mut stream, "400 Bad Request", "That sign-in didn't match", "Close this tab and sign in again from Mida.");
            continue;
        }
        return match get("code") {
            Some(code) if !code.is_empty() && code.len() <= 512 => {
                reply(&mut stream, "200 OK", "Signed in to Mida", "You can close this tab and go back to Mida.");
                Ok(code)
            }
            _ => {
                reply(&mut stream, "200 OK", "Sign-in cancelled", "You can close this tab.");
                Err("Sign-in was cancelled.".into())
            }
        };
    }
    Err("Sign-in timed out. Try again.".into())
}

// ---------- Tokens and the account ----------

/// Swaps a code ("code") or refresh token ("refresh") for tokens, through seals.report.
pub async fn exchange(grant: &str, value: &str) -> Result<Tokens, String> {
    let client = reqwest::Client::new();
    let res = client
        .post(format!("{SITE}/api/mida/token"))
        .header("Content-Type", "application/json")
        .body(json!({ "grant": grant, "value": value }).to_string())
        .timeout(Duration::from_secs(20))
        .send()
        .await
        .map_err(|_| "Couldn't reach the sign-in service. Check your connection and try again.".to_string())?;
    let body: Value = serde_json::from_slice(&res.bytes().await.map_err(|_| "Sign-in failed. Try again.".to_string())?)
        .map_err(|_| "Sign-in failed. Try again.".to_string())?;
    let access = body["access_token"].as_str().unwrap_or("").to_string();
    if access.is_empty() {
        return Err(body["error"].as_str().unwrap_or("Bungie didn't accept the sign-in.").to_string());
    }
    let t = now();
    let refresh = body["refresh_token"].as_str().unwrap_or("").to_string();
    let access_until = t + body["expires_in"].as_u64().unwrap_or(3600);
    let refresh_until = if refresh.is_empty() { 0 } else { t + body["refresh_expires_in"].as_u64().unwrap_or(0) };
    // The Bungie.net account the sign-in belongs to (a number), sent with the tokens.
    let bungie_id = match &body["membership_id"] {
        Value::String(s) => s.clone(),
        Value::Number(n) => n.to_string(),
        _ => String::new(),
    };
    Ok(Tokens { access, access_until, refresh, refresh_until, bungie_id })
}

pub struct Tokens {
    pub access: String,
    pub access_until: u64,
    pub refresh: String,
    pub refresh_until: u64,
    pub bungie_id: String,
}

/// The main Destiny account behind a Bungie sign-in (cross save aware), and the Bungie Name.
pub fn pick_membership(data: &Value) -> Option<(i64, String, String)> {
    let cards = data["destinyMemberships"].as_array()?;
    let primary = data["primaryMembershipId"].as_str();
    let card = primary
        .and_then(|id| cards.iter().find(|c| c["membershipId"].as_str() == Some(id)))
        .or_else(|| {
            cards.iter().find(|c| {
                let over = c["crossSaveOverride"].as_i64().unwrap_or(0);
                over == 0 || over == c["membershipType"].as_i64().unwrap_or(-1)
            })
        })
        .or_else(|| cards.first())?;
    let user = &data["bungieNetUser"];
    let global = card["bungieGlobalDisplayName"].as_str().or(user["cachedBungieGlobalDisplayName"].as_str()).unwrap_or("");
    let code = card["bungieGlobalDisplayNameCode"].as_i64().or(user["cachedBungieGlobalDisplayNameCode"].as_i64());
    let name = match (global, code) {
        ("", _) => card["displayName"].as_str().unwrap_or("Guardian").to_string(),
        (g, Some(c)) => format!("{g}#{c:04}"),
        (g, None) => g.to_string(),
    };
    Some((card["membershipType"].as_i64()?, card["membershipId"].as_str()?.to_string(), name))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn picks_the_cross_save_account() {
        let data = json!({
            "destinyMemberships": [
                { "membershipType": 1, "membershipId": "11", "crossSaveOverride": 3, "displayName": "x", "bungieGlobalDisplayName": "Nocture", "bungieGlobalDisplayNameCode": 1364 },
                { "membershipType": 3, "membershipId": "33", "crossSaveOverride": 3, "displayName": "x", "bungieGlobalDisplayName": "Nocture", "bungieGlobalDisplayNameCode": 1364 }
            ]
        });
        assert_eq!(pick_membership(&data), Some((3, "33".into(), "Nocture#1364".into())));
        let primary = json!({ "primaryMembershipId": "11", "destinyMemberships": data["destinyMemberships"] });
        assert_eq!(pick_membership(&primary).unwrap().1, "11");
    }

    #[test]
    fn state_is_random_and_url_safe() {
        let a = random_state().unwrap();
        assert_ne!(a, random_state().unwrap());
        assert!(a.len() >= 16 && a.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_'));
    }

    #[test]
    fn listener_takes_only_the_matching_state() {
        let (listener, port) = listen().unwrap();
        let send = move |path: &'static str| {
            std::thread::spawn(move || {
                let mut s = TcpStream::connect(("127.0.0.1", port)).unwrap();
                write!(s, "GET {path} HTTP/1.1\r\nHost: x\r\n\r\n").unwrap();
                let mut out = String::new();
                let _ = s.read_to_string(&mut out);
                out
            })
        };
        let waiting = std::thread::spawn(move || wait_for_code(listener, "good"));
        assert!(send("/favicon.ico").join().unwrap().contains("404"));
        assert!(send("/callback?state=nope&code=bad").join().unwrap().contains("400"));
        assert!(send("/callback?state=good&code=abc123").join().unwrap().contains("200"));
        assert_eq!(waiting.join().unwrap(), Ok("abc123".into()));
    }
}
