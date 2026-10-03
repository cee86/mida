//! Modules: the companion sites the app can show, and the checks every saved or added module
//! goes through. Pure (no windows or pages), so the rules are easy to read in one place.

use serde::{Deserialize, Serialize};
use url::Url;

#[derive(Serialize, Clone, Copy)]
pub struct Game {
    pub id: &'static str,
    pub name: &'static str,
}

/// Games MIDA knows. A profile for any other game is "custom": it gets no recommendations.
pub const GAMES: &[Game] = &[Game { id: "destiny2", name: "Destiny 2" }];
pub const CUSTOM_GAME: &str = "custom";

#[derive(Serialize, Clone, Copy)]
pub struct CatalogueEntry {
    pub game: &'static str,
    pub id: &'static str,
    pub name: &'static str,
    pub url: &'static str,
    pub blurb: &'static str,
    pub starter: bool,
}

/// MIDA's own built-in tabs (drawn by the app itself, not websites), per game. Each can be
/// switched off per profile. `sign_in`: needs a Bungie sign-in to show anything.
#[derive(Serialize, Clone, Copy)]
#[serde(rename_all = "camelCase")]
pub struct BuiltInTab {
    pub game: &'static str,
    pub id: &'static str,
    pub name: &'static str,
    pub blurb: &'static str,
    pub sign_in: bool,
}

pub const TABS: &[BuiltInTab] = &[
    BuiltInTab { game: "destiny2", id: "tab-inventory", name: "Inventory", blurb: "Move gear between your characters and the vault.", sign_in: true },
    BuiltInTab { game: "destiny2", id: "tab-seasonal", name: "Seasonal Hub", blurb: "Orders, daily and weekly objectives, and your season pass track.", sign_in: true },
    BuiltInTab { game: "destiny2", id: "tab-quests", name: "Quests", blurb: "Every quest a character has picked up.", sign_in: true },
    BuiltInTab { game: "destiny2", id: "tab-rad", name: "RAD assistant", blurb: "Raids and dungeons: encounters, loot, tips and maps.", sign_in: false },
    BuiltInTab { game: "destiny2", id: "tab-featured", name: "Rotators", blurb: "This week's raids, dungeons, rotations and timers, at a glance.", sign_in: false },
];

/// The built-in tabs a game has (all of them, in order).
pub fn tabs_for(game: &str) -> Vec<&'static str> {
    TABS.iter().filter(|t| t.game == game).map(|t| t.id).collect()
}

/// Recommended sites per game, offered in the first-run picker and in "Add a module". `starter`
/// ones are ticked by default. Addresses are the sites' own home pages.
pub const CATALOGUE: &[CatalogueEntry] = &[
    CatalogueEntry {
        game: "destiny2",
        id: "seals-report",
        name: "seals.report",
        url: "https://d2-seals-report.vercel.app/",
        blurb: "Seals and titles: what to do next and how far you are.",
        starter: true,
    },
    CatalogueEntry {
        game: "destiny2",
        id: "light-gg",
        name: "light.gg",
        url: "https://www.light.gg/",
        blurb: "Weapon and armor database, god rolls and popularity.",
        starter: true,
    },
    CatalogueEntry {
        game: "destiny2",
        id: "dim",
        name: "DIM",
        url: "https://app.destinyitemmanager.com/",
        blurb: "Destiny Item Manager: move gear, build loadouts, sort your vault.",
        starter: true,
    },
    CatalogueEntry {
        game: "destiny2",
        id: "raid-report",
        name: "raid.report",
        url: "https://raid.report/",
        blurb: "Raid clears, fastest times and flawless runs.",
        starter: false,
    },
    CatalogueEntry {
        game: "destiny2",
        id: "dungeon-report",
        name: "dungeon.report",
        url: "https://dungeon.report/",
        blurb: "Dungeon clears, solos and flawless runs.",
        starter: false,
    },
    CatalogueEntry {
        game: "destiny2",
        id: "d2-foundry",
        name: "D2 Foundry",
        url: "https://d2foundry.gg/",
        blurb: "Weapon perks and stats, roll by roll.",
        starter: false,
    },
    CatalogueEntry {
        game: "destiny2",
        id: "braytech",
        name: "Braytech",
        url: "https://bray.tech/",
        blurb: "Triumphs, collections and checklists.",
        starter: false,
    },
    CatalogueEntry {
        game: "destiny2",
        id: "today-in-destiny",
        name: "Today in Destiny",
        url: "https://www.todayindestiny.com/",
        blurb: "Daily and weekly rotations, vendors and resets.",
        starter: false,
    },
];

