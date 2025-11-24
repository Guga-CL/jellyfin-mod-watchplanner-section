### Updated README

Work in progress — this project is not ready for general use.

A basic example of modding the Jellyfin home page with a lightweight Watchplanner section, using a JavaScript injector and a secure server-side write path via Caddy + PowerShell.

---

## Jellyfin mod: Watchplanner section

Lightweight Watchplanner UI for Jellyfin, injected via JavaScript Injector. It adds a weekly grid and lets admins persist the shared configuration to disk with a simple, secure POST.

---

### Overview

- **UI injection:** Adds a Mon–Sun grid to the Jellyfin home screen and basic admin tools to assign series per day.
- **Shared config:** Writes to a server-side JSON file (`server-config.json`) via a secure endpoint proxied by Caddy to a PowerShell script.
- **Fallbacks:** Static `watchplanner-config.json` for first load; localStorage can be used during development.
- **Static assets path:** Served from `/web/mods/jellyfin-mod-watchplanner-section` so Jellyfin can load them directly.

---

### Files

- **watchplanner-client.js:** Client UI and logic for the planner.
- **watchplanner-styles.css:** Styles for the Watchplanner UI.
- **watchplanner-config.json:** Static config fallback read by the client.
- **js-injector.js:** Injector snippet that loads the mod files (via JavaScript Injector plugin or other injection method).
- **scripts/update_config.ps1:** PowerShell script that updates the server-side JSON (`config/server-config.json`) with the POST payload.
- **config/server-config.json:** Shared configuration file persisted on the server.

---

### Server-side write path with Caddy + PowerShell

- **Route:** Clients POST to `/update-config`.
- **Gateway:** Caddy matches requests with a secret token in the `Authorization` header.
- **Action:** Caddy executes `scripts/update_config.ps1` with the raw JSON body; the script merges payload keys into `serverWeekGrid` and writes the result to `config/server-config.json`.
- **Response:** Script returns a compact JSON status (`{"success":true|false,"message":"..."}`) which Caddy forwards to the client.

#### Caddyfile snippet (token-protected)

```caddyfile
handle /update-config {
    @auth header Authorization <your-secret-token>
    route @auth {
        exec {
            command "powershell.exe"
            args -NoProfile -ExecutionPolicy Bypass -File "D:/Bibliotecas/OneDrive/Scripts/Jellyfin/mods/jellyfin-mod-watchplanner-section/scripts/update_config.ps1" "{http.request.body}"
        }
        respond "{exec.stdout}" 200
    }
    respond "Unauthorized" 401
}
```

- Replace `<your-secret-token>` with a long, random secret.
- Caddy runs as a service (e.g., via NSSM) with logging enabled; exec output will be captured automatically.

#### PowerShell script behavior (summary)

- Accepts the JSON body as a string.
- Merges payload keys into `serverWeekGrid`.
- Writes `config/server-config.json` with UTF-8 encoding.
- Returns a JSON status string.

---

### Client usage

Send updates with the token header:

```js
fetch('/update-config', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': '<your-secret-token>'
  },
  body: JSON.stringify({
    monday: ["Movie A", "Movie B"],
    tuesday: ["Show X"]
  })
});
```

On success:
```json
{"success":true,"message":"Configuration updated successfully."}
```

On error:
```json
{"success":false,"message":"<error details>"}
```

---

### Development notes

- **Static asset placement:** Put the mod files in:
  `C:\Program Files\Jellyfin\Server\jellyfin-web\mods\jellyfin-mod-watchplanner-section\`
  so they’re served at `/web/mods/jellyfin-mod-watchplanner-section`.
- **Injector:** Use `js-injector.js` to load the client JS/CSS and optional static JSON. The injector can be delivered via a JavaScript Injector plugin or another method.
- **Persistence:** With the secure Caddy route in place, the client can POST updates that apply server-wide; during early dev, localStorage remains an option.


---

### Security

- **Required:** A strong `Authorization` header token enforced by Caddy. Without it, any reachable client could trigger the script.
- **Do not commit secrets:** Keep the token out of the repo. Generate locally and configure it in your Caddyfile.
- **Optional hardening:** Limit route by IP, add rate limiting, and validate payload shape before writing.

---

### Status

Work in progress. The architecture now relies on:
- UI injected assets served by Jellyfin’s web root.
- Caddy reverse proxy enforcing a token and executing PowerShell for writes.
- No Jellyfin plugin required for persistence.