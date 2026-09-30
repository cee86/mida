// The floating site controls: back, forward, reload, site home and open in your browser for the
// site on show. Uses the same bridge (window.hub) as the shell; the app only accepts the
// navigation actions from here.
"use strict";

const $ = (id) => document.getElementById(id);
let state = null;

function apply() {
  applyTheme(state.prefs);
  document.documentElement.dataset.autohide = String(Boolean(state.prefs.controlsAutohide));
  const status = state.statuses[state.activeId];
  $("progress").dataset.on = String(Boolean(status?.loading));
}

for (const action of ["back", "forward", "reload", "home", "external"]) {
  $(action).addEventListener("click", () => hub.nav(action));
}
hub.onState((next) => {
  state = next;
  apply();
});
hub.onStatus((id, status) => {
  if (!state) return;
  state.statuses[id] = status;
  if (id === state.activeId) $("progress").dataset.on = String(Boolean(status.loading));
});
hub.getState().then((initial) => {
  state = initial;
  apply();
});
