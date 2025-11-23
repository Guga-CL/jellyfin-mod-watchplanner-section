### README

An basic example on how to mod the home page of Jellyfin, making use of the jellyfin API, and implement using just a javascript injector.

# jellyfin-mod-watchplanner-section

Lightweight Watch Planner UI for Jellyfin, injected via JavaScript Injector.

Overview

- Adds a week grid (Mon–Sun) to the Jellyfin home page.
- Admins can search for a series and assign it to a day.
- Static fallback config at watchplanner-config.json; localStorage fallback for saves during development.
- Injector serves assets from /web/mods/jellyfin-mod-watchplanner-section.


Files

- watchplanner-client.js — client UI and logic
- watchplanner-styles.css — UI styles
- watchplanner-config.json — static config fallback
- js-injector.js — injector snippet used to load the mod files maybe using a javascript injector jellyfin plugin or something else.

  
Development notes

- Place the mod files at: 
- `C:\Program Files\Jellyfin\Server\jellyfin-web\mods\jellyfin-mod-watchplanner-section\`
That way the server exposes them at 
`.../web/mods/jellyfin-mod-watchplanner-section`
- For server-wide persistence implement a small Jellyfin plugin that exposes GET/POST at /watchplanner/config; until then saves persist per-browser in localStorage.
