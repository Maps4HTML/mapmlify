---
name: mapml-link-markup
description: Tells you how to correctly create and edit the markup for a <map-link> element. Use it when generating MapML output markup in an HTML page.
---

# MapML `<map-link>` Element Markup Constraints

## Purpose
Document constraints and guidelines for generating valid `<map-link>` elements.

## Required Attributes
- `rel` - Relationship type of the link
- Either `href` (static URL) OR `tref` (templated URL)

When the `<map-link>` is found outside of the `<map-extent>` element content, it is not "templated", it is "static", and must not contain the `tref` attribute, and must contain the `href` attribute.

## Templated Link Relationship Types (`rel`)
- `tile` - Raster or vector tile resource (depends on the `type` attribute value)
- `image` - Static image resource that covers the whole viewport
- `features` - Vector features resource that covers the whole viewport
- `query` - Query endpoint templated link (e.g., WMS GetFeatureInfo)

### Query Link Requirements
When generating a `rel="query"` link for WMS GetFeatureInfo:

1. **Template Variables**: Ensure `<map-input>` elements exist for ALL template variables used in the `tref`:
   - Bounding box: `{xmin}`, `{ymin}`, `{xmax}`, `{ymax}`
   - Dimensions: `{w}`, `{h}`
   - Click position: `{i}`, `{j}` (pixel coordinates within the image)

2. **INFO_FORMAT Parameter**: Always include the `INFO_FORMAT` parameter in the query URL template, set to the desired response format (e.g., `text/html`, `application/json`, `text/plain`). This should match a format advertised in the WMS capabilities document.

3. **WMS Version-Specific Parameters**:
   - **WMS 1.3.0**: Use `I={i}&J={j}` for click position parameters
   - **WMS 1.1.1 and earlier**: Use `X={i}&Y={j}` for click position parameters
   - The parameter names changed between WMS versions

4. **QUERY_LAYERS Parameter**: Must be included and typically matches the `LAYERS` parameter value. This specifies which layer(s) to query for feature information.

5. **Coordinate Reference System**: Use the same CRS/SRS parameter as the corresponding `rel="image"` link.

6. **Click Position Inputs**: The `{i}` and `{j}` variables require corresponding `<map-input>` elements with:
   - `type="location"`
   - `units="map"` (viewport pixel coordinates)
   - `axis="i"` and `axis="j"` respectively

**Example WMS 1.3.0 Query Link:**
```html
<map-link rel="query" tref="https://example.com/wms?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetFeatureInfo&LAYERS=mylayer&QUERY_LAYERS=mylayer&CRS=EPSG:3857&BBOX={xmin},{ymin},{xmax},{ymax}&WIDTH={w}&HEIGHT={h}&INFO_FORMAT=text/html&I={i}&J={j}"></map-link>
```

**Example WMS 1.1.1 Query Link:**
```html
<map-link rel="query" tref="https://example.com/wms?SERVICE=WMS&VERSION=1.1.1&REQUEST=GetFeatureInfo&LAYERS=mylayer&QUERY_LAYERS=mylayer&SRS=EPSG:4326&BBOX={xmin},{ymin},{xmax},{ymax}&WIDTH={w}&HEIGHT={h}&INFO_FORMAT=application/json&X={i}&Y={j}"></map-link>
```

## Static Link Relationship Types (`rel`)
- `license` - License information
- `alternate` - Alternate representation
- `stylesheet` - CSS stylesheet or PMTiles stylesheet module (depends on the `type` attribute)

## Optional Attributes
- `type` - MIME type of the resource
- `tms` - Boolean, for TMS tile ordering

## Constraints
- Must be child of `<map-extent>` or `<map-layer>`
- `tref` values can use variable substitution with `{variableName}` syntax
- Variables in `tref` must have corresponding `<map-input>` elements

When generating a `<map-link>` element, the closing tag `</map-link>` MUST be used even if the element permits no content. Never use the empty element `<map-link type="..." />` (XML) form of markup.  The `<map-link>...</map-link>` form of markup does not harm the parsing process when using the XML parser, so the HTML form of the element should be used when generating the the element both in HTML documents ("inline") and in a standalone ("remote:) XHTML XML-encoded MapML document (`text/mapml`).

## Example
```html
<!-- Templated tile link -->
<map-link rel="tile" tref="https://example.com/tiles/{z}/{x}/{y}.png"></map-link>

<!-- Static link -->
<map-link rel="license" href="https://example.com/license.html"></map-link>
```

## Notes
- 
