// The Featured page's sections, in order (v0.54, owner's scheme): an activity type when it has one (Raids, Lost
// Sectors, Crucible...), otherwise the expansion it belongs to. Shared by the card view and the list view. Pure.
// `expansion: true` sections are grouped under their own heading in the sidebar.
export const FEATURED_SECTIONS = [
  { id: "raids", title: "Raids" },
  { id: "dungeons", title: "Dungeons" },
  { id: "pinnacle", title: "Pinnacle activities" },
  { id: "lost-sectors", title: "Lost Sectors" },
  { id: "distortion", title: "Distortion" },
  { id: "crucible", title: "Crucible" },
  { id: "vendors", title: "Vendors" },
  { id: "events", title: "Events" },
  { id: "edge-of-fate", expansion: true, title: "Edge of Fate" },
  { id: "final-shape", expansion: true, title: "Final Shape" },
  { id: "lightfall", expansion: true, title: "Lightfall" },
  { id: "witch-queen", expansion: true, title: "Witch Queen" },
  { id: "anniversary", expansion: true, title: "30th Anniversary" },
  { id: "beyond-light", expansion: true, title: "Beyond Light" },
  { id: "shadowkeep", expansion: true, title: "Shadowkeep" },
  { id: "forsaken", expansion: true, title: "Forsaken" },
  { id: "misc", title: "Other" },
];

// The default view, "This week" (v0.57): only the core rotations. Each inner list is one row; sections in the same row
// sit side by side, every other section gets a line of its own.
export const LANDING_ROWS = [["raids"], ["dungeons"], ["pinnacle", "distortion", "crucible"], ["vendors"]];
export const LANDING_SECTIONS = new Set(LANDING_ROWS.flat());
