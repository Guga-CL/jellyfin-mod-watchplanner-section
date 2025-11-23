# jellyfin-mod-watchplanner-section

An basic example on how to mod the home page of Jellyfin with just an javascript injector

Simple client-side Watch Planner UI for Jellyfin.  
Loads as a mod via a web folder served from /web/mods/jellyfin-mod-watchplanner-section and is injected with JavaScript Injector.  
Features:
- Week grid (Mon–Sun) on Jellyfin home
- Admin-only editing: search Jellyfin for a series and assign it to a day
- Static fallback config stored in watchplanner-config.json
- LocalStorage fallback for saves during development
Development notes:
- Place assets in your local server files ex:
 C:\Program Files\Jellyfin\Server\jellyfin-web\mods\jellyfin-mod-watchplanner-section\ 
 so the server serves them at /web/mods/jellyfin-mod-watchplanner-section/
 obs.: "mods" is a folder you create, it's not a default jellyfin folder.
- To enable server-wide persistent saves implement a simple server endpoint /watchplanner/config (GET/POST) in a Jellyfin plugin; until then saves persist to localStorage per-browser.
- Injector script is js-injector.js in the repo; keep base path set to /web/mods/jellyfin-mod-watchplanner-section.

---
