import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { CLASS_NAMES } from './class_names.mjs';
import { TEMPLATES } from './dataset_gen/templates.mjs';
import { randomTheme, wrapPage } from './dataset_gen/theme.mjs';
import { mulberry32, pick, seedFrom } from './dataset_gen/rng.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));

function parseArgs() {
  const args = Object.fromEntries(
    process.argv.slice(2).map((a) => {
      const [k, v] = a.replace(/^--/, '').split('=');
      return [k, v ?? true];
    }),
  );
  return {
    variationsTrain: Number(args['variations-train'] ?? 40),
    variationsVal: Number(args['variations-val'] ?? 15),
    seedTag: String(args.seed ?? 'aegis'),
  };
}

const VIEWPORT_WIDTHS = [1024, 1280, 1440];
const VIEWPORT_HEIGHTS = [720, 800, 900];

const classIndex = new Map(CLASS_NAMES.map((name, i) => [name, i]));

function toYoloLine(classId, box, imgW, imgH) {
  const cx = (box.x + box.w / 2) / imgW;
  const cy = (box.y + box.h / 2) / imgH;
  const w = box.w / imgW;
  const h = box.h / imgH;
  return `${classId} ${cx.toFixed(6)} ${cy.toFixed(6)} ${w.toFixed(6)} ${h.toFixed(6)}`;
}

async function main() {
  const { variationsTrain, variationsVal, seedTag } = parseArgs();
  const outRoot = resolve(__dirname, 'dataset');

  if (existsSync(outRoot)) rmSync(outRoot, { recursive: true, force: true });
  for (const split of ['train', 'val']) {
    mkdirSync(resolve(outRoot, split, 'images'), { recursive: true });
    mkdirSync(resolve(outRoot, split, 'labels'), { recursive: true });
  }

  const browser = await chromium.launch();
  const counts = { train: { images: 0, labels: 0, byClass: {} }, val: { images: 0, labels: 0, byClass: {} } };
  for (const c of CLASS_NAMES) {
    counts.train.byClass[c] = 0;
    counts.val.byClass[c] = 0;
  }

  let globalIndex = 0;
  for (const template of TEMPLATES) {
    const variations = template.split === 'train' ? variationsTrain : variationsVal;

    for (let i = 0; i < variations; i++) {
      const rng = mulberry32(seedFrom(`${seedTag}-${template.name}-${i}`));
      const theme = randomTheme(rng);
      const width = pick(rng, VIEWPORT_WIDTHS);
      const height = pick(rng, VIEWPORT_HEIGHTS);
      const html = wrapPage(theme, template.build(rng));

      const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
      await page.setContent(html, { waitUntil: 'load' });

      const rawElements = await page.$$eval('[data-uiclass]', (els) =>
        els.map((el) => {
          const r = el.getBoundingClientRect();
          return { cls: el.getAttribute('data-uiclass'), x: r.x, y: r.y, w: r.width, h: r.height };
        }),
      );

      const elements = rawElements.filter(
        (el) =>
          el.w > 2 &&
          el.h > 2 &&
          el.x >= 0 &&
          el.y >= 0 &&
          el.x + el.w <= width &&
          el.y + el.h <= height &&
          classIndex.has(el.cls),
      );

      const fileBase = `${template.name}_${String(i).padStart(4, '0')}_${globalIndex}`;
      const imgPath = resolve(outRoot, template.split, 'images', `${fileBase}.png`);
      const labelPath = resolve(outRoot, template.split, 'labels', `${fileBase}.txt`);

      await page.screenshot({ path: imgPath });
      const lines = elements.map((el) => toYoloLine(classIndex.get(el.cls), el, width, height));
      writeFileSync(labelPath, lines.join('\n') + (lines.length ? '\n' : ''));

      await page.close();

      counts[template.split].images += 1;
      counts[template.split].labels += elements.length;
      for (const el of elements) counts[template.split].byClass[el.cls] += 1;
      globalIndex += 1;
    }

    console.log(`[dataset-gen] ${template.name} (${template.split}): ${variations} images rendered`);
  }

  await browser.close();

  const manifest = {
    generatedAt: new Date().toISOString(),
    classNames: CLASS_NAMES,
    templates: TEMPLATES.map((t) => ({ name: t.name, split: t.split })),
    counts,
  };
  writeFileSync(resolve(outRoot, 'manifest.json'), JSON.stringify(manifest, null, 2));

  console.log('\n[dataset-gen] DONE');
  console.log(`  train: ${counts.train.images} images, ${counts.train.labels} labeled boxes`);
  console.log(`  val:   ${counts.val.images} images, ${counts.val.labels} labeled boxes`);
  console.log(`  per-class (train):`, counts.train.byClass);
  console.log(`  per-class (val):  `, counts.val.byClass);
}

main().catch((err) => {
  console.error('[dataset-gen] FAILED', err);
  process.exit(1);
});
