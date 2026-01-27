# MapMLify AI Coding Instructions

## Project Overview
MapMLify is a client-side web application that converts OGC WMS (Web Map Service) capabilities documents into functional MapML map viewers. It uses the `@maps4html/mapml` web components to create interactive map experiences directly in the browser.

**⚠️ Before coding: Read your available skills/tools to understand what capabilities you have for file editing, searching, running commands, etc.**

## Architecture & Key Concepts

### Core Data Flow
1. **Fetch WMS Capabilities** ([main.js](../src/script/main.js#L83-L106)): Attempts direct fetch first, falls back to CORS proxy (`https://corsproxy.io/?`)
2. **Parse XML Capabilities** ([main.js](../src/script/main.js#L112-L269)): Extracts service info, layers, styles, CRS/SRS, bounding boxes, GetFeatureInfo formats
3. **Generate MapML** ([main.js](../src/script/main.js#L620-L770)): Dynamically creates `<mapml-viewer>`, `<map-layer>`, `<map-extent>`, `<map-input>`, `<map-link>` elements
4. **Render Interactive Maps**: MapML web components handle rendering, interaction, and GetFeatureInfo queries

### WMS Version Handling
The app supports WMS 1.1.1 and 1.3.0, with critical differences:
- **Parameter names**: 1.3.0 uses `CRS`/`I`/`J`, 1.1.1 uses `SRS`/`X`/`Y`
- **BBOX ordering**: WMS 1.3.0 with EPSG:4326 requires lat,lon order (ymin,xmin,ymax,xmax); all other CRS use standard xmin,ymin,xmax,ymax ([main.js](../src/script/main.js#L540-L548))
- Check version with `version.startsWith('1.3')` pattern throughout codebase

### Projection System
Four projections are supported, mapped from WMS CRS to MapML units:
- `EPSG:3857` → `OSMTILE` (Web Mercator) - default
- `EPSG:3978` → `CBMTILE` (Canada Lambert Conformal Conic)
- `EPSG:4326` / `CRS:84` → `WGS84` (Geographic)
- `EPSG:5936` → `APSTILE` (Arctic Polar Stereographic)

Coordinate transformation uses `wgs84ToWebMercator()` for OSMTILE ([main.js](../src/script/main.js#L6-L11)).

### MapML Structure Pattern
Every layer creates this DOM structure:
```html
<mapml-viewer projection="OSMTILE" controls>
  <map-layer label="Layer Title" checked>
    <map-link rel="license" href="..." />
    <map-link rel="legend" href="..." />
    <map-extent units="OSMTILE">
      <map-input name="xmin" type="location" units="pcrs" axis="easting" position="top-left" />
      <!-- ... more inputs for ymin, xmax, ymax, w, h, i, j ... -->
      <map-select name="style"><!-- if styles exist --></map-select>
      <map-link rel="image" tref="...{xmin},{ymin},{xmax},{ymax}..." />
      <map-link rel="query" tref="..." data-query-link="true" /><!-- if queryable -->
    </map-extent>
  </map-layer>
</mapml-viewer>
```

## Development Workflows

### Running the App
```bash
npm run serve  # Starts http-server on port 8000
# Navigate to http://localhost:8000/src/index.html
```

### Code Formatting
```bash
npm run format        # Format all JS files
npm run format:check  # Check formatting without changes
```

### Testing WMS Services
- Preset URLs are loaded from [capabilities.txt](../src/capabilities.txt) with format: `Label,URL` or just `URL`
- Test both direct fetch and CORS proxy scenarios
- Verify behavior across WMS versions (1.1.1 vs 1.3.0)

## Project-Specific Conventions

### State Management
- `currentWmsBaseUrl`: Stores base URL (without query params) for building GetMap/GetFeatureInfo requests
- `currentUsedProxy`: Boolean flag indicating if CORS proxy was needed
- Layer index (`data-layer-index`) links checkboxes to viewer containers

### Dynamic UI Updates
When users change dropdowns (style, format, projection), the app:
1. Updates preview thumbnails immediately ([main.js](../src/script/main.js#L408-L414))
2. If viewer is active, calls `removeViewerForLayer()` then `createViewerForLayer()` to rebuild ([main.js](../src/script/main.js#L421-L432))

Never attempt partial DOM updates to existing viewers - always rebuild.

### Query Support Pattern
- GetFeatureInfo links use `data-query-link="true"` attribute for identification
- Toggle queries by adding/removing `<map-link rel="query">` elements ([main.js](../src/script/main.js#L566-L610))
- Format selection affects `INFO_FORMAT` parameter in query template URL

### License & Legend Links
- License links extracted from WMS `<Attribution>` elements, with service-level fallback ([main.js](../src/script/main.js#L124-L135))
- Legend links added before `<map-extent>` per MapML spec; only first legend per style used ([main.js](../src/script/main.js#L960-L978))

## Critical Implementation Details

### Template URL Construction
Build WMS URLs manually as strings to preserve MapML template variables like `{xmin}`, `{w}`, etc.:
```javascript
let tref = `${currentWmsBaseUrl}?SERVICE=WMS&VERSION=${version}&REQUEST=GetMap&LAYERS=${encodeURIComponent(layer.name)}&WIDTH={w}&HEIGHT={h}...`;
// DON'T use URLSearchParams - it will encode the curly braces
```

### Basemap Layer Configuration
Each projection has specific basemap configuration with zoom inputs, tile matrix inputs, and tile URLs ([main.js](../src/script/main.js#L640-L764)). OSMTILE uses dual tile links for geometry and labels. WGS84 has no basemap currently.

### GetFeatureInfo Coordinate Parameters
Map click coordinates use different parameter names:
- WMS 1.3.0: `&I={i}&J={j}`
- WMS 1.1.1: `&X={i}&Y={j}`

## Common Pitfalls

1. **Don't modify existing viewer DOM**: Always remove and recreate viewers when changing configuration
2. **BBOX ordering matters**: WMS 1.3.0 + EPSG:4326 is the ONLY case requiring lat,lon order
3. **Encode layer names**: Use `encodeURIComponent(layer.name)` in URL construction
4. **Root CRS inheritance**: Layers inherit CRS from root `<Capability><Layer>` ([main.js](../src/script/main.js#L148-L153))
5. **Map-input attributes**: Location inputs should NOT have min/max attributes ([main.js](../src/script/main.js#L863-L870))

## File Organization
- [src/index.html](../src/index.html): Entry point with MapML polyfill import
- [src/script/main.js](../src/script/main.js): All application logic (1027 lines)
- [src/style/main.css](../src/style/main.css): Styling for UI controls and map viewers
- [src/capabilities.txt](../src/capabilities.txt): Preset WMS URLs for testing
