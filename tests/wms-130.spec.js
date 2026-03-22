import { test, expect } from '@playwright/test';
import {
  routeFixture,
  interceptTileRequests,
  loadService,
  getLayerElements,
  activateLayer,
  getViewer,
  viewerLocator,
} from './helpers.js';

const SERVICE_URL = 'https://test.example.com/wms?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetCapabilities';

test.beforeEach(async ({ page }) => {
  await interceptTileRequests(page);
  await routeFixture(page, '**/test.example.com/**', 'wms-130.xml');
  await page.goto('/index.html');
});

test.describe('WMS 1.3.0 — Service Info', () => {
  test('displays service title and version', async ({ page }) => {
    await loadService(page, SERVICE_URL);
    const details = page.locator('#service-details');
    await expect(details).toContainText('Test WMS 1.3.0 Service');
    await expect(details).toContainText('1.3.0');
  });

  test('shows WMS badge', async ({ page }) => {
    await loadService(page, SERVICE_URL);
    await expect(page.locator('.service-type-badge')).toContainText('WMS');
  });

  test('lists correct number of layers', async ({ page }) => {
    await loadService(page, SERVICE_URL);
    await expect(getLayerElements(page)).toHaveCount(2);
  });

  test('displays layer titles', async ({ page }) => {
    await loadService(page, SERVICE_URL);
    const layers = getLayerElements(page);
    await expect(layers.nth(0)).toContainText('Temperature Layer');
    await expect(layers.nth(1)).toContainText('Administrative Boundaries');
  });
});

test.describe('WMS 1.3.0 — Viewer Generation', () => {
  test('creates mapml-viewer with correct projection', async ({ page }) => {
    await loadService(page, SERVICE_URL);
    await activateLayer(page, 0);
    const viewer = getViewer(page, 0);
    await expect(viewer).toHaveAttribute('projection', 'OSMTILE');
    await expect(viewer).toHaveAttribute('controls', '');
  });

  test('creates map-layer with correct label', async ({ page }) => {
    await loadService(page, SERVICE_URL);
    await activateLayer(page, 0);
    const mapLayer = viewerLocator(page, 0, 'map-layer[data-wms-layer]');
    await expect(mapLayer).toHaveAttribute('label', 'Temperature Layer');
    await expect(mapLayer).toHaveAttribute('checked', '');
  });

  test('creates map-extent with correct units', async ({ page }) => {
    await loadService(page, SERVICE_URL);
    await activateLayer(page, 0);
    const mapLayer = viewerLocator(page, 0, 'map-layer[data-wms-layer]');
    const extent = mapLayer.locator('map-extent');
    await expect(extent).toHaveAttribute('units', 'OSMTILE');
  });

  test('creates map-input elements for location and size', async ({ page }) => {
    await loadService(page, SERVICE_URL);
    await activateLayer(page, 0);
    const extent = viewerLocator(page, 0, 'map-extent');

    // Location inputs
    for (const name of ['xmin', 'ymin', 'xmax', 'ymax']) {
      await expect(extent.locator(`map-input[name="${name}"]`)).toHaveCount(1);
      await expect(extent.locator(`map-input[name="${name}"]`)).toHaveAttribute(
        'type',
        'location'
      );
    }
    // Size inputs
    await expect(extent.locator('map-input[name="w"]')).toHaveAttribute('type', 'width');
    await expect(extent.locator('map-input[name="h"]')).toHaveAttribute('type', 'height');
    // Click coordinate inputs
    await expect(extent.locator('map-input[name="i"]')).toHaveCount(1);
    await expect(extent.locator('map-input[name="j"]')).toHaveCount(1);
  });
});

test.describe('WMS 1.3.0 — Image Link', () => {
  test('image tref contains correct WMS 1.3.0 params', async ({ page }) => {
    await loadService(page, SERVICE_URL);
    await activateLayer(page, 0);
    const imageLink = viewerLocator(page, 0, 'map-link[rel="image"]');
    const tref = await imageLink.getAttribute('tref');

    expect(tref).toContain('SERVICE=WMS');
    expect(tref).toContain('VERSION=1.3.0');
    expect(tref).toContain('REQUEST=GetMap');
    expect(tref).toContain('LAYERS=temperature');
    expect(tref).toContain('CRS=EPSG');
    expect(tref).toContain('{xmin}');
    expect(tref).toContain('{ymin}');
    expect(tref).toContain('{xmax}');
    expect(tref).toContain('{ymax}');
    expect(tref).toContain('{w}');
    expect(tref).toContain('{h}');
  });

  test('style selector is present with correct options', async ({ page }) => {
    await loadService(page, SERVICE_URL);
    await activateLayer(page, 0);
    const selector = viewerLocator(page, 0, 'map-select[name="style"]');
    await expect(selector).toHaveCount(1);
    const options = selector.locator('map-option');
    await expect(options).toHaveCount(2);
    await expect(options.nth(0)).toHaveAttribute('value', 'default');
    await expect(options.nth(1)).toHaveAttribute('value', 'contour');
  });
});

