// start.js
//
// Entry point of the Commonform plugin.
//
// The editor loads this module with a *native* dynamic import and then calls
// the function named in plugin.json's "function" key, passing the
// EditorController instance and the plugin's base URL:
//
//   module[meta.function](this, pluginPath)   — src-js/views-editor/src/editor.js
//
// Because the import is native (not bundled), only *relative* imports between
// files inside this plugin folder can be used. Bare "@fontra/..." specifiers
// cannot be resolved at runtime (the page's import map only maps "fontra/"),
// so everything this plugin needs from Fontra is reached through the `editor`
// object that is handed to us.

import CommonformPanel from "./commonform-panel.js";
import { registerLayer } from "./commonform-layer.js";
import { state } from "./commonform-state.js";

export function registerPlugin(editor, pluginPath) {
  state.pluginPath = pluginPath;
  registerLayer(editor);
  editor.addSidebarPanel(new CommonformPanel(editor), "right");
}
