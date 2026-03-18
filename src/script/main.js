// Main application logic (CORS proxy removed - now using file upload for blocked resources)

// Format dimension name as WMS parameter (time/elevation unchanged, others get DIM_ prefix)
function formatDimensionParam(dimensionName) {
  const name = dimensionName.toLowerCase();
  if (name === 'time' || name === 'elevation') {
    return dimensionName.toUpperCase();
  }
  // Check if DIM_ is already prefixed to avoid double-prefixing
  if (name.startsWith('dim_')) {
    return dimensionName.toUpperCase();
  }
  return 'DIM_' + dimensionName.toUpperCase();
}

// Transform WGS84 coordinates to Web Mercator (EPSG:3857)
function wgs84ToWebMercator(lon, lat) {
  const x = (lon * 20037508.34) / 180;
  let y = Math.log(Math.tan(((90 + lat) * Math.PI) / 360)) / (Math.PI / 180);
  y = (y * 20037508.34) / 180;
  return { x, y };
}

// Parse ISO8601 duration string (e.g., PT10M, PT1H, P1D) and return milliseconds
function parseISO8601Duration(duration) {
  const match = duration.match(/P(?:(\d+)Y)?(?:(\d+)M)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?/);
  if (!match) return 0;
  
  const years = parseInt(match[1] || 0);
  const months = parseInt(match[2] || 0);
  const days = parseInt(match[3] || 0);
  const hours = parseInt(match[4] || 0);
  const minutes = parseInt(match[5] || 0);
  const seconds = parseFloat(match[6] || 0);
  
  // Approximate conversion (not perfect for months/years, but works for typical WMS use)
  return (
    years * 365 * 24 * 60 * 60 * 1000 +
    months * 30 * 24 * 60 * 60 * 1000 +
    days * 24 * 60 * 60 * 1000 +
    hours * 60 * 60 * 1000 +
    minutes * 60 * 1000 +
    seconds * 1000
  );
}

// Parse ISO8601 interval notation and generate array of values
// Format: start/end/period (e.g., 2026-01-19T12:00:00Z/2026-01-22T12:00:00Z/PT1H)
function parseISO8601Interval(intervalString) {
  const parts = intervalString.trim().split('/');
  if (parts.length !== 3) {
    // Not an interval, might be discrete values (comma-separated)
    return intervalString.split(',').map(v => v.trim());
  }
  
  const [startStr, endStr, periodStr] = parts;
  const startTime = new Date(startStr).getTime();
  const endTime = new Date(endStr).getTime();
  
  if (isNaN(startTime) || isNaN(endTime)) {
    console.warn('Invalid ISO8601 interval:', intervalString);
    return [];
  }
  
  // Parse the period to determine if it contains year/month components
  const periodMatch = periodStr.match(/P(?:(\d+)Y)?(?:(\d+)M)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?/);
  if (!periodMatch) {
    console.warn('Invalid ISO8601 period:', periodStr);
    return [];
  }
  
  const years = parseInt(periodMatch[1] || 0);
  const months = parseInt(periodMatch[2] || 0);
  const days = parseInt(periodMatch[3] || 0);
  const hours = parseInt(periodMatch[4] || 0);
  const minutes = parseInt(periodMatch[5] || 0);
  const seconds = parseFloat(periodMatch[6] || 0);
  
  // Detect if original format includes milliseconds
  const hasMilliseconds = startStr.includes('.');
  
  const values = [];
  let currentDate = new Date(startStr);
  const endDate = new Date(endStr);
  
  // If period includes years or months, use date arithmetic (not milliseconds)
  if (years > 0 || months > 0) {
    while (currentDate <= endDate) {
      let isoString = currentDate.toISOString();
      if (!hasMilliseconds) {
        isoString = isoString.replace(/\.\d{3}Z$/, 'Z');
      }
      values.push(isoString);
      
      // Add period using date methods to handle month/year boundaries correctly
      currentDate = new Date(currentDate);
      currentDate.setUTCFullYear(currentDate.getUTCFullYear() + years);
      currentDate.setUTCMonth(currentDate.getUTCMonth() + months);
      currentDate.setUTCDate(currentDate.getUTCDate() + days);
      currentDate.setUTCHours(currentDate.getUTCHours() + hours);
      currentDate.setUTCMinutes(currentDate.getUTCMinutes() + minutes);
      currentDate.setUTCSeconds(currentDate.getUTCSeconds() + seconds);
    }
  } else {
    // For time-only periods (hours, minutes, seconds), use millisecond arithmetic
    const periodMs = parseISO8601Duration(periodStr);
    if (periodMs === 0) {
      console.warn('Invalid period duration:', periodStr);
      return [];
    }
    
    let currentTime = startTime;
    while (currentTime <= endTime) {
      let isoString = new Date(currentTime).toISOString();
      if (!hasMilliseconds) {
        isoString = isoString.replace(/\.\d{3}Z$/, 'Z');
      }
      values.push(isoString);
      currentTime += periodMs;
    }
  }
  
  return values;
}

const wmsUrlInput = document.getElementById('wms-url');
const loadBtn = document.getElementById('load-btn');
const loadFileBtn = document.getElementById('load-file-btn');
const fileInput = document.getElementById('file-input');
const serviceInfo = document.getElementById('service-info');
const serviceDetails = document.getElementById('service-details');

let currentWmsBaseUrl = '';

// Load capabilities URLs from file on page load
async function loadCapabilitiesPresets() {
  try {
    const response = await fetch('capabilities.txt');
    const text = await response.text();
    const lines = text.split('\n').filter(line => line.trim());
    
    const datalist = document.getElementById('wms-presets');
    if (!datalist) return;
    
    // Clear existing options and populate with URLs from file
    datalist.innerHTML = '';
    lines.forEach((line) => {
      const option = document.createElement('option');
      // Check if line has label,url format
      if (line.includes(',')) {
        const commaIndex = line.indexOf(',');
        const label = line.substring(0, commaIndex).trim();
        const url = line.substring(commaIndex + 1).trim();
        option.value = url;
        option.textContent = label;
      } else {
        // Just URL, no label
        option.value = line;
      }
      datalist.appendChild(option);
    });
    
    // Leave input blank by default
    wmsUrlInput.value = '';
  } catch (error) {
    console.error('Error loading capabilities presets:', error);
  }
}

// Load presets when page loads
loadCapabilitiesPresets();

loadBtn.addEventListener('click', async () => {
  const url = wmsUrlInput.value.trim();

  if (!url) {
    alert('Please enter a WMS capabilities URL');
    return;
  }

  try {
    loadBtn.disabled = true;
    loadBtn.textContent = 'Loading...';
    // Hide file upload button in case it was shown from a previous attempt
    loadFileBtn.style.display = 'none';

    await loadWMSCapabilities(url);
    
    // Clear input after successful load
    wmsUrlInput.value = '';
  } catch (error) {
    console.error('Error loading WMS capabilities:', error);
    
    // Check if it's a CORS error (typical fetch failures are TypeError)
    if (error.name === 'TypeError' && error.message.includes('fetch')) {
      alert('Failed to load WMS capabilities due to CORS restrictions.\n\nPlease download the capabilities file in another tab and use "Load from File" button.');
      loadFileBtn.style.display = 'inline-block';
    } else {
      alert('Failed to load WMS capabilities. Check console for details.');
    }
  } finally {
    loadBtn.disabled = false;
    loadBtn.textContent = 'Load Service';
  }
});

loadFileBtn.addEventListener('click', () => {
  fileInput.click();
});

fileInput.addEventListener('change', async (event) => {
  const file = event.target.files[0];
  if (!file) return;

  try {
    loadFileBtn.disabled = true;
    loadFileBtn.textContent = 'Processing...';

    const text = await file.text();
    
    // Detect if JSON or XML based on first character
    if (text.trim().startsWith('{')) {
      await processCapabilitiesJSON(text, 'file');
    } else {
      await processCapabilitiesXML(text, 'file');
    }
    
    // Clear file input and hide button after successful load
    fileInput.value = '';
    loadFileBtn.style.display = 'none';
    wmsUrlInput.value = '';
  } catch (error) {
    console.error('Error processing capabilities file:', error);
    alert('Failed to process capabilities file. Check console for details.');
  } finally {
    loadFileBtn.disabled = false;
    loadFileBtn.textContent = 'Load from File';
  }
});

function detectServiceType(xmlDoc) {
  const rootElement = xmlDoc.documentElement;
  const rootName = rootElement.localName || rootElement.nodeName;
  const namespace = rootElement.namespaceURI || '';

  if (rootName === 'Capabilities' && namespace.includes('wmts')) {
    return 'WMTS';
  } else if (rootName === 'WMS_Capabilities' || rootName === 'WMT_MS_Capabilities') {
    return 'WMS';
  }
  
  return null;
}

// Detect ESRI service type from JSON
function detectESRIServiceType(jsonData) {
  // Check for MapServer
  if (jsonData.mapName !== undefined || jsonData.layers !== undefined) {
    // Check if tiled
    if (jsonData.singleFusedMapCache === true && jsonData.tileInfo) {
      return 'ESRI-MapServer-Tile';
    }
    return 'ESRI-MapServer';
  }
  
  // Check for ImageServer
  if (jsonData.pixelType !== undefined || (jsonData.serviceDataType && jsonData.serviceDataType.includes('esriImageService'))) {
    return 'ESRI-ImageServer';
  }
  
  return null;
}

async function loadWMSCapabilities(url) {
  // Try direct fetch only - no CORS proxy
  const response = await fetch(url);
  const contentType = response.headers.get('content-type') || '';
  const text = await response.text();
  
  // Detect if JSON or XML based on content type or first character
  if (contentType.includes('application/json') || text.trim().startsWith('{')) {
    await processCapabilitiesJSON(text, url);
  } else {
    await processCapabilitiesXML(text, url);
  }
}

async function processCapabilitiesXML(xmlText, source) {
  // Parse XML
  const parser = new DOMParser();
  const xmlDoc = parser.parseFromString(xmlText, 'text/xml');

  // Check for parsing errors
  const parseError = xmlDoc.querySelector('parsererror');
  if (parseError) {
    throw new Error('XML parsing error: ' + parseError.textContent);
  }

  // Detect service type
  const serviceType = detectServiceType(xmlDoc);
  console.log('Detected service type:', serviceType);

  // Store base URL (extract from URL if it's a URL, otherwise use empty string for file uploads)
  if (source !== 'file' && typeof source === 'string') {
    currentWmsBaseUrl = source.split('?')[0];
  } else {
    // For file uploads, try to extract from XML or use empty string
    const onlineResource = xmlDoc.querySelector('Capability Request GetMap DCPType HTTP Get OnlineResource');
    if (onlineResource) {
      const href = onlineResource.getAttribute('xlink:href') || onlineResource.getAttribute('href');
      if (href) {
        currentWmsBaseUrl = href.split('?')[0];
      }
    }
  }

  if (serviceType === 'WMTS') {
    // Extract WMTS service information
    const serviceInfo = extractWMTSInfo(xmlDoc, currentWmsBaseUrl);
    // Display WMTS service information
    displayWMTSInfo(serviceInfo, source === 'file' ? 'file' : 'direct', source === 'file' ? 'file' : source);
  } else {
    // Extract WMS service information
    const serviceInfo = extractServiceInfo(xmlDoc, currentWmsBaseUrl);
    // Display WMS service information
    displayServiceInfo(serviceInfo, source === 'file' ? 'file' : 'direct', source === 'file' ? 'file' : source);
  }
}

// Process ESRI JSON capabilities
async function processCapabilitiesJSON(jsonText, source) {
  let jsonData;
  try {
    jsonData = JSON.parse(jsonText);
  } catch (error) {
    throw new Error('JSON parsing error: ' + error.message);
  }
  
  // Check for ESRI error response
  if (jsonData.error) {
    throw new Error('ESRI Service Error: ' + (jsonData.error.message || JSON.stringify(jsonData.error)));
  }
  
  // Detect ESRI service type
  const serviceType = detectESRIServiceType(jsonData);
  console.log('Detected service type:', serviceType);
  
  if (!serviceType) {
    throw new Error('Unable to detect ESRI service type from JSON response');
  }
  
  // Store base URL (remove ?f=json or ?f=pjson if present)
  if (source !== 'file' && typeof source === 'string') {
    currentWmsBaseUrl = source.split('?')[0];
  } else {
    currentWmsBaseUrl = '';
  }
  
  if (serviceType === 'ESRI-MapServer' || serviceType === 'ESRI-MapServer-Tile') {
    const serviceInfo = extractESRIMapServerInfo(jsonData, currentWmsBaseUrl);
    displayESRIMapServerInfo(serviceInfo, source === 'file' ? 'file' : 'direct', source === 'file' ? 'file' : source);
  } else if (serviceType === 'ESRI-ImageServer') {
    const serviceInfo = extractESRIImageServerInfo(jsonData, currentWmsBaseUrl);
    displayESRIImageServerInfo(serviceInfo, source === 'file' ? 'file' : 'direct', source === 'file' ? 'file' : source);
  }
}

function parseEPSGFromURN(urnString) {
  if (!urnString) return null;
  const match = urnString.match(/EPSG:.*:(\d+)/i) || urnString.match(/epsg[:\/-](\d+)/i);
  return match ? match[1] : null;
}

function mapTileMatrixSetToProjection(crsCode, firstTileMatrix = null) {
  const epsgMap = {
    '3857': 'OSMTILE',
    '900913': 'OSMTILE', // Old "Google" code for Web Mercator
    '3978': 'CBMTILE',
    '5936': 'APSTILE'
  };
  
  // EPSG:4326 requires validation - must have 2x1 tiles at zoom 0 to be WGS84
  if (crsCode === '4326' && firstTileMatrix) {
    if (firstTileMatrix.matrixWidth === 2 && firstTileMatrix.matrixHeight === 1) {
      return 'WGS84';
    }
    return null; // EPSG:4326 but not WGS84-compliant tiling scheme
  }
  
  return epsgMap[crsCode] || null;
}

function extractWMTSInfo(xmlDoc, baseUrl) {
  const owsNS = 'http://www.opengis.net/ows/1.1';
  
  function queryOWS(element, tagName) {
    return element.querySelector(tagName) || element.querySelector(`ows\\:${tagName}`) || element.querySelector(`[localName="${tagName}"]`);
  }
  
  function queryAllOWS(element, tagName) {
    const direct = Array.from(element.querySelectorAll(tagName));
    const prefixed = Array.from(element.querySelectorAll(`ows\\:${tagName}`));
    const localName = Array.from(element.querySelectorAll(`[localName="${tagName}"]`));
    return [...direct, ...prefixed, ...localName].filter((el, idx, arr) => arr.indexOf(el) === idx);
  }

  const serviceIdent = queryOWS(xmlDoc, 'ServiceIdentification');
  const title = queryOWS(serviceIdent, 'Title')?.textContent || 'N/A';
  const abstract = queryOWS(serviceIdent, 'Abstract')?.textContent || 'N/A';
  const version = xmlDoc.documentElement.getAttribute('version') || '1.0.0';

  const tileMatrixSets = {};
  const tmsElements = queryAllOWS(xmlDoc, 'TileMatrixSet');
  
  tmsElements.forEach(tmsEl => {
    const identifier = queryOWS(tmsEl, 'Identifier')?.textContent;
    // Skip TileMatrixSet elements without an Identifier (these are references, not definitions)
    if (!identifier) return;
    
    const crsURN = queryOWS(tmsEl, 'SupportedCRS')?.textContent;
    const epsgCode = parseEPSGFromURN(crsURN);
    
    const tileMatrices = [];
    const tmElements = queryAllOWS(tmsEl, 'TileMatrix');
    tmElements.forEach(tm => {
      const matrixWidth = parseInt(queryOWS(tm, 'MatrixWidth')?.textContent);
      const matrixHeight = parseInt(queryOWS(tm, 'MatrixHeight')?.textContent);
      tileMatrices.push({
        identifier: queryOWS(tm, 'Identifier')?.textContent,
        matrixWidth: matrixWidth || null,
        matrixHeight: matrixHeight || null
      });
    });
    
    // Pass first TileMatrix for validation (especially for EPSG:4326)
    const firstTileMatrix = tileMatrices.length > 0 ? tileMatrices[0] : null;
    const projection = epsgCode ? mapTileMatrixSetToProjection(epsgCode, firstTileMatrix) : null;
    
    tileMatrixSets[identifier] = {
      identifier,
      crs: crsURN,
      epsgCode,
      projection,
      supported: !!projection,
      tileMatrices
    };
  });

  const layers = [];
  const layerElements = queryAllOWS(xmlDoc, 'Layer');
  
  layerElements.forEach(layerEl => {
    const name = queryOWS(layerEl, 'Identifier')?.textContent;
    const layerTitle = queryOWS(layerEl, 'Title')?.textContent || name;
    const layerAbstract = queryOWS(layerEl, 'Abstract')?.textContent || '';
    
    const wgs84BBox = queryOWS(layerEl, 'WGS84BoundingBox');
    let minx = '-180', miny = '-90', maxx = '180', maxy = '90';
    if (wgs84BBox) {
      const lowerCorner = queryOWS(wgs84BBox, 'LowerCorner')?.textContent.split(' ');
      const upperCorner = queryOWS(wgs84BBox, 'UpperCorner')?.textContent.split(' ');
      if (lowerCorner && upperCorner) {
        minx = lowerCorner[0];
        miny = lowerCorner[1];
        maxx = upperCorner[0];
        maxy = upperCorner[1];
      }
    }
    
    const styles = [];
    const styleElements = queryAllOWS(layerEl, 'Style');
    styleElements.forEach(styleEl => {
      const styleName = queryOWS(styleEl, 'Identifier')?.textContent;
      const styleTitle = queryOWS(styleEl, 'Title')?.textContent || styleName;
      const isDefault = styleEl.getAttribute('isDefault') === 'true';
      
      // Extract LegendURL information (WMTS format uses attributes on LegendURL element)
      const legendURLs = [];
      const legendElements = styleEl.querySelectorAll('LegendURL');
      legendElements.forEach(legendEl => {
        const href = legendEl.getAttribute('xlink:href') || legendEl.getAttributeNS('http://www.w3.org/1999/xlink', 'href') || '';
        const width = legendEl.getAttribute('width');
        const height = legendEl.getAttribute('height');
        const format = legendEl.getAttribute('format');
        
        if (href) {
          legendURLs.push({ width, height, format, href });
        }
      });
      
      styles.push({ name: styleName, title: styleTitle, isDefault, legendURLs });
    });
    if (styles.length === 0) {
      styles.push({ name: 'default', title: 'Default', isDefault: true, legendURLs: [] });
    }
    
    const formats = [];
    const formatElements = queryAllOWS(layerEl, 'Format');
    formatElements.forEach(fmt => formats.push(fmt.textContent));
    
    const infoFormats = [];
    const infoFormatElements = queryAllOWS(layerEl, 'InfoFormat');
    infoFormatElements.forEach(fmt => infoFormats.push(fmt.textContent));
    
    // Extract dimensions
    const dimensions = [];
    const dimensionElements = queryAllOWS(layerEl, 'Dimension');
    dimensionElements.forEach(dimEl => {
      const dimName = queryOWS(dimEl, 'Identifier')?.textContent;
      const dimDefault = queryOWS(dimEl, 'Default')?.textContent;
      const dimUnits = queryOWS(dimEl, 'UOM')?.textContent;
      
      if (dimName) {
        // Parse all Value elements
        const valueElements = queryAllOWS(dimEl, 'Value');
        let allValues = [];
        
        valueElements.forEach(valEl => {
          const valContent = valEl.textContent.trim();
          if (valContent) {
            const parsedValues = parseISO8601Interval(valContent);
            allValues = allValues.concat(parsedValues);
          }
        });
        
        const valueCount = allValues.length;
        const usesTemplate = valueCount > 200;
        
        // If using template (>200 values), only store default value
        const values = usesTemplate ? [dimDefault || allValues[0]] : allValues;
        
        if (values.length > 0) {
          dimensions.push({
            name: dimName,
            units: dimUnits || '',
            default: dimDefault || values[0],
            values: values,
            valueCount: valueCount,
            usesTemplate: usesTemplate
          });
          console.log('Parsed WMTS dimension:', dimName, 'with', valueCount, 'total values', usesTemplate ? '(using template with default only)' : '(full value list)');
        }
      }
    });
    
    const tmsLinks = [];
    const tmsLinkElements = queryAllOWS(layerEl, 'TileMatrixSetLink');
    tmsLinkElements.forEach(link => {
      const tmsId = queryOWS(link, 'TileMatrixSet')?.textContent;
      if (tmsId && tileMatrixSets[tmsId]) {
        tmsLinks.push(tileMatrixSets[tmsId]);
      }
    });
    
    const supportedProjections = tmsLinks
      .filter(tms => tms.supported)
      .map(tms => tms.projection)
      .filter((proj, idx, arr) => arr.indexOf(proj) === idx);
    
    if (supportedProjections.length === 0) {
      return;
    }
    
    const resourceURLs = {};
    const resourceElements = queryAllOWS(layerEl, 'ResourceURL');
    resourceElements.forEach(res => {
      const resourceType = res.getAttribute('resourceType');
      const format = res.getAttribute('format');
      const template = res.getAttribute('template');
      if (!resourceURLs[resourceType]) {
        resourceURLs[resourceType] = [];
      }
      resourceURLs[resourceType].push({ format, template });
    });
    
    const queryable = infoFormats.length > 0 && resourceURLs['FeatureInfo'] && resourceURLs['FeatureInfo'].length > 0;
    
    layers.push({
      name,
      title: layerTitle,
      abstract: layerAbstract,
      bbox: { minx, miny, maxx, maxy },
      styles,
      formats,
      infoFormats,
      supportedTileMatrixSets: tmsLinks,
      supportedProjections,
      resourceURLs,
      queryable,
      licenseUrl: '',
      licenseTitle: '',
      dimensions
    });
  });

  return {
    title,
    abstract,
    version,
    tileMatrixSets,
    layers,
    baseUrl
  };
}

