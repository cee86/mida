//! The Guardian and Director tabs: characters with their emblem's stat tracker, Guardian Rank and commendations,
//! recent games, the season and reward pass, the Portal's activities with their bonus drops, and Bungie.net friends.
//! Everything Bungie is asked goes through bungie.rs (`get`, `entity`, `entities`).

use crate::bungie::{self, entities, entity, icon_url, items_of, Manifest};
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};

const EMBLEM_BUCKET: u64 = 4274335291;

/// A record's title for a gender (0 = male, 1 = female).
async fn title_of(record: u64, gender: i64) -> Option<String> {
    if record == 0 {
        return None;
    }
    let def = entity("DestinyRecordDefinition", record).await?;
    let titles = &def["titleInfo"]["titlesByGender"];
    let t = if gender == 1 { titles["Female"].as_str() } else { titles["Male"].as_str() };
    t.filter(|s| !s.is_empty()).map(str::to_string)
}

/// The Guardian tab's top half: each character (emblem, power, race, title, the emblem's equipped stat tracker),
/// Guardian Rank with what the next rank needs, and commendations by category.
/// Profile components 100, 103, 200, 205, 900, 1400.
pub async fn guardian(profile: &Value, m: &Manifest) -> Value {
    let settings = bungie::get("/Settings/", None).await.unwrap_or(Value::Null);
    let rank_root = settings["destiny2CoreSettings"]["guardianRanksRootNodeHash"].as_u64().filter(|h| *h != 0);
    let mut characters = bungie::characters(profile);
    for c in characters.iter_mut() {
        let id = c["id"].as_str().unwrap_or("").to_string();
        c["race"] = json!(bungie::race_name(c["raceType"].as_i64().unwrap_or(-1)));
        c["title"] = json!(title_of(c["titleRecordHash"].as_u64().unwrap_or(0), c["genderType"].as_i64().unwrap_or(0)).await);
        // The equipped emblem's stat tracker: Bungie puts the chosen metric and its value on the emblem item itself.
        let emblem = items_of(&profile["characterEquipment"]["data"][&id]).find(|i| i["bucketHash"].as_u64() == Some(EMBLEM_BUCKET)).cloned();
        if let Some(e) = emblem {
            if let Some(metric) = e["metricHash"].as_u64().filter(|h| *h != 0) {
                let def = entity("DestinyMetricDefinition", metric).await.unwrap_or(Value::Null);
                c["tracker"] = json!({
                    "name": def["displayProperties"]["name"],
                    "icon": icon_url(def["displayProperties"]["icon"].as_str().unwrap_or("")),
                    "value": e["metricObjective"]["progress"],
                });
            }
        }
    }
    let first = characters.first().and_then(|c| c["id"].as_str()).unwrap_or("").to_string();
    let rank = bungie::guardian_rank(profile, &first, rank_root).await;

    // Commendations: the total and each category node's score (Ally, Fun, Mastery, Leadership...), with its colour.
    let com = &profile["profileCommendations"]["data"];
    let mut nodes = Vec::new();
    if let Some(scores) = com["commendationNodeScoresByHash"].as_object() {
        let hashes: Vec<u64> = scores.keys().filter_map(|k| k.parse().ok()).collect();
        let defs = entities("DestinySocialCommendationNodeDefinition", &hashes).await;
        for h in hashes {
            let Some(d) = defs.get(&h) else { continue };
            let col = &d["color"];
            nodes.push(json!({
                "name": d["displayProperties"]["name"],
                "icon": icon_url(d["displayProperties"]["icon"].as_str().unwrap_or("")),
                "score": scores[&h.to_string()],
                "percent": com["commendationNodePercentagesByHash"][h.to_string()],
                "color": if col.is_object() { json!(format!("rgb({}, {}, {})", col["red"].as_i64().unwrap_or(200), col["green"].as_i64().unwrap_or(200), col["blue"].as_i64().unwrap_or(200))) } else { Value::Null },
            }));
        }
    }
    nodes.sort_by_key(|n| -n["score"].as_i64().unwrap_or(0));
    // The account's currencies (Glimmer, Bright Dust, Silver...), as the Companion app shows them above the characters.
    let currencies: Vec<Value> = items_of(&profile["profileCurrencies"]["data"])
        .filter_map(|c| {
            let def = m.items.get(&(c["itemHash"].as_u64()? as u32))?;
            Some(json!({ "name": def.name, "icon": icon_url(&def.icon), "quantity": c["quantity"] }))
        })
        .collect();
    json!({
        "characters": characters,
        "currencies": currencies,
        "rank": rank,
        "commendations": if com.is_object() { json!({ "total": com["totalScore"], "details": com["scoreDetailValues"], "nodes": nodes }) } else { Value::Null },
    })
}

