#!/usr/bin/env node

/*
Usage:
  node ui-parser.js <product_url> <region>
Example:
  node ui-parser.js https://www.vprok.ru/product/domik-v-derevne-dom-v-der-moloko-ster-3-2-950g--309202 "Санкт-Петербург и область"

This script:
 - opens the product page in Chrome (Puppeteer)
 - tries to set the requested region
 - takes a full-page screenshot as screenshot.jpg
 - extracts price(s), rating and reviews count, and saves them to product.txt
*/

const fs = require('fs');
const path = require('path');
const uiParser = require('puppeteer');
const { get } = require('axios');

const OUTPUT_SCREENSHOT = path.resolve(process.cwd(), 'screenshot.jpg');
const OUTPUT_TEXT = path.resolve(process.cwd(), 'product.txt');

const selectorsForParsing = {
  discount_price: "[class*=ProductPage_buyBlockDesktop] [class*='Price_role_discount']",
  old_price: "[class*=ProductPage_buyBlockDesktop] [class*='Price_role_old']",
  regular_price: "[class*='ProductPage_buyBlockDesktop'] [class*='Price_role_regular']",
  rating: "[class*='ActionsRow_stars']",
  reviews_count: "[class*='ActionsRow_reviews_']",
};

const uiInteractionSelectors = {
  region: "[class*='Region_text']",
  regionInRegionList: "[class*='UiRegionListBase_button']",
};

function textNormalize(text) {
  return (text || '').replace(/\s+/g, ' ').trim().toLowerCase();
}

async function clickByText(page, selectors, text) {
  const target = textNormalize(text);
  for (const sel of selectors) {
    const found = await page.$$(sel).catch(() => []);
    for (const el of found) {
      const t = textNormalize(await page.evaluate((e) => e.innerText || e.textContent || '', el));
      if (t === target) {
        await el.click();
        return true;
      }
    }
  }
  return false;
}
async function setRegion(page, regionName) {
  let currentRegionName = '';
  try {
    const currentRegion = await page.$(uiInteractionSelectors.region);
    currentRegionName = await currentRegion.evaluate((el) => el.textContent || '');

    if (currentRegion && textNormalize(currentRegionName) === textNormalize(regionName)) {
      return;
    }
    await page.waitForSelector(uiInteractionSelectors.region, { timeout: 5000 });
    await currentRegion.click();
    await page.waitForSelector(uiInteractionSelectors.regionInRegionList, { timeout: 5000 });

    const clicked = await clickByText(
      page,
      [uiInteractionSelectors.regionInRegionList],
      regionName,
    );
    if (!clicked) {
      throw new Error(`Region "${regionName}" not found`);
    }
    await page.waitForResponse(
      (response) => response.url().includes('/regionList') && response.status() === 200,
      { timeout: 7000 },
    );
  } catch (e) {
    console.error(
      `!!!!Set default region "${currentRegionName}!!!!". Region selection skipped due to error:`,
      e.message,
    );
  }
}

async function extractData(page) {
  const sels = selectorsForParsing;
  const getText = async (sel) => {
    if (!sel) return null;
    try {
      const el = await page.$(sel);
      const prop = await el.evaluate((el) => el.textContent || '');
      return prop.trim();
    } catch {
      return null;
    }
  };

  const cleanNum = (s) => (s ? (s.match(/[\d.,]+/g) || []).join('') || s : null);

  const [priceText, discountPrice, oldPriceText, ratingText, reviewsText] = await Promise.all([
    getText(sels.regular_price),
    getText(sels.discount_price),
    getText(sels.old_price),
    getText(sels.rating),
    getText(sels.reviews_count),
  ]);
  return {
    price: cleanNum(priceText || discountPrice) || 'не определена. Товар вероятно распродан',
    oldPrice: cleanNum(oldPriceText) || '"-"',
    rating: cleanNum(ratingText),
    reviewsCount: cleanNum(reviewsText),
  };
}
(async () => {
  const [, , url, ...regionParts] = process.argv;
  const region = regionParts.join(' ').trim();
  if (!url || !region) {
    console.error('Usage: node ui-parser.js <product_url> <region>');
    process.exit(2);
  }

  const browser = await uiParser.launch({
    headless: false,
    defaultViewport: { width: 1366, height: 900 },
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--lang=ru-RU,ru'],
  });

  try {
    const page = await browser.newPage();

    console.log('Opening URL:', url);
    await page.goto(url, { waitUntil: 'load' });
    const response = await page.waitForResponse(
      (response) => response.url().includes('/regionList') && response.status() === 200,
      { timeout: 15000 },
    );
    await page
      .waitForSelector('[class*=ProductPage_buyBlockDesktop]', { timeout: 5000 })
      .catch(() => {
        throw new Error('Product not found');
      });

    console.log('Setting region to:', region);
    await setRegion(page, region);

    console.log('Taking screenshot to', OUTPUT_SCREENSHOT);
    await page.screenshot({ path: OUTPUT_SCREENSHOT, fullPage: true, type: 'jpeg', quality: 85 });

    console.log('Extracting product data');
    const data = await extractData(page);

    const lines = [];
    if (data.price) lines.push(`Цена: ${data.price}`);
    if (data.oldPrice) lines.push(`Старая цена: ${data.oldPrice}`);
    if (data.rating) lines.push(`Рейтинг: ${data.rating}`);
    if (data.reviewsCount) lines.push(`Количество отзывов: ${data.reviewsCount}`);
    const textContent = lines.join('\n') || 'Нет данных';
    fs.writeFileSync(OUTPUT_TEXT, textContent, 'utf8');

    console.log('Saved to', OUTPUT_TEXT);
  } catch (e) {
    console.error('Error:', e);
    process.exitCode = 1;
  } finally {
    await browser.close().catch(() => {});
  }
})();