function extractServiceInfo(xmlDoc, baseUrl) {
  const service = xmlDoc.querySelector('Service');
  const version = xmlDoc.documentElement.getAttribute('version') || '1.3.0';

  // Extract service-level Attribution OnlineResource as fallback
  let serviceLicenseUrl = '';
  let serviceLicenseTitle = '';
  // Look for Attribution in the root Layer (Capability > Layer)
  const rootLayer = xmlDoc.querySelector('Capability > Layer');
  if (rootLayer) {
    const rootAttribution = rootLayer.querySelector(':scope > Attribution');
    if (rootAttribution) {
      serviceLicenseTitle = rootAttribution.querySelector('Title')?.textContent || '';
      const onlineResource = rootAttribution.querySelector('OnlineResource');
      if (onlineResource) {
        serviceLicenseUrl = onlineResource.getAttribute('xlink:href') || onlineResource.getAttributeNS('http://www.w3.org/1999/xlink', 'href') || '';
      }
    }
  }
  console.log('Service-level license URL:', serviceLicenseUrl || 'none', 'Title:', serviceLicenseTitle || 'none');

  // Extract GetMap image formats
  const getMapFormats = [];
  const mapFormatElements = xmlDoc.querySelectorAll('GetMap > Format');
  mapFormatElements.forEach(formatEl => {
    getMapFormats.push(formatEl.textContent);
  });

  // Extract GetFeatureInfo formats
  const getFeatureInfoFormats = [];
  const formatElements = xmlDoc.querySelectorAll('GetFeatureInfo > Format');
  formatElements.forEach(formatEl => {
    getFeatureInfoFormats.push(formatEl.textContent);
  });

  // Extract root CRS/SRS from Capability > Layer
  const rootCRS = new Set();
  if (rootLayer) {
    rootLayer.querySelectorAll(':scope > CRS, :scope > SRS').forEach(crsEl => {
      rootCRS.add(crsEl.textContent.trim());
    });
  }
  console.log('Root CRS:', Array.from(rootCRS));

  // Extract layers
  const layers = [];
  const layerElements = xmlDoc.querySelectorAll('Layer > Name');
  const seenNames = new Set();

  layerElements.forEach((nameEl) => {
    const parentLayer = nameEl.closest('Layer');
    const name = nameEl.textContent;
    const title = parentLayer.querySelector(':scope > Title')?.textContent;
    const abstract = parentLayer.querySelector(':scope > Abstract')?.textContent;
    const queryable = parentLayer.getAttribute('queryable') === '1';

    // Skip if we've already processed this layer name
    if (!name || seenNames.has(name)) return;
    seenNames.add(name);

    // Extract styles
    const styles = [];
    const styleElements = parentLayer.querySelectorAll(':scope > Style');
    styleElements.forEach(styleEl => {
      const styleName = styleEl.querySelector('Name')?.textContent;
      const styleTitle = styleEl.querySelector('Title')?.textContent;
      
      // Extract LegendURL information
      const legendURLs = [];
      const legendElements = styleEl.querySelectorAll('LegendURL');
      legendElements.forEach(legendEl => {
        const width = legendEl.getAttribute('width');
        const height = legendEl.getAttribute('height');
        const format = legendEl.querySelector('Format')?.textContent;
        const onlineResource = legendEl.querySelector('OnlineResource');
        const href = onlineResource?.getAttribute('xlink:href') || onlineResource?.getAttributeNS('http://www.w3.org/1999/xlink', 'href') || '';
        
        if (href) {
          legendURLs.push({ width, height, format, href });
        }
      });
      
      if (styleName) {
        styles.push({
          name: styleName,
          title: styleTitle || styleName,
          legendURLs
        });
      }
    });

    // Extract MetadataURL or Attribution OnlineResource for license link
    let licenseUrl = '';
    let licenseTitle = '';
    
    // Priority 1: Check for MetadataURL (layer-specific metadata)
    const metadataURL = parentLayer.querySelector(':scope > MetadataURL');
    if (metadataURL) {
      const onlineResource = metadataURL.querySelector('OnlineResource');
      if (onlineResource) {
        licenseUrl = onlineResource.getAttribute('xlink:href') || onlineResource.getAttributeNS('http://www.w3.org/1999/xlink', 'href') || '';
        const metadataType = metadataURL.getAttribute('type');
        // Append "Metadata" to type (e.g., "TC211" becomes "TC211 Metadata")
        licenseTitle = metadataType ? `${metadataType} Metadata` : 'Layer Metadata';
      }
    }
    
    // Priority 2: Check for Attribution OnlineResource if no MetadataURL
    if (!licenseUrl) {
      const attribution = parentLayer.querySelector(':scope > Attribution');
      if (attribution) {
        licenseTitle = attribution.querySelector('Title')?.textContent || '';
        const onlineResource = attribution.querySelector('OnlineResource');
        if (onlineResource) {
          licenseUrl = onlineResource.getAttribute('xlink:href') || onlineResource.getAttributeNS('http://www.w3.org/1999/xlink', 'href') || '';
        }
      }
    }
    
    // Priority 3: Use service-level license URL and title as fallback
    if (!licenseUrl && serviceLicenseUrl) {
      licenseUrl = serviceLicenseUrl;
      licenseTitle = serviceLicenseTitle;
    }

    // Extract layer-specific CRS and combine with root CRS
    const layerCRS = new Set(rootCRS);
    parentLayer.querySelectorAll(':scope > CRS, :scope > SRS').forEach(crsEl => {
      layerCRS.add(crsEl.textContent.trim());
    });

    // Map CRS to projections
    const supportedProjections = [];
    if (layerCRS.has('EPSG:3857')) supportedProjections.push('OSMTILE');
    if (layerCRS.has('EPSG:3978')) supportedProjections.push('CBMTILE');
    if (layerCRS.has('CRS:84') || layerCRS.has('EPSG:4326')) supportedProjections.push('WGS84');
    if (layerCRS.has('EPSG:5936')) supportedProjections.push('APSTILE');

    // Extract dimensions
    const dimensions = [];
    const dimensionElements = parentLayer.querySelectorAll(':scope > Dimension');
    dimensionElements.forEach(dimEl => {
      const dimName = dimEl.getAttribute('name');
      const dimDefault = dimEl.getAttribute('default');
      const dimUnits = dimEl.getAttribute('units');
      const dimContent = dimEl.textContent.trim();
      
      if (dimName && dimContent) {
        // Parse dimension values
        const values = parseISO8601Interval(dimContent);
        
        if (values.length > 0) {
          dimensions.push({
            name: dimName,
            units: dimUnits || '',
            default: dimDefault || values[0],
            values: values
          });
          console.log('Parsed dimension:', dimName, 'with', values.length, 'values');
        }
      }
    });

    // Get bounding box (try EX_GeographicBoundingBox for 1.3.0, LatLonBoundingBox for 1.1.1)
    let bbox = parentLayer.querySelector(':scope > EX_GeographicBoundingBox');
    let minx, miny, maxx, maxy;

    if (bbox) {
      minx = bbox.querySelector('westBoundLongitude')?.textContent;
      miny = bbox.querySelector('southBoundLatitude')?.textContent;
      maxx = bbox.querySelector('eastBoundLongitude')?.textContent;
      maxy = bbox.querySelector('northBoundLatitude')?.textContent;
    } else {
      bbox = parentLayer.querySelector(':scope > LatLonBoundingBox');
      if (bbox) {
        minx = bbox.getAttribute('minx');
        miny = bbox.getAttribute('miny');
        maxx = bbox.getAttribute('maxx');
        maxy = bbox.getAttribute('maxy');
      }
    }

    // Extract projection-specific BoundingBox elements
    const boundingBoxes = {};
    const bboxElements = parentLayer.querySelectorAll(':scope > BoundingBox');
    bboxElements.forEach(bboxEl => {
      const crs = bboxEl.getAttribute('CRS') || bboxEl.getAttribute('SRS');
      if (crs) {
        boundingBoxes[crs] = {
          minx: bboxEl.getAttribute('minx'),
          miny: bboxEl.getAttribute('miny'),
          maxx: bboxEl.getAttribute('maxx'),
          maxy: bboxEl.getAttribute('maxy')
        };
      }
    });

    if (minx && miny && maxx && maxy) {
      layers.push({
        name,
        title: title || name,
        abstract: abstract || '',
        bbox: { minx, miny, maxx, maxy },
        boundingBoxes,
        queryable,
        styles,
        licenseUrl,
        licenseTitle,
        supportedProjections,
        dimensions,
      });
      console.log('Layer:', name, 'Projections:', supportedProjections.join(', ') || 'none', 'Dimensions:', dimensions.length, 'BoundingBoxes:', Object.keys(boundingBoxes).join(', ') || 'none');
    }
  });

  return {
    title: service?.querySelector('Title')?.textContent || 'N/A',
    abstract: service?.querySelector('Abstract')?.textContent || 'N/A',
    version,
    layers,
    baseUrl,
    getFeatureInfoFormats,
    getMapFormats,
    serviceLicenseUrl,
  };
}

function buildWMTSTileUrl(template, layer, tileMatrixSet, style, format, zoom, row, col) {
  if (!template) return '';
  
  let url = template;
  url = url.replace(/{TileMatrixSet}/g, tileMatrixSet);
  url = url.replace(/{TileMatrix}/g, zoom);
  url = url.replace(/{TileRow}/g, row);
  url = url.replace(/{TileCol}/g, col);
  url = url.replace(/{Style}/g, style);
  url = url.replace(/{style}/g, style);
  
  if (layer && layer.name) {
    url = url.replace(/{Layer}/g, layer.name);
    url = url.replace(/{layer}/g, layer.name);
  }
  
  return url;
}

function displayWMTSInfo(info, source, url) {
  const sourceNote = source === 'file' ? '<p><em>(Loaded from file)</em></p>' : '';
  const serviceTypeBadge = '<span class="service-type-badge" style="background: #4CAF50; color: white; padding: 2px 8px; border-radius: 3px; font-size: 0.9em; margin-left: 10px;">WMTS</span>';

  const layersList = info.layers.map((layer, index) => {
    const defaultStyle = layer.styles.find(s => s.isDefault) || layer.styles[0] || { name: 'default', title: 'Default' };
    const firstTMS = layer.supportedTileMatrixSets[0];
    const tileResources = layer.resourceURLs['tile'] || [];
    const pngResource = tileResources.find(r => r.format && r.format.includes('png')) || tileResources[0];
    const tileTemplate = pngResource ? pngResource.template : '';
    let previewUrl = buildWMTSTileUrl(tileTemplate, layer, firstTMS ? firstTMS.identifier : '', defaultStyle.name, 'image/png', '2', '1', '1');
    
    // Replace dimension parameters with default values for preview
    if (layer.dimensions && layer.dimensions.length > 0) {
      layer.dimensions.forEach(function(dimension) {
        const dimPattern = new RegExp('\\{' + dimension.name + '\\}', 'g');
        previewUrl = previewUrl.replace(dimPattern, dimension.default);
      });
    }
    const queryResources = layer.resourceURLs['FeatureInfo'] || [];
    const hasQuery = layer.queryable && queryResources.length > 0;
    
    const projectionOptions = layer.supportedProjections.map(proj => {
      const selected = proj === 'OSMTILE' ? ' selected' : '';
      return '<option value="' + proj + '"' + selected + '>' + proj + '</option>';
    }).join('');
    
    const abstractHtml = layer.abstract ? '<details class="layer-abstract"><summary>Abstract</summary><p>' + layer.abstract + '</p></details>' : '';
    
    const projectionHtml = layer.supportedProjections.length > 0 ? '<div class="projection-selector"><label for="projection-' + index + '">Projection:</label><select id="projection-' + index + '" class="projection-select">' + projectionOptions + '</select></div>' : '';
    
    const queryHtml = hasQuery ? '<div class="query-format-selector"><input type="checkbox" id="query-' + index + '" class="query-checkbox" title="Enable GetFeatureInfo queries" /><label for="query-' + index + '" class="query-label">Query</label><label for="format-' + index + '">Info Format:</label><select id="format-' + index + '" class="format-select">' + layer.infoFormats.map(fmt => '<option value="' + fmt + '">' + fmt + '</option>').join('') + '</select></div>' : '';
    
    const styleOptions = layer.styles.map(style => {
      const selected = style.isDefault ? ' selected' : '';
      return '<option value="' + style.name + '"' + selected + '>' + style.title + '</option>';
    }).join('');
    
    const styleHtml = layer.styles.length > 1 ? '<div class="style-selector"><label for="style-' + index + '">Style:</label><select id="style-' + index + '" class="style-select">' + styleOptions + '</select></div>' : '';
    
    const formatOptions = layer.formats.map(fmt => {
      const selected = fmt.includes('png') ? ' selected' : '';
      return '<option value="' + fmt + '"' + selected + '>' + fmt + '</option>';
    }).join('');
    
    const formatHtml = layer.formats.length > 0 ? '<div class="format-selector"><label for="img-format-' + index + '">Image Format:</label><select id="img-format-' + index + '" class="format-select">' + formatOptions + '</select></div>' : '';
    
    // Add dimension selectors HTML
    const dimensionHtml = (layer.dimensions && layer.dimensions.length > 0) ? layer.dimensions.map((dim, dimIdx) => {
      if (dim.usesTemplate) {
        return '<div class="dimension-info"><strong>' + dim.name + ':</strong> ' + dim.default + ' <em>(fixed value - ' + dim.valueCount + ' total values)</em></div>';
      } else {
        const dimOptions = dim.values.map(val => '<option value="' + val + '"' + (val === dim.default ? ' selected' : '') + '>' + val + '</option>').join('');
        return '<div class="dimension-selector"><input type="checkbox" id="dim-enabled-' + index + '-' + dimIdx + '" class="dimension-checkbox" data-dimension-name="' + dim.name + '" checked /><label for="dim-' + index + '-' + dimIdx + '">' + dim.name + ':</label><select id="dim-' + index + '-' + dimIdx + '" class="dimension-select" data-dimension-name="' + dim.name + '">' + dimOptions + '</select></div>';
      }
    }).join('') : '';
    
    const previewHtml = previewUrl ? '<img src="' + previewUrl + '" alt="Preview of ' + layer.title + '" class="layer-preview" id="preview-' + index + '" />' : '<p>No preview available</p>';
    
    return '<div class="layer-item" data-layer-index="' + index + '" data-service-type="WMTS"><div class="layer-controls"><div class="layer-header"><input type="checkbox" id="layer-' + index + '" class="layer-checkbox" /><label for="layer-' + index + '"><strong>' + layer.title + '</strong></label></div><p class="layer-name">Identifier: ' + layer.name + '</p>' + projectionHtml + abstractHtml + '<div class="bounds-selector"><input type="checkbox" id="bounds-' + index + '" class="bounds-checkbox" title="Include layer bounds" checked /><label for="bounds-' + index + '" class="bounds-label">Include Bounds</label></div>' + queryHtml + styleHtml + formatHtml + dimensionHtml + '</div><div class="layer-viewer-container" id="viewer-container-' + index + '">' + previewHtml + '</div></div>';
  }).join('');

  const supportedCount = Object.values(info.tileMatrixSets).filter(tms => tms.supported).length;
  
  const urlNote = source !== 'file' ? '<p><strong>Loaded URL:</strong> <a href="' + url + '" target="_blank" rel="noopener noreferrer">' + url + '</a></p>' : '';
  
  serviceDetails.innerHTML = sourceNote + '<p><strong>Title:</strong> ' + info.title + ' ' + serviceTypeBadge + '</p><p><strong>Version:</strong> ' + info.version + '</p><p><strong>TileMatrixSets:</strong> ' + Object.keys(info.tileMatrixSets).length + ' (' + supportedCount + ' supported)</p><details class="service-abstract"><summary><strong>Abstract</strong></summary><p>' + info.abstract + '</p></details>' + urlNote + '<h3>Available Layers (' + info.layers.length + ')</h3><div class="layers-list">' + layersList + '</div>';

  serviceInfo.classList.remove('hidden');

  info.layers.forEach((layer, index) => {
    const checkbox = document.getElementById('layer-' + index);
    checkbox.addEventListener('change', function(e) {
      if (e.target.checked) {
        const queryCheckbox = document.getElementById('query-' + index);
        const queryEnabled = queryCheckbox ? queryCheckbox.checked : false;
        const formatSelect = document.getElementById('format-' + index);
        const selectedFormat = formatSelect ? formatSelect.value : (layer.infoFormats[0] || 'text/html');
        const styleSelect = document.getElementById('style-' + index);
        const selectedStyle = styleSelect ? styleSelect.value : (layer.styles[0] ? layer.styles[0].name : 'default');
        const imgFormatSelect = document.getElementById('img-format-' + index);
        const selectedImgFormat = imgFormatSelect ? imgFormatSelect.value : (layer.formats[0] || 'image/png');
        const projectionSelect = document.getElementById('projection-' + index);
        const selectedProjection = projectionSelect ? projectionSelect.value : 'OSMTILE';
        const boundsCheckbox = document.getElementById('bounds-' + index);
        const boundsEnabled = boundsCheckbox ? boundsCheckbox.checked : true;
        createViewerForWMTSLayer(index, layer, info, selectedFormat, queryEnabled, selectedStyle, selectedImgFormat, selectedProjection, boundsEnabled);
      } else {
        removeViewerForLayer(index);
      }
    });

    if (layer.queryable) {
      const queryCheckbox = document.getElementById('query-' + index);
      if (queryCheckbox) {
        queryCheckbox.addEventListener('change', function(e) {
          const layerCheckbox = document.getElementById('layer-' + index);
          if (layerCheckbox.checked) {
            const formatSelect = document.getElementById('format-' + index);
            const selectedFormat = formatSelect ? formatSelect.value : (layer.infoFormats[0] || 'text/html');
            const styleSelect = document.getElementById('style-' + index);
            const selectedStyle = styleSelect ? styleSelect.value : (layer.styles[0] ? layer.styles[0].name : 'default');
            const imgFormatSelect = document.getElementById('img-format-' + index);
            const selectedImgFormat = imgFormatSelect ? imgFormatSelect.value : (layer.formats[0] || 'image/png');
            const projectionSelect = document.getElementById('projection-' + index);
            const selectedProjection = projectionSelect ? projectionSelect.value : 'OSMTILE';
            
            // Find the tile matrix set for the selected projection
            const tileMatrixSet = layer.supportedTileMatrixSets.find(tms => tms.projection === selectedProjection);
            
            // Update the layer with or without query support
            updateWMTSQueryInViewer(index, layer, tileMatrixSet, e.target.checked, selectedFormat, selectedStyle, selectedImgFormat);
          }
        });
      }
    }

    const boundsCheckbox = document.getElementById('bounds-' + index);
    if (boundsCheckbox) {
      boundsCheckbox.addEventListener('change', function(e) {
        const layerCheckbox = document.getElementById('layer-' + index);
        if (layerCheckbox.checked) {
          const queryCheckbox = document.getElementById('query-' + index);
          const queryEnabled = queryCheckbox ? queryCheckbox.checked : false;
          const formatSelect = document.getElementById('format-' + index);
          const selectedFormat = formatSelect ? formatSelect.value : (layer.infoFormats[0] || 'text/html');
          const styleSelect = document.getElementById('style-' + index);
          const selectedStyle = styleSelect ? styleSelect.value : (layer.styles[0] ? layer.styles[0].name : 'default');
          const imgFormatSelect = document.getElementById('img-format-' + index);
          const selectedImgFormat = imgFormatSelect ? imgFormatSelect.value : (layer.formats[0] || 'image/png');
          const projectionSelect = document.getElementById('projection-' + index);
          const selectedProjection = projectionSelect ? projectionSelect.value : 'OSMTILE';
          removeViewerForLayer(index);
          createViewerForWMTSLayer(index, layer, info, selectedFormat, queryEnabled, selectedStyle, selectedImgFormat, selectedProjection, e.target.checked);
        }
      });
    }

    if (layer.styles && layer.styles.length > 1) {
      const styleSelect = document.getElementById('style-' + index);
      if (styleSelect) {
        styleSelect.addEventListener('change', function(e) {
          const layerCheckbox = document.getElementById('layer-' + index);
          if (layerCheckbox.checked) {
            const queryCheckbox = document.getElementById('query-' + index);
            const queryEnabled = queryCheckbox ? queryCheckbox.checked : false;
            const formatSelect = document.getElementById('format-' + index);
            const selectedFormat = formatSelect ? formatSelect.value : (layer.infoFormats[0] || 'text/html');
            const imgFormatSelect = document.getElementById('img-format-' + index);
            const selectedImgFormat = imgFormatSelect ? imgFormatSelect.value : (layer.formats[0] || 'image/png');
            const projectionSelect = document.getElementById('projection-' + index);
            const selectedProjection = projectionSelect ? projectionSelect.value : 'OSMTILE';
            const boundsCheckbox = document.getElementById('bounds-' + index);
            const boundsEnabled = boundsCheckbox ? boundsCheckbox.checked : true;
            removeViewerForLayer(index);
            createViewerForWMTSLayer(index, layer, info, selectedFormat, queryEnabled, e.target.value, selectedImgFormat, selectedProjection, boundsEnabled);
          }
        });
      }
    }

    if (layer.formats && layer.formats.length > 0) {
      const imgFormatSelect = document.getElementById('img-format-' + index);
      if (imgFormatSelect) {
        imgFormatSelect.addEventListener('change', function(e) {
          const layerCheckbox = document.getElementById('layer-' + index);
          if (layerCheckbox.checked) {
            const queryCheckbox = document.getElementById('query-' + index);
            const queryEnabled = queryCheckbox ? queryCheckbox.checked : false;
            const formatSelect = document.getElementById('format-' + index);
            const selectedFormat = formatSelect ? formatSelect.value : (layer.infoFormats[0] || 'text/html');
            const styleSelect = document.getElementById('style-' + index);
            const selectedStyle = styleSelect ? styleSelect.value : (layer.styles[0] ? layer.styles[0].name : 'default');
            const projectionSelect = document.getElementById('projection-' + index);
            const selectedProjection = projectionSelect ? projectionSelect.value : 'OSMTILE';
            const boundsCheckbox = document.getElementById('bounds-' + index);
            const boundsEnabled = boundsCheckbox ? boundsCheckbox.checked : true;
            removeViewerForLayer(index);
            createViewerForWMTSLayer(index, layer, info, selectedFormat, queryEnabled, selectedStyle, e.target.value, selectedProjection, boundsEnabled);
          }
        });
      }
    }

    if (layer.supportedProjections && layer.supportedProjections.length > 0) {
      const projectionSelect = document.getElementById('projection-' + index);
      if (projectionSelect) {
        projectionSelect.addEventListener('change', function(e) {
          const layerCheckbox = document.getElementById('layer-' + index);
          if (layerCheckbox.checked) {
            const queryCheckbox = document.getElementById('query-' + index);
            const queryEnabled = queryCheckbox ? queryCheckbox.checked : false;
            const formatSelect = document.getElementById('format-' + index);
            const selectedFormat = formatSelect ? formatSelect.value : (layer.infoFormats[0] || 'text/html');
            const styleSelect = document.getElementById('style-' + index);
            const selectedStyle = styleSelect ? styleSelect.value : (layer.styles[0] ? layer.styles[0].name : 'default');
            const imgFormatSelect = document.getElementById('img-format-' + index);
            const selectedImgFormat = imgFormatSelect ? imgFormatSelect.value : (layer.formats[0] || 'image/png');
            const boundsCheckbox = document.getElementById('bounds-' + index);
            const boundsEnabled = boundsCheckbox ? boundsCheckbox.checked : true;
            removeViewerForLayer(index);
            createViewerForWMTSLayer(index, layer, info, selectedFormat, queryEnabled, selectedStyle, selectedImgFormat, e.target.value, boundsEnabled);
          }
        });
      }
    }
    
    // Add event listeners to dimension selectors and checkboxes
    if (layer.dimensions && layer.dimensions.length > 0) {
      layer.dimensions.forEach((dim, dimIdx) => {
        if (!dim.usesTemplate) {
          const dimensionSelect = document.getElementById('dim-' + index + '-' + dimIdx);
          const dimensionCheckbox = document.getElementById('dim-enabled-' + index + '-' + dimIdx);
          
          if (dimensionSelect) {
            dimensionSelect.addEventListener('change', function(e) {
              const layerCheckbox = document.getElementById('layer-' + index);
              if (layerCheckbox.checked) {
                const queryCheckbox = document.getElementById('query-' + index);
                const queryEnabled = queryCheckbox ? queryCheckbox.checked : false;
                const formatSelect = document.getElementById('format-' + index);
                const selectedFormat = formatSelect ? formatSelect.value : (layer.infoFormats[0] || 'text/html');
                const styleSelect = document.getElementById('style-' + index);
                const selectedStyle = styleSelect ? styleSelect.value : (layer.styles[0] ? layer.styles[0].name : 'default');
                const imgFormatSelect = document.getElementById('img-format-' + index);
                const selectedImgFormat = imgFormatSelect ? imgFormatSelect.value : (layer.formats[0] || 'image/png');
                const projectionSelect = document.getElementById('projection-' + index);
                const selectedProjection = projectionSelect ? projectionSelect.value : 'OSMTILE';
                const boundsCheckbox = document.getElementById('bounds-' + index);
                const boundsEnabled = boundsCheckbox ? boundsCheckbox.checked : true;
                // Recreate viewer with new dimension value
                removeViewerForLayer(index);
                createViewerForWMTSLayer(index, layer, info, selectedFormat, queryEnabled, selectedStyle, selectedImgFormat, selectedProjection, boundsEnabled);
              }
            });
          }
          
          if (dimensionCheckbox) {
            dimensionCheckbox.addEventListener('change', function(e) {
              const layerCheckbox = document.getElementById('layer-' + index);
              if (layerCheckbox.checked) {
                const queryCheckbox = document.getElementById('query-' + index);
                const queryEnabled = queryCheckbox ? queryCheckbox.checked : false;
                const formatSelect = document.getElementById('format-' + index);
                const selectedFormat = formatSelect ? formatSelect.value : (layer.infoFormats[0] || 'text/html');
                const styleSelect = document.getElementById('style-' + index);
                const selectedStyle = styleSelect ? styleSelect.value : (layer.styles[0] ? layer.styles[0].name : 'default');
                const imgFormatSelect = document.getElementById('img-format-' + index);
                const selectedImgFormat = imgFormatSelect ? imgFormatSelect.value : (layer.formats[0] || 'image/png');
                const projectionSelect = document.getElementById('projection-' + index);
                const selectedProjection = projectionSelect ? projectionSelect.value : 'OSMTILE';
                const boundsCheckbox = document.getElementById('bounds-' + index);
                const boundsEnabled = boundsCheckbox ? boundsCheckbox.checked : true;
                // Recreate viewer when dimension is enabled/disabled
                removeViewerForLayer(index);
                createViewerForWMTSLayer(index, layer, info, selectedFormat, queryEnabled, selectedStyle, selectedImgFormat, selectedProjection, boundsEnabled);
              }
            });
          }
        }
      });
    }
  });
}