pub const MAX_MODULES: usize = 40;
const MAX_NAME: usize = 40;
const MAX_URL: usize = 2048;

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct Module {
    pub id: String,
    pub name: String,
    pub url: String,
    /// The site's own icon, saved as a small image the first time the site loads.
    #[serde(default)]
    pub icon: Option<String>,
}

/// Only real web pages over https. No passwords in the address, no local files, no other
/// programs' links (steam://, file:// ...): those could reach outside the app.
pub fn clean_url(value: &str) -> Option<String> {
    if value.len() > MAX_URL {
        return None;
    }
    let raw = value.trim();
    if raw.is_empty() {
        return None;
    }
    let has_scheme = raw
        .split_once(':')
        .map(|(scheme, _)| {
            !scheme.is_empty()
                && scheme.chars().next().is_some_and(|c| c.is_ascii_alphabetic())
                && scheme.chars().all(|c| c.is_ascii_alphanumeric() || "+.-".contains(c))
        })
        .unwrap_or(false)
        // "localhost:3000" style would parse as a scheme; real schemes are followed by "//".
        && raw.contains("://");
    let url = if has_scheme { Url::parse(raw) } else { Url::parse(&format!("https://{raw}")) }.ok()?;
    if url.scheme() != "https" || !url.username().is_empty() || url.password().is_some() {
        return None;
    }
    let host = url.host_str()?;
    if !host.contains('.') {
        return None;
    }
    Some(url.to_string())
}

pub fn clean_name(value: &str, url: &str) -> String {
    let name: String = value.split_whitespace().collect::<Vec<_>>().join(" ");
    let name: String = name.chars().take(MAX_NAME).collect();
    if !name.is_empty() {
        return name;
    }
    Url::parse(url)
        .ok()
        .and_then(|u| u.host_str().map(|h| h.trim_start_matches("www.").to_string()))
        .unwrap_or_else(|| "Module".into())
}

/// Plain one-line text (names), trimmed and cut to `max` characters.
pub fn clean_text(value: &str, max: usize) -> String {
    let text: String = value.chars().filter(|c| !c.is_control()).collect();
    text.split_whitespace().collect::<Vec<_>>().join(" ").chars().take(max).collect()
}

/// A small picture kept as a data URL. Pictures are shown with <img> only (never as a page), so
/// even SVG can't run anything; size and type are still limited.
pub fn clean_image(value: Option<&str>, svg_ok: bool, max_len: usize) -> Option<String> {
    let value = value?;
    if value.len() > max_len {
        return None;
    }
    let (head, data) = value.split_once(";base64,")?;
    let kind = head.strip_prefix("data:image/")?;
    let allowed = matches!(kind, "png" | "jpeg" | "webp" | "gif" | "x-icon" | "vnd.microsoft.icon")
        || (svg_ok && kind == "svg+xml");
    let valid = !data.is_empty() && data.bytes().all(|b| b.is_ascii_alphanumeric() || b"+/=".contains(&b));
    (allowed && valid).then(|| value.to_string())
}

pub const MAX_ICON: usize = 150_000;
pub const MAX_PICTURE: usize = 150_000;

fn clean_id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 48
        && value.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
}

pub fn clean_module(value: &Module) -> Option<Module> {
    let url = clean_url(&value.url)?;
    if !clean_id(&value.id) {
        return None;
    }
    let icon = clean_image(value.icon.as_deref(), true, MAX_ICON);
    Some(Module { id: value.id.clone(), name: clean_name(&value.name, &url), url, icon })
}

pub fn clean_modules(list: &[Module]) -> Vec<Module> {
    let mut out: Vec<Module> = Vec::new();
    for item in list {
        if let Some(module) = clean_module(item) {
            if !out.iter().any(|m| m.id == module.id) {
                out.push(module);
            }
        }
        if out.len() >= MAX_MODULES {
            break;
        }
    }
    out
}

pub fn from_catalogue(game: &str, id: &str) -> Option<Module> {
    CATALOGUE.iter().find(|c| c.game == game && c.id == id).map(|c| Module {
        id: c.id.into(),
        name: c.name.into(),
        url: c.url.into(),
        icon: None,
    })
}

