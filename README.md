A basic example of modding the Jellyfin home page by adding a new custom global "section", using a JavaScript injector and Endpoint Exposer jellyfin plugin (needed here to allow the mod to write data to disk). No changes are made to any of the server files, I just added a new "mods" folder, this is good because updates shouldn't break anything.

---

## Jellyfin mod: Watchplanner section

Watchplanner UI for Jellyfin, injected via JavaScript Injector. It adds a weekly grid and lets admins persist the shared configuration to disk using Endpoint Exposer jellyfin plugin (also work in progress), injected assets served by Jellyfin’s web root folder.

---

### Status

- Work in progress - this project is not ready for general use, but the main functions already works.
- Simple test week grid.
- Not much customizability, no settings.
- You can already search & replace the serie in the week grid, only 1 serie per week day.¹
- Clicking the images will try to start playback of the next up episode, the next unwatched episode.¹
- Highlight the current day and also auto scroll to it if on a mobile device, it has a 120 minutes delay you can adjust direct in the code -until I add a settings modal-, find in `client-ui.js`: `window.WATCHPLANNER_DAY_DELAY_MINUTES = 120`

¹ uses the jellyfin API

---

### TODO

- Instead of the image being the button, maybe add something similar to what jellyfin uses.
- Add that ball with the number of remaining episodes that you see in some jellyfin cards (I believe it's related to these divs: cardIndicators countIndicator indicator).
- Settings modal, not sure what will be included here, for now it's just the delay to change from one day of the week to the next.

---

### Overview

- **UI injection:** Adds a Mon–Sun grid to the Jellyfin home screen and basic admin tools to assign a serie per day.
- **Shared config:** Writes to a server-side JSON file (`watchplanner-config.json`) via Endpoint Exposer plugin.
- **Static assets path:** Served from `/web/mods/jellyfin-mod-watchplanner-section` so Jellyfin can load them directly.

---

### Main Assets

- **client-ui.js:** Client UI.
- **client-api.js:** Client logic.
- **watchplanner-styles.css:** Styles for the Watchplanner UI.
- **javascript-loader.js:** Injector snippet that loads the mod files (via JavaScript Injector plugin or other injection method).

### Development notes

- **Static asset placement:** Put the mod files in:
  `C:\Program Files\Jellyfin\Server\jellyfin-web\mods\jellyfin-mod-watchplanner-section\`
  so they’re served at `/web/mods/jellyfin-mod-watchplanner-section`.
- **Injector:** Use `javascript-loader.js` to load the client JS/CSS and optional static JSON. The injector can be delivered via a JavaScript Injector plugin or another method.
- **Endpoint Exposer Plugin:** https://github.com/Guga-CL/jellyfin-plugin-endpoint-exposer configured with default settings + exposed folder > relative path: "watchplanner"
