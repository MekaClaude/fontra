import TriangleGuardianPanel from "./triangle-guardian-panel.js";
import { registerLayer } from "./triangle-guardian-layer.js";

export function registerPlugin(editor, pluginPath) {
  registerLayer(editor);
  editor.addSidebarPanel(new TriangleGuardianPanel(editor), "right");
}
