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

const SERVICE_URL = 'https://test.example.com/arcgis/rest/services/Elevation/ImageServer?f=json';

test.beforeEach(async ({ page }) => {
  await interceptTileRequests(page);
  await routeFixture(page, '**/test.example.com/**', 'esri-imageserver.json');
  await page.goto('/index.html');
});

test.describe('ESRI ImageServer — Service Info', () => {
  test('displays service title and ImageServer badge', async ({ page }) => {
    await loadService(page, SERVICE_URL);
    const details = page.locator('#service-details');
    await expect(details).toContainText('Test Elevation Raster');
    await expect(page.locator('.service-type-badge')).toContainText('ImageServer');
  });

  test('creates single layer element', async ({ page }) => {
    await loadService(page, SERVICE_URL);
    await expect(getLayerElements(page)).toHaveCount(1);
  });

  test('shows raster properties (bands, pixel type)', async ({ page }) => {
    await loadService(page, SERVICE_URL);
    const layer = page.locator('mapmlify-layer').nth(0);
    await expect(layer).toContainText('Bands');
    await expect(layer).toContainText('3');
    await expect(layer).toContainText('Pixel Type');
    await expect(layer).toContainText('U8');
  });
});

test.describe('ESRI ImageServer — Viewer Generation', () => {
  test('creates mapml-viewer with OSMTILE projection', async ({ page }) => {
    await loadService(page, SERVICE_URL);
    await activateLayer(page, 0);
    const viewer = getViewer(page, 0);
    await expect(viewer).toHaveAttribute('projection', 'OSMTILE');
  });

  test('map-layer has correct label', async ({ page }) => {
    await loadService(page, SERVICE_URL);
    await activateLayer(page, 0);
    const mapLayer = viewerLocator(page, 0, 'map-layer[data-esri-layer]');
    await expect(mapLayer).toHaveAttribute('label', 'Test Elevation Raster');
  });

  test('exportImage link has correct tref pattern', async ({ page }) => {
    await loadService(page, SERVICE_URL);
    await activateLayer(page, 0);
    const mapLayer = viewerLocator(page, 0, 'map-layer[data-esri-layer]');
    const imageLink = mapLayer.locator('map-link[rel="image"]');
    await expect(imageLink).toHaveCount(1);
    const tref = await imageLink.getAttribute('tref');
    expect(tref).toContain('/exportImage?');
    expect(tref).toContain('bbox={xmin},{ymin},{xmax},{ymax}');
    expect(tref).toContain('size={w},{h}');
    expect(tref).toContain('format=');
  });

  test('location inputs present', async ({ page }) => {
    await loadService(page, SERVICE_URL);
    await activateLayer(page, 0);
    const mapLayer = viewerLocator(page, 0, 'map-layer[data-esri-layer]');
    const extent = mapLayer.locator('map-extent');
    for (const name of ['xmin', 'ymin', 'xmax', 'ymax']) {
      await expect(extent.locator(`map-input[name="${name}"]`)).toHaveCount(1);
    }
    await expect(extent.locator('map-input[name="w"]')).toHaveCount(1);
    await expect(extent.locator('map-input[name="h"]')).toHaveCount(1);
  });

  test('copyright link present', async ({ page }) => {
    await loadService(page, SERVICE_URL);
    await activateLayer(page, 0);
    const mapLayer = viewerLocator(page, 0, 'map-layer[data-esri-layer]');
    const license = mapLayer.locator('map-link[rel="license"]');
    await expect(license).toHaveCount(1);
    await expect(license).toHaveAttribute('title', 'Test ImageServer Copyright');
  });
});

test.describe('ESRI ImageServer — Query', () => {
  test('query toggle is present (Catalog/Metadata capabilities)', async ({ page }) => {
    await loadService(page, SERVICE_URL);
    const layer = page.locator('mapmlify-layer').nth(0);
    await expect(layer.locator('.query-format-selector')).toHaveCount(1);
  });

  test('query enabled by default adds identify link', async ({ page }) => {
    await loadService(page, SERVICE_URL);
    await activateLayer(page, 0);
    // Query is enabled by default for queryable services
    const mapLayer = viewerLocator(page, 0, 'map-layer[data-esri-layer]');
    const queryLink = mapLayer.locator('map-link[rel="query"]');
    await expect(queryLink).toHaveCount(1);
    const tref = await queryLink.getAttribute('tref');
    expect(tref).toContain('/identify?');
    expect(tref).toContain('geometry={i},{j}');
    expect(tref).toContain('geometryType=esriGeometryPoint');
    expect(tref).toContain('f=json');
  });
});
