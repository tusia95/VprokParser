#!/usr/bin/env node

/**
 * api-parser.js
 *
 * Usage:
 *   node api-parser.js https://www.vprok.ru/catalog/7382/pomidory-i-ovoschnye-nabory
 *
 * This script opens the provided category URL in Chrome (Puppeteer),
 * listens for network JSON responses (API calls) that contain product data,
 * extracts the products from the first page only, and saves them to products-api.txt
 * in the required format.
 */

const url = process.argv[2];
const puppeteer = require('puppeteer');
const fs = require('fs');
const { resolve } = require('node:path');
const path = require('node:path');

(async () => {
  const browser = await puppeteer.launch({
    headless: false,
    defaultViewport: null,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  const page = await browser.newPage();
  await page.goto(url, {
    waitUntil: 'networkidle2',
    timeout: 60000,
  });

  const response = await page.waitForResponse(
    (response) => response.url() === url && response.status() === 200,
    { timeout: 15000 },
  );
  if (response.status() !== 200) {
    console.error(`Ошибка загрузки страницы: ${response.status()}`);
    await browser.close();
    return;
  }

  // Получаем тело ответа (HTML)
  const html = await response.text();

  // Извлекаем __NEXT_DATA__ из HTML
  const scriptContent = await page.$eval('#__NEXT_DATA__', (el) => el.textContent);
  let data;
  try {
    data = JSON.parse(scriptContent);
  } catch (e) {
    console.error('Ошибка парсинга __NEXT_DATA__:', e);
  }

  // Путь к массиву товаров
  const products = data?.props?.pageProps?.initialStore?.catalogPage?.products || [];
  if (products.length === 0) {
    console.log('Товары не найдены (возможно, пустая страница или блокировка).');
    await browser.close();
    return;
  }

  const baseUrl = 'https://www.vprok.ru';

  const extracted = products.map((p) => ({
    'Название товара': p.name || '-',
    'Cсылка на страницу товара': baseUrl + (p.url || ''),
    Рейтинг: p.rating || '-',
    'Количество отзывов': p.reviews || 0,
    Цена: p.price || 0,
    'Акционная цена': p.oldPrice > 0 ? p.price : '-',
    'Цена до акции': p.oldPrice > 0 ? p.oldPrice : '-',
    'Размер скидки': p.discount > 0 ? p.discount : '-',
  }));

  console.log(`Найдено товаров: ${extracted.length}`);
  const outA = path.resolve(process.cwd(), 'products_api.txt');
  fs.writeFileSync(outA, JSON.stringify(extracted, null, 2));
  console.log('Данные сохранены');

  await browser.close();
})();
