import TriangleGuardianPanel from "./triangle-guardian-panel.js";
import "./triangle-guardian-layer.js";

export function registerPlugin(editor, pluginPath) {
  editor.addSidebarPanel(new TriangleGuardianPanel(editor), "right");
}

