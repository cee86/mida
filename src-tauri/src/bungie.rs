//! Destiny 2 data for the built-in tabs (Inventory, Quests, Seasonal Hub), read with the player's
//! own Bungie sign-in (src/auth.rs). Only the player's own account, and only what the tabs show.
//!
//! - `Manifest`: the few item, objective and bucket facts the tabs need, slimmed from Bungie's
//!   definition files and kept on disk per game version (downloaded again only after an update).
//! - `inventory`, `activity`: one profile read each, shaped into plain JSON for the shell.
//! - `transfer`, `equip`: Bungie's item actions (character -> character goes through the vault).
//!
//! Field names follow Bungie's API documentation; this couldn't be checked against live data
//! from where it was written, so read failures say so plainly instead of guessing.

use crate::auth::api_key;
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use std::collections::{HashMap, HashSet};
use std::path::Path;
use std::time::Duration;

pub const ROOT: &str = "https://www.bungie.net";

/// The buckets the Inventory tab shows, in order, with our own names.
pub const BUCKETS: &[(u32, &str, &str)] = &[
    (1498876634, "Kinetic", "weapons"),
    (2465295065, "Energy", "weapons"),
    (953998645, "Power", "weapons"),
    (3448274439, "Helmet", "armor"),
    (3551918588, "Gauntlets", "armor"),
    (14239492, "Chest", "armor"),
    (20886954, "Legs", "armor"),
    (1585787867, "Class item", "armor"),
    (4023194814, "Ghost", "general"),
    (2025709351, "Sparrow", "general"),
    (284967655, "Ship", "general"),
    (375726501, "Engrams", "inventory"),
    (1469714392, "Consumables", "inventory"),
    (3313201758, "Modifications", "inventory"),
];
const VAULT_BUCKET: u32 = 138197802;
const POSTMASTER_BUCKET: u32 = 215593132;
/// Buckets that belong to the whole account rather than a character.
const ACCOUNT_BUCKETS: &[u32] = &[1469714392, 3313201758];
const QUESTS_BUCKET: u32 = 1345459588;

// ---------- Talking to Bungie ----------

fn client() -> reqwest::Client {
    reqwest::Client::builder().timeout(Duration::from_secs(30)).build().unwrap_or_default()
}

/// Bungie's envelope: ErrorCode 1 is success; anything else carries a message meant for people.
fn unwrap(bytes: &[u8]) -> Result<Value, String> {
    let body: Value = serde_json::from_slice(bytes).map_err(|_| "Bungie sent back something unexpected. Try again in a moment.".to_string())?;
    match body["ErrorCode"].as_i64() {
        Some(1) => Ok(body["Response"].clone()),
        Some(5) => Err("Bungie's API is down for maintenance. Try again once the game servers are back.".into()),
        Some(36) | Some(51) => Err("Bungie asked MIDA to slow down. Wait a moment and try again.".into()),
        Some(2101) => Err("Bungie rejected MIDA's API key (Bungie error 2101: invalid or expired key).".into()),
        Some(2102) => Err("Bungie says MIDA's request had no API key (Bungie error 2102).".into()),
        // Bungie's own wording plus the code, so a problem can be told apart from another.
        Some(12) => Err(format!(
            "Bungie hasn't given MIDA permission for this: MIDA's app settings on bungie.net are missing a permission (Bungie error 12: {}).",
            body["Message"].as_str().unwrap_or("")
        )),
        Some(99) => Err("Bungie didn't accept MIDA's sign-in for this (Bungie error 99). Sign out in Settings > Tabs and sign in again.".into()),
        code => Err(format!("{} (Bungie error {})", body["Message"].as_str().unwrap_or("Bungie couldn't do that."), code.unwrap_or(0))),
    }
}

pub async fn get(path: &str, token: Option<&str>) -> Result<Value, String> {
    let key = api_key().ok_or("This copy of MIDA can't talk to Bungie (it was built without an API key).")?;
    let mut req = client().get(format!("{ROOT}/Platform{path}")).header("X-API-Key", key);
    if let Some(token) = token {
        req = req.bearer_auth(token);
    }
    let res = req.send().await.map_err(|_| "Couldn't reach Bungie. Check your connection and try again.".to_string())?;
    unwrap(&res.bytes().await.map_err(|_| "Bungie's reply was cut off. Try again.".to_string())?)
}

async fn post(path: &str, token: &str, body: Value) -> Result<Value, String> {
    let key = api_key().ok_or("This copy of MIDA can't talk to Bungie (it was built without an API key).")?;
    let res = client()
        .post(format!("{ROOT}/Platform{path}"))
        .header("X-API-Key", key)
        .header("Content-Type", "application/json")
        .bearer_auth(token)
        .body(body.to_string())
        .send()
        .await
        .map_err(|_| "Couldn't reach Bungie. Check your connection and try again.".to_string())?;
    unwrap(&res.bytes().await.map_err(|_| "Bungie's reply was cut off. Try again.".to_string())?)
}

/// Downloads one of Bungie's big definition files, reporting how far along it is between `from` and `to` (0 to 1).
async fn download(path: &str, from: f64, to: f64) -> Result<Vec<u8>, String> {
    let mut res = client()
        .get(format!("{ROOT}{path}"))
        .timeout(Duration::from_secs(180))
        .send()
        .await
        .map_err(|_| "Couldn't download Destiny's item list from Bungie.".to_string())?;
    if !res.status().is_success() {
        return Err("Couldn't download Destiny's item list from Bungie.".into());
    }
    let total = res.content_length().unwrap_or(0) as f64;
    let mut bytes = Vec::with_capacity(total as usize);
    let mut last = 0.0;
    while let Some(chunk) = res.chunk().await.map_err(|_| "Destiny's item list download was cut off.".to_string())? {
        bytes.extend_from_slice(&chunk);
        if total > 0.0 {
            let done = bytes.len() as f64 / total;
            if done - last > 0.02 {
                last = done;
                report("manifest", from + (to - from) * done, &format!("Downloading Destiny's game data ({:.0} of {:.0} MB)", bytes.len() as f64 / 1e6, total / 1e6));
            }
        }
    }
    Ok(bytes)
}

// ---------- The manifest (slimmed) ----------

#[derive(Serialize, Deserialize, Clone, Default)]
pub struct Item {
    pub name: String,
    pub icon: String,
    #[serde(default)]
    pub watermark: String, // the season's mark drawn over the icon
    pub description: String,
    pub kind: i64,       // itemType: 2 armor, 3 weapon, 12/13 quest step, 15 quest, 26 bounty...
    pub type_name: String,
    pub tier: i64,       // 6 exotic, 5 legendary, 4 rare, 3 common, 2 basic
    pub bucket: u32,     // where it goes when equipped / pulled from the vault
    pub class: i64,      // 0 Titan, 1 Hunter, 2 Warlock, 3 any
    #[serde(default)]
    pub ammo: i64,       // 1 primary, 2 special, 3 heavy
    #[serde(default)]
    pub set: u32,        // the armor set it belongs to (equipableItemSetHash)
    #[serde(default)]
    pub breaker: i64,    // anti-champion: 1 barrier, 2 overload, 3 unstoppable
}

#[derive(Serialize, Deserialize, Clone, Default)]
pub struct Objective {
    pub text: String,
    pub goal: i64,
}

#[derive(Serialize, Deserialize, Default)]
pub struct Manifest {
    pub version: String,
    pub items: HashMap<u32, Item>,
    pub objectives: HashMap<u32, Objective>,
}

#[derive(Deserialize, Default)]
#[serde(default, rename_all = "camelCase")]
struct RawDisplay {
    name: String,
    description: String,
    icon: String,
}

#[derive(Deserialize, Default)]
#[serde(default, rename_all = "camelCase")]
struct RawInventory {
    bucket_type_hash: u32,
    tier_type: i64,
}

#[derive(Deserialize, Default)]
#[serde(default, rename_all = "camelCase")]
struct RawEquipping {
    ammo_type: i64,
    equipable_item_set_hash: u32,
}

#[derive(Deserialize, Default)]
#[serde(default, rename_all = "camelCase")]
struct RawItem {
    display_properties: RawDisplay,
    icon_watermark: String,
    equipping_block: RawEquipping,
    breaker_type: i64,
    item_type: i64,
    item_type_display_name: String,
    inventory: RawInventory,
    class_type: i64,
    redacted: bool,
}

#[derive(Deserialize, Default)]
#[serde(default, rename_all = "camelCase")]
struct RawObjective {
    progress_description: String,
    completion_value: i64,
}

fn slim_items(bytes: &[u8]) -> Result<HashMap<u32, Item>, String> {
    let raw: HashMap<String, RawItem> = serde_json::from_slice(bytes).map_err(|_| "Destiny's item list couldn't be read.".to_string())?;
    Ok(raw
        .into_iter()
        .filter(|(_, r)| !r.redacted && !r.display_properties.name.is_empty())
        .filter_map(|(hash, r)| {
            Some((
                hash.parse().ok()?,
                Item {
                    name: r.display_properties.name,
                    icon: r.display_properties.icon,
                    watermark: r.icon_watermark,
                    description: r.display_properties.description,
                    kind: r.item_type,
                    type_name: r.item_type_display_name,
                    tier: r.inventory.tier_type,
                    bucket: r.inventory.bucket_type_hash,
                    class: r.class_type,
                    ammo: r.equipping_block.ammo_type,
                    set: r.equipping_block.equipable_item_set_hash,
                    breaker: r.breaker_type,
                },
            ))
        })
        .collect())
}

fn slim_objectives(bytes: &[u8]) -> Result<HashMap<u32, Objective>, String> {
    let raw: HashMap<String, RawObjective> = serde_json::from_slice(bytes).map_err(|_| "Destiny's objective list couldn't be read.".to_string())?;
    Ok(raw
        .into_iter()
        .filter_map(|(hash, r)| Some((hash.parse().ok()?, Objective { text: r.progress_description, goal: r.completion_value })))
        .collect())
}

/// The current manifest: from disk if this game version was saved before, else from Bungie
/// (tens of megabytes, once per game update), slimmed and saved.
pub async fn load_manifest(dir: &Path) -> Result<Manifest, String> {
    let info = get("/Destiny2/Manifest/", None).await?;
    let version = info["version"].as_str().unwrap_or("").to_string();
    let safe: String = version.chars().filter(|c| c.is_ascii_alphanumeric() || *c == '.' || *c == '-').collect();
    let folder = dir.join("manifest");
    // "-3": the slimmed format gained fields (v0.5, v0.6), so files saved by older versions of MIDA are read again.
    let file = folder.join(format!("{safe}-3.json"));
    // This version's definitions folder (earlier versions' folders go with the old manifest below).
    if !safe.is_empty() {
        let entities = folder.join(format!("{safe}-entities"));
        let _ = std::fs::create_dir_all(&entities);
        *entity_dir().lock().unwrap() = Some(entities);
    }
    if !safe.is_empty() {
        if let Ok(bytes) = std::fs::read(&file) {
            if let Ok(m) = serde_json::from_slice::<Manifest>(&bytes) {
                return Ok(m);
            }
        }
    }
    report("manifest", 0.0, "Downloading Destiny's game data (first time after a game update)");
    let paths = &info["jsonWorldComponentContentPaths"]["en"];
    let items_path = paths["DestinyInventoryItemLiteDefinition"].as_str().ok_or("Bungie didn't list the item definitions.")?;
    let objectives_path = paths["DestinyObjectiveDefinition"].as_str().ok_or("Bungie didn't list the objective definitions.")?;
    let manifest = Manifest {
        version,
        items: slim_items(&download(items_path, 0.0, 0.85).await?)?,
        objectives: slim_objectives(&download(objectives_path, 0.85, 1.0).await?)?,
    };
    // Keep only this version's file and definitions folder.
    if let Ok(list) = std::fs::read_dir(&folder) {
        for entry in list.flatten() {
            let name = entry.file_name().to_string_lossy().to_string();
            if !name.starts_with(&format!("{safe}-")) {
                let path = entry.path();
                let _ = if path.is_dir() { std::fs::remove_dir_all(path) } else { std::fs::remove_file(path) };
            }
        }
    }
    let _ = std::fs::create_dir_all(&folder);
    if let Ok(bytes) = serde_json::to_vec(&manifest) {
        let _ = std::fs::write(&file, bytes);
    }
    Ok(manifest)
}

// ---------- Shaping a profile ----------

fn icon_url(path: &str) -> Value {
    if path.is_empty() { Value::Null } else { json!(format!("{ROOT}{path}")) }
}

fn class_name(class: i64) -> &'static str {
    match class {
        0 => "Titan",
        1 => "Hunter",
        2 => "Warlock",
        _ => "Guardian",
    }
}

