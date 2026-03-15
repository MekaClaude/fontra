import { SpacingStudioPanel } from "./src/spacing-studio-panel.js";

export function registerPlugin(editor, pluginPath) {
  editor.addSidebarPanel(new SpacingStudioPanel(editor), "right");
}
