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

const SERVICE_URL =
  'https://test.example.com/wmts?SERVICE=WMTS&VERSION=1.0.0&REQUEST=GetCapabilities';

test.beforeEach(async ({ page }) => {
  await interceptTileRequests(page);
  await routeFixture(page, '**/test.example.com/**', 'wmts-100.xml');
  await page.goto('/index.html');
});

test.describe('WMTS — Service Info', () => {
  test('displays service title and WMTS badge', async ({ page }) => {
    await loadService(page, SERVICE_URL);
    const details = page.locator('#service-details');
    await expect(details).toContainText('Test WMTS Service');
    await expect(page.locator('.service-type-badge')).toContainText('WMTS');
  });

  test('shows TileMatrixSets count', async ({ page }) => {
    await loadService(page, SERVICE_URL);
    const details = page.locator('#service-details');
    await expect(details).toContainText('TileMatrixSets');
  });

  test('lists correct number of layers', async ({ page }) => {
    await loadService(page, SERVICE_URL);
    await expect(getLayerElements(page)).toHaveCount(2);
  });

  test('displays layer titles', async ({ page }) => {
    await loadService(page, SERVICE_URL);
    const layers = getLayerElements(page);
    await expect(layers.nth(0)).toContainText('Satellite Imagery');
    await expect(layers.nth(1)).toContainText('Terrain Layer');
  });
});

test.describe('WMTS — Viewer Generation', () => {
  test('creates mapml-viewer with OSMTILE projection', async ({ page }) => {
    await loadService(page, SERVICE_URL);
    await activateLayer(page, 0);
    const viewer = getViewer(page, 0);
    await expect(viewer).toHaveAttribute('projection', 'OSMTILE');
  });

  test('creates map-layer with correct label', async ({ page }) => {
    await loadService(page, SERVICE_URL);
    await activateLayer(page, 0);
    const mapLayer = viewerLocator(page, 0, 'map-layer[data-wmts-layer]');
    await expect(mapLayer).toHaveAttribute('label', 'Satellite Imagery');
  });

  test('map-extent has correct units', async ({ page }) => {
    await loadService(page, SERVICE_URL);
    await activateLayer(page, 0);
    // Get the data layer's map-extent (second map-layer, since first is basemap)
    const mapLayer = viewerLocator(page, 0, 'map-layer[data-wmts-layer]');
    const extent = mapLayer.locator('map-extent');
    await expect(extent).toHaveAttribute('units', 'OSMTILE');
  });

  test('zoom input has correct min/max', async ({ page }) => {
    await loadService(page, SERVICE_URL);
    await activateLayer(page, 0);
    const mapLayer = viewerLocator(page, 0, 'map-layer[data-wmts-layer]');
    const zoomInput = mapLayer.locator('map-input[name="z"]');
    await expect(zoomInput).toHaveAttribute('type', 'zoom');
    await expect(zoomInput).toHaveAttribute('min', '0');
    await expect(zoomInput).toHaveAttribute('max', '3');
  });

  test('tile matrix inputs present (x, y)', async ({ page }) => {
    await loadService(page, SERVICE_URL);
    await activateLayer(page, 0);
    const mapLayer = viewerLocator(page, 0, 'map-layer[data-wmts-layer]');
    const extent = mapLayer.locator('map-extent');
    await expect(extent.locator('map-input[name="x"]')).toHaveCount(1);
    await expect(extent.locator('map-input[name="y"]')).toHaveCount(1);
    await expect(extent.locator('map-input[name="x"]')).toHaveAttribute(
      'units',
      'tilematrix'
    );
    await expect(extent.locator('map-input[name="y"]')).toHaveAttribute(
      'units',
      'tilematrix'
    );
  });
});

test.describe('WMTS — Tile Link', () => {
  test('tile tref has {z}, {x}, {y} template variables', async ({ page }) => {
    await loadService(page, SERVICE_URL);
    await activateLayer(page, 0);
    const mapLayer = viewerLocator(page, 0, 'map-layer[data-wmts-layer]');
    const tileLink = mapLayer.locator('map-link[rel="tile"]');
    await expect(tileLink).toHaveCount(1);
    const tref = await tileLink.getAttribute('tref');
    expect(tref).toContain('{z}');
    expect(tref).toContain('{x}');
    expect(tref).toContain('{y}');
    expect(tref).toContain('GoogleMapsCompatible');
  });
});

test.describe('WMTS — Query Link', () => {
  test('queryable layer gets query link by default', async ({ page }) => {
    await loadService(page, SERVICE_URL);
    await activateLayer(page, 0);
    // Query is enabled by default for queryable layers
    const mapLayer = viewerLocator(page, 0, 'map-layer[data-wmts-layer]');
    const queryLink = mapLayer.locator('map-link[rel="query"]');
    await expect(queryLink).toHaveCount(1);
    const qtref = await queryLink.getAttribute('tref');
    expect(qtref).toContain('{i}');
    expect(qtref).toContain('{j}');
  });

  test('non-queryable layer has no query toggle', async ({ page }) => {
    await loadService(page, SERVICE_URL);
    // Layer index 1 = terrain (no FeatureInfo ResourceURL)
    const layer = page.locator('mapmlify-layer').nth(1);
    await expect(layer.locator('.query-format-selector')).toHaveCount(0);
  });
});

test.describe('WMTS — Legend', () => {
  test('legend link present for styled layer', async ({ page }) => {
    await loadService(page, SERVICE_URL);
    await activateLayer(page, 0);
    const mapLayer = viewerLocator(page, 0, 'map-layer[data-wmts-layer]');
    const legend = mapLayer.locator('map-link[rel="legend"]');
    await expect(legend).toHaveCount(1);
    await expect(legend).toHaveAttribute('href', /legend\/satellite/);
  });
});