/// The most recent games across the characters (Bungie's activity history, newest first).
pub async fn recent_games(kind: i64, id: &str, character_ids: &[String], token: &str) -> Value {
    let mut tasks = Vec::new();
    for c in character_ids.iter().take(3) {
        let path = format!("/Destiny2/{kind}/Account/{id}/Character/{c}/Stats/Activities/?count=10&mode=0&page=0");
        let token = token.to_string();
        let c = c.clone();
        tasks.push(tauri::async_runtime::spawn(async move { (c, bungie::get(&path, Some(&token)).await) }));
    }
    let mut games: Vec<(String, Value)> = Vec::new();
    for t in tasks {
        if let Ok((c, Ok(v))) = t.await {
            for a in v["activities"].as_array().cloned().unwrap_or_default() {
                games.push((c.clone(), a));
            }
        }
    }
    games.sort_by(|a, b| b.1["period"].as_str().unwrap_or("").cmp(a.1["period"].as_str().unwrap_or("")));
    let hashes: Vec<u64> = games
        .iter()
        .flat_map(|(_, g)| [g["activityDetails"]["referenceId"].as_u64(), g["activityDetails"]["directorActivityHash"].as_u64()])
        .flatten()
        .collect::<HashSet<_>>()
        .into_iter()
        .collect();
    let defs = entities("DestinyActivityDefinition", &hashes).await;
    let name = |h: Option<u64>| h.and_then(|h| defs.get(&h)).and_then(|d| d["displayProperties"]["name"].as_str()).unwrap_or("").to_string();
    let value = |g: &Value, k: &str| g["values"][k]["basic"]["value"].as_f64();
    let shown = |g: &Value, k: &str| g["values"][k]["basic"]["displayValue"].as_str().unwrap_or("").to_string();
    let list: Vec<Value> = games
        .iter()
        .map(|(c, g)| {
            let d = &g["activityDetails"];
            let reference = d["referenceId"].as_u64();
            let director = d["directorActivityHash"].as_u64();
            let def = reference.and_then(|h| defs.get(&h));
            let playlist = name(director);
            let title = name(reference);
            json!({
                "character": c,
                "instance": d["instanceId"],
                "at": g["period"],
                "name": if title.is_empty() { playlist.clone() } else { title.clone() },
                "playlist": if playlist != title { playlist } else { String::new() },
                "image": icon_url(def.and_then(|d| d["pgcrImage"].as_str()).unwrap_or("")),
                "icon": icon_url(def.and_then(|d| d["displayProperties"]["icon"].as_str()).filter(|s| !s.is_empty()).or_else(|| director.and_then(|h| defs.get(&h)).and_then(|d| d["displayProperties"]["icon"].as_str())).unwrap_or("")),
                "pvp": def.and_then(|d| d["isPvP"].as_bool()).unwrap_or(false),
                "completed": value(g, "completed") == Some(1.0) && value(g, "completionReason").unwrap_or(0.0) == 0.0,
                "standing": shown(g, "standing"),
                "kills": value(g, "kills"),
                "deaths": value(g, "deaths"),
                "assists": value(g, "assists"),
                "kd": shown(g, "killsDeathsRatio"),
                "duration": shown(g, "activityDurationSeconds"),
            })
        })
        .collect();
    json!(list)
}

