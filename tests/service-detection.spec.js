import { test, expect } from '@playwright/test';
import {
  routeFixture,
  interceptTileRequests,
  loadService,
  getLayerElements,
} from './helpers.js';

test.beforeEach(async ({ page }) => {
  await interceptTileRequests(page);
  await page.goto('/src/index.html');
});

test.describe('Service Detection — WMS', () => {
  test('detects WMS 1.3.0 from XML', async ({ page }) => {
    await routeFixture(page, '**/test.example.com/**', 'wms-130.xml');
    await loadService(page, 'https://test.example.com/wms?SERVICE=WMS&REQUEST=GetCapabilities');
    await expect(page.locator('.service-type-badge')).toContainText('WMS');
    await expect(getLayerElements(page)).not.toHaveCount(0);
  });

  test('detects WMS 1.1.1 from XML', async ({ page }) => {
    await routeFixture(page, '**/test.example.com/**', 'wms-111.xml');
    await loadService(page, 'https://test.example.com/wms111?SERVICE=WMS&REQUEST=GetCapabilities');
    await expect(page.locator('.service-type-badge')).toContainText('WMS');
    await expect(getLayerElements(page)).not.toHaveCount(0);
  });
});

test.describe('Service Detection — WMTS', () => {
  test('detects WMTS from XML', async ({ page }) => {
    await routeFixture(page, '**/test.example.com/**', 'wmts-100.xml');
    await loadService(page, 'https://test.example.com/wmts?SERVICE=WMTS&REQUEST=GetCapabilities');
    await expect(page.locator('.service-type-badge')).toContainText('WMTS');
    await expect(getLayerElements(page)).not.toHaveCount(0);
  });
});

test.describe('Service Detection — ESRI', () => {
  test('detects ESRI MapServer (tiled) from JSON', async ({ page }) => {
    await routeFixture(page, '**/test.example.com/**', 'esri-mapserver-tiled.json');
    await loadService(page, 'https://test.example.com/arcgis/rest/services/Tiled/MapServer?f=json');
    await expect(page.locator('.service-type-badge')).toContainText('Tiled');
  });

  test('detects ESRI MapServer (dynamic) from JSON', async ({ page }) => {
    await routeFixture(page, '**/test.example.com/**', 'esri-mapserver-dynamic.json');
    await loadService(page, 'https://test.example.com/arcgis/rest/services/Dynamic/MapServer?f=json');
    await expect(page.locator('.service-type-badge')).toContainText('ESRI MapServer');
  });

  test('detects ESRI ImageServer from JSON', async ({ page }) => {
    await routeFixture(page, '**/test.example.com/**', 'esri-imageserver.json');
    await loadService(page, 'https://test.example.com/arcgis/rest/services/Elevation/ImageServer?f=json');
    await expect(page.locator('.service-type-badge')).toContainText('ImageServer');
  });
});

test.describe('Edge Cases', () => {
  test('empty URL shows alert', async ({ page }) => {
    page.on('dialog', (dialog) => dialog.accept());
    const input = page.locator('#wms-url');
    await input.fill('');
    await page.click('#load-btn');
    // service-info should remain hidden
    await expect(page.locator('#service-info')).toHaveClass(/hidden/);
  });

  test('each service type creates layers independently', async ({ page }) => {
    // Load WMS first
    await routeFixture(page, '**/wms-service/**', 'wms-130.xml');
    await loadService(page, 'https://test.example.com/wms-service/?SERVICE=WMS&REQUEST=GetCapabilities');
    await expect(getLayerElements(page)).toHaveCount(2);

    // Now load WMTS (should replace)
    await routeFixture(page, '**/wmts-service/**', 'wmts-100.xml');
    await loadService(page, 'https://test.example.com/wmts-service/?SERVICE=WMTS&REQUEST=GetCapabilities');
    await expect(page.locator('.service-type-badge')).toContainText('WMTS');
  });
});