function displayServiceInfo(info, source, loadedUrl) {
  const sourceNote = source === 'file'
    ? '<p><em>(Loaded from file)</em></p>'
    : '';
  const serviceTypeBadge = '<span class="service-type-badge" style="background: #2196F3; color: white; padding: 2px 8px; border-radius: 3px; font-size: 0.9em; margin-left: 10px;">WMS</span>';

  const formatOptions = info.getFeatureInfoFormats.map(fmt => 
    `<option value="${fmt}">${fmt}</option>`
  ).join('');

  const layersList = info.layers
    .map(
      (layer, index) => `
    <div class="layer-item" data-layer-index="${index}">
      <div class="layer-controls">
        <div class="layer-header">
          <input type="checkbox" id="layer-${index}" class="layer-checkbox" />
          <label for="layer-${index}"><strong>${layer.title}</strong></label>
        </div>
        <p class="layer-name">Name: ${layer.name}</p>
        ${layer.supportedProjections && layer.supportedProjections.length > 0 ? `
        <div class="projection-selector">
          <label for="projection-${index}">Projection:</label>
          <select id="projection-${index}" class="projection-select">
            ${layer.supportedProjections.map(proj => `<option value="${proj}"${proj === 'OSMTILE' ? ' selected' : ''}>${proj}</option>`).join('')}
          </select>
        </div>
        ` : ''}
        ${layer.abstract ? `
        <details class="layer-abstract">
          <summary>Abstract</summary>
          <p>${layer.abstract}</p>
        </details>
        ` : ''}
        <div class="bounds-selector">
          <input type="checkbox" id="bounds-${index}" class="bounds-checkbox" title="Include layer bounds (disable if WMS bounds are incorrect)" checked />
          <label for="bounds-${index}" class="bounds-label">Include Bounds</label>
        </div>
        ${layer.queryable ? `
        <div class="query-format-selector">
          <input type="checkbox" id="query-${index}" class="query-checkbox" title="Enable GetFeatureInfo queries" />
          <label for="query-${index}" class="query-label">Query</label>
          <label for="format-${index}">Info Format:</label>
          <select id="format-${index}" class="format-select">
            ${formatOptions}
          </select>
        </div>
        ` : ''}
        ${layer.styles && layer.styles.length > 0 ? `
        <div class="style-selector">
          <label for="style-${index}">Style:</label>
          <select id="style-${index}" class="style-select">
            ${layer.styles.map(style => `<option value="${style.name}">${style.title}</option>`).join('')}
          </select>
        </div>
        ` : ''}
        ${layer.dimensions && layer.dimensions.length > 0 ? layer.dimensions.map((dim, dimIdx) => `
        <div class="dimension-selector">
          <input type="checkbox" id="dim-enabled-${index}-${dimIdx}" class="dimension-checkbox" data-dimension-name="${dim.name}" checked />
          <label for="dim-${index}-${dimIdx}">${dim.name}:</label>
          <select id="dim-${index}-${dimIdx}" class="dimension-select" data-dimension-name="${dim.name}">
            ${dim.values.map(val => `<option value="${val}"${val === dim.default ? ' selected' : ''}>${val}</option>`).join('')}
          </select>
        </div>
        `).join('') : ''}
        ${info.getMapFormats && info.getMapFormats.length > 0 ? `
        <div class="format-selector">
          <label for="img-format-${index}">Image Format:</label>
          <select id="img-format-${index}" class="format-select">
            ${info.getMapFormats.map(fmt => `<option value="${fmt}"${fmt.includes('png') ? ' selected' : ''}>${fmt}</option>`).join('')}
          </select>
        </div>
        ` : ''}
      </div>
      <div class="layer-viewer-container" id="viewer-container-${index}">
        <img 
          src="${buildGetMapUrl(info.baseUrl, layer, info.version, layer.styles && layer.styles.length > 0 ? layer.styles[0].name : '')}" 
          alt="Preview of ${layer.title}"
          class="layer-preview"
          id="preview-${index}"
        />
      </div>
    </div>
  `
    )
    .join('');

  serviceDetails.innerHTML = `
    ${sourceNote}
    <p><strong>Title:</strong> ${info.title} ${serviceTypeBadge}</p>
    <p><strong>Version:</strong> ${info.version}</p>
    <details class="service-abstract">
      <summary><strong>Abstract</strong></summary>
      <p>${info.abstract}</p>
    </details>
    ${source !== 'file' ? `<p><strong>Loaded URL:</strong> <a href="${loadedUrl}" target="_blank" rel="noopener noreferrer">${loadedUrl}</a></p>` : ''}
    <h3>Available Layers</h3>
    <div class="layers-list">
      ${layersList}
    </div>
  `;

  serviceInfo.classList.remove('hidden');

  // Add event listeners to layer checkboxes
  info.layers.forEach((layer, index) => {
    const checkbox = document.getElementById(`layer-${index}`);
    checkbox.addEventListener('change', (e) => {
      if (e.target.checked) {
        const queryCheckbox = document.getElementById(`query-${index}`);
        const queryEnabled = queryCheckbox ? queryCheckbox.checked : false;
        const formatSelect = document.getElementById(`format-${index}`);
        const selectedFormat = formatSelect ? formatSelect.value : info.getFeatureInfoFormats[0];
        const styleSelect = document.getElementById(`style-${index}`);
        const selectedStyle = styleSelect ? styleSelect.value : (layer.styles && layer.styles.length > 0 ? layer.styles[0].name : '');
        const imgFormatSelect = document.getElementById(`img-format-${index}`);
        const selectedImgFormat = imgFormatSelect ? imgFormatSelect.value : (info.getMapFormats && info.getMapFormats.length > 0 ? info.getMapFormats[0] : 'image/png');
        const projectionSelect = document.getElementById(`projection-${index}`);
        const selectedProjection = projectionSelect ? projectionSelect.value : 'OSMTILE';
        const boundsCheckbox = document.getElementById(`bounds-${index}`);
        const boundsEnabled = boundsCheckbox ? boundsCheckbox.checked : true;
        createViewerForLayer(index, layer, info.version, selectedFormat, queryEnabled, selectedStyle, selectedImgFormat, selectedProjection, boundsEnabled);
      } else {
        removeViewerForLayer(index);
      }
    });

    // Add event listener to query checkbox if layer is queryable
    if (layer.queryable) {
      const queryCheckbox = document.getElementById(`query-${index}`);
      queryCheckbox.addEventListener('change', (e) => {
        const layerCheckbox = document.getElementById(`layer-${index}`);
        if (layerCheckbox.checked) {
          const formatSelect = document.getElementById(`format-${index}`);
          const selectedFormat = formatSelect ? formatSelect.value : info.getFeatureInfoFormats[0];
          // Update the layer with or without query support
          updateLayerQueryInViewer(index, layer.name, e.target.checked, layer, info.version, selectedFormat);
        }
      });

      // Add event listener to format dropdown
      const formatSelect = document.getElementById(`format-${index}`);
      if (formatSelect) {
        formatSelect.addEventListener('change', (e) => {
          const layerCheckbox = document.getElementById(`layer-${index}`);
          const queryCheckbox = document.getElementById(`query-${index}`);
          if (layerCheckbox.checked && queryCheckbox.checked) {
            const styleSelect = document.getElementById(`style-${index}`);
            const selectedStyle = styleSelect ? styleSelect.value : (layer.styles && layer.styles.length > 0 ? layer.styles[0].name : '');
            // Update query link with new format
            updateLayerQueryInViewer(index, layer.name, true, layer, info.version, e.target.value);
          }
        });
      }
    }

    // Add event listener to bounds checkbox
    const boundsCheckbox = document.getElementById(`bounds-${index}`);
    if (boundsCheckbox) {
      boundsCheckbox.addEventListener('change', (e) => {
        const layerCheckbox = document.getElementById(`layer-${index}`);
        if (layerCheckbox.checked) {
          const queryCheckbox = document.getElementById(`query-${index}`);
          const queryEnabled = queryCheckbox ? queryCheckbox.checked : false;
          const formatSelect = document.getElementById(`format-${index}`);
          const selectedFormat = formatSelect ? formatSelect.value : info.getFeatureInfoFormats[0];
          const styleSelect = document.getElementById(`style-${index}`);
          const selectedStyle = styleSelect ? styleSelect.value : (layer.styles && layer.styles.length > 0 ? layer.styles[0].name : '');
          const imgFormatSelect = document.getElementById(`img-format-${index}`);
          const selectedImgFormat = imgFormatSelect ? imgFormatSelect.value : (info.getMapFormats && info.getMapFormats.length > 0 ? info.getMapFormats[0] : 'image/png');
          const projectionSelect = document.getElementById(`projection-${index}`);
          const selectedProjection = projectionSelect ? projectionSelect.value : 'OSMTILE';
          // Recreate viewer with new bounds setting
          removeViewerForLayer(index);
          createViewerForLayer(index, layer, info.version, selectedFormat, queryEnabled, selectedStyle, selectedImgFormat, selectedProjection, e.target.checked);
        }
      });
    }

    // Add event listener to style selector if available
    if (layer.styles && layer.styles.length > 0) {
      const styleSelect = document.getElementById(`style-${index}`);
      if (styleSelect) {
        styleSelect.addEventListener('change', (e) => {
          // Update thumbnail
          const preview = document.getElementById(`preview-${index}`);
          if (preview) {
            preview.src = buildGetMapUrl(info.baseUrl, layer, info.version, e.target.value);
          }
          
          // Update viewer if it's checked
          const layerCheckbox = document.getElementById(`layer-${index}`);
          if (layerCheckbox.checked) {
            const queryCheckbox = document.getElementById(`query-${index}`);
            const queryEnabled = queryCheckbox ? queryCheckbox.checked : false;
            const formatSelect = document.getElementById(`format-${index}`);
            const selectedFormat = formatSelect ? formatSelect.value : info.getFeatureInfoFormats[0];
            const imgFormatSelect = document.getElementById(`img-format-${index}`);
            const selectedImgFormat = imgFormatSelect ? imgFormatSelect.value : (info.getMapFormats && info.getMapFormats.length > 0 ? info.getMapFormats[0] : 'image/png');
            const projectionSelect = document.getElementById(`projection-${index}`);
            const selectedProjection = projectionSelect ? projectionSelect.value : 'OSMTILE';
            const boundsCheckbox = document.getElementById(`bounds-${index}`);
            const boundsEnabled = boundsCheckbox ? boundsCheckbox.checked : true;
            // Recreate viewer with new style
            removeViewerForLayer(index);
            createViewerForLayer(index, layer, info.version, selectedFormat, queryEnabled, e.target.value, selectedImgFormat, selectedProjection, boundsEnabled);
          }
        });
      }
    }

    // Add event listener to image format selector if available
    if (info.getMapFormats && info.getMapFormats.length > 0) {
      const imgFormatSelect = document.getElementById(`img-format-${index}`);
      if (imgFormatSelect) {
        imgFormatSelect.addEventListener('change', (e) => {
          const layerCheckbox = document.getElementById(`layer-${index}`);
          if (layerCheckbox.checked) {
            const queryCheckbox = document.getElementById(`query-${index}`);
            const queryEnabled = queryCheckbox ? queryCheckbox.checked : false;
            const formatSelect = document.getElementById(`format-${index}`);
            const selectedFormat = formatSelect ? formatSelect.value : info.getFeatureInfoFormats[0];
            const styleSelect = document.getElementById(`style-${index}`);
            const selectedStyle = styleSelect ? styleSelect.value : (layer.styles && layer.styles.length > 0 ? layer.styles[0].name : '');
            const projectionSelect = document.getElementById(`projection-${index}`);
            const selectedProjection = projectionSelect ? projectionSelect.value : 'OSMTILE';
            const boundsCheckbox = document.getElementById(`bounds-${index}`);
            const boundsEnabled = boundsCheckbox ? boundsCheckbox.checked : true;
            // Recreate viewer with new image format
            removeViewerForLayer(index);
            createViewerForLayer(index, layer, info.version, selectedFormat, queryEnabled, selectedStyle, e.target.value, selectedProjection, boundsEnabled);
          }
        });
      }
    }

    // Add event listener to projection selector if available
    if (layer.supportedProjections && layer.supportedProjections.length > 0) {
      const projectionSelect = document.getElementById(`projection-${index}`);
      if (projectionSelect) {
        projectionSelect.addEventListener('change', (e) => {
          const layerCheckbox = document.getElementById(`layer-${index}`);
          if (layerCheckbox.checked) {
            const queryCheckbox = document.getElementById(`query-${index}`);
            const queryEnabled = queryCheckbox ? queryCheckbox.checked : false;
            const formatSelect = document.getElementById(`format-${index}`);
            const selectedFormat = formatSelect ? formatSelect.value : info.getFeatureInfoFormats[0];
            const styleSelect = document.getElementById(`style-${index}`);
            const selectedStyle = styleSelect ? styleSelect.value : (layer.styles && layer.styles.length > 0 ? layer.styles[0].name : '');
            const imgFormatSelect = document.getElementById(`img-format-${index}`);
            const selectedImgFormat = imgFormatSelect ? imgFormatSelect.value : (info.getMapFormats && info.getMapFormats.length > 0 ? info.getMapFormats[0] : 'image/png');
            const boundsCheckbox = document.getElementById(`bounds-${index}`);
            const boundsEnabled = boundsCheckbox ? boundsCheckbox.checked : true;
            // Recreate viewer with new projection
            removeViewerForLayer(index);
            createViewerForLayer(index, layer, info.version, selectedFormat, queryEnabled, selectedStyle, selectedImgFormat, e.target.value, boundsEnabled);
          }
        });
      }
    }

    // Add event listeners to dimension selectors and checkboxes
    if (layer.dimensions && layer.dimensions.length > 0) {
      layer.dimensions.forEach((dim, dimIdx) => {
        const dimensionSelect = document.getElementById(`dim-${index}-${dimIdx}`);
        const dimensionCheckbox = document.getElementById(`dim-enabled-${index}-${dimIdx}`);
        
        if (dimensionSelect) {
          dimensionSelect.addEventListener('change', (e) => {
            const layerCheckbox = document.getElementById(`layer-${index}`);
            if (layerCheckbox.checked) {
              const queryCheckbox = document.getElementById(`query-${index}`);
              const queryEnabled = queryCheckbox ? queryCheckbox.checked : false;
              const formatSelect = document.getElementById(`format-${index}`);
              const selectedFormat = formatSelect ? formatSelect.value : info.getFeatureInfoFormats[0];
              const styleSelect = document.getElementById(`style-${index}`);
              const selectedStyle = styleSelect ? styleSelect.value : (layer.styles && layer.styles.length > 0 ? layer.styles[0].name : '');
              const imgFormatSelect = document.getElementById(`img-format-${index}`);
              const selectedImgFormat = imgFormatSelect ? imgFormatSelect.value : (info.getMapFormats && info.getMapFormats.length > 0 ? info.getMapFormats[0] : 'image/png');
              const projectionSelect = document.getElementById(`projection-${index}`);
              const selectedProjection = projectionSelect ? projectionSelect.value : 'OSMTILE';
              const boundsCheckbox = document.getElementById(`bounds-${index}`);
              const boundsEnabled = boundsCheckbox ? boundsCheckbox.checked : true;
              // Recreate viewer with new dimension value
              removeViewerForLayer(index);
              createViewerForLayer(index, layer, info.version, selectedFormat, queryEnabled, selectedStyle, selectedImgFormat, selectedProjection, boundsEnabled);
            }
          });
        }
        
        if (dimensionCheckbox) {
          dimensionCheckbox.addEventListener('change', (e) => {
            const layerCheckbox = document.getElementById(`layer-${index}`);
            if (layerCheckbox.checked) {
              const queryCheckbox = document.getElementById(`query-${index}`);
              const queryEnabled = queryCheckbox ? queryCheckbox.checked : false;
              const formatSelect = document.getElementById(`format-${index}`);
              const selectedFormat = formatSelect ? formatSelect.value : info.getFeatureInfoFormats[0];
              const styleSelect = document.getElementById(`style-${index}`);
              const selectedStyle = styleSelect ? styleSelect.value : (layer.styles && layer.styles.length > 0 ? layer.styles[0].name : '');
              const imgFormatSelect = document.getElementById(`img-format-${index}`);
              const selectedImgFormat = imgFormatSelect ? imgFormatSelect.value : (info.getMapFormats && info.getMapFormats.length > 0 ? info.getMapFormats[0] : 'image/png');
              const projectionSelect = document.getElementById(`projection-${index}`);
              const selectedProjection = projectionSelect ? projectionSelect.value : 'OSMTILE';
              const boundsCheckbox = document.getElementById(`bounds-${index}`);
              const boundsEnabled = boundsCheckbox ? boundsCheckbox.checked : true;
              // Recreate viewer when dimension is enabled/disabled
              removeViewerForLayer(index);
              createViewerForLayer(index, layer, info.version, selectedFormat, queryEnabled, selectedStyle, selectedImgFormat, selectedProjection, boundsEnabled);
            }
          });
        }
      });
    }
  });
}

function buildGetMapUrl(baseUrl, layer, version, styleName) {
  const { bbox } = layer;
  const params = new URLSearchParams({
    SERVICE: 'WMS',
    VERSION: version,
    REQUEST: 'GetMap',
    LAYERS: layer.name,
    WIDTH: '100',
    HEIGHT: '100',
    FORMAT: 'image/png',
  });

  // Add STYLES parameter if provided
  if (styleName) {
    params.set('STYLES', styleName);
  }

  // Use correct parameter names based on version
  if (version.startsWith('1.3')) {
    params.set('CRS', 'EPSG:4326');
    params.set('BBOX', `${bbox.miny},${bbox.minx},${bbox.maxy},${bbox.maxx}`);
  } else {
    params.set('SRS', 'EPSG:4326');
    params.set('BBOX', `${bbox.minx},${bbox.miny},${bbox.maxx},${bbox.maxy}`);
  }

  const url = `${baseUrl}?${params.toString()}`;
  // Don't use CORS proxy for GetMap - often works without CORS
  return url;
}

