//! Destiny 2 data for the built-in tabs (Inventory, Quests, Seasonal hub), read with the player's
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
use std::collections::HashMap;
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
        Some(36) | Some(51) => Err("Bungie asked Mida to slow down. Wait a moment and try again.".into()),
        Some(2101) => Err("Bungie rejected Mida's API key (Bungie error 2101: invalid or expired key).".into()),
        Some(2102) => Err("Bungie says Mida's request had no API key (Bungie error 2102).".into()),
        // Bungie's own wording plus the code, so a problem can be told apart from another.
        Some(12) => Err(format!(
            "Bungie hasn't given Mida permission for this: Mida's app settings on bungie.net are missing a permission (Bungie error 12: {}).",
            body["Message"].as_str().unwrap_or("")
        )),
        Some(99) => Err("Bungie didn't accept Mida's sign-in for this (Bungie error 99). Sign out in Settings > Tabs and sign in again.".into()),
        code => Err(format!("{} (Bungie error {})", body["Message"].as_str().unwrap_or("Bungie couldn't do that."), code.unwrap_or(0))),
    }
}

pub async fn get(path: &str, token: Option<&str>) -> Result<Value, String> {
    let key = api_key().ok_or("This copy of Mida can't talk to Bungie (it was built without an API key).")?;
    let mut req = client().get(format!("{ROOT}/Platform{path}")).header("X-API-Key", key);
    if let Some(token) = token {
        req = req.bearer_auth(token);
    }
    let res = req.send().await.map_err(|_| "Couldn't reach Bungie. Check your connection and try again.".to_string())?;
    unwrap(&res.bytes().await.map_err(|_| "Bungie's reply was cut off. Try again.".to_string())?)
}

async fn post(path: &str, token: &str, body: Value) -> Result<Value, String> {
    let key = api_key().ok_or("This copy of Mida can't talk to Bungie (it was built without an API key).")?;
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

async fn download(path: &str) -> Result<Vec<u8>, String> {
    let res = client()
        .get(format!("{ROOT}{path}"))
        .timeout(Duration::from_secs(180))
        .send()
        .await
        .map_err(|_| "Couldn't download Destiny's item list from Bungie.".to_string())?;
    if !res.status().is_success() {
        return Err("Couldn't download Destiny's item list from Bungie.".into());
    }
    Ok(res.bytes().await.map_err(|_| "Destiny's item list download was cut off.".to_string())?.to_vec())
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
    // "-3": the slimmed format gained fields (v0.5, v0.6), so files saved by older Midas are read again.
    let file = folder.join(format!("{safe}-3.json"));
    if !safe.is_empty() {
        if let Ok(bytes) = std::fs::read(&file) {
            if let Ok(m) = serde_json::from_slice::<Manifest>(&bytes) {
                return Ok(m);
            }
        }
    }
    let paths = &info["jsonWorldComponentContentPaths"]["en"];
    let items_path = paths["DestinyInventoryItemLiteDefinition"].as_str().ok_or("Bungie didn't list the item definitions.")?;
    let objectives_path = paths["DestinyObjectiveDefinition"].as_str().ok_or("Bungie didn't list the objective definitions.")?;
    let manifest = Manifest {
        version,
        items: slim_items(&download(items_path).await?)?,
        objectives: slim_objectives(&download(objectives_path).await?)?,
    };
    // Keep only this version's file.
    let _ = std::fs::remove_dir_all(&folder);
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
    let v = get(&format!("/Destiny2/Manifest/{table}/{hash}/"), None).await.ok()?;
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
            }));
        }
        bonuses.push(json!({ "name": set["displayProperties"]["name"], "count": count, "perks": perks }));
    }
    json!({ "stats": stats, "sets": bonuses, "light": c["light"] })
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
pub async fn item_details(item: &Value, hash: u64, plug_sets: &Value, m: &Manifest) -> Value {
    let def = entity("DestinyInventoryItemDefinition", hash).await.unwrap_or(Value::Null);
    let mini = m.items.get(&(hash as u32)).cloned().unwrap_or_default();

    // Stats, in the stat group's order; numbers-only ones (RPM, magazine) without bars.
    let values = &item["stats"]["data"]["stats"];
    let mut stats = Vec::new();
    if let Some(group) = def["stats"]["statGroupHash"].as_u64() {
        if let Some(g) = entity("DestinyStatGroupDefinition", group).await {
            for scaled in g["scaledStats"].as_array().into_iter().flatten() {
                let Some(stat) = scaled["statHash"].as_u64() else { continue };
                let Some(value) = values[stat.to_string()]["value"].as_i64() else { continue };
                let Some(sd) = entity("DestinyStatDefinition", stat).await else { continue };
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
        let cat_name = entity("DestinySocketCategoryDefinition", cat_hash)
            .await
            .and_then(|c| c["displayProperties"]["name"].as_str().map(str::to_string))
            .unwrap_or_default();
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
    fn alerts_are_plain_text() {
        assert_eq!(strip_tags("<p>Servers <b>down</b> at 9&amp;10</p><script>x()</script>"), "Servers down at 9&10 x()");
    }
}
