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

const TILED_URL = 'https://test.example.com/arcgis/rest/services/Tiled/MapServer?f=json';
const DYNAMIC_URL = 'https://test.example.com/arcgis/rest/services/Dynamic/MapServer?f=json';

test.describe('ESRI MapServer (Tiled)', () => {
  test.beforeEach(async ({ page }) => {
    await interceptTileRequests(page);
    await routeFixture(page, '**/test.example.com/**', 'esri-mapserver-tiled.json');
    await page.goto('/index.html');
  });

  test('displays service title and tiled badge', async ({ page }) => {
    await loadService(page, TILED_URL);
    const details = page.locator('#service-details');
    await expect(details).toContainText('Test Tiled MapServer');
    await expect(page.locator('.service-type-badge')).toContainText('Tiled');
  });

  test('shows tile cache zoom levels', async ({ page }) => {
    await loadService(page, TILED_URL);
    const details = page.locator('#service-details');
    await expect(details).toContainText('Zoom levels');
  });

  test('lists correct number of layers', async ({ page }) => {
    await loadService(page, TILED_URL);
    await expect(getLayerElements(page)).toHaveCount(2);
  });

  test('creates viewer with OSMTILE projection', async ({ page }) => {
    await loadService(page, TILED_URL);
    await activateLayer(page, 0);
    const viewer = getViewer(page, 0);
    await expect(viewer).toHaveAttribute('projection', 'OSMTILE');
  });

  test('tile link has correct tref pattern', async ({ page }) => {
    await loadService(page, TILED_URL);
    await activateLayer(page, 0);
    const mapLayer = viewerLocator(page, 0, 'map-layer[data-esri-layer]');
    const tileLink = mapLayer.locator('map-link[rel="tile"]');
    await expect(tileLink).toHaveCount(1);
    const tref = await tileLink.getAttribute('tref');
    expect(tref).toContain('/tile/{z}/{y}/{x}');
  });

  test('zoom input has correct min/max from LODs', async ({ page }) => {
    await loadService(page, TILED_URL);
    await activateLayer(page, 0);
    const mapLayer = viewerLocator(page, 0, 'map-layer[data-esri-layer]');
    const zoomInput = mapLayer.locator('map-input[name="z"]');
    await expect(zoomInput).toHaveAttribute('min', '0');
    await expect(zoomInput).toHaveAttribute('max', '19');
  });

  test('tile matrix inputs present (x, y)', async ({ page }) => {
    await loadService(page, TILED_URL);
    await activateLayer(page, 0);
    const mapLayer = viewerLocator(page, 0, 'map-layer[data-esri-layer]');
    const extent = mapLayer.locator('map-extent');
    await expect(extent.locator('map-input[name="x"]')).toHaveCount(1);
    await expect(extent.locator('map-input[name="y"]')).toHaveCount(1);
  });

  test('copyright link present', async ({ page }) => {
    await loadService(page, TILED_URL);
    await activateLayer(page, 0);
    const mapLayer = viewerLocator(page, 0, 'map-layer[data-esri-layer]');
    const license = mapLayer.locator('map-link[rel="license"]');
    await expect(license).toHaveCount(1);
    await expect(license).toHaveAttribute('title', 'Test Copyright Notice');
  });
});

test.describe('ESRI MapServer (Dynamic)', () => {
  test.beforeEach(async ({ page }) => {
    await interceptTileRequests(page);
    await routeFixture(page, '**/test.example.com/**', 'esri-mapserver-dynamic.json');
    await page.goto('/index.html');
  });

  test('displays service title and MapServer badge', async ({ page }) => {
    await loadService(page, DYNAMIC_URL);
    const details = page.locator('#service-details');
    await expect(details).toContainText('Test Dynamic MapServer');
    await expect(page.locator('.service-type-badge')).toContainText('ESRI MapServer');
  });

  test('lists correct number of layers', async ({ page }) => {
    await loadService(page, DYNAMIC_URL);
    await expect(getLayerElements(page)).toHaveCount(2);
  });

  test('creates viewer with OSMTILE projection', async ({ page }) => {
    await loadService(page, DYNAMIC_URL);
    await activateLayer(page, 0);
    const viewer = getViewer(page, 0);
    await expect(viewer).toHaveAttribute('projection', 'OSMTILE');
  });

  test('export image link has correct tref pattern', async ({ page }) => {
    await loadService(page, DYNAMIC_URL);
    await activateLayer(page, 0);
    const mapLayer = viewerLocator(page, 0, 'map-layer[data-esri-layer]');
    const imageLink = mapLayer.locator('map-link[rel="image"]');
    await expect(imageLink).toHaveCount(1);
    const tref = await imageLink.getAttribute('tref');
    expect(tref).toContain('/export?');
    expect(tref).toContain('bbox={xmin},{ymin},{xmax},{ymax}');
    expect(tref).toContain('size={w},{h}');
    expect(tref).toContain('format=');
    expect(tref).toContain('layers=');
  });

  test('location inputs present (xmin, ymin, xmax, ymax, w, h)', async ({ page }) => {
    await loadService(page, DYNAMIC_URL);
    await activateLayer(page, 0);
    const mapLayer = viewerLocator(page, 0, 'map-layer[data-esri-layer]');
    const extent = mapLayer.locator('map-extent');
    for (const name of ['xmin', 'ymin', 'xmax', 'ymax']) {
      await expect(extent.locator(`map-input[name="${name}"]`)).toHaveCount(1);
    }
    await expect(extent.locator('map-input[name="w"]')).toHaveCount(1);
    await expect(extent.locator('map-input[name="h"]')).toHaveCount(1);
  });

  test('enabling query adds identify link', async ({ page }) => {
    await loadService(page, DYNAMIC_URL);
    await activateLayer(page, 0);
    const layer = page.locator('mapmlify-layer').nth(0);
    await layer.locator('.query-format-selector input[type="checkbox"]').check();
    // Wait for viewer rebuild
    await layer.locator('mapml-viewer').waitFor({ timeout: 15000 });
    const mapLayer = viewerLocator(page, 0, 'map-layer[data-esri-layer]');
    const queryLink = mapLayer.locator('map-link[rel="query"]');
    await expect(queryLink).toHaveCount(1);
    const tref = await queryLink.getAttribute('tref');
    expect(tref).toContain('/identify?');
    expect(tref).toContain('geometry={i},{j}');
    expect(tref).toContain('geometryType=esriGeometryPoint');
  });
});
