import { lookup } from "node:dns/promises";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";
import ipaddr from "ipaddr.js";
import { load } from "cheerio";
import type { Express } from "express";
import { z } from "zod";
import { insertMealSchema } from "@shared/schema";
import type { RecipeImportPreview } from "@shared/recipe-import";
import { parseRecipeIngredientDetails, preferMetricMeasurements } from "./recipe-ingredients";

const MAX_BYTES = 2 * 1024 * 1024;
const TIMEOUT_MS = 15000;

export function isPublicAddress(address: string): boolean {
  try {
    const parsed = ipaddr.process(address);
    return parsed.range() === "unicast";
  } catch {
    return false;
  }
}

export function validateRecipeUrl(value: string): URL {
  let url: URL;
  try { url = new URL(value); } catch { throw new Error("Enter a valid public recipe URL."); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password ||
      (url.port && url.port !== (url.protocol === 'https:' ? '443' : '80'))) {
    throw new Error("Use an HTTP or HTTPS URL without credentials or a custom port.");
  }
  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') ||
      (isIP(host) && !isPublicAddress(host))) {
    throw new Error("Only public recipe websites can be imported.");
  }
  url.hash = '';
  return url;
}

// Resolve every redirect and pin the approved IP to the connection to prevent DNS rebinding.
export async function fetchRecipePage(value: string, dependencies: {
  resolve?: (host: string) => Promise<Array<{ address: string; family: number }>>;
  request?: typeof httpRequest;
} = {}): Promise<{ html: string; url: string }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    let url = validateRecipeUrl(value);
    for (let redirects = 0; redirects <= 3; redirects++) {
      const host = url.hostname.replace(/^\[|\]$/g, '');
      const addresses = await Promise.race([
        dependencies.resolve ? dependencies.resolve(host) : lookup(host, { all: true }),
        new Promise<never>((_, reject) => {
          if (controller.signal.aborted) reject(new Error("Recipe request timed out."));
          else controller.signal.addEventListener('abort', () => reject(new Error("Recipe request timed out.")), { once: true });
        }),
      ]);
      if (!addresses.length || addresses.some(({ address }) => !isPublicAddress(address))) {
        throw new Error("Only public recipe websites can be imported.");
      }
      if (controller.signal.aborted) throw new Error("Recipe request timed out.");
      const pinned = addresses[0];
      const response = await new Promise<{ html?: string; redirect?: string }>((resolve, reject) => {
        const request = (dependencies.request || (url.protocol === 'https:' ? httpsRequest : httpRequest))(url, {
          agent: false,
          signal: controller.signal,
          lookup: (_hostname, options, callback) => {
            if (typeof options === 'object' && options.all) {
              (callback as unknown as (error: null, results: Array<{ address: string; family: number }>) => void)(null, [pinned]);
            } else callback(null, pinned.address, pinned.family);
          },
          headers: { 'User-Agent': 'MealPlannerRecipeImport/1.0', Accept: 'text/html', 'Accept-Encoding': 'identity' },
        }, res => {
          if ([301, 302, 303, 307, 308].includes(res.statusCode || 0)) {
            const location = res.headers.location;
            res.destroy();
            if (!location) reject(new Error("The recipe website returned an invalid redirect."));
            else resolve({ redirect: location });
            return;
          }
          if (res.statusCode !== 200) {
            res.destroy();
            reject(new Error("The recipe website could not be read. It may block imports or require a login."));
            return;
          }
          if (!/^(text\/html|application\/xhtml\+xml)\b/i.test(res.headers['content-type'] || '') ||
              (res.headers['content-encoding'] && res.headers['content-encoding'] !== 'identity')) {
            res.destroy();
            reject(new Error("The URL must return an uncompressed HTML recipe page."));
            return;
          }
          const chunks: Buffer[] = [];
          let bytes = 0;
          res.on('data', (chunk: Buffer) => {
            bytes += chunk.length;
            if (bytes > MAX_BYTES) {
              reject(new Error("The recipe page is too large to import."));
              res.destroy();
            } else chunks.push(chunk);
          });
          res.on('end', () => resolve({ html: Buffer.concat(chunks).toString('utf8') }));
          res.on('error', reject);
        });
        request.on('error', reject);
        request.end();
      });
      if (response.redirect) {
        url = validateRecipeUrl(new URL(response.redirect, url).href);
      } else return { html: response.html || '', url: url.href };
    }
    throw new Error("The recipe URL redirected too many times.");
  } finally { clearTimeout(timeout); }
}