/// The characters, most recently played first.
fn characters(profile: &Value) -> Vec<Value> {
    let mut list: Vec<Value> = profile["characters"]["data"]
        .as_object()
        .map(|m| {
            m.values()
                .map(|c| {
                    json!({
                        "id": c["characterId"],
                        "classType": c["classType"],
                        "className": class_name(c["classType"].as_i64().unwrap_or(3)),
                        "light": c["light"],
                        "emblem": icon_url(c["emblemPath"].as_str().unwrap_or("")),
                        "banner": icon_url(c["emblemBackgroundPath"].as_str().unwrap_or("")),
                        "lastPlayed": c["dateLastPlayed"],
                        "raceType": c["raceType"],
                        "genderType": c["genderType"],
                        "titleRecordHash": c["titleRecordHash"],
                        "emblemHash": c["emblemHash"],
                        "stats": c["stats"],
                    })
                })
                .collect()
        })
        .unwrap_or_default();
    list.sort_by(|a, b| b["lastPlayed"].as_str().unwrap_or("").cmp(a["lastPlayed"].as_str().unwrap_or("")));
    list
}

fn items_of(section: &Value) -> impl Iterator<Item = &Value> {
    section["items"].as_array().into_iter().flatten()
}

/// Everything the Inventory tab shows: weapons, armor, ghosts, vehicles, engrams, consumables
/// and mods on each character (equipped or not), the account and the vault; the postmaster;
/// currencies; how full the vault is.
pub fn shape_inventory(profile: &Value, m: &Manifest) -> Value {
    let instances = &profile["itemComponents"]["instances"]["data"];
    let sockets = &profile["itemComponents"]["sockets"]["data"];
    let mut out: Vec<Value> = Vec::new();
    let mut postmaster: Vec<Value> = Vec::new();
    let mut vault_count = 0;
    let add = |item: &Value, owner: &str, equipped: bool, vault: bool, list: &mut Vec<Value>| {
        let Some(hash) = item["itemHash"].as_u64().map(|h| h as u32) else { return };
        let Some(def) = m.items.get(&hash) else { return };
        let mut bucket = if vault { def.bucket } else { item["bucketHash"].as_u64().unwrap_or(0) as u32 };
        let in_postmaster = bucket == POSTMASTER_BUCKET;
        if in_postmaster {
            bucket = def.bucket;
        } else if !BUCKETS.iter().any(|(b, _, _)| *b == bucket) {
            return;
        }
        let instance = item["itemInstanceId"].as_str().unwrap_or("").to_string();
        let info = &instances[&instance];
        let state = item["state"].as_i64().unwrap_or(0);
        // Armor's archetype (Bulwark, Grenadier...) is one of its plugs; found by the plug's type.
        let archetype = sockets[&instance]["sockets"]
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(|so| m.items.get(&(so["plugHash"].as_u64()? as u32)))
            .find(|p| p.type_name.to_lowercase().contains("archetype"))
            .map(|p| p.name.clone());
        // An applied ornament replaces the icon (as in the game and DIM).
        let style = item["overrideStyleItemHash"].as_u64().and_then(|h| m.items.get(&(h as u32)));
        let id = if instance.is_empty() { format!("{hash}-{owner}-{}", list.len()) } else { instance.clone() };
        list.push(json!({
            "id": id,
            "instance": if instance.is_empty() { Value::Null } else { json!(instance) },
            "hash": hash,
            "name": def.name,
            "icon": icon_url(style.map(|s| s.icon.as_str()).filter(|i| !i.is_empty()).unwrap_or(&def.icon)),
            "watermark": icon_url(if def.watermark.is_empty() { style.map(|s| s.watermark.as_str()).unwrap_or("") } else { &def.watermark }),
            "typeName": def.type_name,
            "tier": def.tier,
            "classType": def.class,
            "bucket": bucket,
            "owner": owner,
            "equipped": equipped,
            "power": info["primaryStat"]["value"],
            "damage": info["damageType"],
            "quantity": item["quantity"].as_i64().unwrap_or(1),
            // transferStatus 2: can't be moved at all.
            "transferable": item["transferStatus"].as_i64().unwrap_or(0) & 2 == 0,
            "locked": state & 1 == 1,
            "masterwork": state & 4 == 4,
            "crafted": state & 8 == 8,
            "gearTier": info["gearTier"],
            "ammo": def.ammo,
            "breaker": def.breaker,
            "set": if def.set == 0 { Value::Null } else { json!(def.set) },
            "archetype": archetype,
            // Things without a copy of their own (consumables, mods) show their description.
            "description": if instance.is_empty() { json!(def.description) } else { Value::Null },
        }));
    };
    if let Some(chars) = profile["characterEquipment"]["data"].as_object() {
        for (id, section) in chars {
            for item in items_of(section) {
                add(item, id, true, false, &mut out);
            }
        }
    }
    if let Some(chars) = profile["characterInventories"]["data"].as_object() {
        for (id, section) in chars {
            for item in items_of(section) {
                if item["bucketHash"].as_u64() == Some(POSTMASTER_BUCKET as u64) {
                    add(item, id, false, false, &mut postmaster);
                } else {
                    add(item, id, false, false, &mut out);
                }
            }
        }
    }
    for item in items_of(&profile["profileInventory"]["data"]) {
        let bucket = item["bucketHash"].as_u64().unwrap_or(0) as u32;
        if bucket == VAULT_BUCKET {
            vault_count += 1;
            add(item, "vault", false, true, &mut out);
        } else if ACCOUNT_BUCKETS.contains(&bucket) {
            add(item, "account", false, false, &mut out);
        }
    }
    let currencies: Vec<Value> = items_of(&profile["profileCurrencies"]["data"])
        .filter_map(|c| {
            let hash = c["itemHash"].as_u64()? as u32;
            let def = m.items.get(&hash)?;
            Some(json!({ "hash": hash, "name": def.name, "icon": icon_url(&def.icon), "quantity": c["quantity"] }))
        })
        .collect();
    let buckets: Vec<Value> = BUCKETS
        .iter()
        .map(|(hash, name, group)| json!({ "hash": hash, "name": name, "group": group, "account": ACCOUNT_BUCKETS.contains(hash) }))
        .collect();
    json!({
        "characters": characters(profile),
        "items": out,
        "postmaster": postmaster,
        "buckets": buckets,
        "currencies": currencies,
        "vault": { "count": vault_count, "max": Value::Null },
    })
}

// ---------- Single definitions (titles, emblems, stats, sets), remembered per run ----------

/// Where loading progress goes (set once by lib.rs: an event the shell's loading bars listen to). `task` names what's
/// loading ("manifest" for the game data, shared by every tab), `fraction` how far along it is (0 to 1).
type Reporter = Box<dyn Fn(&str, f64, &str) + Send + Sync>;
static REPORTER: std::sync::OnceLock<Reporter> = std::sync::OnceLock::new();
pub fn set_reporter(f: Reporter) {
    let _ = REPORTER.set(f);
}
fn report(task: &str, fraction: f64, label: &str) {
    if let Some(f) = REPORTER.get() {
        f(task, fraction.clamp(0.0, 1.0), label);
    }
}

/// Definitions read one at a time are also kept on disk, per game version (manifest/<version>-entities/), so an item
/// card's definitions load instantly the next time, even after a restart. Set when the manifest loads.
fn entity_dir() -> &'static std::sync::Mutex<Option<std::path::PathBuf>> {
    static DIR: std::sync::OnceLock<std::sync::Mutex<Option<std::path::PathBuf>>> = std::sync::OnceLock::new();
    DIR.get_or_init(Default::default)
}

fn entity_cache() -> &'static std::sync::Mutex<HashMap<String, Value>> {
    static CACHE: std::sync::OnceLock<std::sync::Mutex<HashMap<String, Value>>> = std::sync::OnceLock::new();
    CACHE.get_or_init(Default::default)
}

/// One definition from Bungie's manifest (small tables aren't worth downloading whole).
pub async fn entity(table: &str, hash: u64) -> Option<Value> {
    let key = format!("{table}/{hash}");
    if let Some(v) = entity_cache().lock().unwrap().get(&key) {
        return Some(v.clone());
    }
    // Only our own fixed table names reach the file name, plus a number.
    let file = entity_dir().lock().unwrap().as_ref().map(|d| d.join(format!("{table}-{hash}.json")));
    if let Some(Ok(bytes)) = file.as_ref().map(std::fs::read) {
        if let Ok(v) = serde_json::from_slice::<Value>(&bytes) {
            entity_cache().lock().unwrap().insert(key, v.clone());
            return Some(v);
        }
    }
    let v = get(&format!("/Destiny2/Manifest/{table}/{hash}/"), None).await.ok()?;
    if let (Some(file), Ok(bytes)) = (file, serde_json::to_vec(&v)) {
        let _ = std::fs::write(file, bytes);
    }
    entity_cache().lock().unwrap().insert(key, v.clone());
    Some(v)
}

fn race_name(race: i64) -> &'static str {
    match race {
        0 => "Human",
        1 => "Awoken",
        2 => "Exo",
        _ => "",
    }
}

/// Adds each character's equipped title (or race) and wide emblem art, and the vault's size.
pub async fn decorate_inventory(data: &mut Value) {
    if let Some(chars) = data["characters"].as_array_mut() {
        for c in chars.iter_mut() {
            let mut subtitle = race_name(c["raceType"].as_i64().unwrap_or(-1)).to_string();
            if let Some(hash) = c["titleRecordHash"].as_u64() {
                if let Some(record) = entity("DestinyRecordDefinition", hash).await {
                    let gender = if c["genderType"].as_i64() == Some(1) { "Female" } else { "Male" };
                    if let Some(title) = record["titleInfo"]["titlesByGender"][gender].as_str().filter(|t| !t.is_empty()) {
                        subtitle = title.to_string();
                    }
                }
            }
            c["subtitle"] = json!(subtitle);
            if let Some(hash) = c["emblemHash"].as_u64() {
                if let Some(emblem) = entity("DestinyInventoryItemDefinition", hash).await {
                    c["wide"] = icon_url(emblem["secondarySpecial"].as_str().unwrap_or(""));
                    c["color"] = emblem["backgroundColor"].clone();
                }
            }
        }
    }
    // Armor set names, for the Set bonus filter.
    let mut set_hashes: Vec<u64> = data["items"].as_array().into_iter().flatten().filter_map(|i| i["set"].as_u64()).collect();
    set_hashes.sort_unstable();
    set_hashes.dedup();
    let mut set_names = serde_json::Map::new();
    for hash in set_hashes.into_iter().take(80) {
        if let Some(set) = entity("DestinyEquipableItemSetDefinition", hash).await {
            if let Some(name) = set["displayProperties"]["name"].as_str().filter(|n| !n.is_empty()) {
                set_names.insert(hash.to_string(), json!(name));
            }
        }
    }
    data["setNames"] = Value::Object(set_names);
    if let Some(bucket) = entity("DestinyInventoryBucketDefinition", VAULT_BUCKET as u64).await {
        data["vault"]["max"] = bucket["itemCount"].clone();
    }
}

