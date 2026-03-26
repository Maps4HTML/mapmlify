import { test, expect } from '@playwright/test';
import {
  routeFixture,
  interceptTileRequests,
  loadService,
  getLayerElements,
  activateLayer,
  viewerLocator,
} from './helpers.js';

const SERVICE_URL =
  'https://test.example.com/wms111?SERVICE=WMS&VERSION=1.1.1&REQUEST=GetCapabilities';

test.beforeEach(async ({ page }) => {
  await interceptTileRequests(page);
  await routeFixture(page, '**/test.example.com/**', 'wms-111.xml');
  await page.goto('/index.html');
});

test.describe('WMS 1.1.1 — Service Info', () => {
  test('displays service title and version', async ({ page }) => {
    await loadService(page, SERVICE_URL);
    const details = page.locator('#service-details');
    await expect(details).toContainText('Test WMS 1.1.1 Service');
    await expect(details).toContainText('1.1.1');
  });

  test('lists correct number of layers', async ({ page }) => {
    await loadService(page, SERVICE_URL);
    await expect(getLayerElements(page)).toHaveCount(2);
  });

  test('displays layer titles', async ({ page }) => {
    await loadService(page, SERVICE_URL);
    const layers = getLayerElements(page);
    await expect(layers.nth(0)).toContainText('Roads Layer');
    await expect(layers.nth(1)).toContainText('Cities Layer');
  });
});

test.describe('WMS 1.1.1 — Version-Specific Parameters', () => {
  test('image tref uses SRS instead of CRS', async ({ page }) => {
    await loadService(page, SERVICE_URL);
    await activateLayer(page, 0);
    const imageLink = viewerLocator(page, 0, 'map-link[rel="image"]');
    const tref = await imageLink.getAttribute('tref');
    expect(tref).toContain('SRS=');
    expect(tref).not.toMatch(/[&?]CRS=/);
    expect(tref).toContain('VERSION=1.1.1');
  });

  test('query tref uses X/Y instead of I/J', async ({ page }) => {
    await loadService(page, SERVICE_URL);
    await activateLayer(page, 0);
    // Query is enabled by default
    const queryLink = viewerLocator(page, 0, 'map-link[rel="query"]');
    await expect(queryLink).toHaveCount(1);
    const tref = await queryLink.getAttribute('tref');
    expect(tref).toContain('X={i}');
    expect(tref).toContain('Y={j}');
    expect(tref).not.toContain('I={i}');
    expect(tref).not.toContain('J={j}');
  });

  test('BBOX uses standard xmin,ymin,xmax,ymax order even for EPSG:4326', async ({
    page,
  }) => {
    await loadService(page, SERVICE_URL);
    // Switch to WGS84 projection
    const layer = page.locator('mapmlify-layer').nth(0);
    await layer.locator('select').first().selectOption('WGS84');
    await activateLayer(page, 0);
    const imageLink = viewerLocator(page, 0, 'map-link[rel="image"]');
    const tref = await imageLink.getAttribute('tref');
    // WMS 1.1.1 always uses standard order
    expect(tref).toMatch(/BBOX=\{xmin\},\{ymin\},\{xmax\},\{ymax\}/);
  });
});

test.describe('WMS 1.1.1 — Viewer Structure', () => {
  test('creates map-layer with layer name', async ({ page }) => {
    await loadService(page, SERVICE_URL);
    await activateLayer(page, 0);
    const mapLayer = viewerLocator(page, 0, 'map-layer[data-wms-layer]');
    await expect(mapLayer).toHaveAttribute('label', 'Roads Layer');
  });

  test('map-extent has correct units', async ({ page }) => {
    await loadService(page, SERVICE_URL);
    await activateLayer(page, 0);
    const mapLayer = viewerLocator(page, 0, 'map-layer[data-wms-layer]');
    const extent = mapLayer.locator('map-extent');
    await expect(extent).toHaveAttribute('units', 'OSMTILE');
  });

  test('legend link present for first style', async ({ page }) => {
    await loadService(page, SERVICE_URL);
    await activateLayer(page, 0);
    const legend = viewerLocator(page, 0, 'map-link[rel="legend"]');
    await expect(legend).toHaveCount(1);
    await expect(legend).toHaveAttribute('href', /legend\/roads\/default/);
  });
});