// ========================================
// ESRI REST API Service Functions
// ========================================

// Map ESRI WKID codes to MapML projections
function mapESRIWkidToProjection(wkid) {
  const wkidMap = {
    3857: 'OSMTILE',
    102100: 'OSMTILE', // Web Mercator (Auxiliary Sphere)
    3978: 'CBMTILE',
    4326: 'WGS84',
    5936: 'APSTILE'
  };
  
  return wkidMap[wkid] || null;
}

// Extract ESRI MapServer metadata
function extractESRIMapServerInfo(jsonData, baseUrl) {
  const title = jsonData.mapName || jsonData.serviceDescription || 'N/A';
  const abstract = jsonData.description || jsonData.serviceDescription || 'N/A';
  const copyrightText = jsonData.copyrightText || '';
  
  // Detect if this is a tiled service
  const isTiled = jsonData.singleFusedMapCache === true && jsonData.tileInfo;
  
  // Get spatial reference
  const spatialReference = jsonData.spatialReference || {};
  const wkid = spatialReference.latestWkid || spatialReference.wkid;
  const projection = mapESRIWkidToProjection(wkid);
  
  // Parse tile info if available
  let tileInfo = null;
  if (isTiled && jsonData.tileInfo) {
    const lods = jsonData.tileInfo.lods || [];
    tileInfo = {
      minZoom: lods.length > 0 ? lods[0].level : 0,
      maxZoom: lods.length > 0 ? lods[lods.length - 1].level : 18,
      origin: jsonData.tileInfo.origin,
      spatialReference: jsonData.tileInfo.spatialReference
    };
  }
  
  // Parse layers
  const layers = [];
  const layersArray = jsonData.layers || [];
  
  layersArray.forEach(lyr => {
    // Skip group layers (they have subLayerIds)
    if (lyr.subLayerIds && lyr.subLayerIds.length > 0) {
      return;
    }
    
    const extent = jsonData.fullExtent || jsonData.initialExtent || {};
    const layerExtent = lyr.extent || extent;
    
    // Only include layers that match the service projection
    const layerName = lyr.name || `Layer ${lyr.id}`;
    const layerTitle = lyr.name || layerName;
    
    layers.push({
      id: lyr.id,
      name: layerName,
      title: layerTitle,
      description: lyr.description || '',
      bbox: {
        minx: layerExtent.xmin?.toString() || '-180',
        miny: layerExtent.ymin?.toString() || '-90',
        maxx: layerExtent.xmax?.toString() || '180',
        maxy: layerExtent.ymax?.toString() || '90'
      },
      minScale: lyr.minScale,
      maxScale: lyr.maxScale,
      defaultVisibility: lyr.defaultVisibility !== false
    });
  });
  
  // Parse supported image formats
  const supportedFormats = [];
  if (jsonData.supportedImageFormatTypes) {
    // supportedImageFormatTypes is a comma-separated string like "PNG32,PNG24,PNG,JPG,DIB,TIFF,EMF,PS,PDF,GIF,SVG,SVGZ,BMP"
    const formats = jsonData.supportedImageFormatTypes.split(',');
    formats.forEach(fmt => {
      const trimmed = fmt.trim();
      if (trimmed === 'PNG32' || trimmed === 'PNG24' || trimmed === 'PNG') {
        supportedFormats.push('png');
      } else if (trimmed === 'JPG' || trimmed === 'JPEG') {
        supportedFormats.push('jpg');
      } else if (trimmed === 'GIF') {
        supportedFormats.push('gif');
      }
    });
  }
  // Remove duplicates
  const uniqueFormats = [...new Set(supportedFormats)];
  if (uniqueFormats.length === 0) {
    uniqueFormats.push('png'); // Default fallback
  }
  
  // Check for query capability
  const capabilities = jsonData.capabilities || '';
  const supportsQuery = capabilities.toLowerCase().includes('query');
  
  return {
    title,
    abstract,
    copyrightText,
    wkid,
    projection,
    isTiled,
    tileInfo,
    layers,
    supportedFormats: uniqueFormats,
    supportsQuery,
    fullExtent: jsonData.fullExtent || jsonData.initialExtent,
    baseUrl
  };
}

// Extract ESRI ImageServer metadata
function extractESRIImageServerInfo(jsonData, baseUrl) {
  const title = jsonData.name || jsonData.serviceDescription || 'N/A';
  const abstract = jsonData.description || jsonData.serviceDescription || 'N/A';
  const copyrightText = jsonData.copyrightText || '';
  
  // Get spatial reference
  const spatialReference = jsonData.spatialReference || {};
  const wkid = spatialReference.latestWkid || spatialReference.wkid;
  const projection = mapESRIWkidToProjection(wkid);
  
  // Get extent
  const extent = jsonData.extent || {};
  const bbox = {
    minx: extent.xmin?.toString() || '-180',
    miny: extent.ymin?.toString() || '-90',
    maxx: extent.xmax?.toString() || '180',
    maxy: extent.ymax?.toString() || '90'
  };
  
  // Parse supported image formats
  const supportedFormats = [];
  if (jsonData.supportedImageFormatTypes) {
    const formats = jsonData.supportedImageFormatTypes.split(',');
    formats.forEach(fmt => {
      const trimmed = fmt.trim().toLowerCase();
      if (trimmed.includes('png')) {
        supportedFormats.push('png');
      } else if (trimmed.includes('jpg') || trimmed.includes('jpeg')) {
        supportedFormats.push('jpgpng');
      } else if (trimmed.includes('tiff') || trimmed.includes('tif')) {
        supportedFormats.push('tiff');
      }
    });
  }
  const uniqueFormats = [...new Set(supportedFormats)];
  if (uniqueFormats.length === 0) {
    uniqueFormats.push('jpgpng'); // ImageServer default
  }
  
  // Check for query capability
  const capabilities = jsonData.capabilities || '';
  const supportsQuery = capabilities.toLowerCase().includes('catalog') || capabilities.toLowerCase().includes('metadata');
  
  // Create a single "layer" representing the ImageServer
  const layer = {
    id: 0,
    name: title,
    title: title,
    description: abstract,
    bbox: bbox,
    bandCount: jsonData.bandCount || 1,
    pixelType: jsonData.pixelType || 'UNKNOWN',
    hasMultidimensions: jsonData.hasMultidimensions || false
  };
  
  return {
    title,
    abstract,
    copyrightText,
    wkid,
    projection,
    layer,
    supportedFormats: uniqueFormats,
    supportsQuery,
    extent: jsonData.extent,
    baseUrl
  };
}

// Display ESRI MapServer information
function displayESRIMapServerInfo(info, source, url) {
  if (!info.projection) {
    alert(`Unsupported projection: WKID ${info.wkid}. MapMLify only supports EPSG:3857, 3978, 4326, and 5936.`);
    return;
  }
  
  const sourceNote = source === 'file' ? '<p><em>(Loaded from file)</em></p>' : '';
  const serviceTypeBadge = info.isTiled 
    ? '<span class="service-type-badge" style="background: #FF9800; color: white; padding: 2px 8px; border-radius: 3px; font-size: 0.9em; margin-left: 10px;">ESRI MapServer (Tiled)</span>'
    : '<span class="service-type-badge" style="background: #FF9800; color: white; padding: 2px 8px; border-radius: 3px; font-size: 0.9em; margin-left: 10px;">ESRI MapServer</span>';
  
  const layersList = info.layers.map((layer, index) => {
    // Build preview URL
    let previewUrl = '';
    if (info.isTiled) {
      // For tiled services, use tile endpoint: /tile/{z}/{y}/{x}
      const zoomLevel = info.tileInfo ? Math.floor((info.tileInfo.minZoom + info.tileInfo.maxZoom) / 2) : 2;
      previewUrl = `${info.baseUrl}/tile/${zoomLevel}/0/0`;
    } else {
      // For dynamic services, use export endpoint
      const bbox = layer.bbox;
      const params = new URLSearchParams({
        bbox: `${bbox.minx},${bbox.miny},${bbox.maxx},${bbox.maxy}`,
        bboxSR: info.wkid.toString(),
        size: '200,200',
        imageSR: info.wkid.toString(),
        format: 'png32',
        transparent: 'true',
        f: 'image',
        layers: `show:${layer.id}`
      });
      previewUrl = `${info.baseUrl}/export?${params.toString()}`;
    }
    
    const abstractHtml = layer.description ? `<details class="layer-abstract"><summary>Abstract</summary><p>${layer.description}</p></details>` : '';
    
    const projectionHtml = `<div class="projection-selector"><label>Projection:</label><span>${info.projection} (WKID: ${info.wkid})</span></div>`;
    
    const boundsHtml = '<div class="bounds-selector"><input type="checkbox" id="bounds-' + index + '" class="bounds-checkbox" title="Include layer bounds" checked /><label for="bounds-' + index + '" class="bounds-label">Include Bounds</label></div>';
    
    // Only show query checkbox for dynamic (non-tiled) services
    const queryHtml = info.supportsQuery && !info.isTiled ? '<div class="query-format-selector"><input type="checkbox" id="query-' + index + '" class="query-checkbox" title="Enable query support" /><label for="query-' + index + '" class="query-label">Query</label></div>' : '';
    
    const formatOptions = info.supportedFormats.map(fmt => `<option value="${fmt}"${fmt === 'png' ? ' selected' : ''}>${fmt}</option>`).join('');
    const formatHtml = !info.isTiled && info.supportedFormats.length > 0 ? `<div class="format-selector"><label for="img-format-${index}">Image Format:</label><select id="img-format-${index}" class="format-select">${formatOptions}</select></div>` : '';
    
    // Add export mode selector for dynamic (non-tiled) services
    const exportModeHtml = !info.isTiled ? `<div class="export-mode-selector"><label for="export-mode-${index}">Export Mode:</label><select id="export-mode-${index}" class="export-mode-select"><option value="individual">Individual Layer</option><option value="fused">All Layers (Fused)</option></select></div>` : '';
    
    const previewHtml = previewUrl ? `<img src="${previewUrl}" alt="Preview of ${layer.title}" class="layer-preview" id="preview-${index}" onerror="this.style.display='none'" />` : '<p>No preview available</p>';
    
    // For tiled services, disable layer checkbox if it's not the whole service
    const disabledAttr = info.isTiled && info.layers.length > 1 && index > 0 ? ' disabled title="Tiled services can only display all layers together"' : '';
    
    return `<div class="layer-item" data-layer-index="${index}" data-service-type="ESRI-MapServer"><div class="layer-controls"><div class="layer-header"><input type="checkbox" id="layer-${index}" class="layer-checkbox"${disabledAttr} /><label for="layer-${index}"><strong>${layer.title}</strong></label></div><p class="layer-name">ID: ${layer.id} | Name: ${layer.name}</p>${projectionHtml}${abstractHtml}${boundsHtml}${queryHtml}${exportModeHtml}${formatHtml}</div><div class="layer-viewer-container" id="viewer-container-${index}">${previewHtml}</div></div>`;
  }).join('');
  
  const urlNote = source !== 'file' ? `<p><strong>Loaded URL:</strong> <a href="${url}" target="_blank" rel="noopener noreferrer">${url}</a></p>` : '';
  const copyrightNote = info.copyrightText ? `<p><strong>Copyright:</strong> ${info.copyrightText}</p>` : '';
  const tiledNote = info.isTiled ? `<p><strong>Tile Cache:</strong> Zoom levels ${info.tileInfo.minZoom} - ${info.tileInfo.maxZoom}</p>` : '';
  
  serviceDetails.innerHTML = `
    ${sourceNote}
    <p><strong>Title:</strong> ${info.title} ${serviceTypeBadge}</p>
    ${tiledNote}
    <details class="service-abstract">
      <summary><strong>Abstract</strong></summary>
      <p>${info.abstract}</p>
    </details>
    ${copyrightNote}
    ${urlNote}
    <h3>Available Layers (${info.layers.length})</h3>
    <div class="layers-list">
      ${layersList}
    </div>
  `;
  
  serviceInfo.classList.remove('hidden');
  
  // Add event listeners
  info.layers.forEach((layer, index) => {
    const checkbox = document.getElementById(`layer-${index}`);
    if (!checkbox || checkbox.disabled) return;
    
    checkbox.addEventListener('change', (e) => {
      if (e.target.checked) {
        const queryCheckbox = document.getElementById(`query-${index}`);
        const queryEnabled = queryCheckbox ? queryCheckbox.checked : false;
        const imgFormatSelect = document.getElementById(`img-format-${index}`);
        const selectedFormat = imgFormatSelect ? imgFormatSelect.value : 'png';
        const exportModeSelect = document.getElementById(`export-mode-${index}`);
        const exportMode = exportModeSelect ? exportModeSelect.value : 'individual';
        const boundsCheckbox = document.getElementById(`bounds-${index}`);
        const boundsEnabled = boundsCheckbox ? boundsCheckbox.checked : true;
        
        createViewerForESRIMapServerLayer(index, layer, info, queryEnabled, selectedFormat, exportMode, boundsEnabled);
      } else {
        removeViewerForLayer(index);
      }
    });
    
    // Add event listeners for controls
    const boundsCheckbox = document.getElementById(`bounds-${index}`);
    if (boundsCheckbox) {
      boundsCheckbox.addEventListener('change', () => {
        const layerCheckbox = document.getElementById(`layer-${index}`);
        if (layerCheckbox.checked) {
          const queryCheckbox = document.getElementById(`query-${index}`);
          const queryEnabled = queryCheckbox ? queryCheckbox.checked : false;
          const imgFormatSelect = document.getElementById(`img-format-${index}`);
          const selectedFormat = imgFormatSelect ? imgFormatSelect.value : 'png';
          const exportModeSelect = document.getElementById(`export-mode-${index}`);
          const exportMode = exportModeSelect ? exportModeSelect.value : 'individual';
          removeViewerForLayer(index);
          createViewerForESRIMapServerLayer(index, layer, info, queryEnabled, selectedFormat, exportMode, boundsCheckbox.checked);
        }
      });
    }
    
    const queryCheckbox = document.getElementById(`query-${index}`);
    if (queryCheckbox) {
      queryCheckbox.addEventListener('change', () => {
        const layerCheckbox = document.getElementById(`layer-${index}`);
        if (layerCheckbox.checked) {
          const imgFormatSelect = document.getElementById(`img-format-${index}`);
          const selectedFormat = imgFormatSelect ? imgFormatSelect.value : 'png';
          // Update the layer with or without query support
          updateESRIMapServerQueryInViewer(index, layer, info, queryCheckbox.checked, selectedFormat);
        }
      });
    }
    
    const imgFormatSelect = document.getElementById(`img-format-${index}`);
    if (imgFormatSelect) {
      imgFormatSelect.addEventListener('change', () => {
        const layerCheckbox = document.getElementById(`layer-${index}`);
        if (layerCheckbox.checked) {
          const queryCheckbox = document.getElementById(`query-${index}`);
          const queryEnabled = queryCheckbox ? queryCheckbox.checked : false;
          const exportModeSelect = document.getElementById(`export-mode-${index}`);
          const exportMode = exportModeSelect ? exportModeSelect.value : 'individual';
          const boundsCheckbox = document.getElementById(`bounds-${index}`);
          const boundsEnabled = boundsCheckbox ? boundsCheckbox.checked : true;
          removeViewerForLayer(index);
          createViewerForESRIMapServerLayer(index, layer, info, queryEnabled, imgFormatSelect.value, exportMode, boundsEnabled);
        }
      });
    }
    
    const exportModeSelect = document.getElementById(`export-mode-${index}`);
    if (exportModeSelect) {
      exportModeSelect.addEventListener('change', () => {
        const layerCheckbox = document.getElementById(`layer-${index}`);
        if (layerCheckbox.checked) {
          const queryCheckbox = document.getElementById(`query-${index}`);
          const queryEnabled = queryCheckbox ? queryCheckbox.checked : false;
          const imgFormatSelect = document.getElementById(`img-format-${index}`);
          const selectedFormat = imgFormatSelect ? imgFormatSelect.value : 'png';
          const boundsCheckbox = document.getElementById(`bounds-${index}`);
          const boundsEnabled = boundsCheckbox ? boundsCheckbox.checked : true;
          removeViewerForLayer(index);
          createViewerForESRIMapServerLayer(index, layer, info, queryEnabled, selectedFormat, exportModeSelect.value, boundsEnabled);
        }
      });
    }
  });
}

// Display ESRI ImageServer information
function displayESRIImageServerInfo(info, source, url) {
  if (!info.projection) {
    alert(`Unsupported projection: WKID ${info.wkid}. MapMLify only supports EPSG:3857, 3978, 4326, and 5936.`);
    return;
  }
  
  const sourceNote = source === 'file' ? '<p><em>(Loaded from file)</em></p>' : '';
  const serviceTypeBadge = '<span class="service-type-badge" style="background: #9C27B0; color: white; padding: 2px 8px; border-radius: 3px; font-size: 0.9em; margin-left: 10px;">ESRI ImageServer</span>';
  
  const layer = info.layer;
  const index = 0; // Single layer
  
  // Build preview URL using exportImage endpoint
  const bbox = layer.bbox;
  const params = new URLSearchParams({
    bbox: `${bbox.minx},${bbox.miny},${bbox.maxx},${bbox.maxy}`,
    bboxSR: info.wkid.toString(),
    size: '200,200',
    imageSR: info.wkid.toString(),
    format: info.supportedFormats[0] || 'jpgpng',
    f: 'image'
  });
  const previewUrl = `${info.baseUrl}/exportImage?${params.toString()}`;
  
  const abstractHtml = layer.description ? `<details class="layer-abstract"><summary>Abstract</summary><p>${layer.description}</p></details>` : '';
  
  const projectionHtml = `<div class="projection-selector"><label>Projection:</label><span>${info.projection} (WKID: ${info.wkid})</span></div>`;
  
  const rasterPropsHtml = `<div class="raster-props"><p><strong>Bands:</strong> ${layer.bandCount} | <strong>Pixel Type:</strong> ${layer.pixelType}</p></div>`;
  
  const boundsHtml = '<div class="bounds-selector"><input type="checkbox" id="bounds-0" class="bounds-checkbox" title="Include extent" checked /><label for="bounds-0" class="bounds-label">Include Bounds</label></div>';
  
  const queryHtml = info.supportsQuery ? '<div class="query-format-selector"><input type="checkbox" id="query-0" class="query-checkbox" title="Enable query support" /><label for="query-0" class="query-label">Query</label></div>' : '';
  
  const formatOptions = info.supportedFormats.map(fmt => `<option value="${fmt}">${fmt}</option>`).join('');
  const formatHtml = `<div class="format-selector"><label for="img-format-0">Image Format:</label><select id="img-format-0" class="format-select">${formatOptions}</select></div>`;
  
  const previewHtml = `<img src="${previewUrl}" alt="Preview of ${layer.title}" class="layer-preview" id="preview-0" onerror="this.style.display='none'" />`;
  
  const urlNote = source !== 'file' ? `<p><strong>Loaded URL:</strong> <a href="${url}" target="_blank" rel="noopener noreferrer">${url}</a></p>` : '';
  const copyrightNote = info.copyrightText ? `<p><strong>Copyright:</strong> ${info.copyrightText}</p>` : '';
  
  serviceDetails.innerHTML = `
    ${sourceNote}
    <p><strong>Title:</strong> ${info.title} ${serviceTypeBadge}</p>
    <details class="service-abstract">
      <summary><strong>Abstract</strong></summary>
      <p>${info.abstract}</p>
    </details>
    ${copyrightNote}
    ${urlNote}
    <div class="layers-list">
      <div class="layer-item" data-layer-index="0" data-service-type="ESRI-ImageServer">
        <div class="layer-controls">
          <div class="layer-header">
            <input type="checkbox" id="layer-0" class="layer-checkbox" />
            <label for="layer-0"><strong>${layer.title}</strong></label>
          </div>
          ${projectionHtml}
          ${rasterPropsHtml}
          ${abstractHtml}
          ${boundsHtml}
          ${queryHtml}
          ${formatHtml}
        </div>
        <div class="layer-viewer-container" id="viewer-container-0">
          ${previewHtml}
        </div>
      </div>
    </div>
  `;
  
  serviceInfo.classList.remove('hidden');
  
  // Add event listeners
  const checkbox = document.getElementById('layer-0');
  checkbox.addEventListener('change', (e) => {
    if (e.target.checked) {
      const queryCheckbox = document.getElementById('query-0');
      const queryEnabled = queryCheckbox ? queryCheckbox.checked : false;
      const imgFormatSelect = document.getElementById('img-format-0');
      const selectedFormat = imgFormatSelect ? imgFormatSelect.value : info.supportedFormats[0];
      const boundsCheckbox = document.getElementById('bounds-0');
      const boundsEnabled = boundsCheckbox ? boundsCheckbox.checked : true;
      
      createViewerForESRIImageServerLayer(0, layer, info, queryEnabled, selectedFormat, boundsEnabled);
    } else {
      removeViewerForLayer(0);
    }
  });
  
  const boundsCheckbox = document.getElementById('bounds-0');
  if (boundsCheckbox) {
    boundsCheckbox.addEventListener('change', () => {
      const layerCheckbox = document.getElementById('layer-0');
      if (layerCheckbox.checked) {
        const queryCheckbox = document.getElementById('query-0');
        const queryEnabled = queryCheckbox ? queryCheckbox.checked : false;
        const imgFormatSelect = document.getElementById('img-format-0');
        const selectedFormat = imgFormatSelect ? imgFormatSelect.value : info.supportedFormats[0];
        removeViewerForLayer(0);
        createViewerForESRIImageServerLayer(0, layer, info, queryEnabled, selectedFormat, boundsCheckbox.checked);
      }
    });
  }
  
  const queryCheckbox = document.getElementById('query-0');
  if (queryCheckbox) {
    queryCheckbox.addEventListener('change', () => {
      const layerCheckbox = document.getElementById('layer-0');
      if (layerCheckbox.checked) {
        const imgFormatSelect = document.getElementById('img-format-0');
        const selectedFormat = imgFormatSelect ? imgFormatSelect.value : info.supportedFormats[0];
        // Update the layer with or without query support
        updateESRIImageServerQueryInViewer(0, layer.name, queryCheckbox.checked, info, selectedFormat);
      }
    });
  }
  
  const imgFormatSelect = document.getElementById('img-format-0');
  if (imgFormatSelect) {
    imgFormatSelect.addEventListener('change', () => {
      const layerCheckbox = document.getElementById('layer-0');
      if (layerCheckbox.checked) {
        const queryCheckbox = document.getElementById('query-0');
        const queryEnabled = queryCheckbox ? queryCheckbox.checked : false;
        const boundsCheckbox = document.getElementById('bounds-0');
        const boundsEnabled = boundsCheckbox ? boundsCheckbox.checked : true;
        removeViewerForLayer(0);
        createViewerForESRIImageServerLayer(0, layer, info, queryEnabled, imgFormatSelect.value, boundsEnabled);
      }
    });
  }
}

