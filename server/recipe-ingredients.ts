type Ingredient = { name: string; amount: string; category: string };

// These are suggestions using the shopping list's existing categories, not a new taxonomy.
function ingredientCategory(name: string): string {
  const groups: Array<[string, RegExp]> = [
    ['pantry', /\b(flour|sugar|honey|oil|soy sauce|vinegar|stock|breadcrumbs?|baking powder|baking soda)\b/i],
    ['vegetables', /\b(ginger|garlic|onions?|carrots?|broccoli|potatoes?|tomatoes?|spinach|cabbage|courgettes?|zucchini|aubergines?|eggplants?|celery|mushrooms?|capsicums?|bell peppers?|leeks?|peas)\b/i],
    ['fruit', /\b(lemons?|limes?|oranges?|apples?|bananas?|berries|avocado(?:s)?)\b/i],
    ['meat', /\b(chicken|beef|pork|lamb|turkey|bacon|sausages?|steak)\b/i],
    ['fish', /\b(salmon|tuna|cod|fish|prawns?|shrimp|seafood)\b/i],
    ['dairy', /\b(milk|butter|cheese|yog[hu]?urt|cream)\b/i],
    ['grains', /\b(rice|pasta|oats?|quinoa|couscous)\b/i],
    ['seasonings', /\b(salt|black pepper|white pepper)\b/i],
    ['spices', /\b(cumin|paprika|turmeric|cinnamon|nutmeg|coriander powder)\b/i],
  ];
  // Avoid classifying an oil alternative as a vegetable or grain.
  if (/\boil\b/i.test(name)) return 'pantry';
  const matches = groups.filter(([, pattern]) => pattern.test(name));
  return matches.length === 1 ? matches[0][0] : 'other';
}

export function parseRecipeIngredient(line: string): Ingredient {
  const original = line.replace(/[\n|]/g, ' ').replace(/\s+/g, ' ').trim();
  const quantity = '(?:\\d+\\s+\\d+/\\d+|\\d+/\\d+|\\d+(?:\\.\\d+)?[¼½¾⅓⅔⅛⅜⅝⅞]?|[¼½¾⅓⅔⅛⅜⅝⅞])';
  const leading = new RegExp(`^(${quantity}(?:\\s*[-–]\\s*${quantity})?)(.*)$`).exec(original);
  let name = original;
  let amount = '';
  if (leading) {
    const units = /^\s*(cups?|tablespoons?|teaspoons?|tbsp|tsp|grams?|kilograms?|g|kg|millilit(?:er|re)s?|lit(?:er|re)s?|ml|l|ounces?|oz|pounds?|lbs?|cloves?|slices?|cans?|tins?)\.?\s+(.+)$/i.exec(leading[2]);
    if (units) {
      // Preserve the source's compact metric spelling (40g) or spaced spelling (500 g).
      const gap = /^\s/.test(leading[2]) ? ' ' : '';
      amount = `${leading[1]}${gap}${units[1]}`;
      name = units[2];
    } else if (/^\s+\S/.test(leading[2])) {
      name = leading[2].trim();
      amount = leading[1];
    }
    // Package sizes and unclear punctuation need manual review rather than guessing.
    if (/^[\d(/–-]/.test(name) || !name) { name = original; amount = ''; }
  }
  if (amount) {
    name = name.replace(/^(?:a\s+)?(?:piece|pieces)\s+of\s+/i, '');
    const garlicCloves = /^garlic\s+(cloves?)\b\s*(.*)$/i.exec(name);
    if (garlicCloves && /^\d+(?:\s*[-–]\s*\d+)?$/.test(amount)) {
      amount += ` ${garlicCloves[1]}`;
      name = `garlic ${garlicCloves[2]}`.trim();
    }
    name = name.replace(/\bpeeled\s+and\s+(?:finely\s+)?(grated|chopped|sliced)\b/gi, '$1')
      .replace(/\bfinely\s+(grated|chopped)\b/gi, '$1').trim();
  }
  return { name, amount, category: ingredientCategory(name) };
}
