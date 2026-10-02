import assert from 'node:assert/strict';
import { test } from 'node:test';
import express from 'express';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import type { request as httpRequest } from 'node:http';
import { extractRecipe, fetchRecipePage, isPublicAddress, registerRecipeImportRoute, validateRecipeUrl } from './recipe-import';
import { insertMealSchema } from '../shared/schema';
import { parseRecipeIngredient } from './recipe-ingredients';

const page = (recipe: unknown) => `<html><script type="application/ld+json">${JSON.stringify(recipe)}</script></html>`;
const recipe = {
  '@type': 'Recipe', name: 'Chicken &amp; rice', description: '<p>A simple dinner.</p>',
  cookTime: 'PT1H15M', recipeYield: '4 servings', image: [{ '@type': 'ImageObject', url: '/meal.jpg' }],
  recipeIngredient: ['2 cups rice', '500 g chicken'],
  recipeInstructions: [{ '@type': 'HowToSection', name: 'Preparation', itemListElement: [
    { '@type': 'HowToStep', text: 'Wash the rice.' }, { '@type': 'HowToStep', text: 'Cook chicken &amp; rice.' },
  ] }],
};

test('extracts graph recipes into the existing schema without losing ingredient quantities', () => {
  const preview = extractRecipe(page({ '@graph': [{ '@type': 'WebPage' }, recipe] }), 'https://recipes.example/dinner');
  assert.equal(preview.draft.name, 'Chicken & rice');
  assert.equal(preview.draft.description, 'A simple dinner.');
  assert.equal(preview.draft.cookTime, '75 mins');
  assert.equal(preview.draft.servings, 4);
  assert.equal(preview.draft.image, 'https://recipes.example/meal.jpg');
  assert.deepEqual(preview.draft.ingredients, [
    { name: 'rice', amount: '2 cups', category: 'grains' },
    { name: 'chicken', amount: '500 g', category: 'meat' },
  ]);
  assert.deepEqual(preview.draft.instructions, ['Wash the rice.', 'Cook chicken & rice.']);
  assert.deepEqual(insertMealSchema.parse(preview.draft), preview.draft);
  assert.equal('id' in preview.draft, false);
  assert.equal('sourceUrl' in preview.draft, false);
});

test('maps clear quantities and ranges but preserves package sizes and unknown amounts', () => {
  const preview = extractRecipe(page({ ...recipe, recipeIngredient: ['1 1/2 cups flour', '½ tsp salt', '2 eggs', '2-3 carrots', '1 (400 g) can tomatoes', 'Salt to taste'] }), 'https://recipes.example');
  assert.deepEqual(preview.draft.ingredients.map(({ name, amount }) => [name, amount]), [
    ['flour', '1 1/2 cups'], ['salt', '½ tsp'], ['eggs', '2'], ['carrots', '2-3'], ['1 (400 g) can tomatoes', ''], ['Salt to taste', ''],
  ]);
  assert.ok(preview.warnings.some(warning => warning.includes('could not be separated')));
});

test('normalizes BBC-style compact amounts, preparation, and shopping categories', () => {
  assert.deepEqual(parseRecipeIngredient('40g piece of ginger peeled and finely grated'), {
    name: 'ginger grated', amount: '40g', category: 'vegetables',
  });
  assert.deepEqual(parseRecipeIngredient('4 garlic cloves finely chopped'), {
    name: 'garlic chopped', amount: '4 cloves', category: 'vegetables',
  });
  assert.deepEqual(parseRecipeIngredient('½-1 lemon, juiced'), {
    name: 'lemon, juiced', amount: '½-1', category: 'fruit',
  });
  assert.deepEqual(parseRecipeIngredient('500g chicken breast'), {
    name: 'chicken breast', amount: '500g', category: 'meat',
  });
  assert.equal(parseRecipeIngredient('1 tbsp sunflower, vegetable, rice bran or rapeseed oil').category, 'pantry');
  assert.equal(parseRecipeIngredient('cooked rice and steamed broccoli, to serve (optional)').category, 'other');
  assert.equal(parseRecipeIngredient('40ginger').amount, '');
  assert.deepEqual(parseRecipeIngredient('2 cups unusual ingredient'), { name: 'unusual ingredient', amount: '2 cups', category: 'other' });
});

test('supports arrays, type arrays, HTML steps and skips malformed unrelated metadata', () => {
  const html = '<script type="application/ld+json">bad JSON</script>' + page([
    { ...recipe, '@type': ['Thing', 'https://schema.org/Recipe'], recipeInstructions: '<p>First</p><p>Second</p>' },
  ]);
  assert.deepEqual(extractRecipe(html, 'https://recipes.example').draft.instructions, ['First', 'Second']);
});

test('missing fields and ambiguous yields produce an editable draft with explicit warnings', () => {
  const preview = extractRecipe(page({ '@type': 'Recipe', name: 'Cake', recipeYield: '12 cookies', image: 'javascript:alert(1)' }), 'https://recipes.example');
  assert.equal(preview.draft.servings, 4);
  assert.equal(preview.draft.image, '');
  assert.equal(preview.draft.cookTime, '');
  assert.deepEqual(preview.draft.instructions, []);
  assert.ok(preview.warnings.some(w => w.includes('12 cookies')));
  assert.ok(preview.warnings.some(w => w.includes('No ingredients')));
  assert.ok(preview.warnings.some(w => w.includes('Source URL')));
});

