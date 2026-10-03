//! Triumphs, seals and collections (the Records tab), shaped like seals.report and the game's own screens.
//!
//! Bungie's presentation node, record and collectible tables are large, so they're downloaded once per game update
//! (only when this tab is first opened), slimmed to what the tab shows and saved beside the main manifest
//! (`manifest/<version>-records-1.json`, cleaned up with it). Player data comes from profile components 200
//! (characters, for the title's gender), 700 (node progress), 800 (collectibles) and 900 (records).

use crate::bungie::{self, Manifest};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::path::Path;

#[derive(Serialize, Deserialize, Clone, Default)]
pub struct Node {
    pub name: String,
    pub description: String,
    pub icon: String,
    pub nodes: Vec<u32>,
    pub records: Vec<u32>,
    pub collectibles: Vec<u32>,
    pub completion: u32, // a seal's title record
    pub parent: u32,
}

#[derive(Serialize, Deserialize, Clone, Default)]
pub struct Record {
    pub name: String,
    pub description: String,
    pub icon: String,
    pub objectives: Vec<u32>,
    pub intervals: Vec<u32>,
    pub score: i64,
    pub gilding: bool,           // counts toward gilding the title, not earning it
    pub titles: Vec<String>,     // [male, female] when it awards a title
    pub gildable: bool,
}

#[derive(Serialize, Deserialize, Clone, Default)]
pub struct Collectible {
    pub name: String,
    pub icon: String,
    pub source: String,
    pub item: u32,
}

#[derive(Serialize, Deserialize, Clone, Default)]
pub struct Roots {
    pub active_seals: u32,
    pub legacy_seals: u32,
    pub active_triumphs: u32,
    pub legacy_triumphs: u32,
    pub collections: u32,
    pub badges: u32,
}

#[derive(Serialize, Deserialize, Default)]
pub struct Records {
    pub version: String,
    pub roots: Roots,
    pub nodes: HashMap<u32, Node>,
    pub records: HashMap<u32, Record>,
    pub collectibles: HashMap<u32, Collectible>,
}

// ---------- Slimming Bungie's tables ----------

#[derive(Deserialize, Default)]
#[serde(default, rename_all = "camelCase")]
struct RawDisplay {
    name: String,
    description: String,
    icon: String,
}

#[derive(Deserialize, Default)]
#[serde(default, rename_all = "camelCase")]
struct ChildNode {
    presentation_node_hash: u32,
}
#[derive(Deserialize, Default)]
#[serde(default, rename_all = "camelCase")]
struct ChildRecord {
    record_hash: u32,
}
#[derive(Deserialize, Default)]
#[serde(default, rename_all = "camelCase")]
struct ChildCollectible {
    collectible_hash: u32,
}
#[derive(Deserialize, Default)]
#[serde(default, rename_all = "camelCase")]
struct RawChildren {
    presentation_nodes: Vec<ChildNode>,
    records: Vec<ChildRecord>,
    collectibles: Vec<ChildCollectible>,
}
#[derive(Deserialize, Default)]
#[serde(default, rename_all = "camelCase")]
struct RawNode {
    display_properties: RawDisplay,
    children: RawChildren,
    completion_record_hash: Option<u32>,
    parent_node_hashes: Vec<u32>,
    redacted: bool,
}

#[derive(Deserialize, Default)]
#[serde(default, rename_all = "camelCase")]
struct RawInterval {
    interval_objective_hash: u32,
    interval_score_value: i64,
}
#[derive(Deserialize, Default)]
#[serde(default, rename_all = "camelCase")]
struct RawIntervalInfo {
    interval_objectives: Vec<RawInterval>,
}
#[derive(Deserialize, Default)]
#[serde(default)]
struct RawCompletion {
    #[serde(rename = "ScoreValue")]
    score_value: i64,
}
#[derive(Deserialize, Default)]
#[serde(default)]
struct RawTitles {
    #[serde(rename = "Male")]
    male: String,
    #[serde(rename = "Female")]
    female: String,
}
#[derive(Deserialize, Default)]
#[serde(default, rename_all = "camelCase")]
struct RawTitleInfo {
    has_title: bool,
    titles_by_gender: RawTitles,
    gilding_tracking_record_hash: Option<u32>,
}
#[derive(Deserialize, Default)]
#[serde(default, rename_all = "camelCase")]
struct RawRecord {
    display_properties: RawDisplay,
    objective_hashes: Vec<u32>,
    interval_info: RawIntervalInfo,
    completion_info: RawCompletion,
    for_title_gilding: bool,
    title_info: RawTitleInfo,
    redacted: bool,
}