type JsonObject = Record<string, unknown>;
const object = (value: unknown): value is JsonObject => !!value && typeof value === 'object' && !Array.isArray(value);

export function extractRecipe(html: string, sourceUrl: string): RecipeImportPreview {
  const $ = load(html);
  const clean = (value: unknown): string => {
    if (typeof value !== 'string') return '';
    // Decode entities before stripping markup so encoded tags are also removed.
    const encoded = load(`<div>${value}</div>`);
    encoded('script, style').remove();
    encoded('br').replaceWith('\n');
    encoded('p, li').append('\n');
    encoded('span[style*="display: block"]').append('\n');
    const decoded = encoded('div').first().text();
    const fragment = load(decoded);
    fragment('script, style').remove();
    fragment('br').replaceWith('\n');
    fragment('p, li').append('\n');
    fragment('span[style*="display: block"]').append('\n');
    return preferMetricMeasurements(fragment.root().text().replace(/\r/g, '').trim());
  };
  const recipes: JsonObject[] = [];
  const visit = (value: unknown, depth = 0) => {
    if (depth > 30) return;
    if (Array.isArray(value)) { value.forEach(item => visit(item, depth + 1)); return; }
    if (!object(value)) return;
    const types = Array.isArray(value['@type']) ? value['@type'] : [value['@type']];
    if (types.some(type => typeof type === 'string' && /(^|[/#])Recipe$/.test(type))) recipes.push(value);
    Object.values(value).forEach(item => visit(item, depth + 1));
  };
  $('script').each((_index, element) => {
    if (($(element).attr('type') || '').split(';')[0].trim().toLowerCase() !== 'application/ld+json') return;
    try { visit(JSON.parse($(element).text())); } catch { /* Skip unrelated malformed metadata. */ }
  });
  const recipe = recipes.find(item => clean(item.name) && item.recipeIngredient && item.recipeInstructions) || recipes[0];
  if (!recipe) throw new Error("No structured recipe was found on this page. Try another URL or add the meal manually.");

  const warnings: string[] = [];
  if (recipes.length > 1) warnings.push("This page contains multiple recipes. Review the selected recipe.");
  const steps = (value: unknown): string[] => {
    if (Array.isArray(value)) return value.flatMap(steps);
    if (typeof value === 'string') return clean(value).split('\n').map(s => s.trim()).filter(Boolean);
    if (!object(value)) return [];
    if (value.itemListElement) return steps(value.itemListElement);
    if (value.item) return steps(value.item);
    return steps(value.text || value.name);
  };
  const ingredientLines = steps(recipe.recipeIngredient);
  const ingredientDetails = ingredientLines.map(parseRecipeIngredientDetails);
  const ingredients = ingredientDetails.map(detail => detail.ingredient);
  let instructionData = recipe.recipeInstructions;
  if (Array.isArray(instructionData) && instructionData.some(section => object(section) && /^full\s+(recipe|method|instructions?)\b/i.test(clean(section.name)))) {
    instructionData = instructionData.filter(section => !object(section) || !/^(abbreviated|summary|quick)\s+(recipe|method|instructions?)\b/i.test(clean(section.name)));
    warnings.push("The abbreviated method was omitted because the full method is available.");
  }
  const instructions = steps(instructionData);
  const methodStepCount = instructions.length;
  const ingredientNotes = ingredientDetails.flatMap(({ ingredient, notes }) => notes.map(note => `${ingredient.name}: ${note}`));
  if (ingredientNotes.length) {
    instructions.push(`Ingredient notes:\n${ingredientNotes.join('\n')}`);
    warnings.push("Long ingredient explanations and substitutions were moved to the end of the instructions; short preparation and optional flags stay with the ingredient.");
  }
  // WPRM cards are used by many recipe sites. Only take notes from the card
  // matching the chosen recipe; never accidentally pull notes from a related recipe.
  $('.wprm-recipe-container').each((_index, card) => {
    if (clean($(card).find('.wprm-recipe-name').first().text()).toLowerCase() !== clean(recipe.name).toLowerCase()) return;
    if (instructions.some(step => step.startsWith('Recipe notes:'))) return;
    const notesElement = $(card).find('.wprm-recipe-notes').first();
    if (!notesElement.length) return;
    const notes = clean(notesElement.html() || '').split('\n').map(line => line.trim())
      .filter(line => line && !/^nutrition\b/i.test(line));
    if (notes.length) {
      instructions.push(`Recipe notes:\n${notes.join('\n')}`);
      warnings.push("Recipe-card cooking notes were included at the end of the instructions. Review them before saving.");
    }
  });
  const duration = clean(recipe.cookTime);
  const match = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$/i.exec(duration);
  const minutes = match ? Number(match[1] || 0) * 1440 + Number(match[2] || 0) * 60 + Number(match[3] || 0) + Number(match[4] || 0) / 60 : 0;
  const cookTime = match ? `${Math.ceil(minutes)} mins` : duration;
  const yields = Array.isArray(recipe.recipeYield) ? recipe.recipeYield : [recipe.recipeYield];
  const yieldText = yields.map(value => typeof value === 'number' ? String(value) : clean(value)).find(Boolean) || '';
  const servingMatch = /^(\d+)\s*(?:servings?|people|persons?)?$/i.exec(yieldText);
  const servings = servingMatch && Number(servingMatch[1]) > 0 ? Number(servingMatch[1]) : 4;
  if (!servingMatch || Number(servingMatch[1]) <= 0) warnings.push(`Servings defaulted to 4${yieldText ? `; the page lists "${yieldText}"` : ''}. Review before saving.`);
  warnings.push("Difficulty defaults to Easy. Review before saving.");
  const imageUrl = (value: unknown): string => {
    if (Array.isArray(value)) return value.map(imageUrl).find(Boolean) || '';
    if (object(value)) return imageUrl(value.url || value.contentUrl);
    if (typeof value !== 'string') return '';
    try {
      return validateRecipeUrl(new URL(value, sourceUrl).href).href;
    } catch { return ''; }
  };
  const draft = insertMealSchema.parse({
    name: clean(recipe.name), description: clean(recipe.description), cookTime,
    difficulty: 'Easy', servings, image: imageUrl(recipe.image),
    ingredients,
    instructions, utensils: [],
  });
  for (const [label, value] of [['name', draft.name], ['description', draft.description], ['cook time', cookTime], ['image', draft.image], ['ingredients', ingredientLines.length], ['instructions', methodStepCount]] as const) {
    if (!value) warnings.push(`No ${label} was found. Complete it in the form if required.`);
  }
  warnings.push("Review ingredient amounts and suggested shopping categories; uncertain categories remain other.");
  if (ingredients.some(ingredient => !ingredient.amount)) warnings.push("Some quantities could not be separated and remain in the original ingredient text. Blank amounts will use 1 unit when saved; review these lines.");
  warnings.push("Source URL and nutrition are not stored in the current meal model.");
  return { draft, sourceUrl, warnings };
}

// This endpoint has no database dependency and never saves a meal.
export function registerRecipeImportRoute(app: Express, fetchPage = fetchRecipePage) {
  let active = 0;
  app.post('/api/recipes/import-preview', async (req, res) => {
    if (active >= 3) { res.status(429).json({ message: 'Recipe imports are busy. Try again shortly.' }); return; }
    active++;
    try {
      const { url } = z.object({ url: z.string().trim().min(1).max(2048) }).parse(req.body);
      const safeUrl = validateRecipeUrl(url);
      const page = await fetchPage(safeUrl.href);
      res.json(extractRecipe(page.html, page.url));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not import this recipe.';
      res.status(400).json({ message: /ENOTFOUND|EAI_AGAIN|ECONN|certificate|aborted/i.test(message) ? 'The recipe website could not be reached. Check the URL or try another website.' : message });
    } finally { active--; }
  });
}
