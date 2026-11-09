/**
 * Development auto-registration for the Fontra Tutorials plugin.
 *
 * Paste this into the browser console on the editor page:
 *
 *   javascript:(()=>{const k="fontra.pluginsplugins";const p="/localplugins/fontra-tutorials/";const a=JSON.parse(localStorage.getItem(k)||"[]");if(!a.some(x=>(x.address||"").includes("fontra-tutorials"))){a.push({address:p});localStorage.setItem(k,JSON.stringify(a));location.reload();}})();
 */
(function autoRegisterFontraTutorials() {
  const STORAGE_KEY = "fontra.pluginsplugins";
  const PLUGIN_ADDRESS = "/localplugins/fontra-tutorials/";

  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const plugins = raw ? JSON.parse(raw) : [];

    const alreadyRegistered = plugins.some(
      (plugin) =>
        plugin && typeof plugin.address === "string" &&
        plugin.address.includes("fontra-tutorials")
    );

    if (!alreadyRegistered) {
      plugins.push({ address: PLUGIN_ADDRESS });
      localStorage.setItem(STORAGE_KEY, JSON.stringify(plugins));
      console.log(
        "[Fontra Tutorials] Plugin auto-registered. Reloading to activate..."
      );
      setTimeout(() => location.reload(), 500);
    }
  } catch (e) {
    console.warn("[Fontra Tutorials] Auto-registration failed:", e);
  }
})();
