### README

Work in progress - this project is not ready for general use.

A basic example of modding the Jellyfin home page by adding a new custom "section", using a JavaScript injector.

---

## Jellyfin mod: Watchplanner section

Lightweight Watchplanner UI for Jellyfin, injected via JavaScript Injector. It adds a weekly grid and lets admins persist the shared configuration to disk using Endpoint Exposer jellyfin plugin (also work in progress)

---

### Overview

- **UI injection:** Adds a Mon–Sun grid to the Jellyfin home screen and basic admin tools to assign series per day.
- **Shared config:** Writes to a server-side JSON file (`watchplanner.json`) via Endpoint Exposer plugin.
- **Static assets path:** Served from `/web/mods/jellyfin-mod-watchplanner-section` so Jellyfin can load them directly.

---

### Main Files

- **client-ui.js:** Client UI.
- **client-api.js:** Client logic.
- **watchplanner-styles.css:** Styles for the Watchplanner UI.
- **watchplanner-config.json:** file that will need to be moved/created in a local folder using Endpoint Exposer
- **javascript-loader.js:** Injector snippet that loads the mod files (via JavaScript Injector plugin or other injection method).

### Development notes

- **Static asset placement:** Put the mod files in:
  `C:\Program Files\Jellyfin\Server\jellyfin-web\mods\jellyfin-mod-watchplanner-section\`
  so they’re served at `/web/mods/jellyfin-mod-watchplanner-section`.
- **Injector:** Use `javascript-loader.js` to load the client JS/CSS and optional static JSON. The injector can be delivered via a JavaScript Injector plugin or another method.

### Status

Work in progress. The architecture now relies on:

- UI injected assets served by Jellyfin’s web root.
