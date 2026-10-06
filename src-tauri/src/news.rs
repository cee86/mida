//! The News tab: Bungie's own news (the Bungie.net API's news feed), two Bungie Bluesky accounts (Bluesky's public
//! API, no account needed) and the D2 Community Hub's RSS feed (rss.app). The sources are fixed here; nothing else is
//! fetched. Text comes back as plain text (Bungie articles as paragraphs, headings, list items and bungie.net
//! pictures), never as HTML for the page to run. Links and pictures are remembered from each answer, so the app only
//! opens or fetches what these feeds listed (lib.rs `open_news`, `news_image`).

use crate::bungie;
use serde_json::{json, Value};
use std::collections::HashSet;
use std::time::Duration;

const BLUESKY: &[(&str, &str, &str)] = &[
    ("status", "bungieserverstatus.bungie.net", "Bungie Server Status"),
    ("d2", "destinythegame.bungie.net", "Destiny 2"),
];
const COMMUNITY_FEED: &str = "https://rss.app/feeds/eWkksrBfp6ZwkMWp.xml";
const COMMUNITY_NAME: &str = "D2 Community Hub";
const BUNGIE_ROOT: &str = "https://www.bungie.net";

/// One shared client (connections reused across the feeds and their pictures).
fn client() -> reqwest::Client {
    static CLIENT: std::sync::OnceLock<reqwest::Client> = std::sync::OnceLock::new();
    CLIENT
        .get_or_init(|| reqwest::Client::builder().timeout(Duration::from_secs(20)).user_agent("MIDA (Destiny 2 companion)").build().unwrap_or_default())
        .clone()
}

// ---------- Text helpers ----------

/// Decodes the HTML entities feeds use (&amp; &#39; &#x2019; &nbsp; ...).
pub fn decode(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut rest = text;
    while let Some(i) = rest.find('&') {
        out.push_str(&rest[..i]);
        let tail = &rest[i..];
        let Some(end) = tail.find(';').filter(|e| *e <= 10) else {
            out.push('&');
            rest = &tail[1..];
            continue;
        };
        let name = &tail[1..end];
        let ch = match name {
            "amp" => Some('&'),
            "lt" => Some('<'),
            "gt" => Some('>'),
            "quot" => Some('"'),
            "apos" => Some('\''),
            "nbsp" => Some(' '),
            "rsquo" | "lsquo" => Some('\''),
            "rdquo" | "ldquo" => Some('"'),
            "mdash" => Some('—'),
            "ndash" => Some('–'),
            "hellip" => Some('…'),
            _ if name.starts_with("#x") || name.starts_with("#X") => u32::from_str_radix(&name[2..], 16).ok().and_then(char::from_u32),
            _ if name.starts_with('#') => name[1..].parse::<u32>().ok().and_then(char::from_u32),
            _ => None,
        };
        match ch {
            Some(c) => {
                out.push(c);
                rest = &tail[end + 1..];
            }
            None => {
                out.push('&');
                rest = &tail[1..];
            }
        }
    }
    out.push_str(rest);
    out
}

