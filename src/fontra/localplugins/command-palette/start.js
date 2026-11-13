import { CommandPalette } from "./command-palette.js";

export function registerPlugin(editor, pluginPath) {
  // Guard against double registration (e.g. a plugin listed twice).
  if (editor.__commandPalette) {
    return editor.__commandPalette;
  }
  const palette = new CommandPalette(editor);
  editor.__commandPalette = palette;

  const actionExecutor = editor.actionExecutor;
  if (actionExecutor) {
    actionExecutor.registerAction(
      "action.command-palette",
      {
        topic: "action-topics.menu.view",
        titleKey: "action.command-palette",
        defaultShortCuts: [{ baseKey: "p", commandKey: true, shiftKey: true }],
        // So the shortcut also works while focus is in a text field.
        allowGlobalOverride: true,
      },
      () => palette.toggle(),
      null,
      () => "Command Palette"
    );
  } else {
    console.warn(
      "[Command Palette] editor.actionExecutor is not available; " +
        "the plugin needs a Fontra version that exposes it."
    );
  }

  return palette;
}