/// A character's stats (named) and the armor set bonuses its equipped armor gives, for the
/// Inventory tab's side panel.
pub async fn character_details(profile: &Value, character: &str) -> Value {
    let c = &profile["characters"]["data"][character];
    let mut stats = Vec::new();
    if let Some(map) = c["stats"].as_object() {
        for (hash, value) in map {
            let Ok(hash) = hash.parse::<u64>() else { continue };
            if hash == 1935470627 {
                continue; // power, shown on its own
            }
            let Some(def) = entity("DestinyStatDefinition", hash).await else { continue };
            let name = def["displayProperties"]["name"].as_str().unwrap_or("");
            if name.is_empty() {
                continue;
            }
            stats.push(json!({
                "name": name,
                "icon": icon_url(def["displayProperties"]["icon"].as_str().unwrap_or("")),
                "value": value,
                "order": def["index"],
            }));
        }
    }
    stats.sort_by_key(|s| s["order"].as_i64().unwrap_or(0));
    // Armor sets: count the equipped pieces of each set, then list its bonuses.
    let mut sets: Vec<(u64, i64)> = Vec::new();
    for item in items_of(&profile["characterEquipment"]["data"][character]) {
        let bucket = item["bucketHash"].as_u64().unwrap_or(0) as u32;
        if !BUCKETS.iter().any(|(b, _, g)| *b == bucket && *g == "armor") {
            continue;
        }
        let Some(hash) = item["itemHash"].as_u64() else { continue };
        let Some(def) = entity("DestinyInventoryItemDefinition", hash).await else { continue };
        if let Some(set) = def["equippingBlock"]["equipableItemSetHash"].as_u64().filter(|h| *h != 0) {
            match sets.iter_mut().find(|(h, _)| *h == set) {
                Some(entry) => entry.1 += 1,
                None => sets.push((set, 1)),
            }
        }
    }
    let mut bonuses = Vec::new();
    for (hash, count) in sets {
        let Some(set) = entity("DestinyEquipableItemSetDefinition", hash).await else { continue };
        let mut perks = Vec::new();
        for perk in set["setPerks"].as_array().into_iter().flatten() {
            let need = perk["requiredSetCount"].as_i64().unwrap_or(0);
            let Some(p) = perk["sandboxPerkHash"].as_u64() else { continue };
            let def = entity("DestinySandboxPerkDefinition", p).await.unwrap_or(Value::Null);
            perks.push(json!({
                "need": need,
                "active": count >= need,
                "name": def["displayProperties"]["name"],
                "description": def["displayProperties"]["description"],
                "icon": icon_url(def["displayProperties"]["icon"].as_str().unwrap_or("")),
            }));
        }
        bonuses.push(json!({ "name": set["displayProperties"]["name"], "count": count, "perks": perks }));
    }
    // The character's in-game loadouts (component 206), every slot in order like the game's grid: name, icon and
    // colour from their small definition tables (read together, kept on disk), and the item instances in each (the
    // shell matches them to its items). Empty slots (every item "0") come back as `empty: true`; `index` is what
    // EquipLoadout wants.
    let list = profile["characterLoadouts"]["data"][character]["loadouts"].as_array().cloned().unwrap_or_default();
    let hashes = |key: &str| -> Vec<u64> { list.iter().filter_map(|l| l[key].as_u64()).collect::<HashSet<_>>().into_iter().collect() };
    let names = entities("DestinyLoadoutNameDefinition", &hashes("nameHash")).await;
    let icons = entities("DestinyLoadoutIconDefinition", &hashes("iconHash")).await;
    let colors = entities("DestinyLoadoutColorDefinition", &hashes("colorHash")).await;
    let mut loadouts = Vec::new();
    for (index, l) in list.iter().enumerate() {
        let items: Vec<String> = l["items"]
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(|i| i["itemInstanceId"].as_str())
            .filter(|id| !id.is_empty() && *id != "0")
            .map(str::to_string)
            .collect();
        if items.is_empty() {
            loadouts.push(json!({ "index": index, "empty": true }));
            continue;
        }
        let name = l["nameHash"].as_u64().and_then(|h| names.get(&h)).and_then(|d| d["name"].as_str().map(str::to_string));
        let icon = l["iconHash"].as_u64().and_then(|h| icons.get(&h)).map(|d| icon_url(d["iconImagePath"].as_str().unwrap_or("")));
        let color = l["colorHash"].as_u64().and_then(|h| colors.get(&h)).map(|d| icon_url(d["colorImagePath"].as_str().unwrap_or("")));
        loadouts.push(json!({ "index": index, "name": name.unwrap_or_else(|| format!("Loadout {}", index + 1)), "icon": icon, "color": color, "items": items }));
    }
    json!({ "stats": stats, "sets": bonuses, "light": c["light"], "loadouts": loadouts })
}

fn objectives(list: &Value, m: &Manifest) -> Vec<Value> {
    list.as_array()
        .into_iter()
        .flatten()
        .map(|o| {
            let hash = o["objectiveHash"].as_u64().unwrap_or(0) as u32;
            let def = m.objectives.get(&hash).cloned().unwrap_or_default();
            let goal = o["completionValue"].as_i64().filter(|v| *v > 0).unwrap_or(def.goal.max(1));
            json!({
                "text": def.text,
                "progress": o["progress"].as_i64().unwrap_or(0),
                "goal": goal,
                "complete": o["complete"].as_bool().unwrap_or(false),
            })
        })
        .collect()
}

/// Quests and bounties per character, from the Quests bucket.
pub fn shape_activity(profile: &Value, m: &Manifest) -> Value {
    let instanced = &profile["itemComponents"]["objectives"]["data"];
    let uninstanced = &profile["characterUninstancedItemComponents"];
    let mut quests = Map::new();
    let mut bounties = Map::new();
    if let Some(chars) = profile["characterInventories"]["data"].as_object() {
        for (id, section) in chars {
            let (mut q, mut b) = (Vec::new(), Vec::new());
            for item in items_of(section) {
                if item["bucketHash"].as_u64() != Some(QUESTS_BUCKET as u64) {
                    continue;
                }
                let Some(hash) = item["itemHash"].as_u64().map(|h| h as u32) else { continue };
                let Some(def) = m.items.get(&hash) else { continue };
                let instance = item["itemInstanceId"].as_str().unwrap_or("");
                let list = if instance.is_empty() {
                    &uninstanced[id]["objectives"]["data"][hash.to_string()]["objectives"]
                } else {
                    &instanced[instance]["objectives"]
                };
                let objs = objectives(list, m);
                let entry = json!({
                    "id": if instance.is_empty() { hash.to_string() } else { instance.to_string() },
                    "hash": hash,
                    "name": def.name,
                    "icon": icon_url(&def.icon),
                    "typeName": def.type_name,
                    "description": def.description,
                    "expires": item["expirationDate"],
                    "complete": !objs.is_empty() && objs.iter().all(|o| o["complete"].as_bool() == Some(true)),
                    "objectives": objs,
                });
                let bounty = def.kind == 26 || def.type_name.to_lowercase().contains("bounty");
                if bounty { b.push(entry) } else { q.push(entry) }
            }
            quests.insert(id.clone(), Value::Array(q));
            bounties.insert(id.clone(), Value::Array(b));
        }
    }
    let artifact = &profile["profileProgression"]["data"]["seasonalArtifact"];
    json!({
        "characters": characters(profile),
        "quests": quests,
        "bounties": bounties,
        "artifact": if artifact.is_object() { json!({ "powerBonus": artifact["powerBonus"], "points": artifact["pointsAcquired"] }) } else { Value::Null },
        "seasonHash": profile["profile"]["data"]["currentSeasonHash"],
    })
}

/// Adds what the Quests tab shows from each quest's full definition: its category (from Bungie's
/// trait ids, the same ones the game's quest filters use), quest line name and description, which
/// step it's on out of how many, and its rewards. Same quest on several characters: read once.
pub async fn enrich_quests(data: &mut Value, m: &Manifest) {
    let Some(map) = data["quests"].as_object_mut() else { return };
    for list in map.values_mut() {
        for q in list.as_array_mut().into_iter().flatten().take(80) {
            let Some(hash) = q["hash"].as_u64() else { continue };
            let Some(def) = entity("DestinyInventoryItemDefinition", hash).await else { continue };
            let traits: Vec<String> = def["traitIds"].as_array().into_iter().flatten().filter_map(|t| t.as_str().map(str::to_string)).collect();
            let joined = traits.join(" ").to_lowercase();
            let category = if joined.contains("exotic") {
                "exotic"
            } else if joined.contains("seasonal") || joined.contains("current_release") || joined.contains("episode") {
                "seasonal"
            } else if joined.contains("expansion") || joined.contains("campaign") {
                "expansion"
            } else if joined.contains("playlist") {
                "playlists"
            } else if joined.contains("new_light") {
                "newlight"
            } else if joined.contains("past") || joined.contains("legacy") {
                "past"
            } else {
                "other"
            };
            let steps: Vec<u64> = def["setData"]["itemList"].as_array().into_iter().flatten().filter_map(|i| i["itemHash"].as_u64()).collect();
            let step = steps.iter().position(|h| *h == hash).map(|i| i + 1);
            let rewards: Vec<Value> = def["value"]["itemValue"]
                .as_array()
                .into_iter()
                .flatten()
                .filter_map(|v| {
                    let item = m.items.get(&(v["itemHash"].as_u64().filter(|h| *h != 0)? as u32))?;
                    Some(json!({ "name": item.name, "icon": icon_url(&item.icon), "tier": item.tier, "typeName": item.type_name, "description": item.description, "quantity": v["quantity"] }))
                })
                .collect();
            q["category"] = json!(category);
            q["traits"] = json!(traits);
            q["questLine"] = def["setData"]["questLineName"].clone();
            q["questLineDescription"] = def["setData"]["questLineDescription"].clone();
            q["step"] = json!(step);
            q["steps"] = json!(steps.len());
            q["rewards"] = json!(rewards);
            q["tier"] = def["inventory"]["tierType"].clone();
            q["screenshot"] = icon_url(def["screenshot"].as_str().unwrap_or(""));
        }
    }
}

/// The season's name, end and rank (reward track plus anything past it) for a character.
pub async fn season(profile: &Value, token: &str) -> Value {
    let Some(hash) = profile["profile"]["data"]["currentSeasonHash"].as_u64() else { return Value::Null };
    let Ok(def) = get(&format!("/Destiny2/Manifest/DestinySeasonDefinition/{hash}/"), Some(token)).await else { return Value::Null };
    // Newer seasons list their passes; older ones name one.
    let pass_hash = def["seasonPassList"]
        .as_array()
        .and_then(|l| l.last())
        .and_then(|p| p["seasonPassHash"].as_u64())
        .or(def["seasonPassHash"].as_u64());
    let mut rank = Value::Null;
    if let Some(pass_hash) = pass_hash {
        if let Ok(pass) = get(&format!("/Destiny2/Manifest/DestinySeasonPassDefinition/{pass_hash}/"), Some(token)).await {
            let progress = profile["characterProgressions"]["data"].as_object().and_then(|m| m.values().next()).map(|c| &c["progressions"]);
            if let Some(progress) = progress {
                let reward = &progress[pass["rewardProgressionHash"].as_u64().unwrap_or(0).to_string()];
                let prestige = &progress[pass["prestigeProgressionHash"].as_u64().unwrap_or(0).to_string()];
                if reward.is_object() {
                    let past = prestige["level"].as_i64().unwrap_or(0);
                    let on_prestige = past > 0 || reward["level"].as_i64() == reward["levelCap"].as_i64();
                    let current = if on_prestige && prestige.is_object() { prestige } else { reward };
                    rank = json!({
                        "level": reward["level"].as_i64().unwrap_or(0) + past,
                        "progress": current["progressToNextLevel"],
                        "next": current["nextLevelAt"],
                    });
                }
            }
        }
    }
    json!({
        "name": def["displayProperties"]["name"],
        "number": def["seasonNumber"],
        "ends": def["endDate"],
        "rank": rank,
    })
}

// ---------- Seasonal Hub ----------
//
// The season pass track (rank, every reward with its free / premium row and earned / claimed
// state), the account's past passes for the dropdown, the season's daily and weekly objectives
// (records under the presentation nodes the season and the active event card name), and reward
// tracks that look like the weekly rewards. Much of this layout is Bungie's 2025-26 seasonal hub,
// which couldn't be checked from the build workspace, so `check` lists what was found for tuning.

/// A season pass's reward track for one character. `season` is the season the pass belongs to
/// (Bungie's claim action wants it).
pub async fn pass_track(pass_hash: u64, season: u64, progressions: &Value, m: &Manifest) -> Value {
    let Some(pass) = entity("DestinySeasonPassDefinition", pass_hash).await else { return Value::Null };
    let reward_hash = pass["rewardProgressionHash"].as_u64().unwrap_or(0);
    let prestige_hash = pass["prestigeProgressionHash"].as_u64().unwrap_or(0);
    let reward = &progressions[reward_hash.to_string()];
    let prestige = &progressions[prestige_hash.to_string()];
    let states = reward["rewardItemStates"].as_array().cloned().unwrap_or_default();
    let def = entity("DestinyProgressionDefinition", reward_hash).await.unwrap_or(Value::Null);
    let mut ranks: Vec<Value> = Vec::new();
    let mut premium_owned: Option<bool> = None;
    for (i, r) in def["rewardItems"].as_array().into_iter().flatten().enumerate() {
        let level = r["rewardedAtProgressionLevel"].as_i64().unwrap_or(0);
        let Some(hash) = r["itemHash"].as_u64() else { continue };
        if hash == 0 {
            continue;
        }
        let state = states.get(i).and_then(|v| v.as_u64()).unwrap_or(0);
        if state & 1 != 0 {
            continue; // invisible
        }
        let premium = r["uiDisplayStyle"].as_str() == Some("premium");
        // Earned premium rewards that can be claimed mean the pass is owned.
        if premium && state & 2 != 0 {
            let can = state & (4 | 8) != 0;
            premium_owned = Some(premium_owned.unwrap_or(false) || can);
        }
        let item = m.items.get(&(hash as u32)).cloned().unwrap_or_default();
        let earned = state & 2 != 0;
        let claimed = state & 4 != 0;
        let entry = json!({
            "index": i,
            "hash": hash,
            "name": item.name,
            "icon": icon_url(&item.icon),
            "tier": item.tier,
            "typeName": item.type_name,
            "description": item.description,
            "quantity": r["quantity"],
            "rank": level,
            "premium": premium,
            "earned": earned,
            "claimed": claimed,
            "claimable": earned && !claimed && state & 8 != 0,
        });
        let row = if premium { "premium" } else { "free" };
        match ranks.iter_mut().find(|x| x["rank"].as_i64() == Some(level)) {
            Some(x) => x[row].as_array_mut().unwrap().push(entry),
            None => {
                let mut x = json!({ "rank": level, "free": [], "premium": [] });
                x[row].as_array_mut().unwrap().push(entry);
                ranks.push(x);
            }
        }
    }
    ranks.sort_by_key(|x| x["rank"].as_i64().unwrap_or(0));
    let past = prestige["level"].as_i64().unwrap_or(0);
    let on_prestige = past > 0 || (reward.is_object() && reward["level"].as_i64() == reward["levelCap"].as_i64());
    let current = if on_prestige && prestige.is_object() { prestige } else { reward };
    json!({
        "hash": pass_hash,
        "season": season,
        "name": pass["displayProperties"]["name"],
        "icon": icon_url(pass["displayProperties"]["icon"].as_str().unwrap_or("")),
        "tracked": reward.is_object(),
        "rank": reward["level"].as_i64().unwrap_or(0) + past,
        "trackRank": reward["level"],
        "progress": current["progressToNextLevel"],
        "next": current["nextLevelAt"],
        "premium": premium_owned,
        "ranks": ranks,
        // Which fields Bungie gives a pass (to find the pass's bonuses; see the data check).
        "keys": pass.as_object().map(|o| o.keys().cloned().collect::<Vec<_>>()).unwrap_or_default(),
    })
}