function createQueryLink(layer, version, projectionCode, infoFormat, layerIndex, styleName, imageFormat) {
  const queryLink = document.createElement('map-link');
  queryLink.setAttribute('rel', 'query');
  queryLink.setAttribute('data-query-link', 'true'); // Mark for easy identification

  // Build GetFeatureInfo URL template - same as GetMap but with different REQUEST and additional params
  let tref = `${currentWmsBaseUrl}?SERVICE=WMS&VERSION=${version}&REQUEST=GetFeatureInfo&LAYERS=${encodeURIComponent(layer.name)}&QUERY_LAYERS=${encodeURIComponent(layer.name)}&WIDTH={w}&HEIGHT={h}&FORMAT=${encodeURIComponent(imageFormat || 'image/png')}`;
  
  // Only add TRANSPARENT=TRUE for formats that support transparency
  const imgFormat = imageFormat || 'image/png';
  if (imgFormat.toLowerCase().includes('png') || imgFormat.toLowerCase().includes('gif')) {
    tref += '&TRANSPARENT=TRUE';
  }
  
  tref += `&INFO_FORMAT=${encodeURIComponent(infoFormat)}`;

  // Add STYLES parameter if a style is selected
  // Use empty STYLES= for 'default-' prefixed styles to work around GeoServer LayerGroup issues
  if (styleName) {
    if (styleName.toLowerCase().startsWith('default-')) {
      tref += '&STYLES=';
    } else {
      tref += '&STYLES={style}';
    }
  }

  // Add dimension parameters to query link only if enabled in UI
  if (layer.dimensions && layer.dimensions.length > 0) {
    layer.dimensions.forEach((dimension, dimIdx) => {
      const dimensionCheckbox = layerIndex !== undefined ? document.getElementById(`dim-enabled-${layerIndex}-${dimIdx}`) : null;
      const isDimensionEnabled = !dimensionCheckbox || dimensionCheckbox.checked;
      
      if (isDimensionEnabled) {
        const paramName = formatDimensionParam(dimension.name);
        tref += `&${paramName}={${dimension.name}}`;
      }
    });
  }

  if (version.startsWith('1.3')) {
    tref += `&CRS=${projectionCode}`;
    // WMS 1.3.0 with EPSG:4326 requires latitude,longitude order (ymin,xmin,ymax,xmax)
    // All other CRS use standard xmin,ymin,xmax,ymax order
    if (projectionCode === 'EPSG:4326') {
      tref += '&BBOX={ymin},{xmin},{ymax},{xmax}';
    } else {
      tref += '&BBOX={xmin},{ymin},{xmax},{ymax}';
    }
  } else {
    tref += `&SRS=${projectionCode}`;
    tref += '&BBOX={xmin},{ymin},{xmax},{ymax}';
  }

  // Add coordinate parameters for click position
  // WMS 1.3.0 uses I,J; earlier versions use X,Y
  if (version.startsWith('1.3')) {
    tref += '&I={i}&J={j}';
  } else {
    tref += '&X={i}&Y={j}';
  }

  queryLink.setAttribute('tref', tref);
  return queryLink;
}

function updateLayerQuery(layerName, queryEnabled, layer, version, selectedFormat) {
  const viewer = document.querySelector('mapml-viewer');
  const mapLayer = viewer.querySelector(`map-layer[data-wms-layer="${layerName}"]`);
  
  if (!mapLayer) return;

  const mapExtent = mapLayer.querySelector('map-extent');
  const existingQueryLink = mapExtent.querySelector('map-link[data-query-link="true"]');

  if (queryEnabled) {
    // Remove existing query link if present
    if (existingQueryLink) {
      existingQueryLink.remove();
    }
    // Add query link with selected format
    const viewerProjection = viewer.getAttribute('projection') || 'OSMTILE';
    
    // Map projection to CRS code (same logic as addLayerToViewer)
    let projectionCode;
    switch (viewerProjection) {
      case 'OSMTILE':
        projectionCode = 'EPSG:3857';
        break;
      case 'CBMTILE':
        projectionCode = 'EPSG:3978';
        break;
      case 'WGS84':
        projectionCode = 'EPSG:4326';
        break;
      case 'APSTILE':
        projectionCode = 'EPSG:5936';
        break;
      default:
        projectionCode = 'EPSG:3857';
    }
    
    const queryLink = createQueryLink(layer, version, projectionCode, selectedFormat);
    mapExtent.appendChild(queryLink);
    console.log('Added/updated query support to layer:', layerName, 'with format:', selectedFormat);
  } else if (!queryEnabled && existingQueryLink) {
    // Remove query link
    existingQueryLink.remove();
    console.log('Removed query support from layer:', layerName);
  }
}

function createViewerForLayer(index, layer, version, selectedFormat, queryEnabled, selectedStyle, imageFormat, projection, boundsEnabled) {
  const container = document.getElementById(`viewer-container-${index}`);
  if (!container) return;

  // Hide the thumbnail
  const thumbnail = document.getElementById(`preview-${index}`);
  if (thumbnail) {
    thumbnail.style.display = 'none';
  }

  // Default to image/png if not specified
  const imgFormat = imageFormat || 'image/png';
  
  // Default to OSMTILE if no projection specified
  const selectedProjection = projection || 'OSMTILE';
  
  // Default to true if not specified
  const includeBounds = boundsEnabled !== undefined ? boundsEnabled : true;

  // Create mapml-viewer element
  const viewer = document.createElement('mapml-viewer');
  viewer.setAttribute('projection', selectedProjection);
  viewer.setAttribute('controls', '');
  viewer.setAttribute('zoom', '0');
  
  // Center on layer bbox (EX_GeographicBoundingBox values are in WGS84)
  const { bbox } = layer;
  const centerLat = (parseFloat(bbox.miny) + parseFloat(bbox.maxy)) / 2;
  const centerLon = (parseFloat(bbox.minx) + parseFloat(bbox.maxx)) / 2;
  viewer.setAttribute('lat', centerLat.toString());
  viewer.setAttribute('lon', centerLon.toString());

  // Add basemap layer based on projection (skip WGS84 for now)
  if (selectedProjection !== 'WGS84') {
    const baseLayer = document.createElement('map-layer');
    const baseExtent = document.createElement('map-extent');
    baseExtent.setAttribute('checked', '');
    
    if (selectedProjection === 'OSMTILE') {
      baseLayer.setAttribute('label', 'Canada Base Map');
      baseLayer.setAttribute('checked', '');
      baseExtent.setAttribute('units', 'OSMTILE');
      
      // Add license link
      const licenseLink = document.createElement('map-link');
      licenseLink.setAttribute('rel', 'license');
      licenseLink.setAttribute('href', 'https://open.canada.ca/en/open-government-licence-canada');
      licenseLink.setAttribute('title', 'Open Government Licence - Canada');
      baseExtent.appendChild(licenseLink);
      
      // Add zoom input
      const zoomInput = document.createElement('map-input');
      zoomInput.setAttribute('name', 'z');
      zoomInput.setAttribute('type', 'zoom');
      zoomInput.setAttribute('min', '0');
      zoomInput.setAttribute('max', '15');
      zoomInput.setAttribute('value', '15');
      baseExtent.appendChild(zoomInput);
      
      // Add row input
      const yInput = document.createElement('map-input');
      yInput.setAttribute('name', 'y');
      yInput.setAttribute('type', 'location');
      yInput.setAttribute('units', 'tilematrix');
      yInput.setAttribute('axis', 'row');
      baseExtent.appendChild(yInput);
      
      // Add column input
      const xInput = document.createElement('map-input');
      xInput.setAttribute('name', 'x');
      xInput.setAttribute('type', 'location');
      xInput.setAttribute('units', 'tilematrix');
      xInput.setAttribute('axis', 'column');
      baseExtent.appendChild(xInput);
      
      // Add base map tile links
      const tileLink1 = document.createElement('map-link');
      tileLink1.setAttribute('rel', 'tile');
      tileLink1.setAttribute('tref', 'https://geoappext.nrcan.gc.ca/arcgis/rest/services/BaseMaps/CBMT_CBCT_GEOM_3857/MapServer/tile/{z}/{y}/{x}?m4h=t');
      baseExtent.appendChild(tileLink1);
      
      const tileLink2 = document.createElement('map-link');
      tileLink2.setAttribute('rel', 'tile');
      tileLink2.setAttribute('tref', 'https://geoappext.nrcan.gc.ca/arcgis/rest/services/BaseMaps/CBMT_TXT_3857/MapServer/tile/{z}/{y}/{x}?m4h=t');
      baseExtent.appendChild(tileLink2);
      
    } else if (selectedProjection === 'CBMTILE') {
      baseLayer.setAttribute('label', 'Canada Base Map - Transportation');
      baseLayer.setAttribute('checked', '');
      baseExtent.setAttribute('units', 'CBMTILE');
      baseExtent.setAttribute('label', 'Canada Base Map - Transportation');
      
      // Add extent bounds
      const mapMeta = document.createElement('map-meta');
      mapMeta.setAttribute('name', 'extent');
      mapMeta.setAttribute('content', 'top-left-easting=-5388605, top-left-northing=7005413, bottom-right-easting=3895643, bottom-right-northing=-4427255');
      baseExtent.appendChild(mapMeta);
      
      // Add license link
      const licenseLink = document.createElement('map-link');
      licenseLink.setAttribute('rel', 'license');
      licenseLink.setAttribute('href', 'https://open.canada.ca/en/open-government-licence-canada');
      licenseLink.setAttribute('title', 'Open Government Licence - Canada');
      baseExtent.appendChild(licenseLink);
      
      // Add zoom input
      const zoomInput = document.createElement('map-input');
      zoomInput.setAttribute('name', 'z');
      zoomInput.setAttribute('type', 'zoom');
      zoomInput.setAttribute('value', '17');
      zoomInput.setAttribute('min', '0');
      zoomInput.setAttribute('max', '17');
      baseExtent.appendChild(zoomInput);
      
      // Add row input
      const yInput = document.createElement('map-input');
      yInput.setAttribute('name', 'y');
      yInput.setAttribute('type', 'location');
      yInput.setAttribute('units', 'tilematrix');
      yInput.setAttribute('axis', 'row');
      baseExtent.appendChild(yInput);
      
      // Add column input
      const xInput = document.createElement('map-input');
      xInput.setAttribute('name', 'x');
      xInput.setAttribute('type', 'location');
      xInput.setAttribute('units', 'tilematrix');
      xInput.setAttribute('axis', 'column');
      baseExtent.appendChild(xInput);
      
      // Add tile link
      const tileLink = document.createElement('map-link');
      tileLink.setAttribute('rel', 'tile');
      tileLink.setAttribute('tref', 'https://geoappext.nrcan.gc.ca/arcgis/rest/services/BaseMaps/CBMT3978/MapServer/tile/{z}/{y}/{x}?m4h=t');
      baseExtent.appendChild(tileLink);
      
    } else if (selectedProjection === 'APSTILE') {
      baseLayer.setAttribute('label', 'Arctic Ocean Basemap MapML Service');
      baseLayer.setAttribute('checked', '');
      baseExtent.setAttribute('units', 'APSTILE');
      baseExtent.setAttribute('label', 'Arctic Ocean Basemap MapML Service');
      
      // Add license link
      const licenseLink = document.createElement('map-link');
      licenseLink.setAttribute('rel', 'license');
      licenseLink.setAttribute('href', 'https://www.esri.com/legal/software-license');
      licenseLink.setAttribute('title', 'Sources: Esri, GEBCO, NOAA, National Geographic, DeLorme, HERE, Geonames.org, and other contributors');
      baseExtent.appendChild(licenseLink);
      
      // Add zoom input
      const zoomInput = document.createElement('map-input');
      zoomInput.setAttribute('name', 'z');
      zoomInput.setAttribute('type', 'zoom');
      zoomInput.setAttribute('value', '10');
      zoomInput.setAttribute('min', '0');
      zoomInput.setAttribute('max', '10');
      baseExtent.appendChild(zoomInput);
      
      // Add row input
      const yInput = document.createElement('map-input');
      yInput.setAttribute('name', 'y');
      yInput.setAttribute('type', 'location');
      yInput.setAttribute('units', 'tilematrix');
      yInput.setAttribute('axis', 'row');
      baseExtent.appendChild(yInput);
      
      // Add column input
      const xInput = document.createElement('map-input');
      xInput.setAttribute('name', 'x');
      xInput.setAttribute('type', 'location');
      xInput.setAttribute('units', 'tilematrix');
      xInput.setAttribute('axis', 'column');
      baseExtent.appendChild(xInput);
      
      // Add tile link
      const tileLink = document.createElement('map-link');
      tileLink.setAttribute('rel', 'tile');
      tileLink.setAttribute('tref', 'https://server.arcgisonline.com/arcgis/rest/services/Polar/Arctic_Ocean_Base/MapServer/tile/{z}/{y}/{x}');
      baseExtent.appendChild(tileLink);
    }
    
    baseLayer.appendChild(baseExtent);
    viewer.appendChild(baseLayer);
  }

  // Add the layer to this viewer
  addLayerToViewer(viewer, layer, version, selectedFormat, queryEnabled, selectedStyle, imgFormat, index, includeBounds);

  // Add to container
  container.appendChild(viewer);
  
  console.log('Created viewer for layer:', layer.name);
}

// Create viewer for ESRI MapServer layer
function createViewerForESRIMapServerLayer(index, layer, serviceInfo, queryEnabled, selectedFormat, exportMode, boundsEnabled) {
  const container = document.getElementById(`viewer-container-${index}`);
  if (!container) return;

  // Hide the thumbnail
  const thumbnail = document.getElementById(`preview-${index}`);
  if (thumbnail) {
    thumbnail.style.display = 'none';
  }

  const projection = serviceInfo.projection;
  
  // Create mapml-viewer element
  const viewer = document.createElement('mapml-viewer');
  viewer.setAttribute('projection', projection);
  viewer.setAttribute('controls', '');
  viewer.setAttribute('zoom', serviceInfo.isTiled ? '2' : '0');
  
  // Center on layer bbox
  const { bbox } = layer;
  const centerLat = (parseFloat(bbox.miny) + parseFloat(bbox.maxy)) / 2;
  const centerLon = (parseFloat(bbox.minx) + parseFloat(bbox.maxx)) / 2;
  
  // For projected coordinate systems, we may need to transform
  if (serviceInfo.wkid === 4326) {
    viewer.setAttribute('lat', centerLat.toString());
    viewer.setAttribute('lon', centerLon.toString());
  } else {
    // For projected coordinates, use center of extent
    // (MapML viewer will handle the conversion)
    viewer.setAttribute('lat', '45'); // Default center
    viewer.setAttribute('lon', '-75');
  }

  // Add basemap layer based on projection
  if (projection !== 'WGS84') {
    const baseLayer = document.createElement('map-layer');
    const baseExtent = document.createElement('map-extent');
    baseExtent.setAttribute('checked', '');
    
    if (projection === 'OSMTILE') {
      baseLayer.setAttribute('label', 'Canada Base Map');
      baseLayer.setAttribute('checked', '');
      baseExtent.setAttribute('units', 'OSMTILE');
      
      const licenseLink = document.createElement('map-link');
      licenseLink.setAttribute('rel', 'license');
      licenseLink.setAttribute('href', 'https://open.canada.ca/en/open-government-licence-canada');
      licenseLink.setAttribute('title', 'Open Government Licence - Canada');
      baseExtent.appendChild(licenseLink);
      
      const zoomInput = document.createElement('map-input');
      zoomInput.setAttribute('name', 'z');
      zoomInput.setAttribute('type', 'zoom');
      zoomInput.setAttribute('min', '0');
      zoomInput.setAttribute('max', '15');
      zoomInput.setAttribute('value', '15');
      baseExtent.appendChild(zoomInput);
      
      const yInput = document.createElement('map-input');
      yInput.setAttribute('name', 'y');
      yInput.setAttribute('type', 'location');
      yInput.setAttribute('units', 'tilematrix');
      yInput.setAttribute('axis', 'row');
      baseExtent.appendChild(yInput);
      
      const xInput = document.createElement('map-input');
      xInput.setAttribute('name', 'x');
      xInput.setAttribute('type', 'location');
      xInput.setAttribute('units', 'tilematrix');
      xInput.setAttribute('axis', 'column');
      baseExtent.appendChild(xInput);
      
      const tileLink1 = document.createElement('map-link');
      tileLink1.setAttribute('rel', 'tile');
      tileLink1.setAttribute('tref', 'https://geoappext.nrcan.gc.ca/arcgis/rest/services/BaseMaps/CBMT_CBCT_GEOM_3857/MapServer/tile/{z}/{y}/{x}?m4h=t');
      baseExtent.appendChild(tileLink1);
      
      const tileLink2 = document.createElement('map-link');
      tileLink2.setAttribute('rel', 'tile');
      tileLink2.setAttribute('tref', 'https://geoappext.nrcan.gc.ca/arcgis/rest/services/BaseMaps/CBMT_TXT_3857/MapServer/tile/{z}/{y}/{x}?m4h=t');
      baseExtent.appendChild(tileLink2);
      
    } else if (projection === 'CBMTILE') {
      baseLayer.setAttribute('label', 'Canada Base Map - Transportation');
      baseLayer.setAttribute('checked', '');
      baseExtent.setAttribute('units', 'CBMTILE');
      
      const mapMeta = document.createElement('map-meta');
      mapMeta.setAttribute('name', 'extent');
      mapMeta.setAttribute('content', 'top-left-easting=-5388605, top-left-northing=7005413, bottom-right-easting=3895643, bottom-right-northing=-4427255');
      baseExtent.appendChild(mapMeta);
      
      const licenseLink = document.createElement('map-link');
      licenseLink.setAttribute('rel', 'license');
      licenseLink.setAttribute('href', 'https://open.canada.ca/en/open-government-licence-canada');
      licenseLink.setAttribute('title', 'Open Government Licence - Canada');
      baseExtent.appendChild(licenseLink);
      
      const zoomInput = document.createElement('map-input');
      zoomInput.setAttribute('name', 'z');
      zoomInput.setAttribute('type', 'zoom');
      zoomInput.setAttribute('value', '17');
      zoomInput.setAttribute('min', '0');
      zoomInput.setAttribute('max', '17');
      baseExtent.appendChild(zoomInput);
      
      const yInput = document.createElement('map-input');
      yInput.setAttribute('name', 'y');
      yInput.setAttribute('type', 'location');
      yInput.setAttribute('units', 'tilematrix');
      yInput.setAttribute('axis', 'row');
      baseExtent.appendChild(yInput);
      
      const xInput = document.createElement('map-input');
      xInput.setAttribute('name', 'x');
      xInput.setAttribute('type', 'location');
      xInput.setAttribute('units', 'tilematrix');
      xInput.setAttribute('axis', 'column');
      baseExtent.appendChild(xInput);
      
      const tileLink = document.createElement('map-link');
      tileLink.setAttribute('rel', 'tile');
      tileLink.setAttribute('tref', 'https://geoappext.nrcan.gc.ca/arcgis/rest/services/BaseMaps/CBMT3978/MapServer/tile/{z}/{y}/{x}?m4h=t');
      baseExtent.appendChild(tileLink);
      
    } else if (projection === 'APSTILE') {
      baseLayer.setAttribute('label', 'Arctic Ocean Base');
      baseLayer.setAttribute('checked', '');
      baseExtent.setAttribute('units', 'APSTILE');
      
      const licenseLink = document.createElement('map-link');
      licenseLink.setAttribute('rel', 'license');
      licenseLink.setAttribute('href', 'https://www.esri.com/legal/software-license');
      licenseLink.setAttribute('title', 'Sources: Esri, GEBCO, NOAA, National Geographic, DeLorme, HERE, Geonames.org, and other contributors');
      baseExtent.appendChild(licenseLink);
      
      const zoomInput = document.createElement('map-input');
      zoomInput.setAttribute('name', 'z');
      zoomInput.setAttribute('type', 'zoom');
      zoomInput.setAttribute('value', '16');
      zoomInput.setAttribute('min', '0');
      zoomInput.setAttribute('max', '16');
      baseExtent.appendChild(zoomInput);
      
      const yInput = document.createElement('map-input');
      yInput.setAttribute('name', 'y');
      yInput.setAttribute('type', 'location');
      yInput.setAttribute('units', 'tilematrix');
      yInput.setAttribute('axis', 'row');
      baseExtent.appendChild(yInput);
      
      const xInput = document.createElement('map-input');
      xInput.setAttribute('name', 'x');
      xInput.setAttribute('type', 'location');
      xInput.setAttribute('units', 'tilematrix');
      xInput.setAttribute('axis', 'column');
      baseExtent.appendChild(xInput);
      
      const tileLink = document.createElement('map-link');
      tileLink.setAttribute('rel', 'tile');
      tileLink.setAttribute('tref', 'https://server.arcgisonline.com/arcgis/rest/services/Polar/Arctic_Ocean_Base/MapServer/tile/{z}/{y}/{x}');
      baseExtent.appendChild(tileLink);
    }
    
    baseLayer.appendChild(baseExtent);
    viewer.appendChild(baseLayer);
  }

  // Add the ESRI layer
  addESRIMapServerLayerToViewer(viewer, layer, serviceInfo, queryEnabled, selectedFormat, exportMode, boundsEnabled, index);

  container.appendChild(viewer);
  
  console.log('Created ESRI MapServer viewer for layer:', layer.name);
}

