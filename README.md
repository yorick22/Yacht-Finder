# Yacht Finder

Live yacht tracking website using AIS (Automatic Identification System) data.

## Features

- Interactive dark-themed map powered by Leaflet.js
- Real-time vessel position tracking via AIS data
- Search vessels by name, MMSI, or destination
- Vessel detail sidebar with full AIS data (speed, course, heading, dimensions, etc.)
- Trail visualization showing vessel movement history
- Yacht-only filtering (sailing vessels and pleasure craft)
- Follow mode to track a vessel as it moves
- Demo mode with 40 simulated Mediterranean yachts
- Live mode via AISStream.io WebSocket API
- Multiple region presets (Mediterranean, Caribbean, North Sea, US East Coast, etc.)
- Responsive design for mobile and desktop

## Usage

### Demo Mode

Open `site/index.html` in a browser. The app starts in demo mode with simulated yacht data — no API key needed.

### Live AIS Data

1. Get a free API key at [aisstream.io](https://aisstream.io)
2. Click the settings gear icon
3. Enter your API key
4. Select "Live AIS data" and choose a region
5. Click "Save & Connect"

## Deployment

The site deploys to GitHub Pages automatically on push to `main` via the included GitHub Actions workflow.

## Tech Stack

- Vanilla JavaScript (no build step)
- Leaflet.js for maps
- CARTO dark basemap tiles
- AISStream.io WebSocket API for live data
