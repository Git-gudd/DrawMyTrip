# DrawMyTrip

A map of every place on the trip, coloured by day. The page reads its data from
`data/locations.json`, so pushing a new version of that file updates the map.

## Using the page

- **No days yet:** every stop shows in pink. Click a stop (on the map or in the list) to open it in the sidebar.
- **Planning days:** set a stop's **Day** in the sidebar. Once any stop has a day, the day selector appears at the bottom of the map. Pick a day (or press `Q` / `E`, or `1`–`9`, `0` for all) to highlight its stops and grey out the rest.
- **Distances:** a selected day shows its route in visiting order, with the distance of each leg. A selected stop shows dashed lines to its 3 nearest stops, and the sidebar lists the distance to every other stop. All distances are straight-line, so travel by road is usually longer.
- **Visiting order:** stops in a day are ordered by *Stop order in the day* if you set it, then by best time (morning, afternoon, evening), then by their order in the file.
- **Editing:** change any value in the sidebar, or drag a selected pin to move it. Edits are kept in your browser until you export them.
- **Saving:** click **Export data**, copy the text, paste it over the contents of `data/locations.json`, then commit and push.

## Data format

```json
{
  "trip": { "name": "Bangkok", "startDate": "2026-12-05", "days": 4, "hoursPerDay": 10 },
  "locations": [
    {
      "id": "wat-arun",
      "name": "Wat Arun",
      "category": "Temple",
      "zone": "Thonburi riverside",
      "lat": 13.7437,
      "lng": 100.4888,
      "day": null,
      "order": null,
      "hours": 1,
      "priority": "Must",
      "bestTime": "Afternoon",
      "openingHours": "Daily 8:00–18:00",
      "notes": "Ferry from Tha Tien pier"
    }
  ]
}
```

- `day`: `null` while undecided, otherwise `1`, `2`, … (day 1 is `startDate`).
- `order`: `null` for automatic ordering, or a number to fix the stop's place in its day.
- `hours`: time to spend there. A day's total turns red when it goes over `hoursPerDay`.
- To find coordinates, right-click a place in Google Maps and click the numbers at the top of the menu to copy them.

## Hosting

The site is plain HTML with no build step. To publish it with GitHub Pages, go to
**Settings → Pages**, set **Source** to *Deploy from a branch*, choose `main` and `/ (root)`, and save.

To preview it on your computer, run `python3 -m http.server` in this folder and open
<http://localhost:8000>. Opening `index.html` straight from disk won't work, because the browser blocks it from reading the data file.

The dark map comes from CARTO and needs a free key from <https://carto.com/basemaps/apikey>.
The key is set as `CARTO_KEY` at the top of `assets/app.js`.

Map tiles © OpenStreetMap contributors © CARTO. Leaflet and the Barlow fonts are bundled under their own licences.