// Add ESRI MapServer layer to viewer
function addESRIMapServerLayerToViewer(viewer, layer, serviceInfo, queryEnabled, selectedFormat, exportMode, boundsEnabled, layerIndex) {
  const viewerProjection = viewer.getAttribute('projection') || 'OSMTILE';
  const { bbox } = layer;

  const mapLayer = document.createElement('map-layer');
  mapLayer.setAttribute('label', layer.title);
  mapLayer.setAttribute('checked', '');
  mapLayer.setAttribute('data-esri-layer', layer.name);
  mapLayer.setAttribute('data-service-type', 'ESRI-MapServer');

  // Add bounds if enabled
  if (boundsEnabled && bbox) {
    const mapMeta = document.createElement('map-meta');
    mapMeta.setAttribute('name', 'extent');
    
    // Determine coordinate type based on WKID
    let content;
    if (serviceInfo.wkid === 4326) {
      content = `top-left-longitude=${bbox.minx}, top-left-latitude=${bbox.maxy}, bottom-right-longitude=${bbox.maxx}, bottom-right-latitude=${bbox.miny}`;
    } else {
      content = `top-left-easting=${bbox.minx}, top-left-northing=${bbox.maxy}, bottom-right-easting=${bbox.maxx}, bottom-right-northing=${bbox.miny}`;
    }
    mapMeta.setAttribute('content', content);
    mapLayer.appendChild(mapMeta);
  }

  // Add copyright as license link if available
  if (serviceInfo.copyrightText) {
    const licenseLink = document.createElement('map-link');
    licenseLink.setAttribute('rel', 'license');
    licenseLink.setAttribute('title', serviceInfo.copyrightText);
    // ESRI services don't typically provide a license URL, so we use a placeholder
    licenseLink.setAttribute('href', '#');
    mapLayer.appendChild(licenseLink);
  }

  const mapExtent = document.createElement('map-extent');
  mapExtent.setAttribute('units', viewerProjection);
  mapExtent.setAttribute('checked', '');

  if (serviceInfo.isTiled) {
    // Tiled service - use tile inputs
    const minZoom = serviceInfo.tileInfo ? serviceInfo.tileInfo.minZoom.toString() : '0';
    const maxZoom = serviceInfo.tileInfo ? serviceInfo.tileInfo.maxZoom.toString() : '18';
    
    const zoomInput = document.createElement('map-input');
    zoomInput.setAttribute('name', 'z');
    zoomInput.setAttribute('type', 'zoom');
    zoomInput.setAttribute('min', minZoom);
    zoomInput.setAttribute('max', maxZoom);
    mapExtent.appendChild(zoomInput);

    const xInput = document.createElement('map-input');
    xInput.setAttribute('name', 'x');
    xInput.setAttribute('type', 'location');
    xInput.setAttribute('units', 'tilematrix');
    xInput.setAttribute('axis', 'column');
    mapExtent.appendChild(xInput);

    const yInput = document.createElement('map-input');
    yInput.setAttribute('name', 'y');
    yInput.setAttribute('type', 'location');
    yInput.setAttribute('units', 'tilematrix');
    yInput.setAttribute('axis', 'row');
    mapExtent.appendChild(yInput);

    // Add tile link
    const tileLink = document.createElement('map-link');
    tileLink.setAttribute('rel', 'tile');
    const tref = `${serviceInfo.baseUrl}/tile/{z}/{y}/{x}`;
    tileLink.setAttribute('tref', tref);
    mapExtent.appendChild(tileLink);
    
  } else {
    // Dynamic service - use bbox inputs for image export
    const inputs = [
      { name: 'xmin', type: 'location', units: 'pcrs', axis: 'easting', position: 'top-left' },
      { name: 'ymin', type: 'location', units: 'pcrs', axis: 'northing', position: 'bottom-left' },
      { name: 'xmax', type: 'location', units: 'pcrs', axis: 'easting', position: 'bottom-right' },
      { name: 'ymax', type: 'location', units: 'pcrs', axis: 'northing', position: 'top-right' },
      { name: 'w', type: 'width', min: '1', max: '10000' },
      { name: 'h', type: 'height', min: '1', max: '10000' }
    ];

    inputs.forEach((inp) => {
      const input = document.createElement('map-input');
      input.setAttribute('name', inp.name);
      input.setAttribute('type', inp.type);
      if (inp.position) input.setAttribute('position', inp.position);
      if (inp.axis) input.setAttribute('axis', inp.axis);
      if (inp.min) input.setAttribute('min', inp.min);
      if (inp.max) input.setAttribute('max', inp.max);
      if (inp.units) input.setAttribute('units', inp.units);
      mapExtent.appendChild(input);
    });

    // Add query inputs if query is enabled
    if (queryEnabled) {
      const iInput = document.createElement('map-input');
      iInput.setAttribute('name', 'i');
      iInput.setAttribute('type', 'location');
      iInput.setAttribute('units', 'map');
      iInput.setAttribute('axis', 'i');
      mapExtent.appendChild(iInput);

      const jInput = document.createElement('map-input');
      jInput.setAttribute('name', 'j');
      jInput.setAttribute('type', 'location');
      jInput.setAttribute('units', 'map');
      jInput.setAttribute('axis', 'j');
      mapExtent.appendChild(jInput);
    }

    // Build export URL template
    const imageLink = document.createElement('map-link');
    imageLink.setAttribute('rel', 'image');
    
    // Determine which layers to export
    let layersParam;
    if (exportMode === 'fused') {
      // Export all layers
      const allLayerIds = serviceInfo.layers.map(l => l.id).join(',');
      layersParam = `show:${allLayerIds}`;
    } else {
      // Export individual layer
      layersParam = `show:${layer.id}`;
    }
    
    // Map format
    const formatMap = {
      'png': 'png32',
      'jpg': 'jpg',
      'gif': 'gif'
    };
    const esriFormat = formatMap[selectedFormat] || 'png32';
    
    // Build template URL manually to preserve {xmin}, {ymin}, etc.
    let tref = `${serviceInfo.baseUrl}/export?bbox={xmin},{ymin},{xmax},{ymax}&bboxSR=${serviceInfo.wkid}&size={w},{h}&imageSR=${serviceInfo.wkid}&format=${esriFormat}&transparent=true&f=image&layers=${encodeURIComponent(layersParam)}`;
    
    imageLink.setAttribute('tref', tref);
    mapExtent.appendChild(imageLink);

    // Add query link if enabled
    if (queryEnabled && serviceInfo.supportsQuery) {
      const queryLink = document.createElement('map-link');
      queryLink.setAttribute('rel', 'query');
      queryLink.setAttribute('data-query-link', 'true');
      
      // Build identify URL template
      let qtref = `${serviceInfo.baseUrl}/identify?geometry={i},{j}&geometryType=esriGeometryPoint&sr=${serviceInfo.wkid}&layers=all:${layer.id}&tolerance=5&mapExtent={xmin},{ymin},{xmax},{ymax}&imageDisplay={w},{h},96&returnGeometry=true&f=html`;
      
      queryLink.setAttribute('tref', qtref);
      mapExtent.appendChild(queryLink);
    }
  }

  mapLayer.appendChild(mapExtent);
  viewer.appendChild(mapLayer);

  console.log('Added ESRI MapServer layer to viewer:', layer.name, serviceInfo.isTiled ? '(tiled)' : '(dynamic)');
}

// Create viewer for ESRI ImageServer
function createViewerForESRIImageServerLayer(index, layer, serviceInfo, queryEnabled, selectedFormat, boundsEnabled) {
  const container = document.getElementById(`viewer-container-${index}`);
  if (!container) return;

  // Hide the thumbnail
  const thumbnail = document.getElementById(`preview-${index}`);
  if (thumbnail) {
    thumbnail.style.display = 'none';
  }

  const projection = serviceInfo.projection;
  
  // Create mapml-viewer element
  const viewer = document.createElement('mapml-viewer');
  viewer.setAttribute('projection', projection);
  viewer.setAttribute('controls', '');
  viewer.setAttribute('zoom', '0');
  
  // Center on extent
  const { bbox } = layer;
  const centerLat = (parseFloat(bbox.miny) + parseFloat(bbox.maxy)) / 2;
  const centerLon = (parseFloat(bbox.minx) + parseFloat(bbox.maxx)) / 2;
  
  if (serviceInfo.wkid === 4326) {
    viewer.setAttribute('lat', centerLat.toString());
    viewer.setAttribute('lon', centerLon.toString());
  } else {
    viewer.setAttribute('lat', '45');
    viewer.setAttribute('lon', '-75');
  }

  // Add basemap layer based on projection (same as MapServer)
  if (projection !== 'WGS84') {
    const baseLayer = document.createElement('map-layer');
    const baseExtent = document.createElement('map-extent');
    baseExtent.setAttribute('checked', '');
    
    if (projection === 'OSMTILE') {
      baseLayer.setAttribute('label', 'Canada Base Map');
      baseLayer.setAttribute('checked', '');
      baseExtent.setAttribute('units', 'OSMTILE');
      
      const licenseLink = document.createElement('map-link');
      licenseLink.setAttribute('rel', 'license');
      licenseLink.setAttribute('href', 'https://open.canada.ca/en/open-government-licence-canada');
      licenseLink.setAttribute('title', 'Open Government Licence - Canada');
      baseExtent.appendChild(licenseLink);
      
      const zoomInput = document.createElement('map-input');
      zoomInput.setAttribute('name', 'z');
      zoomInput.setAttribute('type', 'zoom');
      zoomInput.setAttribute('min', '0');
      zoomInput.setAttribute('max', '15');
      zoomInput.setAttribute('value', '15');
      baseExtent.appendChild(zoomInput);
      
      const yInput = document.createElement('map-input');
      yInput.setAttribute('name', 'y');
      yInput.setAttribute('type', 'location');
      yInput.setAttribute('units', 'tilematrix');
      yInput.setAttribute('axis', 'row');
      baseExtent.appendChild(yInput);
      
      const xInput = document.createElement('map-input');
      xInput.setAttribute('name', 'x');
      xInput.setAttribute('type', 'location');
      xInput.setAttribute('units', 'tilematrix');
      xInput.setAttribute('axis', 'column');
      baseExtent.appendChild(xInput);
      
      const tileLink1 = document.createElement('map-link');
      tileLink1.setAttribute('rel', 'tile');
      tileLink1.setAttribute('tref', 'https://geoappext.nrcan.gc.ca/arcgis/rest/services/BaseMaps/CBMT_CBCT_GEOM_3857/MapServer/tile/{z}/{y}/{x}?m4h=t');
      baseExtent.appendChild(tileLink1);
      
      const tileLink2 = document.createElement('map-link');
      tileLink2.setAttribute('rel', 'tile');
      tileLink2.setAttribute('tref', 'https://geoappext.nrcan.gc.ca/arcgis/rest/services/BaseMaps/CBMT_TXT_3857/MapServer/tile/{z}/{y}/{x}?m4h=t');
      baseExtent.appendChild(tileLink2);
      
    } else if (projection === 'CBMTILE') {
      baseLayer.setAttribute('label', 'Canada Base Map - Transportation');
      baseLayer.setAttribute('checked', '');
      baseExtent.setAttribute('units', 'CBMTILE');
      
      const mapMeta = document.createElement('map-meta');
      mapMeta.setAttribute('name', 'extent');
      mapMeta.setAttribute('content', 'top-left-easting=-5388605, top-left-northing=7005413, bottom-right-easting=3895643, bottom-right-northing=-4427255');
      baseExtent.appendChild(mapMeta);
      
      const licenseLink = document.createElement('map-link');
      licenseLink.setAttribute('rel', 'license');
      licenseLink.setAttribute('href', 'https://open.canada.ca/en/open-government-licence-canada');
      licenseLink.setAttribute('title', 'Open Government Licence - Canada');
      baseExtent.appendChild(licenseLink);
      
      const zoomInput = document.createElement('map-input');
      zoomInput.setAttribute('name', 'z');
      zoomInput.setAttribute('type', 'zoom');
      zoomInput.setAttribute('value', '17');
      zoomInput.setAttribute('min', '0');
      zoomInput.setAttribute('max', '17');
      baseExtent.appendChild(zoomInput);
      
      const yInput = document.createElement('map-input');
      yInput.setAttribute('name', 'y');
      yInput.setAttribute('type', 'location');
      yInput.setAttribute('units', 'tilematrix');
      yInput.setAttribute('axis', 'row');
      baseExtent.appendChild(yInput);
      
      const xInput = document.createElement('map-input');
      xInput.setAttribute('name', 'x');
      xInput.setAttribute('type', 'location');
      xInput.setAttribute('units', 'tilematrix');
      xInput.setAttribute('axis', 'column');
      baseExtent.appendChild(xInput);
      
      const tileLink = document.createElement('map-link');
      tileLink.setAttribute('rel', 'tile');
      tileLink.setAttribute('tref', 'https://geoappext.nrcan.gc.ca/arcgis/rest/services/BaseMaps/CBMT3978/MapServer/tile/{z}/{y}/{x}?m4h=t');
      baseExtent.appendChild(tileLink);
      
    } else if (projection === 'APSTILE') {
      baseLayer.setAttribute('label', 'Arctic Ocean Base');
      baseLayer.setAttribute('checked', '');
      baseExtent.setAttribute('units', 'APSTILE');
      
      const licenseLink = document.createElement('map-link');
      licenseLink.setAttribute('rel', 'license');
      licenseLink.setAttribute('href', 'https://www.esri.com/legal/software-license');
      licenseLink.setAttribute('title', 'Sources: Esri, GEBCO, NOAA, National Geographic, DeLorme, HERE, Geonames.org, and other contributors');
      baseExtent.appendChild(licenseLink);
      
      const zoomInput = document.createElement('map-input');
      zoomInput.setAttribute('name', 'z');
      zoomInput.setAttribute('type', 'zoom');
      zoomInput.setAttribute('value', '16');
      zoomInput.setAttribute('min', '0');
      zoomInput.setAttribute('max', '16');
      baseExtent.appendChild(zoomInput);
      
      const yInput = document.createElement('map-input');
      yInput.setAttribute('name', 'y');
      yInput.setAttribute('type', 'location');
      yInput.setAttribute('units', 'tilematrix');
      yInput.setAttribute('axis', 'row');
      baseExtent.appendChild(yInput);
      
      const xInput = document.createElement('map-input');
      xInput.setAttribute('name', 'x');
      xInput.setAttribute('type', 'location');
      xInput.setAttribute('units', 'tilematrix');
      xInput.setAttribute('axis', 'column');
      baseExtent.appendChild(xInput);
      
      const tileLink = document.createElement('map-link');
      tileLink.setAttribute('rel', 'tile');
      tileLink.setAttribute('tref', 'https://server.arcgisonline.com/arcgis/rest/services/Polar/Arctic_Ocean_Base/MapServer/tile/{z}/{y}/{x}');
      baseExtent.appendChild(tileLink);
    }
    
    baseLayer.appendChild(baseExtent);
    viewer.appendChild(baseLayer);
  }

  // Add the ImageServer layer
  addESRIImageServerLayerToViewer(viewer, layer, serviceInfo, queryEnabled, selectedFormat, boundsEnabled);

  container.appendChild(viewer);
  
  console.log('Created ESRI ImageServer viewer for:', layer.name);
}

// Add ESRI ImageServer layer to viewer
function addESRIImageServerLayerToViewer(viewer, layer, serviceInfo, queryEnabled, selectedFormat, boundsEnabled) {
  const viewerProjection = viewer.getAttribute('projection') || 'OSMTILE';
  const { bbox } = layer;

  const mapLayer = document.createElement('map-layer');
  mapLayer.setAttribute('label', layer.title);
  mapLayer.setAttribute('checked', '');
  mapLayer.setAttribute('data-esri-layer', layer.name);
  mapLayer.setAttribute('data-service-type', 'ESRI-ImageServer');

  // Add bounds if enabled
  if (boundsEnabled && bbox) {
    const mapMeta = document.createElement('map-meta');
    mapMeta.setAttribute('name', 'extent');
    
    let content;
    if (serviceInfo.wkid === 4326) {
      content = `top-left-longitude=${bbox.minx}, top-left-latitude=${bbox.maxy}, bottom-right-longitude=${bbox.maxx}, bottom-right-latitude=${bbox.miny}`;
    } else {
      content = `top-left-easting=${bbox.minx}, top-left-northing=${bbox.maxy}, bottom-right-easting=${bbox.maxx}, bottom-right-northing=${bbox.miny}`;
    }
    mapMeta.setAttribute('content', content);
    mapLayer.appendChild(mapMeta);
  }

  // Add copyright as license link if available
  if (serviceInfo.copyrightText) {
    const licenseLink = document.createElement('map-link');
    licenseLink.setAttribute('rel', 'license');
    licenseLink.setAttribute('title', serviceInfo.copyrightText);
    licenseLink.setAttribute('href', '#');
    mapLayer.appendChild(licenseLink);
  }

  const mapExtent = document.createElement('map-extent');
  mapExtent.setAttribute('units', viewerProjection);
  mapExtent.setAttribute('checked', '');

  // ImageServer uses bbox inputs (always dynamic, never tiled)
  const inputs = [
    { name: 'xmin', type: 'location', units: 'pcrs', axis: 'easting', position: 'top-left' },
    { name: 'ymin', type: 'location', units: 'pcrs', axis: 'northing', position: 'bottom-left' },
    { name: 'xmax', type: 'location', units: 'pcrs', axis: 'easting', position: 'bottom-right' },
    { name: 'ymax', type: 'location', units: 'pcrs', axis: 'northing', position: 'top-right' },
    { name: 'w', type: 'width', min: '1', max: '10000' },
    { name: 'h', type: 'height', min: '1', max: '10000' }
  ];

  inputs.forEach((inp) => {
    const input = document.createElement('map-input');
    input.setAttribute('name', inp.name);
    input.setAttribute('type', inp.type);
    if (inp.position) input.setAttribute('position', inp.position);
    if (inp.axis) input.setAttribute('axis', inp.axis);
    if (inp.min) input.setAttribute('min', inp.min);
    if (inp.max) input.setAttribute('max', inp.max);
    if (inp.units) input.setAttribute('units', inp.units);
    mapExtent.appendChild(input);
  });

  // Add query inputs if query is enabled
  if (queryEnabled) {
    const iInput = document.createElement('map-input');
    iInput.setAttribute('name', 'i');
    iInput.setAttribute('type', 'location');
    iInput.setAttribute('units', 'map');
    iInput.setAttribute('axis', 'i');
    mapExtent.appendChild(iInput);

    const jInput = document.createElement('map-input');
    jInput.setAttribute('name', 'j');
    jInput.setAttribute('type', 'location');
    jInput.setAttribute('units', 'map');
    jInput.setAttribute('axis', 'j');
    mapExtent.appendChild(jInput);
  }

  // Build exportImage URL template
  const imageLink = document.createElement('map-link');
  imageLink.setAttribute('rel', 'image');
  
  // Map format - ImageServer uses different format names
  const formatMap = {
    'png': 'png',
    'jpgpng': 'jpgpng',
    'tiff': 'tiff'
  };
  const esriFormat = formatMap[selectedFormat] || 'jpgpng';
  
  // Build template URL manually to preserve {xmin}, {ymin}, etc.
  let tref = `${serviceInfo.baseUrl}/exportImage?bbox={xmin},{ymin},{xmax},{ymax}&bboxSR=${serviceInfo.wkid}&size={w},{h}&imageSR=${serviceInfo.wkid}&format=${esriFormat}&pixelType=U8&noData=0&interpolation=RSP_BilinearInterpolation&f=image`;
  
  imageLink.setAttribute('tref', tref);
  mapExtent.appendChild(imageLink);

  // Add query link if enabled
  if (queryEnabled && serviceInfo.supportsQuery) {
    const queryLink = document.createElement('map-link');
    queryLink.setAttribute('rel', 'query');
    queryLink.setAttribute('data-query-link', 'true');
    
    // ImageServer uses identify endpoint
    let qtref = `${serviceInfo.baseUrl}/identify?geometry={i},{j}&geometryType=esriGeometryPoint&sr=${serviceInfo.wkid}&tolerance=5&mapExtent={xmin},{ymin},{xmax},{ymax}&imageDisplay={w},{h},96&returnGeometry=false&returnCatalogItems=true&f=html`;
    
    queryLink.setAttribute('tref', qtref);
    mapExtent.appendChild(queryLink);
  }

  mapLayer.appendChild(mapExtent);
  viewer.appendChild(mapLayer);

  console.log('Added ESRI ImageServer layer to viewer:', layer.name);
}

function removeViewerForLayer(index) {
  const container = document.getElementById(`viewer-container-${index}`);
  if (!container) return;

  // Show the thumbnail again
  const thumbnail = document.getElementById(`preview-${index}`);
  if (thumbnail) {
    thumbnail.style.display = 'block';
  }

  // Remove the viewer (but keep the thumbnail)
  const viewer = container.querySelector('mapml-viewer');
  if (viewer) {
    viewer.remove();
  }
  console.log('Removed viewer for layer index:', index);
}

