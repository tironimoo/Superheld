# Überheld

Ein Ego-Perspektive-Rollenspiel für Kinder: Erschaffe deinen eigenen Helden und steuere ihn in echter 3D-Ich-Perspektive durch eine magische Fantasy-Welt. Besiege freche Wichte, sammle Sterne ⭐ und schalte damit immer stärkere Superkräfte frei – bis du zum mächtigsten **ÜBERHELD** aufgestiegen bist!

## Features

- 🦸 Eigener Held mit wählbarem Aussehen und Namen
- 🎮 Echte 3D-Ego-Perspektive: Joystick zum Laufen, Wischen zum Umschauen, Button zum Zaubern
- 🔥❄️⚡💪🌈🦋 Sechs Superkräfte, die einzeln von Stufe 1 bis 5 ausgebaut werden können, als Zauber im 3D-Kampf einsetzbar
- ⭐ Belohnungssystem: Sterne durch besiegte Wichte und eingesammelte Sternchen verdienen, in Kräfte investieren
- 👑 Aufsteigendes Rangsystem (Anfänger → Kraftpaket → Held → Superheld → Meisterheld → ÜBERHELD)
- 🏆 Sammelbare Erfolge
- 🎯 Sehr einfacher Schwierigkeitsgrad: großzügiges Ziel-Lock-on, keine Verlierbedingung, ständige kleine Belohnungen
- 🎨 Fantasievolles, WoW-inspiriertes Low-Poly-Design mit echten Texturen (Steinboden), einem echten 3D-Baummodell mit magischen Glow-Blüten, leuchtenden Glow-Sprites, Nebel und Konfetti – gerendert mit eigenem, leichtgewichtigem WebGL (keine externen Laufzeit-Abhängigkeiten nötig)
- 📱 Vollständig touch-optimiert für Handy und Tablet, als installierbare Web-App (PWA), auch offline spielbar
- 💾 Fortschritt wird automatisch lokal gespeichert

## Grafik-Assets

Die Bodentextur, das Baummodell (`assets/tree.obj`) und die Glow-Sprite-Textur (`assets/glow.png`) stammen aus dem quelloffenen [three.js](https://github.com/mrdoob/three.js)-Projekt (MIT-Lizenz, `examples/`-Ordner) und wurden lokal eingebunden. Alle übrige Grafik (Kristalle, Wichte, Sterne, Held-Icons, Boden-Formgebung) ist prozedural in `geometry.js` erzeugt.

## Starten

Einfach `index.html` in einem Browser öffnen, oder lokal hosten:

```bash
python3 -m http.server 8000
```

und dann `http://localhost:8000` auf dem Handy/Tablet im Browser öffnen. Über "Zum Home-Bildschirm hinzufügen" lässt sich das Spiel wie eine App installieren.

## Dateien

- `index.html` – Struktur der App
- `style.css` – Fantasy-Look & responsives, touch-freundliches HUD-Layout
- `math.js` – kleine Matrix-/Vektor-Bibliothek für die 3D-Berechnungen
- `geometry.js` – erzeugt die Low-Poly-3D-Formen (Kristalle, Wichte, Sterne, Boden, Himmel)
- `state.js` – Spieldaten (Kräfte, Ränge, Erfolge) und Speicherstand
- `world.js` – die WebGL-Ego-Perspektive-Engine: Bewegung, Kamera, Gegner, Zaubern, Rendering
- `ui.js` – Heldenerstellung, HUD, Pause-Menü, Belohnungs-Overlays
- `manifest.json`, `sw.js`, `icon.svg` – PWA-Unterstützung für Installation auf Mobilgeräten