/// Rewards earned but not claimed yet on a track.
fn claimable(track: &Value) -> Vec<Value> {
    track["ranks"]
        .as_array()
        .into_iter()
        .flatten()
        .flat_map(|r| r["free"].as_array().into_iter().flatten().chain(r["premium"].as_array().into_iter().flatten()))
        .filter(|w| w["claimable"].as_bool() == Some(true))
        .cloned()
        .collect()
}

/// Records under a presentation node, a few levels down, with the node names on the way.
async fn node_records(root: u64, depth: u32, path: String, out: &mut Vec<(String, u64)>, seen: &mut Vec<Value>) {
    if depth > 3 || out.len() > 120 {
        return;
    }
    let Some(node) = entity("DestinyPresentationNodeDefinition", root).await else {
        seen.push(json!({ "hash": root, "name": "(couldn't read)", "nodes": 0, "records": 0 }));
        return;
    };
    let name = node["displayProperties"]["name"].as_str().unwrap_or("").to_string();
    let here = if path.is_empty() { name.clone() } else { format!("{path} / {name}") };
    let records = node["children"]["records"].as_array().cloned().unwrap_or_default();
    let nodes = node["children"]["presentationNodes"].as_array().cloned().unwrap_or_default();
    if seen.len() < 40 {
        seen.push(json!({ "hash": root, "name": here, "nodes": nodes.len(), "records": records.len() }));
    }
    for r in &records {
        if let Some(h) = r["recordHash"].as_u64() {
            out.push((here.clone(), h));
        }
    }
    for c in &nodes {
        if let Some(h) = c["presentationNodeHash"].as_u64() {
            Box::pin(node_records(h, depth + 1, here.clone(), out, seen)).await;
        }
    }
}

/// Vendors that sell things with objectives or bounties (where the seasonal hub's orders, daily and
/// weekly objectives probably live), read from the character's vendors (components 400,401,402,
/// 301). Each comes back with its display categories and their items.
async fn hub_vendors(vendors: &Value, m: &Manifest) -> Vec<Value> {
    let mut out = Vec::new();
    let Some(sales) = vendors["sales"]["data"].as_object() else { return out };
    // Rank vendors by how many of their sale items carry objectives (then bounties / quests), so
    // the likeliest hub vendors are read first; at most 30 definitions are fetched.
    let mut ranked: Vec<(usize, &String, &Value)> = sales
        .iter()
        .map(|(vkey, sale)| {
            let objs = &vendors["itemComponents"][vkey]["objectives"]["data"];
            let score = sale["saleItems"].as_object().map(|o| {
                o.iter()
                    .map(|(k, it)| {
                        let with_objectives = objs[k]["objectives"].as_array().map(|a| !a.is_empty()).unwrap_or(false);
                        let pursuit = it["itemHash"].as_u64().and_then(|h| m.items.get(&(h as u32))).map(|d| matches!(d.kind, 26 | 12 | 15)).unwrap_or(false);
                        usize::from(with_objectives) * 2 + usize::from(pursuit)
                    })
                    .sum::<usize>()
            });
            (score.unwrap_or(0), vkey, sale)
        })
        .filter(|(score, _, _)| *score > 0)
        .collect();
    ranked.sort_by(|a, b| b.0.cmp(&a.0));
    for (_, vkey, sale) in ranked.into_iter().take(30) {
        let Ok(vhash) = vkey.parse::<u64>() else { continue };
        let item_objectives = &vendors["itemComponents"][vkey]["objectives"]["data"];
        let items: Vec<(String, Value)> = sale["saleItems"].as_object().map(|o| o.iter().map(|(k, v)| (k.clone(), v.clone())).collect()).unwrap_or_default();
        let Some(def) = entity("DestinyVendorDefinition", vhash).await else { continue };
        let display = def["displayCategories"].as_array().cloned().unwrap_or_default();
        let mut categories = Vec::new();
        for cat in vendors["categories"]["data"][vkey]["categories"].as_array().into_iter().flatten() {
            let index = cat["displayCategoryIndex"].as_u64().unwrap_or(0) as usize;
            let name = display.get(index).and_then(|d| d["displayProperties"]["name"].as_str()).unwrap_or("").to_string();
            let mut list = Vec::new();
            for i in cat["itemIndexes"].as_array().into_iter().flatten().filter_map(|v| v.as_u64()) {
                let key = i.to_string();
                let Some((_, it)) = items.iter().find(|(k, _)| *k == key) else { continue };
                let Some(hash) = it["itemHash"].as_u64() else { continue };
                let d = m.items.get(&(hash as u32)).cloned().unwrap_or_default();
                if d.name.is_empty() {
                    continue;
                }
                let objs = objectives(&item_objectives[&key]["objectives"], m);
                list.push(json!({
                    "hash": hash,
                    "name": d.name,
                    "icon": icon_url(&d.icon),
                    "typeName": d.type_name,
                    "description": d.description,
                    "tier": d.tier,
                    "quantity": it["quantity"],
                    "complete": !objs.is_empty() && objs.iter().all(|o| o["complete"].as_bool() == Some(true)),
                    "objectives": objs,
                }));
            }
            if !list.is_empty() {
                categories.push(json!({ "name": name, "items": list }));
            }
        }
        out.push(json!({
            "hash": vhash,
            "name": def["displayProperties"]["name"],
            "refresh": vendors["vendors"]["data"][vkey]["nextRefreshDate"],
            "categories": categories,
        }));
    }
    out
}

/// Bungie definitions for many hashes at once, a few requests at a time (each is memory-cached by `entity`).
async fn entities(table: &'static str, hashes: &[u64]) -> HashMap<u64, Value> {
    let mut out = HashMap::new();
    for chunk in hashes.chunks(10) {
        let tasks: Vec<_> = chunk.iter().map(|&h| tauri::async_runtime::spawn(async move { (h, entity(table, h).await) })).collect();
        for task in tasks {
            if let Ok((h, Some(v))) = task.await {
                out.insert(h, v);
            }
        }
    }
    out
}

/// Why a sale item can't be bought right now (Bungie's VendorItemStatus flags), in a word or two.
fn sale_status(flags: u64) -> Option<&'static str> {
    if flags & 4096 != 0 {
        Some("Owned")
    } else if flags & 2 != 0 {
        Some("Can't afford")
    } else if flags & 8192 != 0 {
        None // shown for information only
    } else if flags & (4 | 8 | 32 | 64) != 0 {
        Some("Locked")
    } else if flags & 16 != 0 {
        Some("Sold out")
    } else {
        None
    }
}

/// Every vendor a character can visit (component 400 enabled, a visible definition, something for sale), for the
/// Vendors tab: name, location, group (Tower, destinations...), background art, rank, reset time, and the items
/// for sale by category with their costs and whether they can be bought. At most 80 vendors.
pub async fn vendor_screen(vendors: &Value, m: &Manifest) -> Value {
    let empty = json!({ "vendors": [] });
    let (Some(states), Some(sales)) = (vendors["vendors"]["data"].as_object(), vendors["sales"]["data"].as_object()) else { return empty };
    let keys: Vec<u64> = states
        .iter()
        .filter(|(k, v)| v["enabled"].as_bool() != Some(false) && sales.get(*k).and_then(|s| s["saleItems"].as_object()).is_some_and(|o| !o.is_empty()))
        .filter_map(|(k, _)| k.parse().ok())
        .take(80)
        .collect();
    let defs = entities("DestinyVendorDefinition", &keys).await;
    let location_of = |hash: u64, def: &Value| {
        let index = states[&hash.to_string()]["vendorLocationIndex"].as_u64().unwrap_or(0) as usize;
        def["locations"].as_array().and_then(|l| l.get(index).or(l.first())).cloned().unwrap_or(Value::Null)
    };
    let destinations: Vec<u64> = defs.iter().filter_map(|(h, d)| location_of(*h, d)["destinationHash"].as_u64()).filter(|h| *h != 0).collect::<HashSet<_>>().into_iter().collect();
    let groups: Vec<u64> = defs.values().filter_map(|d| d["groups"][0]["vendorGroupHash"].as_u64()).collect::<HashSet<_>>().into_iter().collect();
    let destination_defs = entities("DestinyDestinationDefinition", &destinations).await;
    let group_defs = entities("DestinyVendorGroupDefinition", &groups).await;
    let horizon = years_later(&chrono_now(), 2);
    let mut out = Vec::new();
    for hash in keys {
        let Some(def) = defs.get(&hash) else { continue };
        let name = def["displayProperties"]["name"].as_str().unwrap_or("");
        if name.is_empty() || def["visible"].as_bool() == Some(false) {
            continue;
        }
        let key = hash.to_string();
        let state = &states[&key];
        let location = location_of(hash, def);
        let destination = location["destinationHash"].as_u64().and_then(|h| destination_defs.get(&h)).and_then(|d| d["displayProperties"]["name"].as_str()).unwrap_or("");
        let group = def["groups"][0]["vendorGroupHash"].as_u64().and_then(|h| group_defs.get(&h)).and_then(|g| g["categoryName"].as_str()).unwrap_or("");
        let display = def["displayCategories"].as_array().cloned().unwrap_or_default();
        let sale_items = sales[&key]["saleItems"].as_object().cloned().unwrap_or_default();
        let objectives_of = &vendors["itemComponents"][&key]["objectives"]["data"];
        let mut categories = Vec::new();
        for cat in vendors["categories"]["data"][&key]["categories"].as_array().into_iter().flatten() {
            let index = cat["displayCategoryIndex"].as_u64().unwrap_or(0) as usize;
            let cat_name = display.get(index).and_then(|d| d["displayProperties"]["name"].as_str()).unwrap_or("").to_string();
            let mut items = Vec::new();
            for i in cat["itemIndexes"].as_array().into_iter().flatten().filter_map(|v| v.as_u64()).take(120) {
                let index_key = i.to_string();
                let Some(sale) = sale_items.get(&index_key) else { continue };
                let Some(item_hash) = sale["itemHash"].as_u64() else { continue };
                let Some(d) = m.items.get(&(item_hash as u32)) else { continue };
                if d.name.is_empty() {
                    continue;
                }
                let costs: Vec<Value> = sale["costs"]
                    .as_array()
                    .into_iter()
                    .flatten()
                    .filter_map(|c| {
                        let cost = m.items.get(&(c["itemHash"].as_u64()? as u32))?;
                        Some(json!({ "name": cost.name, "icon": icon_url(&cost.icon), "quantity": c["quantity"] }))
                    })
                    .collect();
                let objs = objectives(&objectives_of[&index_key]["objectives"], m);
                items.push(json!({
                    "hash": item_hash,
                    "name": d.name,
                    "icon": icon_url(&d.icon),
                    "watermark": icon_url(&d.watermark),
                    "typeName": d.type_name,
                    "description": d.description,
                    "tier": d.tier,
                    "kind": d.kind,
                    "classType": d.class,
                    "quantity": sale["quantity"],
                    "costs": costs,
                    "status": sale_status(sale["saleStatus"].as_u64().unwrap_or(0)),
                    "objectives": objs,
                }));
            }
            if !items.is_empty() {
                categories.push(json!({ "name": cat_name, "items": items }));
            }
        }
        if categories.is_empty() {
            continue;
        }
        let refresh = state["nextRefreshDate"].as_str().filter(|d| *d < horizon.as_str()).map(str::to_string);
        let progression = &state["progression"];
        out.push(json!({
            "hash": hash,
            "name": name,
            "subtitle": def["displayProperties"]["subtitle"],
            "description": def["displayProperties"]["description"],
            "icon": icon_url(def["displayProperties"]["icon"].as_str().unwrap_or("")),
            "art": icon_url(location["backgroundImagePath"].as_str().unwrap_or("")),
            "destination": destination,
            "group": group,
            "refresh": refresh,
            "rank": if progression.is_object() { json!({ "level": progression["level"], "progress": progression["progressToNextLevel"], "next": progression["nextLevelAt"], "resets": progression["currentResetCount"] }) } else { Value::Null },
            "categories": categories,
        }));
    }
    json!({ "vendors": out })
}

