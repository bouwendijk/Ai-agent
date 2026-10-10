# FinSight-server

FinSight op eigen hosting: de complete app, je eigen database en de bunq-sync —
zonder afhankelijkheid van claude.ai of een AI-sleutel.

## Hoe het werkt

- `server.js` serveert de app (`app.html`, hetzelfde bestand als de claude.ai-versie)
  en biedt een kleine API: documenten-opslag, login en een bunq-proxy.
- De app merkt zelf dat hij op een eigen server draait en gebruikt dan deze API
  in plaats van de claude.ai-opslag. Dedupliceren en labelen gebeurt ín de app,
  dus er is maar één plek met die logica.
- **Sync bij openen**: zodra je de app opent haalt de server (max. 1× per 10 min)
  je nieuwste bunq-transacties op — de app is dus altijd actueel.
- Je bunq-sleutel staat alléén als omgevingsvariabele op de server, nooit in de app.

## Omgevingsvariabelen

| Naam | Verplicht | Uitleg |
|---|---|---|
| `APP_PASSWORD` | ja | wachtwoord waarmee je in de app inlogt |
| `DATABASE_URL` | ja (productie) | Postgres-verbinding; zonder → lokale map `./data` (alleen voor tests) |
| `BUNQ_API_KEY` | nee | zonder werkt alles behalve de automatische bunq-sync |

## Lokaal draaien

```bash
cd finsight-server
npm install
APP_PASSWORD=test node server.js   # http://localhost:3000
```

## App bijwerken

`app.html` is een kopie van het app-bestand (zelfde bestand als op claude.ai).
Nieuwe versie van de app? Vervang `app.html` en push — Render deployt automatisch.