test('does not invent a recipe from pages without structured recipe data', () => {
  assert.throws(() => extractRecipe('<h1>Some article</h1>', 'https://recipes.example'), /No structured recipe/);
});

test('rejects unsafe URL schemes, credentials, ports, and literal private addresses', () => {
  for (const url of ['file:///etc/passwd', 'ftp://example.com', 'https://user:pass@example.com',
    'http://example.com:8080', 'http://localhost', 'http://service.local', 'http://127.1',
    'http://2130706433', 'http://10.0.0.1', 'http://169.254.169.254', 'http://[::1]', 'http://[::ffff:127.0.0.1]']) {
    assert.throws(() => validateRecipeUrl(url), undefined, url);
  }
  assert.equal(validateRecipeUrl('https://example.com/recipe#steps').href, 'https://example.com/recipe');
});

test('rejects private, reserved, multicast, and IPv4-mapped private DNS addresses', () => {
  for (const ip of ['0.0.0.0', '127.0.0.1', '172.16.1.1', '192.168.1.1', '100.64.0.1', '224.0.0.1',
    '::', '::1', 'fc00::1', 'fe80::1', 'ff02::1', '::ffff:10.0.0.1', '2001:db8::1']) assert.equal(isPublicAddress(ip), false, ip);
  assert.equal(isPublicAddress('8.8.8.8'), true);
  assert.equal(isPublicAddress('2606:4700:4700::1111'), true);
});

test('preview API returns drafts without invoking any save route; invalid URLs never reach fetch', async () => {
  const app = express();
  app.use(express.json());
  let fetches = 0;
  let writes = 0;
  registerRecipeImportRoute(app, async url => { fetches++; return { html: page(recipe), url }; });
  app.post('/api/meals', (_req, res) => { writes++; res.sendStatus(201); });
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  try {
    const endpoint = `http://127.0.0.1:${address.port}/api/recipes/import-preview`;
    const response = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: 'https://recipes.example/dinner' }) });
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.draft.name, 'Chicken & rice');
    const invalid = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: 'http://127.0.0.1' }) });
    assert.equal(invalid.status, 400);
    assert.equal(fetches, 1);
    assert.equal(writes, 0);
  } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
});

function mockRequests(responses: Array<{ status?: number; headers?: Record<string, string>; body?: string }>) {
  let calls = 0;
  const request = ((_url: URL, options: any, callback: (response: any) => void) => {
    const fixture = responses[calls++];
    assert.ok(fixture, 'Unexpected additional HTTP request');
    options.lookup('recipes.example', { all: true }, (error: unknown, addresses: unknown) => {
      assert.equal(error, null);
      assert.deepEqual(addresses, [{ address: '8.8.8.8', family: 4 }]);
    });
    const req = new EventEmitter() as EventEmitter & { end(): void };
    req.end = () => queueMicrotask(() => {
      const res = new PassThrough() as PassThrough & { statusCode: number; headers: Record<string, string> };
      res.statusCode = fixture.status || 200;
      res.headers = fixture.headers || { 'content-type': 'text/html' };
      callback(res);
      if (!res.destroyed) res.end(fixture.body || '<html></html>');
    });
    return req;
  }) as unknown as typeof httpRequest;
  return { request, get calls() { return calls; } };
}
const publicDns = async () => [{ address: '8.8.8.8', family: 4 }];

test('fetch pins the public DNS address and follows relative redirects', async () => {
  const network = mockRequests([{ status: 302, headers: { location: '/actual' } }, { body: page(recipe) }]);
  const result = await fetchRecipePage('https://recipes.example/start', { resolve: publicDns, request: network.request });
  assert.equal(result.url, 'https://recipes.example/actual');
  assert.ok(result.html.includes('Chicken'));
  assert.equal(network.calls, 2);
});

test('fetch refuses private DNS results and public-to-private redirects before connecting', async () => {
  const privateDns = async () => [{ address: '8.8.8.8', family: 4 }, { address: '10.0.0.1', family: 4 }];
  const blocked = mockRequests([]);
  await assert.rejects(fetchRecipePage('https://recipes.example', { resolve: privateDns, request: blocked.request }), /Only public/);
  assert.equal(blocked.calls, 0);
  const redirect = mockRequests([{ status: 302, headers: { location: 'http://169.254.169.254/latest' } }]);
  await assert.rejects(fetchRecipePage('https://recipes.example', { resolve: publicDns, request: redirect.request }), /Only public/);
  assert.equal(redirect.calls, 1);
});

test('fetch limits redirect loops, content types, website errors, and page sizes', async () => {
  const cases = [
    { responses: Array.from({ length: 4 }, () => ({ status: 302, headers: { location: '/again' } })), error: /too many/ },
    { responses: [{ headers: { 'content-type': 'application/json' } }], error: /HTML recipe page/ },
    { responses: [{ status: 403 }], error: /could not be read/ },
    { responses: [{ body: 'x'.repeat(2 * 1024 * 1024 + 1) }], error: /too large/ },
  ];
  for (const fixture of cases) {
    const network = mockRequests(fixture.responses);
    await assert.rejects(fetchRecipePage('https://recipes.example', { resolve: publicDns, request: network.request }), fixture.error);
  }
});
