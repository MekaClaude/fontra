/**
 * Development auto-registration for the Cadence Spacer plugin.
 *
 * Paste this into the browser console on the editor page:
 *
 *   javascript:(()=>{const k="fontra.pluginsplugins";const p="/localplugins/cadence-spacer/";const a=JSON.parse(localStorage.getItem(k)||"[]");if(!a.some(x=>(x.address||"").includes("cadence-spacer"))){a.push({address:p});localStorage.setItem(k,JSON.stringify(a));location.reload();}})();
 *
 * The storage layout matches `ObservableController.synchronizeWithLocalStorage`:
 * the key is `<prefix><modelKey>` (i.e. "fontra.plugins" + "plugins") and the
 * value is the JSON-encoded array of `{ address }` plugin records.
 */
(function autoRegisterCadenceSpacer() {
  const STORAGE_KEY = "fontra.pluginsplugins";
  const PLUGIN_ADDRESS = "/localplugins/cadence-spacer/";

  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const plugins = raw ? JSON.parse(raw) : [];

    const alreadyRegistered = plugins.some(
      (plugin) =>
        plugin && typeof plugin.address === "string" &&
        plugin.address.includes("cadence-spacer")
    );

    if (!alreadyRegistered) {
      plugins.push({ address: PLUGIN_ADDRESS });
      localStorage.setItem(STORAGE_KEY, JSON.stringify(plugins));
      console.log("[Cadence Spacer] Plugin auto-registered. Reloading to activate...");
      setTimeout(() => location.reload(), 500);
    }
  } catch (e) {
    console.warn("[Cadence Spacer] Auto-registration failed:", e);
  }
})();