function createViewerForWMTSLayer(index, layer, serviceInfo, selectedFormat, queryEnabled, selectedStyle, imageFormat, projection, boundsEnabled) {
  const container = document.getElementById('viewer-container-' + index);
  if (!container) return;

  const thumbnail = document.getElementById('preview-' + index);
  if (thumbnail) {
    thumbnail.style.display = 'none';
  }

  const imgFormat = imageFormat || layer.formats[0] || 'image/png';
  const selectedProjection = projection || 'OSMTILE';
  const includeBounds = boundsEnabled !== undefined ? boundsEnabled : true;
  const styleName = selectedStyle || (layer.styles[0] ? layer.styles[0].name : 'default');

  const tileMatrixSet = layer.supportedTileMatrixSets.find(function(tms) {
    return tms.projection === selectedProjection;
  });
  
  if (!tileMatrixSet) {
    console.error('No TileMatrixSet found for projection:', selectedProjection);
    return;
  }

  const viewer = document.createElement('mapml-viewer');
  viewer.setAttribute('projection', selectedProjection);
  viewer.setAttribute('controls', '');
  viewer.setAttribute('zoom', '2');
  
  const bbox = layer.bbox;
  const centerLat = (parseFloat(bbox.miny) + parseFloat(bbox.maxy)) / 2;
  const centerLon = (parseFloat(bbox.minx) + parseFloat(bbox.maxx)) / 2;
  viewer.setAttribute('lat', centerLat.toString());
  viewer.setAttribute('lon', centerLon.toString());

  if (selectedProjection !== 'WGS84') {
    const baseLayer = document.createElement('map-layer');
    const baseExtent = document.createElement('map-extent');
    baseExtent.setAttribute('checked', '');
    
    if (selectedProjection === 'OSMTILE') {
      baseLayer.setAttribute('label', 'Canada Base Map');
      baseLayer.setAttribute('checked', '');
      baseExtent.setAttribute('units', 'OSMTILE');
      
      const licenseLink = document.createElement('map-link');
      licenseLink.setAttribute('rel', 'license');
      licenseLink.setAttribute('href', 'https://open.canada.ca/en/open-government-licence-canada');
      licenseLink.setAttribute('title', 'Open Government Licence - Canada');
      baseExtent.appendChild(licenseLink);
      
      const zoomInput = document.createElement('map-input');
      zoomInput.setAttribute('name', 'z');
      zoomInput.setAttribute('type', 'zoom');
      zoomInput.setAttribute('min', '0');
      zoomInput.setAttribute('max', '15');
      zoomInput.setAttribute('value', '15');
      baseExtent.appendChild(zoomInput);
      
      const yInput = document.createElement('map-input');
      yInput.setAttribute('name', 'y');
      yInput.setAttribute('type', 'location');
      yInput.setAttribute('units', 'tilematrix');
      yInput.setAttribute('axis', 'row');
      baseExtent.appendChild(yInput);
      
      const xInput = document.createElement('map-input');
      xInput.setAttribute('name', 'x');
      xInput.setAttribute('type', 'location');
      xInput.setAttribute('units', 'tilematrix');
      xInput.setAttribute('axis', 'column');
      baseExtent.appendChild(xInput);
      
      const tileLink1 = document.createElement('map-link');
      tileLink1.setAttribute('rel', 'tile');
      tileLink1.setAttribute('tref', 'https://geoappext.nrcan.gc.ca/arcgis/rest/services/BaseMaps/CBMT_CBCT_GEOM_3857/MapServer/tile/{z}/{y}/{x}?m4h=t');
      baseExtent.appendChild(tileLink1);
      
      const tileLink2 = document.createElement('map-link');
      tileLink2.setAttribute('rel', 'tile');
      tileLink2.setAttribute('tref', 'https://geoappext.nrcan.gc.ca/arcgis/rest/services/BaseMaps/CBMT_TXT_3857/MapServer/tile/{z}/{y}/{x}?m4h=t');
      baseExtent.appendChild(tileLink2);
      
    } else if (selectedProjection === 'CBMTILE') {
      baseLayer.setAttribute('label', 'Canada Base Map - Transportation');
      baseLayer.setAttribute('checked', '');
      baseExtent.setAttribute('units', 'CBMTILE');
      baseExtent.setAttribute('label', 'Canada Base Map - Transportation');
      
      const mapMeta = document.createElement('map-meta');
      mapMeta.setAttribute('name', 'extent');
      mapMeta.setAttribute('content', 'top-left-easting=-5388605, top-left-northing=7005413, bottom-right-easting=3895643, bottom-right-northing=-4427255');
      baseExtent.appendChild(mapMeta);
      
      const licenseLink = document.createElement('map-link');
      licenseLink.setAttribute('rel', 'license');
      licenseLink.setAttribute('href', 'https://open.canada.ca/en/open-government-licence-canada');
      licenseLink.setAttribute('title', 'Open Government Licence - Canada');
      baseExtent.appendChild(licenseLink);
      
      const zoomInput = document.createElement('map-input');
      zoomInput.setAttribute('name', 'z');
      zoomInput.setAttribute('type', 'zoom');
      zoomInput.setAttribute('value', '17');
      zoomInput.setAttribute('min', '0');
      zoomInput.setAttribute('max', '17');
      baseExtent.appendChild(zoomInput);
      
      const yInput = document.createElement('map-input');
      yInput.setAttribute('name', 'y');
      yInput.setAttribute('type', 'location');
      yInput.setAttribute('units', 'tilematrix');
      yInput.setAttribute('axis', 'row');
      baseExtent.appendChild(yInput);
      
      const xInput = document.createElement('map-input');
      xInput.setAttribute('name', 'x');
      xInput.setAttribute('type', 'location');
      xInput.setAttribute('units', 'tilematrix');
      xInput.setAttribute('axis', 'column');
      baseExtent.appendChild(xInput);
      
      const tileLink = document.createElement('map-link');
      tileLink.setAttribute('rel', 'tile');
      tileLink.setAttribute('tref', 'https://geoappext.nrcan.gc.ca/arcgis/rest/services/BaseMaps/CBMT3978/MapServer/tile/{z}/{y}/{x}?m4h=t');
      baseExtent.appendChild(tileLink);
      
    } else if (selectedProjection === 'APSTILE') {
      baseLayer.setAttribute('label', 'Arctic Ocean Basemap MapML Service');
      baseLayer.setAttribute('checked', '');
      baseExtent.setAttribute('units', 'APSTILE');
      baseExtent.setAttribute('label', 'Arctic Ocean Basemap MapML Service');
      
      const licenseLink = document.createElement('map-link');
      licenseLink.setAttribute('rel', 'license');
      licenseLink.setAttribute('href', 'https://www.esri.com/legal/software-license');
      licenseLink.setAttribute('title', 'Sources: Esri, GEBCO, NOAA, National Geographic, DeLorme, HERE, Geonames.org, and other contributors');
      baseExtent.appendChild(licenseLink);
      
      const zoomInput = document.createElement('map-input');
      zoomInput.setAttribute('name', 'z');
      zoomInput.setAttribute('type', 'zoom');
      zoomInput.setAttribute('value', '10');
      zoomInput.setAttribute('min', '0');
      zoomInput.setAttribute('max', '10');
      baseExtent.appendChild(zoomInput);
      
      const yInput = document.createElement('map-input');
      yInput.setAttribute('name', 'y');
      yInput.setAttribute('type', 'location');
      yInput.setAttribute('units', 'tilematrix');
      yInput.setAttribute('axis', 'row');
      baseExtent.appendChild(yInput);
      
      const xInput = document.createElement('map-input');
      xInput.setAttribute('name', 'x');
      xInput.setAttribute('type', 'location');
      xInput.setAttribute('units', 'tilematrix');
      xInput.setAttribute('axis', 'column');
      baseExtent.appendChild(xInput);
      
      const tileLink = document.createElement('map-link');
      tileLink.setAttribute('rel', 'tile');
      tileLink.setAttribute('tref', 'https://server.arcgisonline.com/arcgis/rest/services/Polar/Arctic_Ocean_Base/MapServer/tile/{z}/{y}/{x}');
      baseExtent.appendChild(tileLink);
    }
    
    baseLayer.appendChild(baseExtent);
    viewer.appendChild(baseLayer);
  }

  addWMTSLayerToViewer(viewer, layer, tileMatrixSet, selectedFormat, queryEnabled, styleName, imgFormat, includeBounds, index);

  container.appendChild(viewer);
  
  console.log('Created WMTS viewer for layer:', layer.name);
}

function addWMTSLayerToViewer(viewer, layer, tileMatrixSet, selectedFormat, queryEnabled, selectedStyle, imageFormat, boundsEnabled, layerIndex) {
  const viewerProjection = viewer.getAttribute('projection') || 'OSMTILE';
  const bbox = layer.bbox;

  const imgFormat = imageFormat || layer.formats[0] || 'image/png';
  const styleName = selectedStyle || (layer.styles[0] ? layer.styles[0].name : 'default');
  const includeBounds = boundsEnabled !== undefined ? boundsEnabled : true;

  const mapLayer = document.createElement('map-layer');
  mapLayer.setAttribute('label', layer.title);
  mapLayer.setAttribute('checked', '');
  mapLayer.setAttribute('data-wmts-layer', layer.name);
  mapLayer.setAttribute('data-service-type', 'WMTS');

  if (includeBounds && bbox) {
    const mapMeta = document.createElement('map-meta');
    mapMeta.setAttribute('name', 'extent');
    const content = 'top-left-longitude=' + bbox.minx + ', top-left-latitude=' + bbox.maxy + ', bottom-right-longitude=' + bbox.maxx + ', bottom-right-latitude=' + bbox.miny;
    mapMeta.setAttribute('content', content);
    mapLayer.appendChild(mapMeta);
  }

  if (layer.licenseUrl) {
    const licenseLink = document.createElement('map-link');
    licenseLink.setAttribute('rel', 'license');
    licenseLink.setAttribute('href', layer.licenseUrl);
    if (layer.licenseTitle) {
      licenseLink.setAttribute('title', layer.licenseTitle + ' for ' + layer.title);
    }
    mapLayer.appendChild(licenseLink);
  }
  
  // Add legend link for the selected style only (before map-extent)
  if (layer.styles && layer.styles.length > 0 && styleName) {
    const selectedStyle = layer.styles.find(function(style) { return style.name === styleName; });
    if (selectedStyle && selectedStyle.legendURLs && selectedStyle.legendURLs.length > 0) {
      // Only add the first legend URL for the selected style
      const legend = selectedStyle.legendURLs[0];
      const legendLink = document.createElement('map-link');
      legendLink.setAttribute('rel', 'legend');
      legendLink.setAttribute('href', legend.href);
      if (selectedStyle.title) {
        legendLink.setAttribute('title', selectedStyle.title);
      }
      if (legend.width) {
        legendLink.setAttribute('width', legend.width);
      }
      if (legend.height) {
        legendLink.setAttribute('height', legend.height);
      }
      mapLayer.appendChild(legendLink);
      console.log('Added WMTS legend link for selected style:', selectedStyle.title);
    }
  }

  const mapExtent = document.createElement('map-extent');
  mapExtent.setAttribute('units', viewerProjection);
  mapExtent.setAttribute('checked', '');

  // Extract zoom levels from TileMatrix identifiers, handling prefixes like "EPSG:900913:0"
  let minZoom = '0';
  let maxZoom = '18';
  
  if (tileMatrixSet.tileMatrices.length > 0) {
    const firstId = tileMatrixSet.tileMatrices[0].identifier;
    const lastId = tileMatrixSet.tileMatrices[tileMatrixSet.tileMatrices.length - 1].identifier;
    
    // Try to extract numeric suffix from identifiers like "EPSG:900913:0"
    const firstMatch = firstId ? firstId.match(/:(\d+)$/) : null;
    const lastMatch = lastId ? lastId.match(/:(\d+)$/) : null;
    
    if (firstMatch && lastMatch) {
      minZoom = firstMatch[1];
      maxZoom = lastMatch[1];
    } else {
      // Use the identifiers as-is if they're already numeric
      minZoom = firstId || '0';
      maxZoom = lastId || '18';
    }
  }

  const zoomInput = document.createElement('map-input');
  zoomInput.setAttribute('name', 'z');
  zoomInput.setAttribute('type', 'zoom');
  zoomInput.setAttribute('min', minZoom);
  zoomInput.setAttribute('max', maxZoom);
  mapExtent.appendChild(zoomInput);

  const xInput = document.createElement('map-input');
  xInput.setAttribute('name', 'x');
  xInput.setAttribute('type', 'location');
  xInput.setAttribute('units', 'tilematrix');
  xInput.setAttribute('axis', 'column');
  mapExtent.appendChild(xInput);

  const yInput = document.createElement('map-input');
  yInput.setAttribute('name', 'y');
  yInput.setAttribute('type', 'location');
  yInput.setAttribute('units', 'tilematrix');
  yInput.setAttribute('axis', 'row');
  mapExtent.appendChild(yInput);

  if (queryEnabled && layer.queryable) {
    const iInput = document.createElement('map-input');
    iInput.setAttribute('name', 'i');
    iInput.setAttribute('type', 'location');
    iInput.setAttribute('units', 'tile');
    iInput.setAttribute('axis', 'i');
    mapExtent.appendChild(iInput);

    const jInput = document.createElement('map-input');
    jInput.setAttribute('name', 'j');
    jInput.setAttribute('type', 'location');
    jInput.setAttribute('units', 'tile');
    jInput.setAttribute('axis', 'j');
    mapExtent.appendChild(jInput);
  }

  if (layer.styles && layer.styles.length > 1) {
    const mapSelect = document.createElement('map-select');
    mapSelect.setAttribute('id', 'style-selector');
    mapSelect.setAttribute('name', 'style');
    
    layer.styles.forEach(function(style) {
      const mapOption = document.createElement('map-option');
      mapOption.setAttribute('value', style.name);
      mapOption.textContent = style.title;
      
      if (style.name === styleName) {
        mapOption.setAttribute('selected', '');
      }
      
      mapSelect.appendChild(mapOption);
    });
    
    mapExtent.appendChild(mapSelect);
  }
  
  // Add dimension selectors if dimensions are available and not using template
  if (layer.dimensions && layer.dimensions.length > 0) {
    layer.dimensions.forEach(function(dimension, dimIdx) {
      if (!dimension.usesTemplate) {
        // Check if this dimension is enabled in the UI
        const dimensionCheckbox = layerIndex !== undefined ? document.getElementById('dim-enabled-' + layerIndex + '-' + dimIdx) : null;
        const isDimensionEnabled = !dimensionCheckbox || dimensionCheckbox.checked;
        
        if (!isDimensionEnabled) {
          console.log('Skipping disabled WMTS dimension:', dimension.name);
          return;
        }
        
        // Get the selected value from the UI dropdown
        const dimensionSelect = layerIndex !== undefined ? document.getElementById('dim-' + layerIndex + '-' + dimIdx) : null;
        const selectedValue = dimensionSelect ? dimensionSelect.value : dimension.default;
        
        const mapSelect = document.createElement('map-select');
        mapSelect.setAttribute('id', dimension.name + '-selector');
        mapSelect.setAttribute('name', dimension.name);
        
        dimension.values.forEach(function(value) {
          const mapOption = document.createElement('map-option');
          mapOption.setAttribute('value', value);
          mapOption.textContent = value;
          
          // Mark the selected value from UI
          if (value === selectedValue) {
            mapOption.setAttribute('selected', '');
          }
          
          mapSelect.appendChild(mapOption);
        });
        
        mapExtent.appendChild(mapSelect);
        console.log('Added WMTS dimension selector for:', dimension.name, 'with', dimension.values.length, 'options');
      }
    });
  }

  const tileResources = layer.resourceURLs['tile'] || [];
  let tileResource = tileResources.find(function(r) { return r.format === imgFormat; }) || tileResources[0];
  
  if (tileResource) {
    const mapLink = document.createElement('map-link');
    mapLink.setAttribute('rel', 'tile');
    
    let tref = tileResource.template;
    tref = tref.replace(/{TileMatrixSet}/g, tileMatrixSet.identifier);
    
    // Handle TileMatrix identifiers that may have a prefix (e.g., "EPSG:900913:0")
    // Extract prefix if all TileMatrix identifiers follow a "prefix:number" pattern
    let tileMatrixReplacement = '{z}';
    if (tileMatrixSet.tileMatrices && tileMatrixSet.tileMatrices.length > 0) {
      const firstId = tileMatrixSet.tileMatrices[0].identifier;
      const lastId = tileMatrixSet.tileMatrices[tileMatrixSet.tileMatrices.length - 1].identifier;
      
      // Check if identifiers end with numbers and have a common prefix
      const firstMatch = firstId ? firstId.match(/^(.+):(\d+)$/) : null;
      const lastMatch = lastId ? lastId.match(/^(.+):(\d+)$/) : null;
      
      if (firstMatch && lastMatch && firstMatch[1] === lastMatch[1]) {
        // All TileMatrix identifiers share the same prefix
        tileMatrixReplacement = firstMatch[1] + ':{z}';
      }
    }
    
    tref = tref.replace(/{TileMatrix}/g, tileMatrixReplacement);
    tref = tref.replace(/{TileRow}/g, '{y}');
    tref = tref.replace(/{TileCol}/g, '{x}');
    tref = tref.replace(/{Style}/g, styleName);
    tref = tref.replace(/{style}/g, styleName);
    
    // Handle dimension parameters in template URL
    if (layer.dimensions && layer.dimensions.length > 0) {
      layer.dimensions.forEach(function(dimension) {
        const dimPattern = new RegExp('\\{' + dimension.name + '\\}', 'g');
        if (dimension.usesTemplate) {
          // Replace with literal default value for >200 value dimensions
          tref = tref.replace(dimPattern, dimension.default);
          console.log('Replaced WMTS dimension', dimension.name, 'with default value:', dimension.default);
        } else {
          // Keep as template variable for MapML substitution
          tref = tref.replace(dimPattern, '{' + dimension.name + '}');
        }
      });
    }
    
    mapLink.setAttribute('tref', tref);
    mapExtent.appendChild(mapLink);
  }

  if (queryEnabled && layer.queryable) {
    const queryResources = layer.resourceURLs['FeatureInfo'] || [];
    const queryResource = queryResources.find(function(r) { return r.format === selectedFormat; }) || queryResources[0];
    
    if (queryResource) {
      const queryLink = document.createElement('map-link');
      queryLink.setAttribute('rel', 'query');
      queryLink.setAttribute('data-query-link', 'true');
      
      let qtref = queryResource.template;
      qtref = qtref.replace(/{TileMatrixSet}/g, tileMatrixSet.identifier);
      
      // Handle TileMatrix identifiers that may have a prefix (e.g., "EPSG:900913:0")
      let tileMatrixReplacement = '{z}';
      if (tileMatrixSet.tileMatrices && tileMatrixSet.tileMatrices.length > 0) {
        const firstId = tileMatrixSet.tileMatrices[0].identifier;
        const lastId = tileMatrixSet.tileMatrices[tileMatrixSet.tileMatrices.length - 1].identifier;
        
        const firstMatch = firstId ? firstId.match(/^(.+):(\d+)$/) : null;
        const lastMatch = lastId ? lastId.match(/^(.+):(\d+)$/) : null;
        
        if (firstMatch && lastMatch && firstMatch[1] === lastMatch[1]) {
          tileMatrixReplacement = firstMatch[1] + ':{z}';
        }
      }
      
      qtref = qtref.replace(/{TileMatrix}/g, tileMatrixReplacement);
      qtref = qtref.replace(/{TileRow}/g, '{y}');
      qtref = qtref.replace(/{TileCol}/g, '{x}');
      qtref = qtref.replace(/{Style}/g, styleName);
      qtref = qtref.replace(/{style}/g, styleName);
      qtref = qtref.replace(/{I}/g, '{i}');
      qtref = qtref.replace(/{J}/g, '{j}');
      qtref = qtref.replace(/{InfoFormat}/g, selectedFormat);
      qtref = qtref.replace(/{infoformat}/g, selectedFormat);
      
      // Handle dimension parameters in query template URL
      if (layer.dimensions && layer.dimensions.length > 0) {
        layer.dimensions.forEach(function(dimension) {
          const dimPattern = new RegExp('\\{' + dimension.name + '\\}', 'g');
          if (dimension.usesTemplate) {
            // Replace with literal default value for >200 value dimensions
            qtref = qtref.replace(dimPattern, dimension.default);
          } else {
            // Keep as template variable for MapML substitution
            qtref = qtref.replace(dimPattern, '{' + dimension.name + '}');
          }
        });
      }
      
      queryLink.setAttribute('tref', qtref);
      mapExtent.appendChild(queryLink);
    }
  }

  mapLayer.appendChild(mapExtent);
  viewer.appendChild(mapLayer);

  console.log('Added WMTS layer to viewer:', layer.name, 'TileMatrixSet:', tileMatrixSet.identifier);
}

