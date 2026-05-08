/**
 * Development auto-registration for Triangle Guardian plugin.
 * Run this in the browser console once, or include via a bookmarklet:
 *
 * javascript:(()=>{const k="fontra.plugins";const d=JSON.parse(localStorage.getItem(k)||'{"plugins":[]}');if(!d.plugins.find(p=>p.address.includes("triangle-guardian"))){d.plugins.push({address:"/localplugins/triangle-guardian/"});localStorage.setItem(k,JSON.stringify(d));location.reload();}})();
 */

// Auto-register on first load
(function autoRegisterTriangleGuardian() {
  const STORAGE_KEY = "fontra.plugins";
  const PLUGIN_ADDRESS = "/localplugins/triangle-guardian/";

  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const data = raw ? JSON.parse(raw) : { plugins: [] };

    const alreadyRegistered = data.plugins.some(
      (p) => p.address && p.address.includes("triangle-guardian")
    );

    if (!alreadyRegistered) {
      data.plugins.push({ address: PLUGIN_ADDRESS });
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
      console.log(
        "[Triangle Guardian] Plugin auto-registered. Reloading to activate..."
      );
      setTimeout(() => location.reload(), 500);
    }
  } catch (e) {
    console.warn("[Triangle Guardian] Auto-registration failed:", e);
  }
})();
