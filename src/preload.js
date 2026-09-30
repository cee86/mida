// The only bridge between the shell page and the app. It exposes a short, fixed list of
// actions; the shell gets no other access to the computer. Module pages have no preload.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("hub", {
  getState: () => ipcRenderer.invoke("state:get"),
  setStageRect: (rect) => ipcRenderer.send("stage:rect", rect),
  setOverlay: (open) => ipcRenderer.send("overlay", open === true),
  select: (id) => ipcRenderer.send("module:select", id),
  nav: (action) => ipcRenderer.send("nav", action),
  moduleMenu: (id) => ipcRenderer.send("module:menu", id),
  toggleSidebar: () => ipcRenderer.send("sidebar:toggle"),
  finishFirstRun: (ids) => ipcRenderer.invoke("firstrun:finish", ids),
  addFromCatalogue: (id) => ipcRenderer.invoke("module:add-catalogue", id),
  addCustom: (name, url) => ipcRenderer.invoke("module:add-custom", { name, url }),
  onState: (callback) => ipcRenderer.on("state", (_e, state) => callback(state)),
  onStatus: (callback) => ipcRenderer.on("status", (_e, id, status) => callback(id, status)),
});