#[derive(Deserialize, Default)]
#[serde(default, rename_all = "camelCase")]
struct RawCollectible {
    display_properties: RawDisplay,
    source_string: String,
    item_hash: u32,
    redacted: bool,
}

fn parse<T: for<'de> Deserialize<'de>>(bytes: &[u8], what: &str) -> Result<HashMap<u32, T>, String> {
    let raw: HashMap<String, T> = serde_json::from_slice(bytes).map_err(|_| format!("Destiny's {what} couldn't be read."))?;
    Ok(raw.into_iter().filter_map(|(k, v)| Some((k.parse().ok()?, v))).collect())
}

/// This game version's tables: from disk when saved before, else from Bungie (about 40 MB, once per update).
pub async fn load(dir: &Path, version: &str) -> Result<Records, String> {
    let safe: String = version.chars().filter(|c| c.is_ascii_alphanumeric() || *c == '.' || *c == '-').collect();
    let file = dir.join("manifest").join(format!("{safe}-records-1.json"));
    if !safe.is_empty() {
        if let Ok(bytes) = std::fs::read(&file) {
            if let Ok(r) = serde_json::from_slice::<Records>(&bytes) {
                if r.version == version {
                    return Ok(r);
                }
            }
        }
    }
    let info = bungie::get("/Destiny2/Manifest/", None).await?;
    let paths = &info["jsonWorldComponentContentPaths"]["en"];
    let path = |table: &str| paths[table].as_str().map(str::to_string).ok_or_else(|| format!("Bungie didn't list {table}."));
    let (nodes_path, records_path, collectibles_path) = (path("DestinyPresentationNodeDefinition")?, path("DestinyRecordDefinition")?, path("DestinyCollectibleDefinition")?);
    bungie::report("manifest", 0.0, "Downloading triumphs and collections (first time after a game update)");
    let raw_nodes: HashMap<u32, RawNode> = parse(&bungie::download(&nodes_path, 0.0, 0.2).await?, "presentation nodes")?;
    let raw_records: HashMap<u32, RawRecord> = parse(&bungie::download(&records_path, 0.2, 0.75).await?, "triumphs")?;
    let raw_collectibles: HashMap<u32, RawCollectible> = parse(&bungie::download(&collectibles_path, 0.75, 1.0).await?, "collections")?;

    let nodes = raw_nodes
        .into_iter()
        .filter(|(_, n)| !n.redacted)
        .map(|(h, n)| {
            (
                h,
                Node {
                    name: n.display_properties.name,
                    description: n.display_properties.description,
                    icon: n.display_properties.icon,
                    nodes: n.children.presentation_nodes.iter().map(|c| c.presentation_node_hash).collect(),
                    records: n.children.records.iter().map(|c| c.record_hash).collect(),
                    collectibles: n.children.collectibles.iter().map(|c| c.collectible_hash).collect(),
                    completion: n.completion_record_hash.unwrap_or(0),
                    parent: n.parent_node_hashes.first().copied().unwrap_or(0),
                },
            )
        })
        .collect();
    let records = raw_records
        .into_iter()
        .filter(|(_, r)| !r.redacted)
        .map(|(h, r)| {
            let intervals: Vec<u32> = r.interval_info.interval_objectives.iter().map(|i| i.interval_objective_hash).collect();
            let score = if intervals.is_empty() { r.completion_info.score_value } else { r.interval_info.interval_objectives.iter().map(|i| i.interval_score_value).sum() };
            let titles = if r.title_info.has_title { vec![r.title_info.titles_by_gender.male, r.title_info.titles_by_gender.female] } else { Vec::new() };
            (
                h,
                Record {
                    name: r.display_properties.name,
                    description: r.display_properties.description,
                    icon: r.display_properties.icon,
                    objectives: r.objective_hashes,
                    intervals,
                    score,
                    gilding: r.for_title_gilding,
                    titles,
                    gildable: r.title_info.gilding_tracking_record_hash.is_some_and(|h| h != 0),
                },
            )
        })
        .collect();
    let collectibles = raw_collectibles
        .into_iter()
        .filter(|(_, c)| !c.redacted && !c.display_properties.name.is_empty())
        .map(|(h, c)| (h, Collectible { name: c.display_properties.name, icon: c.display_properties.icon, source: c.source_string, item: c.item_hash }))
        .collect();

    let settings = bungie::get("/Settings/", None).await.unwrap_or(Value::Null);
    let core = &settings["destiny2CoreSettings"];
    let root = |k: &str| core[k].as_u64().unwrap_or(0) as u32;
    let mut roots = Roots {
        active_seals: root("activeSealsRootNodeHash"),
        legacy_seals: root("legacySealsRootNodeHash"),
        active_triumphs: root("activeTriumphsRootNodeHash"),
        legacy_triumphs: root("legacyTriumphsRootNodeHash"),
        collections: root("collectionRootNode"),
        badges: root("badgesRootNode"),
    };
    let mut r = Records { version: version.to_string(), roots: Roots::default(), nodes, records, collectibles };
    // The badges node, when the settings don't name it: the node called "Badges" under the collections root.
    if roots.badges == 0 {
        roots.badges = r.nodes.get(&roots.collections).and_then(|c| c.nodes.iter().copied().find(|h| r.nodes.get(h).is_some_and(|n| n.name.eq_ignore_ascii_case("badges")))).unwrap_or(0);
    }
    r.roots = roots;
    if let Ok(bytes) = serde_json::to_vec(&r) {
        let _ = std::fs::write(&file, bytes);
    }
    Ok(r)
}