pub async fn seasonal(profile: &Value, vendors: &Value, character: &str, m: &Manifest) -> Value {
    let progressions = &profile["characterProgressions"]["data"][character]["progressions"];
    let season_hash = profile["profile"]["data"]["currentSeasonHash"].as_u64().unwrap_or(0);
    let season = entity("DestinySeasonDefinition", season_hash).await.unwrap_or(Value::Null);
    let now = chrono_now();

    // The current pass: the latest one in the season's list that has started; it ends when the
    // next one starts, or with the season (when Bungie gives a real date).
    let list = season["seasonPassList"].as_array().cloned().unwrap_or_default();
    let started: Vec<&Value> = list.iter().filter(|p| p["seasonPassStartDate"].as_str().map(|d| d <= now.as_str()).unwrap_or(true)).collect();
    let current_ref = started.last().copied().or(list.last());
    let current_pass = current_ref.and_then(|p| p["seasonPassHash"].as_u64()).or(season["seasonPassHash"].as_u64());
    let horizon = years_later(&now, 2);
    let soon = |d: &str| d > now.as_str() && d < horizon.as_str();
    let next_start = list.iter().filter_map(|p| p["seasonPassStartDate"].as_str()).find(|d| soon(d)).map(str::to_string);
    let season_end = season["endDate"].as_str().filter(|d| soon(d)).map(str::to_string);
    let pass_ends = next_start.or(season_end.clone());
    let pass = match current_pass {
        Some(h) => pass_track(h, season_hash, progressions, m).await,
        None => Value::Null,
    };

    // Past passes (newest first) for the dropdown, and rewards still waiting to be claimed on each.
    let mut passes = Vec::new();
    let mut waiting = Vec::new();
    let mut seasons: Vec<u64> = profile["profile"]["data"]["seasonHashes"].as_array().into_iter().flatten().filter_map(|v| v.as_u64()).collect();
    if !seasons.contains(&season_hash) && season_hash != 0 {
        seasons.push(season_hash);
    }
    for h in seasons.iter().rev().take(12) {
        let Some(def) = entity("DestinySeasonDefinition", *h).await else { continue };
        let season_name = def["displayProperties"]["name"].as_str().unwrap_or("").to_string();
        let number = def["seasonNumber"].clone();
        let mut hashes: Vec<u64> = def["seasonPassList"].as_array().into_iter().flatten().filter_map(|p| p["seasonPassHash"].as_u64()).collect();
        if hashes.is_empty() {
            hashes.extend(def["seasonPassHash"].as_u64());
        }
        for (i, ph) in hashes.iter().enumerate().rev() {
            let label = if hashes.len() > 1 { format!("{season_name} (pass {})", i + 1) } else { season_name.clone() };
            let is_current = Some(*ph) == current_pass;
            passes.push(json!({ "hash": ph, "seasonHash": h, "season": label, "number": number, "current": is_current }));
            let track = if is_current { pass.clone() } else { pass_track(*ph, *h, progressions, m).await };
            for mut w in claimable(&track) {
                w["pass"] = track["name"].clone();
                w["passHash"] = json!(ph);
                w["seasonHash"] = json!(h);
                w["seasonLabel"] = json!(label);
                w["current"] = json!(is_current);
                waiting.push(w);
            }
        }
    }

    // Objectives: records under every presentation node the season or the active event card names.
    let mut roots: Vec<(String, u64)> = Vec::new();
    let mut collect_roots = |def: &Value, from: &str| {
        if let Some(obj) = def.as_object() {
            for (k, v) in obj {
                if k.ends_with("PresentationNodeHash") {
                    if let Some(h) = v.as_u64().filter(|h| *h != 0) {
                        roots.push((format!("{from}.{k}"), h));
                    }
                }
            }
        }
    };
    collect_roots(&season, "season");
    let card_hash = profile["profile"]["data"]["activeEventCardHash"].as_u64().unwrap_or(0);
    let card = if card_hash != 0 { entity("DestinyEventCardDefinition", card_hash).await.unwrap_or(Value::Null) } else { Value::Null };
    collect_roots(&card, "eventCard");
    // Bungie's core settings name the root of each record tree; list them all (for the data
    // check) and look inside the ones whose names suggest the hub's objectives.
    let mut core_nodes: Vec<Value> = Vec::new();
    let mut guardian_root: Option<u64> = None;
    if let Ok(settings) = get("/Settings/", None).await {
        guardian_root = settings["destiny2CoreSettings"]["guardianRanksRootNodeHash"].as_u64().filter(|h| *h != 0);
        if let Some(core) = settings["destiny2CoreSettings"].as_object() {
            for (k, v) in core {
                if !k.to_lowercase().contains("node") {
                    continue;
                }
                let Some(h) = v.as_u64().filter(|h| *h != 0) else { continue };
                let node = entity("DestinyPresentationNodeDefinition", h).await.unwrap_or(Value::Null);
                let name = node["displayProperties"]["name"].as_str().unwrap_or("").to_string();
                let lower = format!("{k} {name}").to_lowercase();
                if ["season", "hub", "objective", "daily", "weekly", "pathfinder", "portal"].iter().any(|w| lower.contains(w)) && !lower.contains("seal") {
                    roots.push((format!("core.{k}"), h));
                }
                core_nodes.push(json!(format!("{k}: {} · {} sub-nodes · {} records", if name.is_empty() { "(no name)" } else { &name }, node["children"]["presentationNodes"].as_array().map(|a| a.len()).unwrap_or(0), node["children"]["records"].as_array().map(|a| a.len()).unwrap_or(0))));
            }
        }
    }
    let mut found: Vec<(String, u64)> = Vec::new();
    let mut nodes_seen: Vec<Value> = Vec::new();
    for (_, h) in &roots {
        node_records(*h, 0, String::new(), &mut found, &mut nodes_seen).await;
    }
    let record_state = |h: u64| -> Value {
        let key = h.to_string();
        let c = &profile["characterRecords"]["data"][character]["records"][&key];
        if c.is_object() {
            return c.clone();
        }
        profile["profileRecords"]["data"]["records"][&key].clone()
    };
    let (mut daily, mut weekly) = (Vec::new(), Vec::new());
    let mut groups: Vec<Value> = Vec::new();
    for (path, h) in found.iter().take(120) {
        let lower = path.to_lowercase();
        let group = if lower.contains("daily") { "daily" } else if lower.contains("week") { "weekly" } else { "other" };
        match groups.iter_mut().find(|g| g["path"].as_str() == Some(path.as_str())) {
            Some(g) => g["records"] = json!(g["records"].as_i64().unwrap_or(0) + 1),
            None => groups.push(json!({ "path": path, "group": group, "records": 1 })),
        }
        if group == "other" {
            continue;
        }
        let state = record_state(*h);
        let flags = state["state"].as_u64().unwrap_or(0);
        if flags & 16 != 0 || state.is_null() {
            continue; // invisible, or not this account's
        }
        let Some(def) = entity("DestinyRecordDefinition", *h).await else { continue };
        let rewards: Vec<Value> = def["rewardItems"]
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(|r| {
                let item = m.items.get(&(r["itemHash"].as_u64()? as u32))?;
                Some(json!({ "name": item.name, "icon": icon_url(&item.icon), "quantity": r["quantity"] }))
            })
            .collect();
        let entry = json!({
            "hash": h,
            "name": def["displayProperties"]["name"],
            "description": def["displayProperties"]["description"],
            "icon": icon_url(def["displayProperties"]["icon"].as_str().unwrap_or("")),
            "complete": flags & 4 == 0,
            "objectives": objectives(&state["objectives"], m),
            "rewards": rewards,
        });
        if group == "daily" { daily.push(entry) } else { weekly.push(entry) }
    }

    // Orders are items in the inventories whose kind ends in "Order" (Foundry Order, Duality
    // Order...); their objectives are with the item (instanced) or kept apart (uninstanced).
    let instanced = &profile["itemComponents"]["objectives"]["data"];
    let char_apart = &profile["characterProgressions"]["data"][character]["uninstancedItemObjectives"];
    let profile_apart = &profile["profileProgression"]["data"]["uninstancedItemObjectives"];
    let objectives_of = |item: &Value, hash: u32| -> Value {
        let instance = item["itemInstanceId"].as_str().unwrap_or("");
        if !instance.is_empty() && instanced[instance]["objectives"].is_array() {
            return instanced[instance]["objectives"].clone();
        }
        let key = hash.to_string();
        if char_apart[&key].is_array() { char_apart[&key].clone() } else { profile_apart[&key].clone() }
    };
    let mut inventory_orders = Vec::new();
    for section in [&profile["characterInventories"]["data"][character], &profile["profileInventory"]["data"]] {
        for item in items_of(section) {
            let Some(hash) = item["itemHash"].as_u64().map(|h| h as u32) else { continue };
            let Some(d) = m.items.get(&hash) else { continue };
            if !d.type_name.to_lowercase().contains("order") || matches!(d.kind, 2 | 3) {
                continue;
            }
            let objs = objectives(&objectives_of(item, hash), m);
            inventory_orders.push(json!({
                "name": d.name,
                "icon": icon_url(&d.icon),
                "typeName": d.type_name,
                "tier": d.tier,
                "description": d.description,
                "complete": !objs.is_empty() && objs.iter().all(|o| o["complete"].as_bool() == Some(true)),
                "objectives": objs,
            }));
        }
    }

    // Daily / weekly objectives live on hidden items such as "Personal Weekly Objectives": each
    // of its objectives is one card, named from the objective's own definition.
    let mut holders = Vec::new();
    let mut clan_xp: Vec<Value> = Vec::new();
    let mut held_daily = Vec::new();
    let mut held_weekly = Vec::new();
    let mut weekly_holder: Option<(Value, usize)> = None;
    for apart in [char_apart, profile_apart] {
        let Some(map) = apart.as_object() else { continue };
        for (key, entry) in map {
            let Ok(hash) = key.parse::<u32>() else { continue };
            let Some(d) = m.items.get(&hash) else { continue };
            let lower = d.name.to_lowercase();
            if !lower.contains("objective") {
                continue;
            }
            // "Personal Weekly Objectives" is the clan's weekly XP objective, not the hub's.
            let clan = entry.as_array().into_iter().flatten().any(|o| {
                o["objectiveHash"].as_u64().and_then(|h| m.objectives.get(&(h as u32))).map(|d| d.text.to_lowercase().contains("clan")).unwrap_or(false)
            });
            if clan {
                holders.push(json!({ "name": format!("{} (clan)", d.name), "objectives": 0, "done": 0, "value": [] }));
                clan_xp.extend(objectives(entry, m));
                continue;
            }
            let daily_kind = lower.contains("daily");
            let list = entry.as_array().cloned().unwrap_or_default();
            let mut cards = Vec::new();
            for o in &list {
                let Some(oh) = o["objectiveHash"].as_u64() else { continue };
                let def = entity("DestinyObjectiveDefinition", oh).await.unwrap_or(Value::Null);
                let progress_text = def["progressDescription"].as_str().unwrap_or("").to_string();
                let name = def["displayProperties"]["name"].as_str().filter(|n| !n.is_empty()).map(str::to_string).unwrap_or_else(|| progress_text.clone());
                let objs = objectives(&Value::Array(vec![o.clone()]), m);
                cards.push(json!({
                    "name": name,
                    "description": def["displayProperties"]["description"].as_str().filter(|t| !t.is_empty()).unwrap_or(&progress_text),
                    "icon": icon_url(def["displayProperties"]["icon"].as_str().unwrap_or("")),
                    "complete": o["complete"].as_bool().unwrap_or(false),
                    "objectives": objs,
                    "rewards": [],
                }));
            }
            let full = entity("DestinyInventoryItemDefinition", hash as u64).await.unwrap_or(Value::Null);
            let value: Vec<Value> = full["value"]["itemValue"]
                .as_array()
                .into_iter()
                .flatten()
                .filter_map(|v| {
                    let item = m.items.get(&(v["itemHash"].as_u64().filter(|h| *h != 0)? as u32))?;
                    Some(json!({ "name": item.name, "icon": icon_url(&item.icon), "tier": item.tier, "typeName": item.type_name, "description": item.description, "quantity": v["quantity"] }))
                })
                .collect();
            let done = cards.iter().filter(|c| c["complete"].as_bool() == Some(true)).count();
            holders.push(json!({ "name": d.name, "objectives": cards.len(), "done": done, "value": value.iter().map(|v| v["name"].clone()).collect::<Vec<_>>() }));
            if daily_kind {
                held_daily.extend(cards);
            } else if lower.contains("week") {
                if !value.is_empty() && weekly_holder.is_none() {
                    weekly_holder = Some((Value::Array(value), done));
                }
                held_weekly.extend(cards);
            }
        }
    }
    if daily.is_empty() {
        daily = held_daily;
    }
    if weekly.is_empty() {
        weekly = held_weekly;
    }

    // Vendors with objectives or bounties: their categories fill in what the records didn't.
    let hub = hub_vendors(vendors, m).await;
    let mut orders = inventory_orders;
    let mut weekly_rewards_items = Vec::new();
    for v in &hub {
        for c in v["categories"].as_array().into_iter().flatten() {
            let name = c["name"].as_str().unwrap_or("").to_lowercase();
            let items = c["items"].as_array().cloned().unwrap_or_default();
            let as_objective = |it: &Value| json!({ "name": it["name"], "description": it["description"], "icon": it["icon"], "complete": it["complete"], "objectives": it["objectives"], "rewards": [] });
            if name.contains("order") {
                orders.extend(items.iter().map(as_objective));
            } else if name.contains("daily") && daily.is_empty() {
                daily.extend(items.iter().filter(|i| i["objectives"].as_array().map(|a| !a.is_empty()).unwrap_or(false)).map(as_objective));
            } else if name.contains("week") && name.contains("reward") {
                weekly_rewards_items.extend(items.clone());
            } else if name.contains("week") && weekly.is_empty() {
                weekly.extend(items.iter().filter(|i| i["objectives"].as_array().map(|a| !a.is_empty()).unwrap_or(false)).map(as_objective));
            }
        }
    }

    // Reward tracks other than the pass (the weekly rewards might be one): progressions that
    // carry reward states, with their definitions.
    let mut tracks = Vec::new();
    if let Some(map) = progressions.as_object() {
        for (key, p) in map {
            let steps = p["rewardItemStates"].as_array().map(|a| a.len()).unwrap_or(0);
            if !(3..=24).contains(&steps) || tracks.len() >= 25 {
                continue;
            }
            let Ok(hash) = key.parse::<u64>() else { continue };
            let Some(def) = entity("DestinyProgressionDefinition", hash).await else { continue };
            let states = p["rewardItemStates"].as_array().cloned().unwrap_or_default();
            let rewards: Vec<Value> = def["rewardItems"]
                .as_array()
                .into_iter()
                .flatten()
                .enumerate()
                .filter_map(|(i, r)| {
                    let item = m.items.get(&(r["itemHash"].as_u64()? as u32))?;
                    let st = states.get(i).and_then(|v| v.as_u64()).unwrap_or(0);
                    Some(json!({ "step": r["rewardedAtProgressionLevel"], "name": item.name, "icon": icon_url(&item.icon), "tier": item.tier, "typeName": item.type_name, "description": item.description, "quantity": r["quantity"], "earned": st & 2 != 0, "claimed": st & 4 != 0 }))
                })
                .collect();
            let first = rewards.first().and_then(|r| r["name"].as_str()).unwrap_or("").to_string();
            tracks.push(json!({
                "hash": hash,
                "name": def["displayProperties"]["name"],
                "firstReward": first,
                "level": p["level"],
                "levelCap": p["levelCap"],
                "progress": p["progressToNextLevel"],
                "next": p["nextLevelAt"],
                "rewards": rewards,
            }));
        }
    }
    let named = |word: &str| tracks.iter().find(|t| t["name"].as_str().map(|n| n.to_lowercase().contains(word)).unwrap_or(false)).cloned();
    // The weekly rewards: a track named "week", else the one the owner identified (unnamed, 20
    // steps, first reward a Strange Coin), else one whose every level gives a reward and that
    // isn't a 15-rank vendor reputation.
    let strange = tracks
        .iter()
        .find(|t| t["firstReward"].as_str().map(|n| n.to_lowercase().contains("strange coin")).unwrap_or(false))
        .or_else(|| {
            tracks.iter().find(|t| {
                let steps = t["rewards"].as_array().map(|a| a.len()).unwrap_or(0) as i64;
                let cap = t["levelCap"].as_i64().unwrap_or(0);
                cap >= 18 && steps >= cap
            })
        })
        .cloned();
    let weekly_rewards = named("week").or(strange).unwrap_or_else(|| {
        if weekly_rewards_items.is_empty() {
            // The weekly objectives item's own reward list, one step per completed objective (a guess).
            match &weekly_holder {
                Some((value, done)) => json!({
                    "name": "Weekly rewards",
                    "level": done,
                    "levelCap": value.as_array().map(|a| a.len()),
                    "guess": true,
                    "rewards": value.as_array().into_iter().flatten().enumerate().map(|(i, v)| { let mut w = v.clone(); w["step"] = json!(i + 1); w["earned"] = json!(i < *done); w }).collect::<Vec<_>>(),
                }),
                None => Value::Null,
            }
        } else {
            json!({ "name": "Weekly rewards", "level": Value::Null, "rewards": weekly_rewards_items.iter().enumerate().map(|(i, it)| { let mut w = it.clone(); w["step"] = json!(i + 1); w }).collect::<Vec<_>>() })
        }
    });

    // Pursuits the character holds whose objectives Bungie keeps apart from the item (orders may
    // be these), and what kinds of things sit in the inventories, for the data check.
    let uninstanced: Vec<Value> = profile["characterProgressions"]["data"][character]["uninstancedItemObjectives"]
        .as_object()
        .map(|o| o.keys().filter_map(|k| k.parse::<u32>().ok()).filter_map(|h| m.items.get(&h)).map(|d| json!(format!("{} ({})", d.name, d.type_name))).take(40).collect())
        .unwrap_or_default();
    let mut kinds: Vec<(String, usize)> = Vec::new();
    let sections = [&profile["characterInventories"]["data"][character], &profile["profileInventory"]["data"]];
    for section in sections {
        for item in items_of(section) {
            let Some(d) = item["itemHash"].as_u64().and_then(|h| m.items.get(&(h as u32))) else { continue };
            if matches!(d.kind, 2 | 3) || d.type_name.is_empty() {
                continue;
            }
            match kinds.iter_mut().find(|(k, _)| *k == d.type_name) {
                Some(entry) => entry.1 += 1,
                None => kinds.push((d.type_name.clone(), 1)),
            }
        }
    }
    kinds.sort_by(|a, b| b.1.cmp(&a.1));

    // The weekly checklist: the character's milestones (raids, dungeons, Kepler, Purification,
    // Weekly Clan Engrams...), each done when its rewards are earned (else its challenges or quests
    // are complete). Same-named milestones are merged. Weekly Clan Engrams also feeds the clan box.
    let mut milestones = Vec::new();
    let mut checklist: Vec<Value> = Vec::new();
    let mut clan_engrams: Vec<Value> = Vec::new();
    if let Some(map) = profile["characterProgressions"]["data"][character]["milestones"].as_object() {
        for (key, ms) in map.iter().take(40) {
            let Ok(h) = key.parse::<u64>() else { continue };
            let Some(def) = entity("DestinyMilestoneDefinition", h).await else { continue };
            let name = def["displayProperties"]["name"].as_str().unwrap_or("").to_string();
            if name.is_empty() {
                continue;
            }
            milestones.push(json!(name));
            // Reward entries: earned / redeemed, named from the definition's reward categories.
            let mut entries = Vec::new();
            for cat in ms["rewards"].as_array().into_iter().flatten() {
                let cat_def = &def["rewards"][cat["rewardCategoryHash"].as_u64().unwrap_or(0).to_string()];
                for e in cat["entries"].as_array().into_iter().flatten() {
                    let entry_def = &cat_def["rewardEntries"][e["rewardEntryHash"].as_u64().unwrap_or(0).to_string()];
                    entries.push(json!({
                        "name": entry_def["displayProperties"]["name"].as_str().filter(|n| !n.is_empty()).unwrap_or(cat_def["displayProperties"]["name"].as_str().unwrap_or("Reward")),
                        "earned": e["earned"].as_bool().unwrap_or(false),
                        "redeemed": e["redeemed"].as_bool().unwrap_or(false),
                    }));
                }
            }
            let challenges: Vec<Value> = ms["activities"].as_array().into_iter().flatten().flat_map(|a| a["challenges"].as_array().cloned().unwrap_or_default()).map(|c| c["objective"].clone()).filter(|o| o.is_object()).collect();
            let quests: Vec<bool> = ms["availableQuests"].as_array().into_iter().flatten().map(|q| q["status"]["completed"].as_bool().unwrap_or(false)).collect();
            let progress = objectives(&Value::Array(challenges.clone()), m);
            let done = if !entries.is_empty() {
                entries.iter().all(|e| e["earned"].as_bool() == Some(true))
            } else if !challenges.is_empty() {
                challenges.iter().all(|o| o["complete"].as_bool() == Some(true))
            } else if !quests.is_empty() {
                quests.iter().all(|q| *q)
            } else {
                false
            };
            if name.to_lowercase().contains("clan engram") {
                clan_engrams.extend(entries.clone());
            }
            let known = !entries.is_empty() || !challenges.is_empty() || !quests.is_empty();
            match checklist.iter_mut().find(|c| c["name"].as_str() == Some(name.as_str())) {
                Some(c) => {
                    c["done"] = json!(c["done"].as_bool().unwrap_or(false) && done);
                    c["known"] = json!(c["known"].as_bool().unwrap_or(false) || known);
                }
                None => checklist.push(json!({
                    "name": name,
                    "icon": icon_url(def["displayProperties"]["icon"].as_str().unwrap_or("")),
                    "description": def["displayProperties"]["description"],
                    "done": done,
                    "known": known,
                    "entries": entries,
                    "progress": progress,
                    "ends": ms["endDate"],
                    "order": ms["order"],
                })),
            }
        }
    }
    checklist.sort_by_key(|c| (c["done"].as_bool().unwrap_or(false), c["order"].as_i64().unwrap_or(0)));

    // Guardian Rank: the profile's current rank, and the records under the next rank's node in
    // Bungie's Guardian Ranks tree (done = objective flag clear).
    let current_rank = profile["profile"]["data"]["currentGuardianRank"].as_i64().unwrap_or(0);
    let highest_rank = profile["profile"]["data"]["lifetimeHighestGuardianRank"].as_i64().unwrap_or(0);
    let mut guardian = Value::Null;
    if let Some(root) = guardian_root {
        if let Some(root_def) = entity("DestinyPresentationNodeDefinition", root).await {
            let ranks: Vec<u64> = root_def["children"]["presentationNodes"].as_array().into_iter().flatten().filter_map(|c| c["presentationNodeHash"].as_u64()).collect();
            let name_of = |def: &Value| def["displayProperties"]["name"].as_str().unwrap_or("").to_string();
            let current = match ranks.get((current_rank.max(1) - 1) as usize) {
                Some(h) => entity("DestinyPresentationNodeDefinition", *h).await,
                None => None,
            };
            let mut next_json = Value::Null;
            if let Some(next_hash) = ranks.get(current_rank.max(0) as usize) {
                if let Some(next) = entity("DestinyPresentationNodeDefinition", *next_hash).await {
                    let mut steps = Vec::new();
                    for r in next["children"]["records"].as_array().into_iter().flatten().take(30) {
                        let Some(rh) = r["recordHash"].as_u64() else { continue };
                        let state = record_state(rh);
                        let Some(rdef) = entity("DestinyRecordDefinition", rh).await else { continue };
                        let flags = state["state"].as_u64().unwrap_or(4);
                        if flags & 16 != 0 {
                            continue;
                        }
                        steps.push(json!({ "name": rdef["displayProperties"]["name"], "description": rdef["displayProperties"]["description"], "done": flags & 4 == 0 && !state.is_null() }));
                    }
                    next_json = json!({ "rank": current_rank + 1, "name": name_of(&next), "steps": steps });
                }
            }
            guardian = json!({
                "rank": current_rank,
                "highest": highest_rank,
                "name": current.as_ref().map(name_of).unwrap_or_default(),
                "icon": current.as_ref().map(|d| icon_url(d["displayProperties"]["icon"].as_str().unwrap_or(""))).unwrap_or(Value::Null),
                "max": ranks.len(),
                "next": next_json,
            });
        }
    }
    if guardian.is_null() && current_rank > 0 {
        guardian = json!({ "rank": current_rank, "highest": highest_rank, "name": "", "next": Value::Null });
    }

    json!({
        "season": {
            "hash": season_hash,
            "name": season["displayProperties"]["name"],
            "number": season["seasonNumber"],
            "ends": season_end,
            "passEnds": pass_ends,
        },
        "eventCard": card["displayProperties"]["name"],
        "pass": pass,
        "passes": passes,
        "claimable": waiting,
        "daily": daily,
        "weekly": weekly,
        "orders": orders,
        "weeklyRewards": weekly_rewards,
        "checklist": checklist,
        "guardian": guardian,
        "clan": { "xp": clan_xp, "engrams": clan_engrams },
        "check": {
            "roots": roots.iter().map(|(k, h)| json!({ "from": k, "hash": h })).collect::<Vec<_>>(),
            "nodes": nodes_seen,
            "groups": groups,
            "tracks": tracks.iter().map(|t| json!({ "hash": t["hash"], "name": t["name"], "firstReward": t["firstReward"], "steps": t["rewards"].as_array().map(|a| a.len()), "level": t["level"], "levelCap": t["levelCap"] })).collect::<Vec<_>>(),
            "vendors": hub.iter().map(|v| json!({ "name": v["name"], "refresh": v["refresh"], "categories": v["categories"].as_array().into_iter().flatten().map(|c| json!({ "name": c["name"], "count": c["items"].as_array().map(|a| a.len()), "first": c["items"].as_array().and_then(|a| a.first()).map(|i| i["name"].clone()) })).collect::<Vec<_>>() })).collect::<Vec<_>>(),
            "vendorsRead": vendors["sales"]["data"].as_object().map(|o| o.len()).unwrap_or(0),
            "milestones": milestones,
            "uninstanced": uninstanced,
            "holders": holders,
            "coreNodes": core_nodes,
            "inventoryOrders": orders.len(),
            "kinds": kinds.iter().take(40).map(|(k, n)| json!(format!("{k} · {n}"))).collect::<Vec<_>>(),
            "passKeys": pass["keys"],
            "seasonKeys": season.as_object().map(|o| o.keys().cloned().collect::<Vec<_>>()).unwrap_or_default(),
        },
    })
}

