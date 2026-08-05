#!/usr/bin/env node
/**
 * sync-brand-assets.cjs
 *
 * Copia la carpeta canónica /public/brand (raíz del monorepo) hacia
 * public/brand dentro de la app indicada (apps/admin o apps/guard).
 *
 * Por qué existe:
 * Next.js solo sirve archivos estáticos desde el `public/` de CADA app,
 * por lo que no es posible referenciar directamente /public/brand desde
 * apps/admin o apps/guard sin una copia local. Este script mantiene esa
 * copia sincronizada automáticamente en cada build, para que la ÚNICA
 * fuente editable siga siendo la raíz del monorepo.
 *
 * Uso:
 *   node ../../scripts/sync-brand-assets.cjs admin
 *   node ../../scripts/sync-brand-assets.cjs guard
 *
 * No requiere dependencias externas (solo Node core: fs, path).
 * Se ejecuta automáticamente vía el script "prebuild" de cada app,
 * tanto en local (si aplica) como en el build de Netlify.
 */

const fs = require("fs");
const path = require("path");

const appName = process.argv[2];

if (!appName) {
  console.error(
    "[sync-brand-assets] Falta el nombre de la app. Uso: node sync-brand-assets.cjs <admin|guard>"
  );
  process.exit(1);
}

// Este script vive en <repoRoot>/scripts/sync-brand-assets.cjs
const repoRoot = path.resolve(__dirname, "..");
const source = path.join(repoRoot, "public", "brand");
const destination = path.join(repoRoot, "apps", appName, "public", "brand");

if (!fs.existsSync(source)) {
  console.error(`[sync-brand-assets] No existe la carpeta fuente: ${source}`);
  process.exit(1);
}

// Limpia el destino y copia de nuevo, para que nunca queden archivos
// obsoletos si algún día se elimina un asset de la fuente canónica.
fs.rmSync(destination, { recursive: true, force: true });
fs.mkdirSync(destination, { recursive: true });
fs.cpSync(source, destination, { recursive: true });

const copied = fs.readdirSync(destination);
console.log(
  `[sync-brand-assets] OK -> apps/${appName}/public/brand (${copied.length} archivos): ${copied.join(", ")}`
);
