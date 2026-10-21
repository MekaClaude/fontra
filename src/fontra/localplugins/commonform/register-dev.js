/**
 * Development auto-registration for the Commonform plugin.
 *
 * Paste this into the browser console on the editor page:
 *
 *   javascript:(()=>{const k="fontra.pluginsplugins";const p="/localplugins/commonform/";const a=JSON.parse(localStorage.getItem(k)||"[]");if(!a.some(x=>(x.address||"").includes("commonform"))){a.push({address:p});localStorage.setItem(k,JSON.stringify(a));location.reload();}})();
 *
 * The storage layout matches `ObservableController.synchronizeWithLocalStorage`:
 * the key is `<prefix><modelKey>` (i.e. "fontra.plugins" + "plugins") and the
 * value is the JSON-encoded array of `{ address }` plugin records.
 */
(function autoRegisterCommonform() {
  const STORAGE_KEY = "fontra.pluginsplugins";
  const PLUGIN_ADDRESS = "/localplugins/commonform/";

  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const plugins = raw ? JSON.parse(raw) : [];

    const alreadyRegistered = plugins.some(
      (plugin) =>
        plugin && typeof plugin.address === "string" &&
        plugin.address.includes("commonform")
    );

    if (!alreadyRegistered) {
      plugins.push({ address: PLUGIN_ADDRESS });
      localStorage.setItem(STORAGE_KEY, JSON.stringify(plugins));
      console.log("[Commonform] Plugin auto-registered. Reloading to activate...");
      setTimeout(() => location.reload(), 500);
    }
  } catch (e) {
    console.warn("[Commonform] Auto-registration failed:", e);
  }
})();