test.describe('WMS 1.3.0 — Query Link', () => {
  test('queryable layer has no query link by default', async ({ page }) => {
    await loadService(page, SERVICE_URL);
    await activateLayer(page, 0);
    // Query is disabled by default
    const queryLinks = viewerLocator(page, 0, 'map-link[rel="query"]');
    await expect(queryLinks).toHaveCount(0);
  });

  test('enabling query adds query link with I/J params', async ({ page }) => {
    await loadService(page, SERVICE_URL);
    await activateLayer(page, 0);
    // Enable query checkbox
    const layer = page.locator('mapmlify-layer').nth(0);
    await layer.locator('.query-format-selector input[type="checkbox"]').check();
    // Wait for query link to appear
    const queryLink = viewerLocator(page, 0, 'map-link[rel="query"]');
    await expect(queryLink).toHaveCount(1);
    const tref = await queryLink.getAttribute('tref');
    expect(tref).toContain('REQUEST=GetFeatureInfo');
    // WMS 1.3.0 uses I/J (not X/Y)
    expect(tref).toContain('I={i}');
    expect(tref).toContain('J={j}');
    expect(tref).not.toContain('X={i}');
    expect(tref).not.toContain('Y={j}');
  });

  test('non-queryable layer has no query toggle', async ({ page }) => {
    await loadService(page, SERVICE_URL);
    // Layer index 1 = "boundaries" (queryable="0")
    const layer = page.locator('mapmlify-layer').nth(1);
    await expect(layer.locator('.query-format-selector')).toHaveCount(0);
  });
});

test.describe('WMS 1.3.0 — License & Legend', () => {
  test('license link is present', async ({ page }) => {
    await loadService(page, SERVICE_URL);
    await activateLayer(page, 0);
    const license = viewerLocator(page, 0, 'map-link[rel="license"]');
    // At least one license link (basemap + data layer)
    expect(await license.count()).toBeGreaterThanOrEqual(1);
  });

  test('legend link is present for styled layer', async ({ page }) => {
    await loadService(page, SERVICE_URL);
    await activateLayer(page, 0);
    const legend = viewerLocator(page, 0, 'map-link[rel="legend"]');
    await expect(legend).toHaveCount(1);
    await expect(legend).toHaveAttribute('href', /legend\/temperature/);
  });
});

test.describe('WMS 1.3.0 — BBOX Ordering', () => {
  test('EPSG:4326 uses lat/lon BBOX order in WMS 1.3.0', async ({ page }) => {
    await loadService(page, SERVICE_URL);
    // Change projection to WGS84
    const layer = page.locator('mapmlify-layer').nth(0);
    await layer.locator('select').first().selectOption('WGS84');
    // Activate the layer (will rebuild with new projection)
    await activateLayer(page, 0);
    const imageLink = viewerLocator(page, 0, 'map-link[rel="image"]');
    const tref = await imageLink.getAttribute('tref');
    expect(tref).toContain('CRS=EPSG:4326');
    // 1.3.0 + EPSG:4326 = lat/lon order: BBOX={ymin},{xmin},{ymax},{xmax}
    expect(tref).toMatch(/BBOX=\{ymin\},\{xmin\},\{ymax\},\{xmax\}/);
  });

  test('EPSG:3857 uses standard BBOX order', async ({ page }) => {
    await loadService(page, SERVICE_URL);
    await activateLayer(page, 0);
    const imageLink = viewerLocator(page, 0, 'map-link[rel="image"]');
    const tref = await imageLink.getAttribute('tref');
    // Standard order: BBOX={xmin},{ymin},{xmax},{ymax}
    expect(tref).toMatch(/BBOX=\{xmin\},\{ymin\},\{xmax\},\{ymax\}/);
  });
});

test.describe('WMS 1.3.0 — Dimensions', () => {
  test('time dimension selector is present', async ({ page }) => {
    await loadService(page, SERVICE_URL);
    await activateLayer(page, 0);
    const extent = viewerLocator(page, 0, 'map-extent');
    const timeSelect = extent.locator('map-select[name="time"]');
    await expect(timeSelect).toHaveCount(1);
    const options = timeSelect.locator('map-option');
    await expect(options).toHaveCount(3);
  });

  test('time dimension appears in image tref', async ({ page }) => {
    await loadService(page, SERVICE_URL);
    await activateLayer(page, 0);
    const imageLink = viewerLocator(page, 0, 'map-link[rel="image"]');
    const tref = await imageLink.getAttribute('tref');
    expect(tref).toContain('TIME={time}');
  });
});
