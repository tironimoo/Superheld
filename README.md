# Überheld

Ein Ego-Perspektive-Rollenspiel für Kinder: Erschaffe deinen eigenen Helden und steuere ihn in echter 3D-Ich-Perspektive durch eine magische Fantasy-Welt. Besiege umherstreifende, dich verfolgende Wicht-Füchse, sammle Sterne ⭐ und schalte damit immer stärkere Superkräfte frei – bis du zum mächtigsten **ÜBERHELD** aufgestiegen bist!

## Features

- 🦸 Eigener Held mit wählbarem Aussehen und Namen
- 🎮 Echte 3D-Ego-Perspektive: Joystick zum Laufen, Wischen zum Umschauen, Button zum Zaubern
- 🦊 Bewegte, animierte Gegner mit echter KI: sie streifen umher, bemerken den Spieler, verfolgen ihn (mit Lauf-Animation) und greifen aus der Nähe an
- ❤️ Herzen-/Gesundheitssystem: Kontakt mit Gegnern kostet Herzen (mit kurzer Unverwundbarkeit danach), Herzen regenerieren automatisch – bei 0 gibt es eine kurze Verschnaufpause statt eines "Game Over"
- 🔥❄️⚡💪🌈🦋 Sechs Superkräfte, die einzeln von Stufe 1 bis 5 ausgebaut werden können, als Zauber im 3D-Kampf einsetzbar (mit großzügigem Ziel-Lock-on)
- ⭐ Belohnungssystem: Sterne durch besiegte Gegner und eingesammelte Sternchen verdienen, in Kräfte investieren
- 👑 Aufsteigendes Rangsystem (Anfänger → Kraftpaket → Held → Superheld → Meisterheld → ÜBERHELD)
- 🏆 Sammelbare Erfolge
- 🎯 Sehr einfacher Schwierigkeitsgrad: keine echte Verlierbedingung, Schutzzeit beim Start, ständige kleine Belohnungen
- 🎨 Deutlich verbesserte 3D-Grafik auf Basis von **three.js**: echte Materialien, Schatten, Nebel, Punktlicht an den Kristallen, ein animiertes 3D-Fuchsmodell, ein echtes Baummodell mit magischen Glow-Blüten und leuchtende Glow-Sprites
- 📱 Vollständig touch-optimiert für Handy und Tablet, als installierbare Web-App (PWA), auch offline spielbar
- 💾 Fortschritt wird automatisch lokal gespeichert

## Grafik- & Code-Credits

- **[three.js](https://github.com/mrdoob/three.js)** (MIT-Lizenz) – die 3D-Engine (`vendor/three/`), inkl. GLTFLoader/OBJLoader
- **Bodentextur & Glow-Sprite** – aus dem `examples/`-Ordner von three.js (MIT-Lizenz)
- **Baummodell** (`assets/tree.obj`) – aus dem `examples/`-Ordner von three.js (MIT-Lizenz)
- **Fuchs-Gegnermodell** (`assets/models/fox.glb`, mit Lauf-/Renn-/Spähen-Animationen) – Basismodell [CC0 von PixelMannen](https://opengameart.org/content/fox-and-shiba), Rigging/Animation CC-BY 4.0 von [tomkranis (Sketchfab)](https://sketchfab.com/models/371dea88d7e04a76af5763f2a36866bc), glTF-Konvertierung via [KhronosGroup/glTF-Sample-Models](https://github.com/KhronosGroup/glTF-Sample-Models)
- Alle übrige Grafik (Kristalle, Sterne, Held-Icons, Boden-Formgebung) ist prozedural mit three.js-Geometrien erzeugt

## Starten

Einfach lokal hosten (wegen ES-Modulen/Fetch reicht `index.html` per Doppelklick nicht):

```bash
python3 -m http.server 8000
```

und dann `http://localhost:8000` auf dem Handy/Tablet im Browser öffnen. Über "Zum Home-Bildschirm hinzufügen" lässt sich das Spiel wie eine App installieren.

## Dateien

- `index.html` – Struktur der App, lädt three.js per Import-Map
- `style.css` – Fantasy-Look & responsives, touch-freundliches HUD-Layout (inkl. Herzen-Anzeige)
- `state.js` – Spieldaten (Kräfte, Ränge, Erfolge) und Speicherstand
- `game.js` – die three.js-Ego-Perspektive-Engine: Bewegung, Kamera, Gegner-KI, Zaubern, Gesundheit, Rendering
- `ui.js` – Heldenerstellung, HUD, Pause-Menü, Belohnungs-Overlays
- `vendor/three/` – lokal eingebundenes three.js samt Loadern
- `assets/` – Texturen, Baummodell, Fuchs-Gegnermodell
- `manifest.json`, `sw.js`, `icon.svg` – PWA-Unterstützung für Installation auf Mobilgeräten