/// The season (name, art, end, its seal) and the reward pass rank for the Director's banners.
/// Profile components 100 and 202.
pub async fn director(profile: &Value, token: &str) -> Value {
    let summary = bungie::season(profile, token).await;
    let hash = profile["profile"]["data"]["currentSeasonHash"].as_u64().unwrap_or(0);
    let def = if hash != 0 { entity("DestinySeasonDefinition", hash).await.unwrap_or(Value::Null) } else { Value::Null };
    let pass_hash = def["seasonPassList"].as_array().and_then(|l| l.last()).and_then(|p| p["seasonPassHash"].as_u64()).or(def["seasonPassHash"].as_u64());
    let pass_name = match pass_hash {
        Some(h) => entity("DestinySeasonPassDefinition", h).await.map(|p| p["displayProperties"]["name"].clone()).unwrap_or(Value::Null),
        None => Value::Null,
    };
    json!({
        "characters": bungie::characters(profile),
        "pass": pass_name,
        "season": {
            "name": summary["name"],
            "number": summary["number"],
            "ends": summary["ends"],
            "rank": summary["rank"],
            "description": def["displayProperties"]["description"],
            "icon": icon_url(def["displayProperties"]["icon"].as_str().unwrap_or("")),
            "image": icon_url(def["backgroundImagePath"].as_str().unwrap_or("")),
            "seal": def["sealPresentationNodeHash"],
        },
    })
}

/// The Portal: every activity the character can launch now (component 204) with the rewards Bungie shows for it
/// (`visibleRewards`: bonus drops, the focused weapon, engrams), whether it's in the Portal's featured carousel
/// (`isFocusedActivity`), its traits (where Solo / Fireteam / Pinnacle / Arena Ops are expected) and whether it's
/// matchmade. Only activities with something to show (featured, rewards or traits) come back.
pub async fn portal(profile: &Value, character: &str, m: &Manifest) -> Value {
    let list = profile["characterActivities"]["data"][character]["availableActivities"].as_array().cloned().unwrap_or_default();
    let list: Vec<Value> = list.into_iter().filter(|a| a["isVisible"].as_bool() != Some(false)).collect();
    let hashes: Vec<u64> = list.iter().filter_map(|a| a["activityHash"].as_u64()).collect::<HashSet<_>>().into_iter().collect();
    let total = hashes.len().max(1) as f64;
    let mut defs: HashMap<u64, Value> = HashMap::new();
    for (i, chunk) in hashes.chunks(40).enumerate() {
        bungie::report("portal", 0.3 + 0.6 * (i * 40) as f64 / total, &format!("Reading activities ({} of {})", (i * 40).min(hashes.len()), hashes.len()));
        defs.extend(entities("DestinyActivityDefinition", chunk).await);
    }
    let trait_hashes: Vec<u64> = defs.values().flat_map(|d| d["traitHashes"].as_array().cloned().unwrap_or_default()).filter_map(|t| t.as_u64()).collect::<HashSet<_>>().into_iter().collect();
    let traits = entities("DestinyTraitDefinition", &trait_hashes).await;
    let type_hashes: Vec<u64> = defs.values().filter_map(|d| d["activityTypeHash"].as_u64()).collect::<HashSet<_>>().into_iter().collect();
    let types = entities("DestinyActivityTypeDefinition", &type_hashes).await;
    let mut seen_traits: HashMap<String, usize> = HashMap::new();
    let mut out = Vec::new();
    let mut done: HashSet<u64> = HashSet::new();
    for a in &list {
        let Some(h) = a["activityHash"].as_u64() else { continue };
        let Some(d) = defs.get(&h) else { continue };
        let trait_names: Vec<String> = d["traitHashes"]
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(|t| t.as_u64())
            .filter_map(|t| traits.get(&t))
            .filter_map(|t| t["displayProperties"]["name"].as_str().map(str::to_string))
            .filter(|n| !n.is_empty())
            .collect();
        for t in &trait_names {
            *seen_traits.entry(t.clone()).or_default() += 1;
        }
        let mut rewards = Vec::new();
        for mapping in a["visibleRewards"].as_array().into_iter().flatten() {
            for r in mapping["rewardItems"].as_array().into_iter().flatten() {
                let q = &r["itemQuantity"];
                let Some(ih) = q["itemHash"].as_u64() else { continue };
                let Some(item) = m.items.get(&(ih as u32)) else { continue };
                if rewards.iter().any(|x: &Value| x["hash"].as_u64() == Some(ih)) {
                    continue;
                }
                rewards.push(json!({
                    "hash": ih, "name": item.name, "icon": icon_url(&item.icon), "tier": item.tier, "typeName": item.type_name,
                    "kind": item.kind, "quantity": q["quantity"], "description": item.description,
                }));
            }
        }
        let featured = a["isFocusedActivity"].as_bool() == Some(true);
        if !featured && rewards.is_empty() && trait_names.is_empty() {
            continue;
        }
        if !done.insert(h) {
            continue;
        }
        let show = if d["selectionScreenDisplayProperties"]["name"].as_str().is_some_and(|n| !n.is_empty()) { &d["selectionScreenDisplayProperties"] } else { &d["displayProperties"] };
        out.push(json!({
            "hash": h,
            "name": show["name"],
            "description": show["description"],
            "fullName": d["displayProperties"]["name"],
            "icon": icon_url(d["displayProperties"]["icon"].as_str().unwrap_or("")),
            "image": icon_url(d["pgcrImage"].as_str().unwrap_or("")),
            "type": d["activityTypeHash"].as_u64().and_then(|t| types.get(&t)).map(|t| t["displayProperties"]["name"].clone()).unwrap_or(Value::Null),
            "modes": d["activityModeTypes"],
            "traits": trait_names,
            "featured": featured,
            "matchmade": d["matchmaking"]["isMatchmade"].as_bool().unwrap_or(false),
            "pvp": d["isPvP"].as_bool().unwrap_or(false),
            "light": a["recommendedLight"],
            "rewards": rewards,
        }));
    }
    let mut trait_info = serde_json::Map::new();
    for t in traits.values() {
        let name = t["displayProperties"]["name"].as_str().unwrap_or("");
        if !name.is_empty() {
            trait_info.insert(name.to_string(), json!({ "description": t["displayProperties"]["description"], "icon": icon_url(t["displayProperties"]["icon"].as_str().unwrap_or("")) }));
        }
    }
    let mut trait_list: Vec<(String, usize)> = seen_traits.into_iter().collect();
    trait_list.sort_by(|a, b| b.1.cmp(&a.1));
    json!({
        "activities": out,
        "available": list.len(),
        "traits": trait_list.into_iter().map(|(n, c)| json!({ "name": n, "count": c })).collect::<Vec<_>>(),
        "traitInfo": trait_info,
    })
}

