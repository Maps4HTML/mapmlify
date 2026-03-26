import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// 1x1 transparent PNG as a Buffer
const TRANSPARENT_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVQI12NgAAIABQAB' +
    'Nl7BcQAAAABJRU5ErkJggg==',
  'base64'
);

/**
 * Read a fixture file from tests/fixtures/
 */
export function readFixture(filename) {
  return readFileSync(join(__dirname, 'fixtures', filename), 'utf-8');
}

/**
 * Intercept a URL pattern via page.route() and respond with a fixture file.
 * @param {import('@playwright/test').Page} page
 * @param {string|RegExp} urlPattern - URL pattern to intercept
 * @param {string} fixtureFilename - File in tests/fixtures/
 * @param {string} [contentType] - Override content type (auto-detected from extension)
 */
export async function routeFixture(
  page,
  urlPattern,
  fixtureFilename,
  contentType
) {
  const body = readFixture(fixtureFilename);
  if (!contentType) {
    contentType = fixtureFilename.endsWith('.json')
      ? 'application/json'
      : 'text/xml';
  }
  await page.route(urlPattern, (route) =>
    route.fulfill({ status: 200, contentType, body })
  );
}

/**
 * Intercept tile/image requests to prevent network errors.
 * Returns a 1x1 transparent PNG for any matching request.
 */
export async function interceptTileRequests(page) {
  await page.route(
    /\/(tile|export|exportImage|GetMap|GetLegendGraphic|legend)\b/i,
    (route) =>
      route.fulfill({
        status: 200,
        contentType: 'image/png',
        body: TRANSPARENT_PNG,
      })
  );
  // Also intercept basemap tile requests
  await page.route(/arcgis\/rest\/services.*\/tile\//i, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'image/png',
      body: TRANSPARENT_PNG,
    })
  );
}

/**
 * Load a service by setting the URL input and clicking Load.
 * Waits for the #service-info section to become visible.
 */
export async function loadService(page, url) {
  await page.fill('#wms-url', url);
  await page.click('#load-btn');
  await page.waitForSelector('#service-info:not(.hidden)', { timeout: 15000 });
}

/**
 * Get all <mapmlify-layer> elements on the page.
 */
export function getLayerElements(page) {
  return page.locator('mapmlify-layer');
}

/**
 * Activate a layer's viewer by checking its checkbox.
 * @param {import('@playwright/test').Page} page
 * @param {number} index - Zero-based index of the layer
 */
export async function activateLayer(page, index) {
  const layer = page.locator('mapmlify-layer').nth(index);
  await layer.locator('.layer-checkbox').check();
  // Wait for the mapml-viewer to appear inside this layer
  await layer.locator('mapml-viewer').waitFor({ timeout: 15000 });
}

/**
 * Get the mapml-viewer element for a given layer index.
 */
export function getViewer(page, layerIndex) {
  return page.locator('mapmlify-layer').nth(layerIndex).locator('mapml-viewer');
}

/**
 * Evaluate a function inside the mapml-viewer's DOM to extract MapML elements.
 * Since mapml-viewer children are light DOM, we can query directly.
 * @param {import('@playwright/test').Page} page
 * @param {number} layerIndex
 * @param {string} selector - CSS selector relative to mapml-viewer
 * @returns Locator
 */
export function viewerLocator(page, layerIndex, selector) {
  return page
    .locator('mapmlify-layer')
    .nth(layerIndex)
    .locator(`mapml-viewer ${selector}`);
}
