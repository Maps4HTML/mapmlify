---
name: mapml-extent-markup
description: Tells you how to correctly create and edit the markup for a <map-extent> element. Use it when generating MapML output markup in an HTML page.
---

## Required Attributes
- `units` - Coordinate reference system (e.g., "OSMTILE", "WGS84", "CBMTILE", "APSTILE")

## Optional Attributes
- `checked` - Boolean, whether extent is initially enabled
- `hidden` - boolean, hides or shows the extent in the layer control as a "sub-layer" (underneath a layer)
- `label` - string, used to provide non-default label for the sub-layer controls in the layer control

## Child Elements
- `<map-input>` - Required, defines variable inputs for templated URLs
- `<map-link>` - Provides templated URLs for links to tiles, images, features, or queries


## Constraints
- Must be child of `<map-layer>`, either inline or remote
- Must contain one or more `<map-link>` element(s)
- Must contain `<map-input>` elements that define ALL the variables contained in a child `<map-link tref="...{variable}...">` `tref` value
- The `units` value must match one of the supported projection values OR a string that identifies a custom projection defined at runtime.

## Supported Units/Projections
- `OSMTILE` - Web Mercator tile grid, based on EPSG:3857
- `WGS84` - Geographic coordinates, based on CRS:84
- `CBMTILE` - Canada Base Map tile grid based on EPSG:3978
- `APSTILE` - Alaska Polar Stereographic, based on EPSG:5936

## Example
```html
<map-extent units="OSMTILE" label="Example tiled sub-layer, default checked, not hidden" checked>
  <map-input name="z" type="zoom" min="0" max="18" value="0"></map-input>
  <map-link rel="tile" tref="https://example.com/tiles/{z}/{y}/{x}.png"></map-link>
</map-extent>
```

## Notes
- 
