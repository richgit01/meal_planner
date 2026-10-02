import assert from 'node:assert/strict';
import { test } from 'node:test';
import { insertMealPlanSchema } from './schema';

test('meal plans accept assigned meals and null slots and default missing arrays', () => {
  const data = { weekStartDate: '2026-10-03', meals: [{ day: 'Saturday', mealId: 'meal-001' }, { day: 'Sunday', mealId: null }] };
  assert.deepEqual(insertMealPlanSchema.parse(data), data);
  assert.deepEqual(insertMealPlanSchema.parse({ weekStartDate: data.weekStartDate }).meals, []);
});

test('meal plan updates preserve omitted fields instead of clearing meals', () => {
  assert.deepEqual(insertMealPlanSchema.partial().parse({ weekStartDate: '2026-10-10' }), { weekStartDate: '2026-10-10' });
  assert.deepEqual(insertMealPlanSchema.partial().parse({ meals: [] }), { meals: [] });
});

test('meal plans reject malformed meal references', () => {
  for (const meals of [[{ day: 'Saturday' }], [{ day: 'Saturday', mealId: 42 }], [{ day: 42, mealId: null }], 'invalid']) {
    assert.equal(insertMealPlanSchema.safeParse({ weekStartDate: '2026-10-03', meals }).success, false);
  }
});