/// The character's vendors with their sales, display categories and item objectives.
pub async fn character_vendors(kind: i64, id: &str, character: &str, token: &str) -> Result<Value, String> {
    get(&format!("/Destiny2/{kind}/Profile/{id}/Character/{character}/Vendors/?components=400,401,402,301"), Some(token)).await
}

/// Claims a season pass reward (it goes to the character, or the postmaster when full).
pub async fn claim_reward(kind: i64, token: &str, character: &str, season: u64, index: u32) -> Result<(), String> {
    post("/Destiny2/Actions/Seasons/ClaimReward/", token, json!({ "rewardIndex": index, "seasonHash": season, "characterId": character, "membershipType": kind }))
        .await
        .map(|_| ())
}

/// `iso` moved `years` years later (only for rough "is this date in the next year or two" checks).
fn years_later(iso: &str, years: i64) -> String {
    let year: i64 = iso.get(..4).and_then(|y| y.parse().ok()).unwrap_or(2026);
    format!("{:04}{}", year + years, iso.get(4..).unwrap_or(""))
}

/// Now as an ISO 8601 string (UTC), comparable with Bungie's dates.
fn chrono_now() -> String {
    let secs = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0) as i64;
    let days = secs.div_euclid(86_400);
    let rem = secs.rem_euclid(86_400);
    // Civil date from days since 1970 (Howard Hinnant's algorithm).
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let mo = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = if mo <= 2 { y + 1 } else { y };
    format!("{y:04}-{mo:02}-{d:02}T{:02}:{:02}:{:02}Z", rem / 3600, rem % 3600 / 60, rem % 60)
}

