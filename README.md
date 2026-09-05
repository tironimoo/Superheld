# Überheld

Ein Browser-Rollenspiel für Kinder: Erschaffe deinen eigenen Helden, sammle in kinderleichten Mini-Missionen Sterne ⭐ und schalte damit immer stärkere Superkräfte frei – bis du zum mächtigsten **ÜBERHELD** aufgestiegen bist!

## Features

- 🦸 Eigener Held mit wählbarem Aussehen und Namen
- 🔥❄️⚡💪🌈🦋 Sechs Superkräfte, die einzeln von Stufe 1 bis 5 ausgebaut werden können
- ⭐ Belohnungssystem: Sterne aus Missionen verdienen und in Kräfte investieren
- 👑 Aufsteigendes Rangsystem (Anfänger → Kraftpaket → Held → Superheld → Meisterheld → ÜBERHELD)
- 🏆 Sammelbare Erfolge
- 🎯 Drei kinderleichte, faire Mini-Spiele ohne Frustfaktor (Monster-Tippen, Farben-Zauber-Merkspiel, Sternenregen)
- 🎨 Fantasievolles, WoW-inspiriertes Design mit Glow-Effekten und Konfetti
- 📱 Vollständig touch-optimiert für Handy und Tablet, als installierbare Web-App (PWA)
- 💾 Fortschritt wird automatisch lokal gespeichert

## Starten

Einfach `index.html` in einem Browser öffnen, oder lokal hosten:

```bash
python3 -m http.server 8000
```

und dann `http://localhost:8000` auf dem Handy/Tablet im Browser öffnen. Über "Zum Home-Bildschirm hinzufügen" lässt sich das Spiel wie eine App installieren.

## Dateien

- `index.html` – Struktur der App
- `style.css` – Fantasy-Look & responsives, touch-freundliches Layout
- `app.js` – Spiellogik (Kräfte, Ränge, Missionen, Speicherstand)
- `manifest.json`, `sw.js`, `icon.svg` – PWA-Unterstützung für Installation auf Mobilgeräten