// ---------- Shaping for the tab ----------

const NOT_COMPLETE: i64 = 4;
const OBSCURED: i64 = 8;
const INVISIBLE: i64 = 16;
const REDEEMED: i64 = 1;

pub struct View<'a> {
    pub r: &'a Records,
    pub m: &'a Manifest,
    pub profile: &'a Value,
}

impl View<'_> {
    fn female(&self) -> bool {
        // The most recently played character's gender picks the title's wording.
        self.profile["characters"]["data"]
            .as_object()
            .and_then(|m| m.values().max_by_key(|c| c["dateLastPlayed"].as_str().unwrap_or("").to_string()))
            .is_some_and(|c| c["genderType"].as_i64() == Some(1))
    }

    /// A record's state: the profile's copy, else the best character copy (completed first, then most progress).
    fn state(&self, hash: u32) -> Value {
        let key = hash.to_string();
        let p = &self.profile["profileRecords"]["data"]["records"][&key];
        if p.is_object() {
            return p.clone();
        }
        let mut best = Value::Null;
        let mut best_score = -1i64;
        if let Some(chars) = self.profile["characterRecords"]["data"].as_object() {
            for c in chars.values() {
                let s = &c["records"][&key];
                if !s.is_object() {
                    continue;
                }
                let done = s["state"].as_i64().unwrap_or(NOT_COMPLETE) & NOT_COMPLETE == 0;
                let progress: i64 = s["objectives"].as_array().into_iter().flatten().chain(s["intervalObjectives"].as_array().into_iter().flatten()).filter_map(|o| o["progress"].as_i64()).sum();
                let score = if done { i64::MAX } else { progress };
                if score > best_score {
                    best_score = score;
                    best = s.clone();
                }
            }
        }
        best
    }

    /// Complete as seals.report counts it: a tiered record when every tier is done (Bungie can leave flag 4 set on
    /// finished ones), else flag 4 clear, or every objective done.
    fn complete(&self, state: &Value) -> bool {
        let intervals = state["intervalObjectives"].as_array().cloned().unwrap_or_default();
        if !intervals.is_empty() {
            return intervals.iter().all(|o| o["complete"].as_bool().unwrap_or(false));
        }
        let flags = state["state"].as_i64().unwrap_or(NOT_COMPLETE);
        if flags & NOT_COMPLETE == 0 {
            return true;
        }
        let objectives = state["objectives"].as_array().cloned().unwrap_or_default();
        !objectives.is_empty() && objectives.iter().all(|o| o["complete"].as_bool().unwrap_or(false))
    }

    fn node_progress(&self, hash: u32) -> (i64, i64) {
        let key = hash.to_string();
        let mut best = (0i64, 0i64);
        let mut take = |n: &Value| {
            let (p, g) = (n["progressValue"].as_i64().unwrap_or(0), n["completionValue"].as_i64().unwrap_or(0));
            if g > 0 && (best.1 == 0 || p * best.1 > best.0 * g) {
                best = (p, g);
            }
        };
        take(&self.profile["profilePresentationNodes"]["data"]["nodes"][&key]);
        if let Some(chars) = self.profile["characterPresentationNodes"]["data"].as_object() {
            for c in chars.values() {
                take(&c["nodes"][&key]);
            }
        }
        best
    }

    fn summary(&self, hash: u32) -> Option<Value> {
        let n = self.r.nodes.get(&hash)?;
        let state = self.profile["profilePresentationNodes"]["data"]["nodes"][hash.to_string()]["state"].as_i64().unwrap_or(0);
        if state & 1 != 0 && n.name.is_empty() {
            return None;
        }
        let (progress, goal) = self.node_progress(hash);
        let mut v = json!({
            "hash": hash,
            "name": n.name,
            "icon": bungie::icon_url(&n.icon),
            "progress": progress,
            "goal": goal,
            "complete": goal > 0 && progress >= goal,
        });
        if n.completion != 0 {
            let rec = self.r.records.get(&n.completion);
            let titles = rec.map(|r| r.titles.clone()).unwrap_or_default();
            let title = titles.get(if self.female() { 1 } else { 0 }).or(titles.first()).cloned().unwrap_or_default();
            let earned = (goal > 0 && progress >= goal) || self.complete(&self.state(n.completion));
            v["title"] = json!(title);
            v["earned"] = json!(earned);
            v["gildable"] = json!(rec.is_some_and(|r| r.gildable));
        }
        Some(v)
    }

    fn summaries(&self, hashes: &[u32]) -> Vec<Value> {
        hashes.iter().filter_map(|h| self.summary(*h)).filter(|v| !v["name"].as_str().unwrap_or("").is_empty()).collect()
    }

    fn record(&self, hash: u32) -> Option<Value> {
        let d = self.r.records.get(&hash)?;
        let state = self.state(hash);
        let flags = state["state"].as_i64().unwrap_or(NOT_COMPLETE);
        if flags & INVISIBLE != 0 || d.name.is_empty() {
            return None;
        }
        let complete = self.complete(&state);
        let tiers = state["intervalObjectives"].as_array().map(|a| a.len()).unwrap_or(0);
        let tiers_done = state["intervalObjectives"].as_array().map(|a| a.iter().filter(|o| o["complete"].as_bool().unwrap_or(false)).count()).unwrap_or(0);
        let claimable = if tiers > 0 { (state["intervalsRedeemedCount"].as_i64().unwrap_or(0) as usize) < tiers_done } else { complete && flags & REDEEMED == 0 };
        // A tiered record shows its current tier's objective; others their own.
        let objectives = if tiers > 0 {
            let list = state["intervalObjectives"].as_array().cloned().unwrap_or_default();
            let current = list.iter().find(|o| !o["complete"].as_bool().unwrap_or(false)).or(list.last()).cloned();
            bungie::objectives(&json!(current.into_iter().collect::<Vec<_>>()), self.m)
        } else if state["objectives"].is_array() {
            bungie::objectives(&state["objectives"], self.m)
        } else {
            let zero: Vec<Value> = d.objectives.iter().map(|h| json!({ "objectiveHash": h, "progress": 0, "complete": false })).collect();
            bungie::objectives(&json!(zero), self.m)
        };
        Some(json!({
            "hash": hash,
            "name": d.name,
            "description": d.description,
            "icon": bungie::icon_url(&d.icon),
            "complete": complete,
            "claimable": claimable,
            "secret": flags & OBSCURED != 0,
            "score": d.score,
            "extra": d.gilding,
            "tier": if tiers > 1 { json!([tiers_done, tiers]) } else { Value::Null },
            "objectives": objectives,
        }))
    }

    fn collectible(&self, hash: u32) -> Option<Value> {
        let d = self.r.collectibles.get(&hash)?;
        let key = hash.to_string();
        let mut state = self.profile["profileCollectibles"]["data"]["collectibles"][&key]["state"].as_i64();
        if let Some(chars) = self.profile["characterCollectibles"]["data"].as_object() {
            for c in chars.values() {
                if let Some(s) = c["collectibles"][&key]["state"].as_i64() {
                    state = Some(match state {
                        Some(prev) if prev & 1 == 0 => prev,
                        _ => s,
                    });
                }
            }
        }
        let s = state.unwrap_or(1);
        if s & 4 != 0 {
            return None; // invisible
        }
        let item = self.m.items.get(&d.item);
        Some(json!({
            "hash": hash,
            "name": d.name,
            "icon": bungie::icon_url(if d.icon.is_empty() { item.map(|i| i.icon.as_str()).unwrap_or("") } else { &d.icon }),
            "source": d.source,
            "owned": s & 1 == 0,
            "tier": item.map(|i| i.tier).unwrap_or(0),
            "type": item.map(|i| i.type_name.clone()).unwrap_or_default(),
            "itemHash": d.item,
        }))
    }

    fn roots(&self) -> [u32; 5] {
        let r = &self.r.roots;
        [r.active_seals, r.legacy_seals, r.active_triumphs, r.legacy_triumphs, r.collections]
    }

    /// The overview: scores, seals (active and legacy), triumph categories, collection categories and badges.
    pub fn home(&self) -> Value {
        let r = &self.r.roots;
        let kids = |h: u32| self.r.nodes.get(&h).map(|n| n.nodes.clone()).unwrap_or_default();
        let collections: Vec<u32> = kids(r.collections).into_iter().filter(|h| *h != r.badges).collect();
        let pr = &self.profile["profileRecords"]["data"];
        json!({
            "scores": { "active": pr["activeScore"], "lifetime": pr["lifetimeScore"], "legacy": pr["legacyScore"] },
            "seals": { "active": self.summaries(&kids(r.active_seals)), "legacy": self.summaries(&kids(r.legacy_seals)) },
            "triumphs": { "active": self.summaries(&kids(r.active_triumphs)), "legacy": self.summaries(&kids(r.legacy_triumphs)) },
            "collections": { "categories": self.summaries(&collections), "badges": self.summaries(&kids(r.badges)), "badgesHash": r.badges },
        })
    }

    /// One node: its summary and description, the way back up (crumbs), its sub-nodes, triumphs and collectibles.
    pub fn node(&self, hash: u32) -> Option<Value> {
        let n = self.r.nodes.get(&hash)?;
        let mut summary = self.summary(hash)?;
        summary["description"] = json!(n.description);
        let roots = self.roots();
        let mut crumbs = Vec::new();
        let mut at = n.parent;
        let mut section = "";
        for _ in 0..8 {
            if at == 0 {
                break;
            }
            let r = &self.r.roots;
            if at == r.active_seals || at == r.legacy_seals {
                section = "seals";
            } else if at == r.active_triumphs || at == r.legacy_triumphs {
                section = "triumphs";
            } else if at == r.collections {
                section = "collections";
            }
            if roots.contains(&at) {
                break;
            }
            let Some(p) = self.r.nodes.get(&at) else { break };
            crumbs.push(json!({ "hash": at, "name": p.name }));
            at = p.parent;
        }
        crumbs.reverse();
        let r = &self.r.roots;
        let legacy = at == r.legacy_seals || at == r.legacy_triumphs;
        let badge = n.parent == r.badges || crumbs.first().and_then(|c| c["hash"].as_u64()).is_some_and(|h| h as u32 == r.badges);
        Some(json!({
            "node": summary,
            "section": if badge { "badge" } else { section },
            "legacy": legacy,
            "crumbs": crumbs,
            "children": self.summaries(&n.nodes),
            "records": n.records.iter().filter_map(|h| self.record(*h)).collect::<Vec<_>>(),
            "collectibles": n.collectibles.iter().filter_map(|h| self.collectible(*h)).collect::<Vec<_>>(),
        }))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_records_and_counts_completion_like_the_site() {
        let raw = br#"{"5":{"displayProperties":{"name":"Flawless","description":"","icon":""},"objectiveHashes":[1],
            "completionInfo":{"ScoreValue":20},"forTitleGilding":true,"titleInfo":{"hasTitle":true,"titlesByGender":{"Male":"A","Female":"B"}}}}"#;
        let parsed: HashMap<u32, RawRecord> = parse(raw, "triumphs").unwrap();
        let r = &parsed[&5];
        assert_eq!((r.completion_info.score_value, r.for_title_gilding, r.title_info.titles_by_gender.female.as_str()), (20, true, "B"));

        let defs = Records::default();
        let m = Manifest::default();
        let profile = Value::Null;
        let v = View { r: &defs, m: &m, profile: &profile };
        // Tiered: done when every tier is, even with flag 4 still set.
        assert!(v.complete(&json!({ "state": 4, "intervalObjectives": [{ "complete": true }, { "complete": true }] })));
        assert!(!v.complete(&json!({ "state": 0, "intervalObjectives": [{ "complete": true }, { "complete": false }] })));
        // Plain: flag 4 clear, or every objective done.
        assert!(v.complete(&json!({ "state": 0 })));
        assert!(v.complete(&json!({ "state": 4, "objectives": [{ "complete": true }] })));
        assert!(!v.complete(&json!({ "state": 4, "objectives": [{ "complete": false }] })));
    }
}