/// Bungie's site-wide alerts, as plain text.
pub async fn alerts() -> Vec<Value> {
    let Ok(list) = get("/GlobalAlerts/", None).await else { return Vec::new() };
    list.as_array()
        .into_iter()
        .flatten()
        .filter_map(|a| {
            let text = strip_tags(a["AlertHtml"].as_str().unwrap_or(""));
            (!text.is_empty()).then(|| json!({ "text": text, "level": a["AlertLevel"] }))
        })
        .take(5)
        .collect()
}

/// Turns Bungie's alert HTML into plain text (the shell only ever shows text).
pub fn strip_tags(html: &str) -> String {
    let mut out = String::new();
    let mut in_tag = false;
    for c in html.chars() {
        match c {
            '<' => in_tag = true,
            '>' => {
                in_tag = false;
                out.push(' ');
            }
            _ if !in_tag => out.push(c),
            _ => {}
        }
    }
    let text = out.replace("&amp;", "&").replace("&nbsp;", " ").replace("&#39;", "'").replace("&quot;", "\"").replace("&lt;", "<").replace("&gt;", ">");
    text.split_whitespace().collect::<Vec<_>>().join(" ")
}

pub async fn profile(kind: i64, id: &str, token: &str, components: &str) -> Result<Value, String> {
    get(&format!("/Destiny2/{kind}/Profile/{id}/?components={components}"), Some(token)).await
}

// ---------- Actions ----------

pub struct Move {
    pub hash: u32,
    pub instance: Option<String>,
    pub owner: String,
    pub quantity: i64,
}

async fn transfer_once(kind: i64, token: &str, mv: &Move, character: &str, to_vault: bool) -> Result<(), String> {
    post(
        "/Destiny2/Actions/Items/TransferItem/",
        token,
        json!({
            "itemReferenceHash": mv.hash,
            "stackSize": mv.quantity,
            "transferToVault": to_vault,
            "itemId": mv.instance.clone().unwrap_or_else(|| "0".into()),
            "characterId": character,
            "membershipType": kind,
        }),
    )
    .await
    .map(|_| ())
}

/// Moves an item to a character or the vault. Between characters it goes through the vault.
pub async fn transfer(kind: i64, token: &str, mv: &Move, to: &str) -> Result<(), String> {
    if mv.owner == to {
        return Ok(());
    }
    if mv.owner != "vault" {
        transfer_once(kind, token, mv, &mv.owner, true).await?;
    }
    if to != "vault" {
        transfer_once(kind, token, mv, to, false).await?;
    }
    Ok(())
}

// ---------- One item in detail (the item card) ----------

fn plug_json(m: &Manifest, hash: u32) -> Value {
    match m.items.get(&hash) {
        Some(p) => json!({ "hash": hash, "name": p.name, "icon": icon_url(&p.icon), "description": p.description, "type": p.type_name }),
        None => json!({ "hash": hash, "name": "", "icon": Value::Null, "description": "", "type": "" }),
    }
}

/// What kind of socket a category is, from its name (WEAPON PERKS, ARMOR MODS, INTRINSIC
/// TRAITS, WEAPON COSMETICS...).
fn socket_kind(category: &str) -> &'static str {
    let c = category.to_lowercase();
    if c.contains("intrinsic") || c.contains("frame") {
        "intrinsic"
    } else if c.contains("perk") || c.contains("trait") {
        "perks"
    } else if c.contains("cosmetic") || c.contains("ornament") || c.contains("shader") {
        "cosmetics"
    } else if c.contains("mod") {
        "mods"
    } else {
        "other"
    }
}

/// An item's card: stats in the game's order, its frame, perk columns (with the other perks it
/// can switch to), mod sockets (with the mods you own), kill trackers and flavour text.
/// `item` is Bungie's item endpoint answer (components 300,302,304,305,309,310); `plug_sets` the
/// profile's and characters' plug sets (component 105), for mod choices.
/// Every item's card details from one profile read (components 102, 201, 205, 300, 304, 305, 309, 310), kept so a card
/// opens without asking Bungie about that item: { states: { instance: state }, instances, stats, sockets,
/// reusablePlugs, plugObjectives } (the last five keyed by instance, as Bungie sends them).
pub fn item_parts(profile: &Value) -> Value {
    let mut states = Map::new();
    let mut note = |section: &Value| {
        for item in items_of(section) {
            if let (Some(id), Some(state)) = (item["itemInstanceId"].as_str(), item["state"].as_i64()) {
                states.insert(id.to_string(), json!(state));
            }
        }
    };
    note(&profile["profileInventory"]["data"]);
    for key in ["characterInventories", "characterEquipment"] {
        if let Some(chars) = profile[key]["data"].as_object() {
            for section in chars.values() {
                note(section);
            }
        }
    }
    let parts = &profile["itemComponents"];
    json!({
        "states": states,
        "instances": parts["instances"]["data"],
        "stats": parts["stats"]["data"],
        "sockets": parts["sockets"]["data"],
        "reusablePlugs": parts["reusablePlugs"]["data"],
        "plugObjectives": parts["plugObjectives"]["data"],
    })
}

/// One item in the shape Bungie's item endpoint answers with, from `item_parts` (None when it isn't there).
pub fn item_from_parts(parts: &Value, instance: &str) -> Option<Value> {
    if !parts["sockets"][instance].is_object() || !parts["instances"][instance].is_object() {
        return None;
    }
    Some(json!({
        "item": { "data": { "state": parts["states"][instance] } },
        "instance": { "data": parts["instances"][instance] },
        "stats": { "data": parts["stats"][instance] },
        "sockets": { "data": parts["sockets"][instance] },
        "reusablePlugs": { "data": parts["reusablePlugs"][instance] },
        "plugObjectives": { "data": parts["plugObjectives"][instance] },
    }))
}

/// Reads ahead (in the background) the definitions every weapon and armor card in the inventory needs, a few at a
/// time; they're kept on disk, so this only costs anything the first time after a game update.
pub async fn prefetch_cards(profile: &Value, m: &Manifest) {
    let mut hashes: HashSet<u64> = HashSet::new();
    let mut note = |section: &Value| {
        for item in items_of(section) {
            let Some(hash) = item["itemHash"].as_u64() else { continue };
            if item["itemInstanceId"].is_string() && m.items.get(&(hash as u32)).is_some_and(|d| d.kind == 2 || d.kind == 3) {
                hashes.insert(hash);
            }
        }
    };
    note(&profile["profileInventory"]["data"]);
    for key in ["characterInventories", "characterEquipment"] {
        if let Some(chars) = profile[key]["data"].as_object() {
            for section in chars.values() {
                note(section);
            }
        }
    }
    let list: Vec<u64> = hashes.into_iter().collect();
    for chunk in list.chunks(40) {
        let defs = entities("DestinyInventoryItemDefinition", chunk).await;
        let groups: Vec<u64> = defs.values().filter_map(|d| d["stats"]["statGroupHash"].as_u64()).collect::<HashSet<_>>().into_iter().collect();
        let cats: Vec<u64> = defs.values().flat_map(|d| d["sockets"]["socketCategories"].as_array().cloned().unwrap_or_default()).filter_map(|c| c["socketCategoryHash"].as_u64()).collect::<HashSet<_>>().into_iter().collect();
        let group_defs = entities("DestinyStatGroupDefinition", &groups).await;
        let stats: Vec<u64> = group_defs.values().flat_map(|g| g["scaledStats"].as_array().cloned().unwrap_or_default()).filter_map(|x| x["statHash"].as_u64()).collect::<HashSet<_>>().into_iter().collect();
        entities("DestinyStatDefinition", &stats).await;
        entities("DestinySocketCategoryDefinition", &cats).await;
    }
}

