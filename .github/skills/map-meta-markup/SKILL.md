---
name: mapml-meta-markup
description: Tells you how to correctly create and edit the markup for a <map-meta> element. Use it when generating MapML output markup in an HTML page or XHTML MapML document.
---

## Required Attributes
- `name` - Metadata property name
- `content` - Metadata value

The `<map-meta>` element should always use closing tag, `<map-meta name="foo" content="bar"></map-meta>` and should not use the XML self-closing style of markup `<map-meta name="foo" content="bar" />`.  The element must always be empty/ takes no content besides attributes.

## Common Metadata Properties
- `projection` - Coordinate reference system. Corresponding `content` attribute value must be one of the MapML-defined values `OSMTILE`,`CBMTILE`,`WGS84` or `APSTILE`, or a custom value defined at runtime.  
- `zoom` - Zoom level constraints.  When `zoom` is used,
`content` is a micro grammar of comma-separated name=value keywords "(min=minimum zoom value,max=maximum zoom value,)(value=current zoom value)" i.e. you can omit the min=n,max=n+m part of the content, but you must at least provide `value=2` (for example).
- `extent` - Spatial bounds.  The corresponding `content` value specifies the bounds using `top-left-{axisName}=n.nnn,top-left-{otherAxisName}=n.nnn,bottom-right={axisName}=n.nnn,bottom-right-{axisName}=n.nnn` micro syntax, where `{axisName}` is replaced by the lower-case name of the axis used by the bbox from a coordinate system defined by the projection. e.g. for a gcrs coordinate system in the OSMTILE projection you could use `latitude` and `longitude` or `easting` and `northing`.  Coordinate systems' axis names must not be mixed i.e. you can't use pcrs axis names in one corner and gcrs axis names in the other.  Using the axis names here allows the `extent` value to be defined in one coordinate system but does not affect the coordinate system used by features as established by the `cs` meta parameter below. i.e. they are independent.
- `cs` - Coordinate system identifier used by <map-geometry> elements if not explicitly specified on the element with a `cs` attribute.

## Optional Attributes
- Attributes vary based on the metadata type

## Constraints
- Can be child of `<map-layer>` or  `<map-extent>` or loaded in a remote MapML document as part of a templated response to a `rel=features` link or as part of a MapML response to a templated request for a tile e.g. as established by `<map-link rel="tile" type="text/mapml" tref="...">`
- Used to provide metadata about the map or layer

## Example
```html
<map-meta name="projection" content="OSMTILE"></map-meta>
<map-meta name="zoom" content="min=0,max=18,value=10"></map-meta>
<map-meta name="extent" content="top-left-longitude=-180,top-left-latitude=90,bottom-right-longitude=180,bottom-right-latitude=-90"></map-meta>
```

