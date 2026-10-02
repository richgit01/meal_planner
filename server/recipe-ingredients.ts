type Ingredient = { name: string; amount: string; category: string };

// These are suggestions using the shopping list's existing categories, not a new taxonomy.
function ingredientCategory(name: string): string {
  const primaryName = name.split('(')[0].trim();
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
  if (/\b(oil|vinegar|soy sauce|cornflour|cornstarch|cooking wine|sesame seeds?|flour|stock)\b/i.test(primaryName)) return 'pantry';
  const matches = groups.filter(([, pattern]) => pattern.test(primaryName));
  return matches.length === 1 ? matches[0][0] : 'other';
}

export function parseRecipeIngredient(line: string): Ingredient {
  const original = line.replace(/[\n|]/g, ' ').replace(/\s+/g, ' ').trim();
  const quantity = '(?:\\d+\\s+\\d+/\\d+|\\d+/\\d+|\\d+(?:\\.\\d+)?[¼½¾⅓⅔⅛⅜⅝⅞]?|[¼½¾⅓⅔⅛⅜⅝⅞])';
  const unit = 'cups?|tablespoons?|teaspoons?|tbsp|tsp|grams?|kilograms?|g|kg|millilit(?:er|re)s?|lit(?:er|re)s?|ml|l|ounces?|oz|pounds?|lbs?|cloves?|slices?|cans?|tins?';
  const measure = new RegExp(`^(${quantity}(?:\\s*[-–]\\s*${quantity})?)(?:\\s*(${unit})\\.?)?(?=\\s|/|\\+|$)`, 'i');
  const leading = measure.exec(original);
  let name = original;
  let amount = '';
  if (leading) {
    amount = leading[0].trim();
    let rest = original.slice(leading[0].length);
    // Keep equivalent units and additive measures as text; never silently convert them.
    for (let part = 0; part < 4; part++) {
      const separator = /^\s*([/+])\s*/.exec(rest);
      if (!separator) break;
      const next = measure.exec(rest.slice(separator[0].length));
      if (!leading[2] || !next?.[2]) break;
      amount += ` ${separator[1]} ${next[0].trim()}`;
      rest = rest.slice(separator[0].length + next[0].length);
    }
    name = rest.trim();
    // Package sizes and unclear punctuation need manual review rather than guessing.
    if (/^[\d(/+–-]/.test(name) || !name) { name = original; amount = ''; }
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
  // Recipe-card metadata often wraps notes as '(, ...)' or '(- ...)'. Keep
  // substitutions, optional flags and preparation details, but clean the wrappers.
  name = name.replace(/\(\s*[,\-/]\s*/g, '(')
    .replace(/\(\s+/g, '(').replace(/\s+\)/g, ')')
    .replace(/\(\(([^()]*)\)\)/g, '($1)').replace(/\(\s*\)/g, '')
    .replace(/\s+/g, ' ').trim();
  return { name, amount, category: ingredientCategory(name) };
}

export function parseRecipeIngredientDetails(line: string): { ingredient: Ingredient; notes: string[] } {
  const ingredient = parseRecipeIngredient(line);
  if (!ingredient.amount && /^[\d¼½¾⅓⅔⅛⅜⅝⅞]/.test(ingredient.name)) return { ingredient, notes: [] };
  const notes: string[] = [];
  const name = ingredient.name;
  let depth = 0;
  let start = -1;
  let outside = '';
  for (let index = 0; index < name.length; index++) {
    const char = name[index];
    if (char === '(') { if (depth === 0) start = index; depth++; }
    else if (char === ')' && depth > 0) {
      depth--;
      if (depth === 0) {
        const detail = name.slice(start + 1, index).trim();
        if (/^(?:finely\s+)?(grated|chopped|minced|sliced|diced)$/i.test(detail)) outside += ` ${detail.replace(/^finely\s+/i, '')}`;
        else if (/^(optional|for\s+(mixing|coating|crispy coating))$/i.test(detail)) outside += ` (${detail})`;
        else if (detail) {
          notes.push(detail);
          if (/\boptional\b/i.test(detail)) outside += ' (optional)';
        }
      }
    } else if (depth === 0) outside += char;
  }
  // Unbalanced parentheses indicate unfamiliar text: preserve the original.
  if (depth !== 0 || !outside.trim()) return { ingredient, notes: [] };
  const cleaned = outside.replace(/\s+/g, ' ').replace(/[,;]\s*$/g, '').trim();
  return { ingredient: { ...ingredient, name: cleaned }, notes };
}