/// Bungie.net friends with whether they're online (needs the app's "read your Bungie.net friends" permission).
pub async fn friends(token: &str) -> Result<Value, String> {
    let v = bungie::get("/Social/Friends/", Some(token)).await.map_err(|e| {
        let lower = e.to_lowercase();
        if lower.contains("scope") || lower.contains("permission") || lower.contains("not permitted") || lower.contains("authoriz") {
            "MIDA needs permission to read your Bungie.net friends. That's a setting on MIDA's Bungie app (the owner adds it on bungie.net); then sign out and in again.".to_string()
        } else {
            e
        }
    })?;
    let mut list: Vec<Value> = v["friends"]
        .as_array()
        .into_iter()
        .flatten()
        .map(|f| {
            let u = &f["bungieNetUser"];
            let name = f["bungieGlobalDisplayName"].as_str().filter(|s| !s.is_empty()).or(u["cachedBungieGlobalDisplayName"].as_str()).or(u["displayName"].as_str()).unwrap_or("").to_string();
            let code = f["bungieGlobalDisplayNameCode"].as_i64().or(u["cachedBungieGlobalDisplayNameCode"].as_i64());
            json!({
                "name": name,
                "code": code.map(|c| format!("{c:04}")),
                "icon": icon_url(u["profilePicturePath"].as_str().unwrap_or("")),
                "online": f["onlineStatus"].as_i64() == Some(1),
                "inDestiny": f["onlineTitle"].as_i64() == Some(1),
            })
        })
        .collect();
    list.sort_by(|a, b| b["online"].as_bool().cmp(&a["online"].as_bool()).then_with(|| a["name"].as_str().unwrap_or("").to_lowercase().cmp(&b["name"].as_str().unwrap_or("").to_lowercase())));
    Ok(json!(list))
}