/// Hosts where one address can't stand for one site (anyone can have name.vercel.app), so the
/// site is the last three parts of the name instead of the last two.
const SHARED_SUFFIXES: &[&str] = &[
    "vercel.app", "netlify.app", "github.io", "pages.dev", "web.app", "firebaseapp.com",
    "herokuapp.com", "co.uk", "com.au", "co.jp", "com.br",
];

fn site_of(host: &str) -> String {
    let parts: Vec<&str> = host.split('.').filter(|p| !p.is_empty()).collect();
    let take = |n: usize| parts[parts.len().saturating_sub(n)..].join(".").to_lowercase();
    let two = take(2);
    if SHARED_SUFFIXES.contains(&two.as_str()) { take(3) } else { two }
}

pub fn same_site(a: &Url, b: &str) -> bool {
    match (a.host_str(), Url::parse(b).ok().and_then(|u| u.host_str().map(str::to_string))) {
        (Some(x), Some(y)) => site_of(x) == site_of(&y),
        _ => false,
    }
}

/// Sign-in pages companion sites send you to (Bungie and the platforms Bungie accepts).
/// Pop-ups to these open inside the app so the sign-in can hand back to the site.
const SIGN_IN_SITES: &[&str] = &[
    "bungie.net", "steamcommunity.com", "steampowered.com", "live.com", "microsoftonline.com",
    "xbox.com", "microsoft.com", "playstation.com", "sonyentertainmentnetwork.com",
    "epicgames.com", "twitch.tv", "discord.com", "google.com",
];

pub fn is_sign_in(url: &Url) -> bool {
    url.scheme() == "https" && url.host_str().is_some_and(|h| SIGN_IN_SITES.contains(&site_of(h).as_str()))
}

pub fn is_web(url: &Url) -> bool {
    matches!(url.scheme(), "https" | "http")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn urls() {
        assert_eq!(clean_url("light.gg").as_deref(), Some("https://light.gg/"));
        assert_eq!(clean_url("https://www.light.gg/db").as_deref(), Some("https://www.light.gg/db"));
        assert_eq!(clean_url("javascript:alert(1)"), None);
        assert_eq!(clean_url("http://x.com"), None);
        assert_eq!(clean_url("file:///etc/passwd"), None);
        assert_eq!(clean_url("https://user:pw@x.com"), None);
        assert_eq!(clean_url("https://localhost"), None);
        assert_eq!(clean_url("steam://run/1085660"), None);
        assert_eq!(clean_url("   "), None);
    }

    #[test]
    fn sites() {
        let u = |s: &str| Url::parse(s).unwrap();
        assert!(!same_site(&u("https://d2-seals-report.vercel.app/x"), "https://evil.vercel.app/"));
        assert!(same_site(&u("https://www.light.gg/db"), "https://light.gg/"));
        assert!(same_site(&u("https://app.destinyitemmanager.com"), "https://destinyitemmanager.com/x"));
        assert!(is_sign_in(&u("https://www.bungie.net/en/OAuth/Authorize")));
        assert!(!is_sign_in(&u("https://bungie.net.evil.com/")));
        assert!(!is_sign_in(&u("http://www.bungie.net/")));
    }

    #[test]
    fn names_and_modules() {
        assert_eq!(clean_name("  My   site ", "https://x.com/"), "My site");
        assert_eq!(clean_name("", "https://www.x.com/"), "x.com");
        let bad = Module { id: "Bad Id".into(), name: "x".into(), url: "https://x.com".into(), icon: None };
        assert!(clean_module(&bad).is_none());
        let dupes = vec![from_catalogue("destiny2", "dim").unwrap(), from_catalogue("destiny2", "dim").unwrap()];
        assert_eq!(clean_modules(&dupes).len(), 1);
        assert!(from_catalogue("custom", "dim").is_none());
        assert_eq!(clean_text("  a\u{7}  b  ", 10), "a b");
    }

    #[test]
    fn images() {
        assert!(clean_image(Some("data:image/png;base64,iVBORw0KGgo="), false, 1000).is_some());
        assert!(clean_image(Some("data:image/svg+xml;base64,PHN2Zz4="), false, 1000).is_none());
        assert!(clean_image(Some("data:image/svg+xml;base64,PHN2Zz4="), true, 1000).is_some());
        assert!(clean_image(Some("data:text/html;base64,PGI+"), true, 1000).is_none());
        assert!(clean_image(Some("data:image/png;base64,<script>"), true, 1000).is_none());
        assert!(clean_image(Some("https://x.com/a.png"), true, 1000).is_none());
    }
}