function addLayerToViewer(viewer, layer, version, selectedFormat, queryEnabled, selectedStyle, imageFormat, layerIndex, boundsEnabled) {
  const viewerProjection = viewer.getAttribute('projection') || 'OSMTILE';
  const { bbox } = layer;

  // Map projection to CRS code and units
  let projectionCode, units;
  switch (viewerProjection) {
    case 'OSMTILE':
      projectionCode = 'EPSG:3857';
      units = 'OSMTILE';
      break;
    case 'CBMTILE':
      projectionCode = 'EPSG:3978';
      units = 'CBMTILE';
      break;
    case 'WGS84':
      projectionCode = 'EPSG:4326';
      units = 'WGS84';
      break;
    case 'APSTILE':
      projectionCode = 'EPSG:5936';
      units = 'APSTILE';
      break;
    default:
      projectionCode = 'EPSG:3857';
      units = 'OSMTILE';
  }
  
  // Use first style if none selected and styles exist
  const styleName = selectedStyle || (layer.styles && layer.styles.length > 0 ? layer.styles[0].name : '');
  
  // Default to image/png if not specified
  const imgFormat = imageFormat || 'image/png';
  
  // Default to true if not specified
  const includeBounds = boundsEnabled !== undefined ? boundsEnabled : true;

  // Determine which bounding box to use based on projection
  let extentBbox = null;
  let extentCRS = null;
  
  // Check for projection-specific BoundingBox elements
  if (layer.boundingBoxes) {
    if (viewerProjection === 'OSMTILE' && (layer.boundingBoxes['EPSG:3857'] || layer.boundingBoxes['MapML:OSMTILE'])) {
      extentBbox = layer.boundingBoxes['EPSG:3857'] || layer.boundingBoxes['MapML:OSMTILE'];
      extentCRS = 'EPSG:3857';
    } else if (viewerProjection === 'CBMTILE' && (layer.boundingBoxes['EPSG:3978'] || layer.boundingBoxes['MapML:CBMTILE'])) {
      extentBbox = layer.boundingBoxes['EPSG:3978'] || layer.boundingBoxes['MapML:CBMTILE'];
      extentCRS = 'EPSG:3978';
    } else if (viewerProjection === 'WGS84' && (layer.boundingBoxes['EPSG:4326'] || layer.boundingBoxes['CRS:84'] || layer.boundingBoxes['MapML:WGS84'])) {
      extentBbox = layer.boundingBoxes['EPSG:4326'] || layer.boundingBoxes['CRS:84'] || layer.boundingBoxes['MapML:WGS84'];
      extentCRS = 'EPSG:4326';
    } else if (viewerProjection === 'APSTILE' && (layer.boundingBoxes['EPSG:5936'] || layer.boundingBoxes['MapML:APSTILE'])) {
      extentBbox = layer.boundingBoxes['EPSG:5936'] || layer.boundingBoxes['MapML:APSTILE'];
      extentCRS = 'EPSG:5936';
    }
  }
  
  // Fall back to transforming EX_GeographicBoundingBox if no projection-specific bbox found
  if (!extentBbox) {
    if (viewerProjection === 'OSMTILE') {
      // Transform WGS84 to Web Mercator
      const minCoords = wgs84ToWebMercator(parseFloat(bbox.minx), parseFloat(bbox.miny));
      const maxCoords = wgs84ToWebMercator(parseFloat(bbox.maxx), parseFloat(bbox.maxy));
      extentBbox = {
        minx: minCoords.x.toString(),
        miny: minCoords.y.toString(),
        maxx: maxCoords.x.toString(),
        maxy: maxCoords.y.toString(),
      };
      extentCRS = 'EPSG:3857';
    } else {
      // Use geographic bbox as-is
      extentBbox = bbox;
      extentCRS = 'EPSG:4326';
    }
  }

  // Create map-layer element
  const mapLayer = document.createElement('map-layer');
  mapLayer.setAttribute('label', layer.title);
  mapLayer.setAttribute('checked', '');
  mapLayer.setAttribute('data-wms-layer', layer.name);

  // Add map-meta extent if enabled
  if (includeBounds && extentBbox) {
    const mapMeta = document.createElement('map-meta');
    mapMeta.setAttribute('name', 'extent');
    
    // Use appropriate coordinate names based on CRS
    let content;
    if (extentCRS === 'EPSG:4326' || extentCRS === 'CRS:84') {
      // Geographic coordinates (longitude/latitude)
      content = `top-left-longitude=${extentBbox.minx}, top-left-latitude=${extentBbox.maxy}, bottom-right-longitude=${extentBbox.maxx}, bottom-right-latitude=${extentBbox.miny}`;
    } else {
      // Projected coordinates (easting/northing)
      content = `top-left-easting=${extentBbox.minx}, top-left-northing=${extentBbox.maxy}, bottom-right-easting=${extentBbox.maxx}, bottom-right-northing=${extentBbox.miny}`;
    }
    
    mapMeta.setAttribute('content', content);
    mapLayer.appendChild(mapMeta);
  }

  // Add license link if available (before map-extent)
  if (layer.licenseUrl) {
    const licenseLink = document.createElement('map-link');
    licenseLink.setAttribute('rel', 'license');
    licenseLink.setAttribute('href', layer.licenseUrl);
    if (layer.licenseTitle) {
      licenseLink.setAttribute('title', `${layer.licenseTitle} for ${layer.title}`);
    }
    mapLayer.appendChild(licenseLink);
    console.log('Added license link to layer:', layer.name, 'URL:', layer.licenseUrl, 'Title:', layer.licenseTitle || 'none');
  } else {
    console.log('No license URL for layer:', layer.name);
  }
  
  // Add legend link for the selected style only (before map-extent)
  if (layer.styles && layer.styles.length > 0 && styleName) {
    const selectedStyle = layer.styles.find(style => style.name === styleName);
    if (selectedStyle && selectedStyle.legendURLs && selectedStyle.legendURLs.length > 0) {
      // Only add the first legend URL for the selected style
      const legend = selectedStyle.legendURLs[0];
      const legendLink = document.createElement('map-link');
      legendLink.setAttribute('rel', 'legend');
      legendLink.setAttribute('href', legend.href);
      if (selectedStyle.title) {
        legendLink.setAttribute('title', selectedStyle.title);
      }
      if (legend.width) {
        legendLink.setAttribute('width', legend.width);
      }
      if (legend.height) {
        legendLink.setAttribute('height', legend.height);
      }
      mapLayer.appendChild(legendLink);
      console.log('Added legend link for selected style:', selectedStyle.title);
    }
  }

  // Create map-extent
  const mapExtent = document.createElement('map-extent');
  mapExtent.setAttribute('units', units);
  mapExtent.setAttribute('checked', '');

  // Create inputs for bbox (omitting min/max attributes for location inputs)
  const inputs = [
    { name: 'xmin', type: 'location', units: 'pcrs', axis: 'easting', position: 'top-left' },
    { name: 'ymin', type: 'location', units: 'pcrs', axis: 'northing', position: 'bottom-left' },
    { name: 'xmax', type: 'location', units: 'pcrs', axis: 'easting', position: 'bottom-right' },
    { name: 'ymax', type: 'location', units: 'pcrs', axis: 'northing', position: 'top-right' },
    { name: 'w', type: 'width', min: '1', max: '10000' },
    { name: 'h', type: 'height', min: '1', max: '10000' },
    { name: 'i', type: 'location', units: 'map', axis: 'i' },
    { name: 'j', type: 'location', units: 'map', axis: 'j' },
  ];

  inputs.forEach((inp) => {
    const input = document.createElement('map-input');
    input.setAttribute('name', inp.name);
    input.setAttribute('type', inp.type);
    if (inp.position) input.setAttribute('position', inp.position);
    if (inp.axis) input.setAttribute('axis', inp.axis);
    if (inp.min) input.setAttribute('min', inp.min);
    if (inp.max) input.setAttribute('max', inp.max);
    if (inp.units) input.setAttribute('units', inp.units);
    mapExtent.appendChild(input);
  });

  // Add style selector if styles are available
  if (layer.styles && layer.styles.length > 0) {
    const mapSelect = document.createElement('map-select');
    mapSelect.setAttribute('id', 'style-selector');
    mapSelect.setAttribute('name', 'style');
    
    layer.styles.forEach((style) => {
      const mapOption = document.createElement('map-option');
      mapOption.setAttribute('value', style.name);
      mapOption.textContent = style.title;
      
      // Mark the selected style
      if (style.name === styleName) {
        mapOption.setAttribute('selected', '');
      }
      
      mapSelect.appendChild(mapOption);
    });
    
    mapExtent.appendChild(mapSelect);
  }

  // Add dimension selectors if dimensions are available and enabled
  if (layer.dimensions && layer.dimensions.length > 0) {
    layer.dimensions.forEach((dimension, dimIdx) => {
      // Check if this dimension is enabled in the UI
      const dimensionCheckbox = layerIndex !== undefined ? document.getElementById(`dim-enabled-${layerIndex}-${dimIdx}`) : null;
      const isDimensionEnabled = !dimensionCheckbox || dimensionCheckbox.checked;
      
      if (!isDimensionEnabled) {
        console.log('Skipping disabled dimension:', dimension.name);
        return;
      }
      
      // Get the selected value from the UI dropdown
      const dimensionSelect = layerIndex !== undefined ? document.getElementById(`dim-${layerIndex}-${dimIdx}`) : null;
      const selectedValue = dimensionSelect ? dimensionSelect.value : dimension.default;
      
      const mapSelect = document.createElement('map-select');
      mapSelect.setAttribute('id', `${dimension.name}-selector`);
      mapSelect.setAttribute('name', dimension.name);
      
      dimension.values.forEach((value) => {
        const mapOption = document.createElement('map-option');
        mapOption.setAttribute('value', value);
        mapOption.textContent = value;
        
        // Mark the selected value from UI
        if (value === selectedValue) {
          mapOption.setAttribute('selected', '');
        }
        
        mapSelect.appendChild(mapOption);
      });
      
      mapExtent.appendChild(mapSelect);
      console.log('Added dimension selector for:', dimension.name, 'with', dimension.values.length, 'options');
    });
  }

  // Create map-link for image
  const mapLink = document.createElement('map-link');
  mapLink.setAttribute('rel', 'image');

  // Build URL manually to preserve template variables
  let tref = `${currentWmsBaseUrl}?SERVICE=WMS&VERSION=${version}&REQUEST=GetMap&LAYERS=${encodeURIComponent(layer.name)}&WIDTH={w}&HEIGHT={h}&FORMAT=${encodeURIComponent(imgFormat)}`;
  
  // Only add TRANSPARENT=TRUE for formats that support transparency
  if (imgFormat.toLowerCase().includes('png') || imgFormat.toLowerCase().includes('gif')) {
    tref += '&TRANSPARENT=TRUE';
  }
  
  // Add STYLES parameter if a style is selected
  if (styleName) {
    tref += '&STYLES={style}';
  }

  // Add dimension parameters only if enabled in UI
  if (layer.dimensions && layer.dimensions.length > 0) {
    layer.dimensions.forEach((dimension, dimIdx) => {
      const dimensionCheckbox = layerIndex !== undefined ? document.getElementById(`dim-enabled-${layerIndex}-${dimIdx}`) : null;
      const isDimensionEnabled = !dimensionCheckbox || dimensionCheckbox.checked;
      
      if (isDimensionEnabled) {
        const paramName = formatDimensionParam(dimension.name);
        tref += `&${paramName}={${dimension.name}}`;
      }
    });
  }

  if (version.startsWith('1.3')) {
    tref += `&CRS=${projectionCode}`;
    // WMS 1.3.0 with EPSG:4326 requires latitude,longitude order (ymin,xmin,ymax,xmax)
    // All other CRS use standard xmin,ymin,xmax,ymax order
    if (projectionCode === 'EPSG:4326') {
      tref += '&BBOX={ymin},{xmin},{ymax},{xmax}';
    } else {
      tref += '&BBOX={xmin},{ymin},{xmax},{ymax}';
    }
  } else {
    tref += `&SRS=${projectionCode}`;
    tref += '&BBOX={xmin},{ymin},{xmax},{ymax}';
  }

  mapLink.setAttribute('tref', tref);
  mapExtent.appendChild(mapLink);

  // Add query link if query is enabled
  if (queryEnabled && layer.queryable) {
    const queryLink = createQueryLink(layer, version, projectionCode, selectedFormat, layerIndex, styleName, imgFormat);
    mapExtent.appendChild(queryLink);
  }

  mapLayer.appendChild(mapExtent);
  
  viewer.appendChild(mapLayer);

  console.log('Added layer to viewer:', layer.name);
}

function updateLayerQueryInViewer(index, layerName, queryEnabled, layer, version, selectedFormat) {
  const container = document.getElementById(`viewer-container-${index}`);
  if (!container) return;

  const viewer = container.querySelector('mapml-viewer');
  if (!viewer) return;

  const mapLayer = viewer.querySelector(`map-layer[data-wms-layer="${layerName}"]`);
  if (!mapLayer) return;

  const mapExtent = mapLayer.querySelector('map-extent');
  const existingQueryLink = mapExtent.querySelector('map-link[data-query-link="true"]');

  if (queryEnabled) {
    // Remove existing query link if present
    if (existingQueryLink) {
      existingQueryLink.remove();
    }
    // Add query link with selected format
    const viewerProjection = viewer.getAttribute('projection') || 'OSMTILE';
    
    // Map projection to CRS code (same logic as addLayerToViewer)
    let projectionCode;
    switch (viewerProjection) {
      case 'OSMTILE':
        projectionCode = 'EPSG:3857';
        break;
      case 'CBMTILE':
        projectionCode = 'EPSG:3978';
        break;
      case 'WGS84':
        projectionCode = 'EPSG:4326';
        break;
      case 'APSTILE':
        projectionCode = 'EPSG:5936';
        break;
      default:
        projectionCode = 'EPSG:3857';
    }
    
    // Get current style and image format from UI
    const styleSelect = document.getElementById(`style-${index}`);
    const styleName = styleSelect ? styleSelect.value : (layer.styles && layer.styles.length > 0 ? layer.styles[0].name : '');
    const imgFormatSelect = document.getElementById(`img-format-${index}`);
    const imgFormat = imgFormatSelect ? imgFormatSelect.value : 'image/png';
    
    const queryLink = createQueryLink(layer, version, projectionCode, selectedFormat, index, styleName, imgFormat);
    mapExtent.appendChild(queryLink);
    console.log('Added/updated query support to layer:', layerName, 'with format:', selectedFormat);
  } else if (!queryEnabled && existingQueryLink) {
    // Remove query link
    existingQueryLink.remove();
    console.log('Removed query support from layer:', layerName);
  }
}

function updateESRIImageServerQueryInViewer(index, layerName, queryEnabled, serviceInfo, selectedFormat) {
  const container = document.getElementById(`viewer-container-${index}`);
  if (!container) return;

  const viewer = container.querySelector('mapml-viewer');
  if (!viewer) return;

  // For ESRI ImageServer, get the layer by service type since there's only one data layer
  const mapLayer = viewer.querySelector(`map-layer[data-service-type="ESRI-ImageServer"]`);
  if (!mapLayer) return;

  const mapExtent = mapLayer.querySelector('map-extent');
  if (!mapExtent) {
    console.error('Map extent not found');
    return;
  }
  
  const existingQueryLink = mapExtent.querySelector('map-link[data-query-link="true"]');
  const existingIInput = mapExtent.querySelector('map-input[name="i"]');
  const existingJInput = mapExtent.querySelector('map-input[name="j"]');

  if (queryEnabled && serviceInfo.supportsQuery) {
    // Remove existing query elements if present
    if (existingQueryLink) existingQueryLink.remove();
    if (existingIInput) existingIInput.remove();
    if (existingJInput) existingJInput.remove();

    // Add query inputs (i, j)
    const iInput = document.createElement('map-input');
    iInput.setAttribute('name', 'i');
    iInput.setAttribute('type', 'location');
    iInput.setAttribute('units', 'map');
    iInput.setAttribute('axis', 'i');
    mapExtent.appendChild(iInput);

    const jInput = document.createElement('map-input');
    jInput.setAttribute('name', 'j');
    jInput.setAttribute('type', 'location');
    jInput.setAttribute('units', 'map');
    jInput.setAttribute('axis', 'j');
    mapExtent.appendChild(jInput);

    // Add query link with identify endpoint
    const queryLink = document.createElement('map-link');
    queryLink.setAttribute('rel', 'query');
    queryLink.setAttribute('data-query-link', 'true');
    
    let qtref = `${serviceInfo.baseUrl}/identify?geometry={i},{j}&geometryType=esriGeometryPoint&sr=${serviceInfo.wkid}&tolerance=5&mapExtent={xmin},{ymin},{xmax},{ymax}&imageDisplay={w},{h},96&returnGeometry=false&returnCatalogItems=true&f=html`;
    
    queryLink.setAttribute('tref', qtref);
    mapExtent.appendChild(queryLink);

    console.log('Added/updated query support to ESRI ImageServer layer:', layerName);
  } else {
    // Remove query elements
    if (existingQueryLink) existingQueryLink.remove();
    if (existingIInput) existingIInput.remove();
    if (existingJInput) existingJInput.remove();
    console.log('Removed query support from ESRI ImageServer layer:', layerName);
  }
}

function updateESRIMapServerQueryInViewer(index, layer, serviceInfo, queryEnabled, selectedFormat) {
  const container = document.getElementById(`viewer-container-${index}`);
  if (!container) return;

  const viewer = container.querySelector('mapml-viewer');
  if (!viewer) return;

  // For ESRI MapServer, get the layer by service type
  const mapLayer = viewer.querySelector(`map-layer[data-service-type="ESRI-MapServer"]`);
  if (!mapLayer) return;

  const mapExtent = mapLayer.querySelector('map-extent');
  if (!mapExtent) return;

  // Check if this is a tiled service (has tile link instead of image link)
  const isTiled = mapExtent.querySelector('map-link[rel="tile"]') !== null;
  if (isTiled) return; // Query not supported for tiled services
  
  const existingQueryLink = mapExtent.querySelector('map-link[data-query-link="true"]');
  const existingIInput = mapExtent.querySelector('map-input[name="i"]');
  const existingJInput = mapExtent.querySelector('map-input[name="j"]');

  if (queryEnabled && serviceInfo.supportsQuery) {
    // Remove existing query elements if present
    if (existingQueryLink) existingQueryLink.remove();
    if (existingIInput) existingIInput.remove();
    if (existingJInput) existingJInput.remove();

    // Add query inputs (i, j)
    const iInput = document.createElement('map-input');
    iInput.setAttribute('name', 'i');
    iInput.setAttribute('type', 'location');
    iInput.setAttribute('units', 'map');
    iInput.setAttribute('axis', 'i');
    mapExtent.appendChild(iInput);

    const jInput = document.createElement('map-input');
    jInput.setAttribute('name', 'j');
    jInput.setAttribute('type', 'location');
    jInput.setAttribute('units', 'map');
    jInput.setAttribute('axis', 'j');
    mapExtent.appendChild(jInput);

    // Add query link with identify endpoint
    const queryLink = document.createElement('map-link');
    queryLink.setAttribute('rel', 'query');
    queryLink.setAttribute('data-query-link', 'true');
    
    let qtref = `${serviceInfo.baseUrl}/identify?geometry={i},{j}&geometryType=esriGeometryPoint&sr=${serviceInfo.wkid}&layers=all:${layer.id}&tolerance=5&mapExtent={xmin},{ymin},{xmax},{ymax}&imageDisplay={w},{h},96&returnGeometry=true&f=html`;
    
    queryLink.setAttribute('tref', qtref);
    mapExtent.appendChild(queryLink);

    console.log('Added/updated query support to ESRI MapServer layer:', layer.name);
  } else {
    // Remove query elements
    if (existingQueryLink) existingQueryLink.remove();
    if (existingIInput) existingIInput.remove();
    if (existingJInput) existingJInput.remove();
    console.log('Removed query support from ESRI MapServer layer:', layer.name);
  }
}

function updateWMTSQueryInViewer(index, layer, tileMatrixSet, queryEnabled, selectedFormat, selectedStyle, imageFormat) {
  const container = document.getElementById(`viewer-container-${index}`);
  if (!container) return;

  const viewer = container.querySelector('mapml-viewer');
  if (!viewer) return;

  // For WMTS, get the layer by service type
  const mapLayer = viewer.querySelector(`map-layer[data-service-type="WMTS"]`);
  if (!mapLayer) return;

  const mapExtent = mapLayer.querySelector('map-extent');
  if (!mapExtent) return;

  const existingQueryLink = mapExtent.querySelector('map-link[data-query-link="true"]');
  const existingIInput = mapExtent.querySelector('map-input[name="i"]');
  const existingJInput = mapExtent.querySelector('map-input[name="j"]');

  if (queryEnabled && layer.queryable) {
    // Remove existing query elements if present
    if (existingQueryLink) existingQueryLink.remove();
    if (existingIInput) existingIInput.remove();
    if (existingJInput) existingJInput.remove();

    // Add query inputs (i, j) - WMTS uses 'tile' units
    const iInput = document.createElement('map-input');
    iInput.setAttribute('name', 'i');
    iInput.setAttribute('type', 'location');
    iInput.setAttribute('units', 'tile');
    iInput.setAttribute('axis', 'i');
    mapExtent.appendChild(iInput);

    const jInput = document.createElement('map-input');
    jInput.setAttribute('name', 'j');
    jInput.setAttribute('type', 'location');
    jInput.setAttribute('units', 'tile');
    jInput.setAttribute('axis', 'j');
    mapExtent.appendChild(jInput);

    // Build query link from resource URL template
    const queryResources = layer.resourceURLs['FeatureInfo'] || [];
    const queryResource = queryResources.find(function(r) { return r.format === selectedFormat; }) || queryResources[0];
    
    if (queryResource) {
      const queryLink = document.createElement('map-link');
      queryLink.setAttribute('rel', 'query');
      queryLink.setAttribute('data-query-link', 'true');
      
      let qtref = queryResource.template;
      qtref = qtref.replace(/{TileMatrixSet}/g, tileMatrixSet.identifier);
      
      // Handle TileMatrix identifiers with prefix
      let tileMatrixReplacement = '{z}';
      if (tileMatrixSet.tileMatrices && tileMatrixSet.tileMatrices.length > 0) {
        const firstId = tileMatrixSet.tileMatrices[0].identifier;
        const lastId = tileMatrixSet.tileMatrices[tileMatrixSet.tileMatrices.length - 1].identifier;
        
        const firstMatch = firstId ? firstId.match(/^(.+):(\d+)$/) : null;
        const lastMatch = lastId ? lastId.match(/^(.+):(\d+)$/) : null;
        
        if (firstMatch && lastMatch && firstMatch[1] === lastMatch[1]) {
          tileMatrixReplacement = firstMatch[1] + ':{z}';
        }
      }
      
      qtref = qtref.replace(/{TileMatrix}/g, tileMatrixReplacement);
      qtref = qtref.replace(/{TileRow}/g, '{y}');
      qtref = qtref.replace(/{TileCol}/g, '{x}');
      qtref = qtref.replace(/{Style}/g, selectedStyle);
      qtref = qtref.replace(/{style}/g, selectedStyle);
      qtref = qtref.replace(/{I}/g, '{i}');
      qtref = qtref.replace(/{J}/g, '{j}');
      qtref = qtref.replace(/{InfoFormat}/g, selectedFormat);
      qtref = qtref.replace(/{infoformat}/g, selectedFormat);
      
      // Handle dimension parameters in query template URL
      if (layer.dimensions && layer.dimensions.length > 0) {
        layer.dimensions.forEach(function(dimension) {
          const dimPattern = new RegExp('\\{' + dimension.name + '\\}', 'g');
          if (dimension.usesTemplate) {
            qtref = qtref.replace(dimPattern, dimension.default);
          } else {
            qtref = qtref.replace(dimPattern, '{' + dimension.name + '}');
          }
        });
      }
      
      queryLink.setAttribute('tref', qtref);
      mapExtent.appendChild(queryLink);
    }

    console.log('Added/updated query support to WMTS layer:', layer.name);
  } else {
    // Remove query elements
    if (existingQueryLink) existingQueryLink.remove();
    if (existingIInput) existingIInput.remove();
    if (existingJInput) existingJInput.remove();
    console.log('Removed query support from WMTS layer:', layer.name);
  }
}
