---
name: mapml-input-markup
description: Tells you how to correctly create and edit the markup for a <map-input> element. Use it when generating MapML output markup in an HTML page.
---
# MapML `<map-input>` Element Markup Constraints

## Purpose
Document constraints and guidelines for generating valid `<map-input>` elements.

When generating a `<map-input>` element in an HTML file, the closing tag `</map-input>` MUST be used.  The `<map-input>...</map-input>` form of markup does not harm the parsing process when using the XML parser, so the HTML form of the element should be used when generating the the element in a standalone (remote) XML-encoded MapML document (`text/mapml`).

## Required Attributes
- `name` - Variable name used in templated URLs
- `type` - Input type (defines the input's purpose)

## Input Types
- `zoom` - Zoom level variable
- `location` - Geographic location, used to serialize one axis of a point relative to the bounding box of either the viewport or a tile.
- `width` - Width dimension of the bounding box 
- `height` - Height dimension of the bounding box 
- `hidden` - Hidden/constant value. Used for things like access tokens

## Optional Attributes (type-dependent)
- `min` - Minimum value for zoom, or location axis. In the case of location axis, `min` and `max` can be used together on orthogonal axes to establish the bounding box outside of which requests should not be allowed.  Such limits are essential
to minimize or constrain server load
- `max` - Maximum value for zoom, or location axis. See `min`.
- `value` - Default/initial value of a `zoom` input, which is required to know what the `min` and `max` values mean (are located) for associated (via variable-associated `<map-link tref={varname}>`s) location inputs, because `row` and `column` values' meaning (location coordinates) are `zoom`-dependent.
- `axis` - Axis name (for location types)
- `units` - Unit coordinate system - values include `pcrs`,`tcrs`,`gcrs`,`tile`,`map`
- `position` - The relative position.  Legal values include `top-left`,`bottom-right`. Other values, are theoretically possible, but are not supported at this time.

## Constraints
- Must be child of `<map-extent>`
- `name` value must correspond to variables used in `<map-link tref="{name}">`
- Zoom inputs typically require `min`, `max`, and `value` attributes

## Common Patterns

### Zoom Input
```html
<map-input name="z" type="zoom" min="0" max="18" value="0"></map-input>
```

### Location Inputs
```html
<map-input name="x" type="location" units="tilematrix" axis="column"></map-input>
<map-input name="y" type="location" units="tilematrix" axis="row"></map-input>
```

### Query Click Position Inputs (for WMS GetFeatureInfo)
For `<map-link rel="query">` links, pixel coordinates within the viewport are required:
```html
<map-input name="i" type="location" units="map" axis="i"></map-input>
<map-input name="j" type="location" units="map" axis="j"></map-input>
```

**Important**: 
- `units="map"` provides viewport pixel coordinates (origin at top-left)
- `axis="i"` is the horizontal axis (image width)
- `axis="j"` is the vertical axis (image height)
- These correspond to the WMS GetFeatureInfo `I/J` (WMS 1.3.0) or `X/Y` (WMS 1.1.1) parameters
- Do NOT use `units="tile"` for WMS queries (that's for WMTS tile-based services)

## Notes
- 