fn squash(text: &str) -> String {
    text.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// An attribute's value in one tag's text (`<img src="...">`).
fn attr(tag: &str, name: &str) -> Option<String> {
    let lower = tag.to_lowercase();
    for quote in ['"', '\''] {
        let key = format!("{name}={quote}");
        if let Some(i) = lower.find(&key) {
            let start = i + key.len();
            let end = tag[start..].find(quote)? + start;
            return Some(decode(&tag[start..end]));
        }
    }
    None
}

/// A bungie.net picture's full address (Bungie often gives "/img/..." paths); anything else is dropped.
fn bungie_image(src: &str) -> Option<String> {
    let src = src.trim();
    let full = if src.starts_with("//") { format!("https:{src}") } else if src.starts_with('/') { format!("{BUNGIE_ROOT}{src}") } else { src.to_string() };
    let host_ok = full.starts_with("https://www.bungie.net/") || full.starts_with("https://images.contentstack.io/") || full.starts_with("https://assets.contentstack.io/");
    host_ok.then_some(full)
}

/// An article's HTML as plain blocks: headings, paragraphs, list items and pictures. Scripts and styles are dropped.
pub fn html_blocks(html: &str) -> (Vec<Value>, Vec<String>) {
    let mut blocks: Vec<Value> = Vec::new();
    let mut images: Vec<String> = Vec::new();
    let mut text = String::new();
    let mut kind = "p";
    let mut skip: Option<String> = None;
    let flush = |text: &mut String, kind: &str, blocks: &mut Vec<Value>| {
        let t = squash(&decode(text));
        if !t.is_empty() {
            blocks.push(json!({ "type": kind, "text": t }));
        }
        text.clear();
    };
    let mut rest = html;
    while let Some(lt) = rest.find('<') {
        if skip.is_none() {
            text.push_str(&rest[..lt]);
        }
        let Some(gt) = rest[lt..].find('>') else { break };
        let tag = &rest[lt + 1..lt + gt];
        rest = &rest[lt + gt + 1..];
        let closing = tag.starts_with('/');
        let name: String = tag.trim_start_matches('/').chars().take_while(|c| c.is_ascii_alphanumeric()).collect::<String>().to_lowercase();
        if let Some(s) = &skip {
            if closing && &name == s {
                skip = None;
            }
            continue;
        }
        match name.as_str() {
            "script" | "style" | "iframe" | "noscript" if !closing => skip = Some(name),
            "h1" | "h2" | "h3" | "h4" | "h5" | "h6" => {
                flush(&mut text, kind, &mut blocks);
                kind = if closing { "p" } else { "h" };
            }
            "li" => {
                flush(&mut text, kind, &mut blocks);
                kind = if closing { "p" } else { "li" };
            }
            "p" | "div" | "br" | "tr" | "section" | "blockquote" | "ul" | "ol" | "table" => flush(&mut text, kind, &mut blocks),
            "img" if !closing => {
                flush(&mut text, kind, &mut blocks);
                if let Some(src) = attr(tag, "src").and_then(|s| bungie_image(&s)) {
                    images.push(src.clone());
                    blocks.push(json!({ "type": "img", "src": src, "alt": attr(tag, "alt").unwrap_or_default() }));
                }
            }
            _ => {}
        }
    }
    if skip.is_none() {
        text.push_str(rest);
    }
    flush(&mut text, kind, &mut blocks);
    (blocks, images)
}

/// RFC 2822 dates from RSS ("Fri, 03 Oct 2026 12:00:00 GMT" or "+0200") as ISO 8601 in UTC; ISO dates pass through.
pub fn iso_date(text: &str) -> Option<String> {
    let t = text.trim();
    if t.len() >= 10 && t.as_bytes()[4] == b'-' {
        return Some(t.to_string());
    }
    let parts: Vec<&str> = t.split_whitespace().collect();
    let parts = if parts.first().is_some_and(|p| p.ends_with(',')) { &parts[1..] } else { &parts[..] };
    if parts.len() < 4 {
        return None;
    }
    let day: i64 = parts[0].parse().ok()?;
    let month = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"].iter().position(|m| parts[1].to_lowercase().starts_with(m))? as i64 + 1;
    let year: i64 = parts[2].parse().ok()?;
    let hms: Vec<i64> = parts[3].split(':').filter_map(|x| x.parse().ok()).collect();
    let (h, mi, s) = (*hms.first()?, *hms.get(1).unwrap_or(&0), *hms.get(2).unwrap_or(&0));
    let offset_min = match parts.get(4) {
        Some(z) if z.starts_with('+') || z.starts_with('-') => {
            let sign = if z.starts_with('-') { -1 } else { 1 };
            let n: i64 = z[1..].parse().unwrap_or(0);
            sign * ((n / 100) * 60 + n % 100)
        }
        _ => 0,
    };
    // Days from the civil date (Howard Hinnant's algorithm), then back after applying the offset.
    let days_from_civil = |y: i64, m: i64, d: i64| {
        let y = if m <= 2 { y - 1 } else { y };
        let era = if y >= 0 { y } else { y - 399 } / 400;
        let yoe = y - era * 400;
        let doy = (153 * (if m > 2 { m - 3 } else { m + 9 }) + 2) / 5 + d - 1;
        let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
        era * 146097 + doe - 719468
    };
    let secs = days_from_civil(year, month, day) * 86400 + h * 3600 + mi * 60 + s - offset_min * 60;
    let (days, rem) = (secs.div_euclid(86400), secs.rem_euclid(86400));
    let z = days + 719468;
    let era = if z >= 0 { z } else { z - 146096 } / 146097;
    let doe = z - era * 146097;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = yoe + era * 400 + if m <= 2 { 1 } else { 0 };
    Some(format!("{y:04}-{m:02}-{d:02}T{:02}:{:02}:{:02}Z", rem / 3600, (rem % 3600) / 60, rem % 60))
}

// ---------- Sources ----------

/// Bungie.net's news (the API's RSS-shaped answer), each article with its body as blocks.
async fn bungie_news() -> Result<Vec<Value>, String> {
    let v = bungie::get("/Content/Rss/NewsArticles/0/?includebody=true", None).await?;
    let mut out = Vec::new();
    for a in v["NewsArticles"].as_array().into_iter().flatten().take(25) {
        let link = a["Link"].as_str().unwrap_or("");
        let link = if link.starts_with('/') { format!("{BUNGIE_ROOT}{link}") } else { link.to_string() };
        let (blocks, images) = html_blocks(a["HtmlContent"].as_str().unwrap_or(""));
        let image = a["ImagePath"].as_str().and_then(bungie_image).or_else(|| a["OptionalMobileImagePath"].as_str().and_then(bungie_image));
        out.push(json!({
            "id": format!("bungie-{}", a["UniqueIdentifier"].as_str().unwrap_or(link.as_str())),
            "source": "bungie",
            "sourceName": "Bungie.net",
            "at": a["PubDate"].as_str().and_then(iso_date),
            "title": squash(&decode(a["Title"].as_str().unwrap_or(""))),
            "text": squash(&decode(a["Description"].as_str().unwrap_or(""))),
            "link": link,
            "image": image,
            "blocks": blocks,
            "pictures": images,
        }));
    }
    Ok(out)
}

/// One Bluesky account's recent posts (no replies), reposts marked.
async fn bluesky(source: &str, handle: &str, name: &str) -> Result<Vec<Value>, String> {
    let url = format!("https://public.api.bsky.app/xrpc/app.bsky.feed.getAuthorFeed?actor={handle}&limit=30&filter=posts_no_replies");
    let res = client().get(url).send().await.map_err(|_| format!("Couldn't reach Bluesky for {name}."))?;
    if !res.status().is_success() {
        return Err(format!("Bluesky didn't answer for {name} ({}).", res.status().as_u16()));
    }
    let body = res.text().await.map_err(|_| format!("Bluesky's answer for {name} couldn't be read."))?;
    let v: Value = serde_json::from_str(&body).map_err(|_| format!("Bluesky's answer for {name} couldn't be read."))?;
    let mut out = Vec::new();
    for item in v["feed"].as_array().into_iter().flatten() {
        let p = &item["post"];
        let author = &p["author"];
        let author_handle = author["handle"].as_str().unwrap_or(handle);
        let rkey = p["uri"].as_str().and_then(|u| u.rsplit('/').next()).unwrap_or("");
        let embed = &p["embed"];
        let media = if embed["media"].is_object() { &embed["media"] } else { embed };
        let images: Vec<Value> = media["images"]
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(|i| Some(json!({ "src": i["thumb"].as_str()?, "full": i["fullsize"].as_str().unwrap_or(""), "alt": i["alt"].as_str().unwrap_or("") })))
            .collect();
        let ext = &media["external"];
        let external = if ext.is_object() {
            json!({ "uri": ext["uri"], "title": ext["title"], "description": ext["description"], "thumb": ext["thumb"] })
        } else {
            Value::Null
        };
        let video_thumb = media["thumbnail"].as_str().map(str::to_string);
        let reposted = item["reason"]["$type"].as_str().is_some_and(|t| t.ends_with("reasonRepost"));
        out.push(json!({
            "id": format!("bsky-{}", p["uri"].as_str().unwrap_or("")),
            "source": source,
            "sourceName": name,
            "at": if reposted { item["reason"]["indexedAt"].clone() } else { p["record"]["createdAt"].clone() },
            "text": p["record"]["text"],
            "link": format!("https://bsky.app/profile/{author_handle}/post/{rkey}"),
            "author": { "name": author["displayName"], "handle": author_handle, "avatar": author["avatar"] },
            "repostBy": if reposted { item["reason"]["by"]["displayName"].clone() } else { Value::Null },
            "images": images,
            "video": video_thumb,
            "external": external,
            "likes": p["likeCount"],
            "reposts": p["repostCount"],
        }));
    }
    Ok(out)
}

fn tag_text(item: &str, tag: &str) -> Option<String> {
    let open = format!("<{tag}");
    let start = item.find(&open)?;
    let after = &item[start..];
    let gt = after.find('>')?;
    if after[..gt].ends_with('/') {
        return None;
    }
    let body = &after[gt + 1..];
    let end = body.find(&format!("</{tag}>"))?;
    let raw = body[..end].trim();
    let raw = raw.strip_prefix("<![CDATA[").and_then(|r| r.strip_suffix("]]>")).unwrap_or(raw);
    Some(raw.to_string())
}

fn tag_attr(item: &str, tag: &str, name: &str) -> Option<String> {
    let start = item.find(&format!("<{tag}"))?;
    let end = item[start..].find('>')? + start;
    attr(&item[start..end], name)
}

/// An RSS feed's items (title, link, date, text, picture).
async fn rss(url: &str, source: &str, name: &str) -> Result<Vec<Value>, String> {
    let res = client().get(url).send().await.map_err(|_| format!("Couldn't reach {name}."))?;
    if !res.status().is_success() {
        return Err(format!("{name} didn't answer ({}).", res.status().as_u16()));
    }
    let body = res.text().await.map_err(|_| format!("{name}'s feed couldn't be read."))?;
    let mut out = Vec::new();
    for chunk in body.split("<item").skip(1).take(40) {
        let item = chunk.split("</item>").next().unwrap_or("");
        let description = tag_text(item, "description").unwrap_or_default();
        let description = decode(&description);
        // Pictures: media:content / media:thumbnail / enclosure, else the first <img> in the description.
        let image = tag_attr(item, "media:content", "url")
            .or_else(|| tag_attr(item, "media:thumbnail", "url"))
            .or_else(|| tag_attr(item, "enclosure", "url"))
            .or_else(|| description.find("<img").and_then(|i| attr(&description[i..description[i..].find('>').map(|e| e + i).unwrap_or(description.len())], "src")))
            .filter(|u| u.starts_with("https://"));
        let (blocks, _) = html_blocks(&description);
        let text: String = blocks.iter().filter_map(|b| b["text"].as_str()).collect::<Vec<_>>().join(" ");
        let link = tag_text(item, "link").map(|l| decode(&l)).unwrap_or_default();
        out.push(json!({
            "id": format!("rss-{}", tag_text(item, "guid").unwrap_or_else(|| link.clone())),
            "source": source,
            "sourceName": name,
            "at": tag_text(item, "pubDate").and_then(|d| iso_date(&d)),
            "title": squash(&decode(&tag_text(item, "title").unwrap_or_default())),
            "text": text.chars().take(600).collect::<String>(),
            "link": link,
            "image": image,
            "author": { "name": tag_text(item, "dc:creator").or_else(|| tag_text(item, "author")).map(|a| decode(&a)) },
        }));
    }
    Ok(out)
}

/// Everything, newest first, with each source's problem (if any) and the links and pictures it may open or fetch.
pub async fn feed() -> (Value, HashSet<String>, HashSet<String>) {
    // All four at once.
    let tb = tauri::async_runtime::spawn(bungie_news());
    let ts = tauri::async_runtime::spawn(bluesky(BLUESKY[0].0, BLUESKY[0].1, BLUESKY[0].2));
    let td = tauri::async_runtime::spawn(bluesky(BLUESKY[1].0, BLUESKY[1].1, BLUESKY[1].2));
    let tc = tauri::async_runtime::spawn(rss(COMMUNITY_FEED, "community", COMMUNITY_NAME));
    let lost = || Err::<Vec<Value>, String>("Something went wrong.".into());
    let (b, s, d, c) = (tb.await.unwrap_or_else(|_| lost()), ts.await.unwrap_or_else(|_| lost()), td.await.unwrap_or_else(|_| lost()), tc.await.unwrap_or_else(|_| lost()));
    let mut items: Vec<Value> = Vec::new();
    let mut problems = serde_json::Map::new();
    for (key, result) in [("bungie", b), ("status", s), ("d2", d), ("community", c)] {
        match result {
            Ok(list) => items.extend(list),
            Err(e) => {
                problems.insert(key.into(), json!(e));
            }
        }
    }
    items.sort_by(|a, b| b["at"].as_str().unwrap_or("").cmp(a["at"].as_str().unwrap_or("")));
    let mut links = HashSet::new();
    let mut pictures = HashSet::new();
    let note = |set: &mut HashSet<String>, v: &Value| {
        if let Some(u) = v.as_str().filter(|u| u.starts_with("https://")) {
            set.insert(u.to_string());
        }
    };
    for it in &items {
        note(&mut links, &it["link"]);
        note(&mut links, &it["external"]["uri"]);
        for key in [&it["image"], &it["author"]["avatar"], &it["external"]["thumb"], &it["video"]] {
            note(&mut pictures, key);
        }
        for u in it["pictures"].as_array().into_iter().flatten() {
            note(&mut pictures, u);
        }
        for i in it["images"].as_array().into_iter().flatten() {
            note(&mut pictures, &i["src"]);
            note(&mut pictures, &i["full"]);
        }
    }
    let sources = json!([
        { "id": "bungie", "name": "Bungie.net" },
        { "id": "status", "name": BLUESKY[0].2, "handle": BLUESKY[0].1 },
        { "id": "d2", "name": BLUESKY[1].2, "handle": BLUESKY[1].1 },
        { "id": "community", "name": COMMUNITY_NAME },
    ]);
    (json!({ "items": items, "problems": problems, "sources": sources }), links, pictures)
}

/// A picture from a feed as a data: address (MIDA's pages only load pictures from themselves and bungie.net):
/// images only, at most 4 MB.
pub async fn picture(url: &str) -> Result<String, String> {
    use base64::Engine;
    let res = client().get(url).send().await.map_err(|_| "Couldn't load that picture.".to_string())?;
    let kind = res.headers().get("content-type").and_then(|v| v.to_str().ok()).unwrap_or("").to_string();
    if !res.status().is_success() || !kind.starts_with("image/") || kind.contains("svg") {
        return Err("That isn't a picture.".into());
    }
    if res.content_length().is_some_and(|n| n > 4_000_000) {
        return Err("That picture is too big.".into());
    }
    let bytes = res.bytes().await.map_err(|_| "Couldn't load that picture.".to_string())?;
    if bytes.len() > 4_000_000 {
        return Err("That picture is too big.".into());
    }
    Ok(format!("data:{};base64,{}", kind.split(';').next().unwrap_or("image/jpeg"), base64::engine::general_purpose::STANDARD.encode(&bytes)))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dates_text_and_articles() {
        assert_eq!(iso_date("Fri, 03 Oct 2026 12:30:00 GMT").unwrap(), "2026-10-03T12:30:00Z");
        assert_eq!(iso_date("Fri, 03 Oct 2026 01:00:00 +0200").unwrap(), "2026-10-02T23:00:00Z");
        assert_eq!(iso_date("2026-10-03T12:00:00Z").unwrap(), "2026-10-03T12:00:00Z");
        assert_eq!(decode("Rock &amp; Roll &#8217;s &#x2014; ok &nbsp;"), "Rock & Roll ’s — ok  ");
        let (blocks, pics) = html_blocks("<h2>Patch</h2><p>Fixed <b>bugs</b>.</p><script>alert(1)</script><ul><li>One</li></ul><img src=\"/img/a.jpg\"><img src=\"https://evil.example/x.png\">");
        assert_eq!(blocks[0], json!({ "type": "h", "text": "Patch" }));
        assert_eq!(blocks[1], json!({ "type": "p", "text": "Fixed bugs." }));
        assert_eq!(blocks[2], json!({ "type": "li", "text": "One" }));
        assert_eq!(pics, vec!["https://www.bungie.net/img/a.jpg".to_string()]);
        assert!(!blocks.iter().any(|b| b["text"].as_str().is_some_and(|t| t.contains("alert"))));
        let item = r#"<title><![CDATA[Hello & bye]]></title><link>https://x.example/a</link><media:content url="https://img.example/p.jpg" />"#;
        assert_eq!(tag_text(item, "title").unwrap(), "Hello & bye");
        assert_eq!(tag_attr(item, "media:content", "url").unwrap(), "https://img.example/p.jpg");
    }
}