pub async fn item_details(item: &Value, hash: u64, plug_sets: &Value, m: &Manifest) -> Value {
    let def = entity("DestinyInventoryItemDefinition", hash).await.unwrap_or(Value::Null);
    let mini = m.items.get(&(hash as u32)).cloned().unwrap_or_default();

    // Stats, in the stat group's order; numbers-only ones (RPM, magazine) without bars.
    let values = &item["stats"]["data"]["stats"];
    let mut stats = Vec::new();
    // The stat group, then its stats and the socket categories, each batch read at once (and kept on disk).
    let group = match def["stats"]["statGroupHash"].as_u64() {
        Some(h) => entity("DestinyStatGroupDefinition", h).await,
        None => None,
    };
    let stat_hashes: Vec<u64> = group.iter().flat_map(|g| g["scaledStats"].as_array().cloned().unwrap_or_default()).filter_map(|x| x["statHash"].as_u64()).collect();
    let category_hashes: Vec<u64> = def["sockets"]["socketCategories"].as_array().into_iter().flatten().filter_map(|c| c["socketCategoryHash"].as_u64()).collect();
    let stat_defs = entities("DestinyStatDefinition", &stat_hashes).await;
    let category_defs = entities("DestinySocketCategoryDefinition", &category_hashes).await;
    if let Some(g) = &group {
        {
            for scaled in g["scaledStats"].as_array().into_iter().flatten() {
                let Some(stat) = scaled["statHash"].as_u64() else { continue };
                let Some(value) = values[stat.to_string()]["value"].as_i64() else { continue };
                let Some(sd) = stat_defs.get(&stat) else { continue };
                let name = sd["displayProperties"]["name"].as_str().unwrap_or("");
                if name.is_empty() {
                    continue;
                }
                stats.push(json!({ "name": name, "value": value, "bar": !scaled["displayAsNumeric"].as_bool().unwrap_or(false) }));
            }
        }
    }

    // Plug choices from plug sets (the account's and every character's).
    let set_plugs = |set: u64| -> Vec<Value> {
        let key = set.to_string();
        let mut list: Vec<Value> = plug_sets["profilePlugSets"]["data"]["plugs"][&key].as_array().cloned().unwrap_or_default();
        if let Some(chars) = plug_sets["characterPlugSets"]["data"].as_object() {
            for c in chars.values() {
                list.extend(c["plugs"][&key].as_array().cloned().unwrap_or_default());
            }
        }
        list
    };

    let current = item["sockets"]["data"]["sockets"].as_array().cloned().unwrap_or_default();
    let reusable = &item["reusablePlugs"]["data"]["plugs"];
    let entries = def["sockets"]["socketEntries"].as_array().cloned().unwrap_or_default();
    let mut sockets = Vec::new();
    for category in def["sockets"]["socketCategories"].as_array().into_iter().flatten() {
        let Some(cat_hash) = category["socketCategoryHash"].as_u64() else { continue };
        let cat_name = category_defs.get(&cat_hash).and_then(|c| c["displayProperties"]["name"].as_str().map(str::to_string)).unwrap_or_default();
        let kind = socket_kind(&cat_name);
        for index in category["socketIndexes"].as_array().into_iter().flatten().filter_map(|i| i.as_u64()) {
            let socket = &current.get(index as usize).cloned().unwrap_or(Value::Null);
            if socket["isVisible"].as_bool() == Some(false) {
                continue;
            }
            let Some(plug) = socket["plugHash"].as_u64() else { continue };
            let mut options: Vec<Value> = Vec::new();
            let mut seen: Vec<u64> = Vec::new();
            let mut offer = |p: &Value| {
                let Some(h) = p["plugItemHash"].as_u64() else { return };
                if seen.contains(&h) || p["canInsert"].as_bool() == Some(false) || p["enabled"].as_bool() == Some(false) {
                    return;
                }
                seen.push(h);
                let mut o = plug_json(m, h as u32);
                o["current"] = json!(h == plug);
                options.push(o);
            };
            if kind == "perks" || kind == "intrinsic" {
                for p in reusable[index.to_string()].as_array().into_iter().flatten() {
                    offer(p);
                }
            } else if kind == "mods" {
                // The socket's own list (component 310) first: weapon mod slots list the mods
                // you've unlocked there; then the plug sets the definition names.
                for p in reusable[index.to_string()].as_array().into_iter().flatten() {
                    offer(p);
                }
                let entry = entries.get(index as usize).cloned().unwrap_or(Value::Null);
                for set in [entry["reusablePlugSetHash"].as_u64(), entry["randomizedPlugSetHash"].as_u64()].into_iter().flatten() {
                    for p in set_plugs(set).iter().take(150) {
                        offer(p);
                    }
                }
            }
            let mut current_plug = plug_json(m, plug as u32);
            if current_plug["name"].as_str().unwrap_or("").is_empty() {
                continue;
            }
            current_plug["enabled"] = socket["isEnabled"].clone();
            sockets.push(json!({
                "index": index,
                "kind": kind,
                "category": cat_name,
                "current": current_plug,
                // Only offer a change when there's something else to pick.
                "options": if options.len() > 1 || (options.len() == 1 && options[0]["hash"].as_u64() != Some(plug)) { Value::Array(options) } else { json!([]) },
            }));
        }
    }

    // Kill trackers and other counters on plugs.
    let mut trackers = Vec::new();
    if let Some(per_plug) = item["plugObjectives"]["data"]["objectivesPerPlug"].as_object() {
        for objectives in per_plug.values() {
            for o in objectives.as_array().into_iter().flatten() {
                let Some(h) = o["objectiveHash"].as_u64() else { continue };
                let label = m.objectives.get(&(h as u32)).map(|d| d.text.clone()).unwrap_or_default();
                if !label.is_empty() {
                    trackers.push(json!({ "label": label, "value": o["progress"] }));
                }
            }
        }
    }

    let instance = &item["instance"]["data"];
    json!({
        "name": mini.name,
        "typeName": mini.type_name,
        "tierName": def["inventory"]["tierTypeName"],
        "flavor": def["flavorText"],
        "power": instance["primaryStat"]["value"],
        "damage": instance["damageType"],
        "ammo": def["equippingBlock"]["ammoType"],
        "gearTier": instance["gearTier"],
        "locked": item["item"]["data"]["state"].as_i64().unwrap_or(0) & 1 == 1,
        "stats": stats,
        "sockets": sockets,
        "trackers": trackers,
    })
}

pub async fn item(kind: i64, id: &str, token: &str, instance: &str) -> Result<Value, String> {
    get(&format!("/Destiny2/{kind}/Profile/{id}/Item/{instance}/?components=300,302,304,305,309,310"), Some(token)).await
}

pub async fn set_lock(kind: i64, token: &str, instance: &str, character: &str, locked: bool) -> Result<(), String> {
    post(
        "/Destiny2/Actions/Items/SetLockState/",
        token,
        json!({ "state": locked, "itemId": instance, "characterId": character, "membershipType": kind }),
    )
    .await
    .map(|_| ())
}

/// Put a perk or mod into a socket (only "free" plugs, as Bungie allows apps).
pub async fn insert_plug(kind: i64, token: &str, instance: &str, character: &str, socket: u64, plug: u64) -> Result<(), String> {
    post(
        "/Destiny2/Actions/Items/InsertSocketPlugFree/",
        token,
        json!({
            "plug": { "socketIndex": socket, "socketArrayType": 0, "plugItemHash": plug },
            "itemId": instance,
            "characterId": character,
            "membershipType": kind,
        }),
    )
    .await
    .map(|_| ())
}

pub async fn pull_from_postmaster(kind: i64, token: &str, mv: &Move) -> Result<(), String> {
    post(
        "/Destiny2/Actions/Items/PullFromPostmaster/",
        token,
        json!({
            "itemReferenceHash": mv.hash,
            "stackSize": mv.quantity,
            "itemId": mv.instance.clone().unwrap_or_else(|| "0".into()),
            "characterId": mv.owner,
            "membershipType": kind,
        }),
    )
    .await
    .map(|_| ())
}

/// Equips one of the character's in-game loadouts (by its slot number).
pub async fn equip_loadout(kind: i64, token: &str, index: u32, character: &str) -> Result<(), String> {
    post("/Destiny2/Actions/Loadouts/EquipLoadout/", token, json!({ "loadoutIndex": index, "characterId": character, "membershipType": kind }))
        .await
        .map(|_| ())
}

pub async fn equip(kind: i64, token: &str, instance: &str, character: &str) -> Result<(), String> {
    post("/Destiny2/Actions/Items/EquipItem/", token, json!({ "itemId": instance, "characterId": character, "membershipType": kind }))
        .await
        .map(|_| ())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn manifest() -> Manifest {
        let mut m = Manifest::default();
        let item = |name: &str, kind, bucket, class| Item { name: name.into(), icon: "/i.jpg".into(), kind, bucket, class, tier: 5, ..Item::default() };
        m.items.insert(1, item("Fatebringer", 3, 1498876634, 3));
        m.items.insert(2, item("Helm", 2, 3448274439, 0));
        m.items.insert(3, item("Shader", 19, 2973005342, 3));
        m.items.insert(4, Item { type_name: "Weekly Bounty".into(), ..item("Bounty", 26, QUESTS_BUCKET, 3) });
        m.items.insert(5, item("A quest", 12, QUESTS_BUCKET, 3));
        m.objectives.insert(9, Objective { text: "Defeat enemies".into(), goal: 50 });
        m
    }

    #[test]
    fn shapes_inventory_from_characters_and_vault() {
        let profile = json!({
            "characters": { "data": {
                "100": { "characterId": "100", "classType": 0, "light": 2010, "dateLastPlayed": "2026-09-01T00:00:00Z" },
                "200": { "characterId": "200", "classType": 1, "light": 2000, "dateLastPlayed": "2026-09-30T00:00:00Z" }
            } },
            "characterEquipment": { "data": { "100": { "items": [ { "itemHash": 1, "itemInstanceId": "11", "bucketHash": 1498876634 } ] } } },
            "characterInventories": { "data": { "100": { "items": [
                { "itemHash": 3, "itemInstanceId": "33", "bucketHash": 2973005342u64 },
                { "itemHash": 1, "itemInstanceId": "12", "bucketHash": 215593132 }
            ] } } },
            "profileCurrencies": { "data": { "items": [ { "itemHash": 1, "quantity": 250000 } ] } },
            "profileInventory": { "data": { "items": [
                { "itemHash": 2, "itemInstanceId": "22", "bucketHash": 138197802, "transferStatus": 0 },
                { "itemHash": 2, "itemInstanceId": "23", "bucketHash": 3313201758u64 }
            ] } },
            "itemComponents": { "instances": { "data": { "11": { "primaryStat": { "value": 2010 } } } } }
        });
        let out = shape_inventory(&profile, &manifest());
        assert_eq!(out["characters"][0]["id"], "200", "last played first");
        let items = out["items"].as_array().unwrap();
        assert_eq!(items.len(), 3, "the shader is left out; the account's mods are in");
        assert_eq!((items[2]["owner"].as_str(), items[2]["bucket"].as_u64()), (Some("account"), Some(3313201758)));
        assert_eq!(out["vault"]["count"], 1);
        assert_eq!((items[0]["owner"].as_str(), items[0]["equipped"].as_bool(), items[0]["power"].as_i64()), (Some("100"), Some(true), Some(2010)));
        assert_eq!((items[1]["owner"].as_str(), items[1]["bucket"].as_u64()), (Some("vault"), Some(3448274439)));
        assert_eq!((out["postmaster"][0]["bucket"].as_u64(), out["postmaster"][0]["owner"].as_str()), (Some(1498876634), Some("100")));
        assert_eq!(out["currencies"][0]["quantity"], 250000);
    }

    #[test]
    fn splits_quests_and_bounties() {
        let profile = json!({
            "characterInventories": { "data": { "100": { "items": [
                { "itemHash": 4, "itemInstanceId": "44", "bucketHash": QUESTS_BUCKET, "expirationDate": "2026-10-06T17:00:00Z" },
                { "itemHash": 5, "bucketHash": QUESTS_BUCKET }
            ] } } },
            "itemComponents": { "objectives": { "data": { "44": { "objectives": [ { "objectiveHash": 9, "progress": 50, "completionValue": 50, "complete": true } ] } } } },
            "characterUninstancedItemComponents": { "100": { "objectives": { "data": { "5": { "objectives": [ { "objectiveHash": 9, "progress": 10, "complete": false } ] } } } } }
        });
        let out = shape_activity(&profile, &manifest());
        assert_eq!(out["bounties"]["100"][0]["complete"], true);
        assert_eq!(out["bounties"]["100"][0]["objectives"][0]["text"], "Defeat enemies");
        assert_eq!(out["quests"]["100"][0]["objectives"][0]["goal"], 50, "goal falls back to the definition");
    }

    #[test]
    fn sorts_sockets_by_category_name() {
        assert_eq!(socket_kind("WEAPON PERKS"), "perks");
        assert_eq!(socket_kind("INTRINSIC TRAITS"), "intrinsic");
        assert_eq!(socket_kind("ARMOR MODS"), "mods");
        assert_eq!(socket_kind("WEAPON COSMETICS"), "cosmetics");
        assert_eq!(socket_kind("ARMOR TIER"), "other");
    }

    #[test]
    fn now_is_an_iso_date() {
        let now = chrono_now();
        assert_eq!(now.len(), 20);
        assert!(now.starts_with("20") && now.ends_with('Z') && &now[10..11] == "T");
    }

    #[test]
    fn alerts_are_plain_text() {
        assert_eq!(strip_tags("<p>Servers <b>down</b> at 9&amp;10</p><script>x()</script>"), "Servers down at 9&10 x()");
    }
}
