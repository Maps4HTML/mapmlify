# MapMLify AI Coding Instructions

## Project Overview
MapMLify is a client-side web application that converts geospatial service capabilities documents into functional MapML map viewers. The objective of creating the map viewers is to copy the code for use in external web pages. It uses the `@maps4html/mapml` web components to create interactive map experiences directly in the browser, suitable for copying.

**Supported Services:**
- **OGC WMS** (Web Map Service) - versions 1.1.1 and 1.3.0
- **OGC WMTS** (Web Map Tile Service) - version 1.0.0
- **ESRI REST API MapServer** - both tiled and dynamic (export) modes
- **ESRI REST API ImageServer** - raster imagery services

**Not Yet Supported:**
- ESRI FeatureServer (vector features)
- OGC WFS (Web Feature Service)
- OGC API (Application Programming Interface) services

**⚠️ Before coding: Read your available skills/tools to understand what capabilities you have for file editing, searching, running commands, etc.**

## Architecture & Key Concepts

### Core Data Flow
1. **Fetch Capabilities** ([main.js](../src/script/main.js#L83-L106)): Attempts direct fetch first, then prompts user to save local file if CORS issues arise, presents button to read that file from disk (only if CORS issue detected).
2. **Detect Service Type** ([main.js](../src/script/main.js#L234-L270)): Identifies WMS (XML with WMS namespace), WMTS (XML with WMTS namespace), or ESRI (JSON with MapServer/ImageServer indicators)
3. **Parse Capabilities** ([main.js](../src/script/main.js#L112-L269)): Extracts service info, layers, styles, CRS/SRS, bounding boxes, query formats (GetFeatureInfo for WMS/WMTS, identify for ESRI)
4. **Generate MapML** (service-specific functions): Dynamically creates `<mapml-viewer>`, `<map-layer>`, `<map-extent>`, `<map-input>`, `<map-link>` elements
5. **Render Interactive Maps**: MapML web components handle rendering, interaction, and query operations

### Service Type Detection
Service type is detected by examining the response:
- **WMS**: XML root element `Capabilities` with WMS namespace (`http://www.opengis.net/wms`)
- **WMTS**: XML root element `Capabilities` with WMTS namespace (`http://www.opengis.net/wmts/1.0`)
- **ESRI MapServer**: JSON with `layers` array and `tileInfo` (tiled) or `supportedImageFormatTypes` (export)
- **ESRI ImageServer**: JSON with `pixelType` or `serviceDataType` containing `esriImageService`

### WMS Version Handling
The app supports WMS 1.1.1 and 1.3.0, with critical differences:
- **Parameter names**: 1.3.0 uses `CRS`/`I`/`J`, 1.1.1 uses `SRS`/`X`/`Y`
- **BBOX ordering**: WMS 1.3.0 with EPSG:4326 requires lat,lon order (ymin,xmin,ymax,ymax); all other CRS use standard xmin,ymin,xmax,ymax ([main.js](../src/script/main.js#L540-L548))
- Check version with `version.startsWith('1.3')` pattern throughout codebase

### WMTS Tile Matrix Sets
WMTS services define TileMatrixSet elements that specify zoom levels, tile sizes, and CRS:
- Extract TileMatrixSet identifier and associated TileMatrix elements ([main.js](../src/script/main.js#L393-L450))
- Map TileMatrixSet CRS to MapML projections using `mapTileMatrixSetToProjection()` ([main.js](../src/script/main.js#L376-L392))
- EPSG:4326 requires validation: must have 2×1 tiles at zoom 0 to qualify as WGS84 projection
- ResourceURL templates provide tile and FeatureInfo URL patterns with `{TileMatrix}`, `{TileRow}`, `{TileCol}` variables ([main.js](../src/script/main.js#L564-L574))

### ESRI Service Modes
ESRI MapServer can operate in two modes:
- **Tiled Mode** (`ESRI-MapServer-Tile`): Pre-generated tiles, indicated by presence of `tileInfo` in JSON
- **Export Mode** (`ESRI-MapServer`): Dynamic map generation, uses `export` endpoint with bbox parameters
- **ImageServer**: Always dynamic, uses `exportImage` endpoint

Detection logic in `detectESRIServiceType()` ([main.js](../src/script/main.js#L256-L270))

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

### Testing Services
- Preset URLs are loaded from [capabilities.txt](../src/capabilities.txt) with format: `Label,URL` or just `URL`
- Test both direct fetch and CORS proxy scenarios
- **WMS**: Verify behavior across versions (1.1.1 vs 1.3.0)
- **WMTS**: Test services with multiple TileMatrixSets and dimensions
- **ESRI**: Test both tiled and export modes for MapServer; verify ImageServer rendering
- Sample files: `nasa-imagery-wmts.xml` (WMTS), `ducks-MapServer.json` (ESRI MapServer)

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

**WMS URLs** - Build manually as strings to preserve MapML template variables:
```javascript
let tref = `${currentWmsBaseUrl}?SERVICE=WMS&VERSION=${version}&REQUEST=GetMap&LAYERS=${encodeURIComponent(layer.name)}&WIDTH={w}&HEIGHT={h}...`;
// DON'T use URLSearchParams - it will encode the curly braces
```

**WMTS URLs** - Use ResourceURL templates from capabilities, replace template variables:
```javascript
function buildWMTSTileUrl(template, layer, tileMatrixSet, style, format, zoom, row, col) {
  let url = template;
  url = url.replace(/{TileMatrixSet}/g, tileMatrixSet);
  url = url.replace(/{TileMatrix}/g, zoom);
  url = url.replace(/{TileRow}/g, row);
  url = url.replace(/{TileCol}/g, col);
  // ... replace {Style}, {Layer}, dimension parameters
}
```

**ESRI URLs** - Construct based on service type and mode:
- **MapServer Tile**: `${baseUrl}/tile/{z}/{y}/{x}`
- **MapServer Export**: `${baseUrl}/export?bbox={xmin},{ymin},{xmax},{ymax}&size={w},{h}&format=...`
- **ImageServer**: `${baseUrl}/exportImage?bbox={xmin},{ymin},{xmax},{ymax}&size={w},{h}&format=...`

### Basemap Layer Configuration
Each projection has specific basemap configuration with zoom inputs, tile matrix inputs, and tile URLs ([main.js](../src/script/main.js#L640-L764)). OSMTILE uses dual tile links for geometry and labels. WGS84 has no basemap currently.

### Query/Feature Info Handling

**WMS GetFeatureInfo** - Click coordinates use version-specific parameters:
- WMS 1.3.0: `&I={i}&J={j}`
- WMS 1.1.1: `&X={i}&Y={j}`

**WMTS GetFeatureInfo** - Uses ResourceURL templates with `{TileRow}`, `{TileCol}`, `{I}`, `{J}` parameters
- Extract from `<ResourceURL resourceType="FeatureInfo">` elements
- Info formats specified in capabilities as MIME types

**ESRI Identify** - Uses `identify` endpoint with JSON format:
- **MapServer**: `${baseUrl}/identify?geometry={i},{j}&geometryType=esriGeometryPoint&...&f=json`
- **ImageServer**: `${baseUrl}/identify?geometry={i},{j}&geometryType=esriGeometryPoint&...&f=json`
- Uses `f=json` parameter to return ESRI JSON format for broad compatibility across ArcGIS versions
- MapServer uses `returnGeometry=true`, ImageServer uses `returnCatalogItems=true`

## Common Pitfalls

1. **Don't modify existing viewer DOM**: Always remove and recreate viewers when changing configuration
2. **BBOX ordering matters**: WMS 1.3.0 + EPSG:4326 is the ONLY case requiring lat,lon order
3. **Encode layer names**: Use `encodeURIComponent(layer.name)` in URL construction
4. **Root CRS inheritance** (WMS): Layers inherit CRS from root `<Capability><Layer>` ([main.js](../src/script/main.js#L148-L153))
5. **Map-input attributes**: Location inputs should NOT have min/max attributes ([main.js](../src/script/main.js#L863-L870))
6. **WMTS dimension defaults**: When building preview URLs, replace dimension template variables with default values from capabilities
7. **ESRI coordinate systems**: ESRI services use WKID (e.g., 3857) instead of EPSG codes; extract from `spatialReference.wkid` or `latestWkid`
8. **TileMatrixSet validation**: Not all EPSG:4326 TileMatrixSets are WGS84-compatible; verify 2×1 tile structure at zoom 0
9. **Service type before parsing**: Always detect service type before attempting to parse; JSON vs XML parsers are not interchangeable

## File Organization
- [src/index.html](../src/index.html): Entry point with MapML polyfill import
- [src/script/main.js](../src/script/main.js): All application logic (1027 lines)
- [src/style/main.css](../src/style/main.css): Styling for UI controls and map viewers
- [src/capabilities.txt](../src/capabilities.txt): Preset WMS URLs for testing
