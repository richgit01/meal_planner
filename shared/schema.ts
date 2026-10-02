import { sql } from "drizzle-orm";
import { pgTable, text, varchar, json, integer, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const meals = pgTable("meals", {
  id: varchar("id").primaryKey().notNull(),
  name: text("name").notNull(),
  description: text("description").notNull(),
  cookTime: text("cook_time").notNull(),
  difficulty: text("difficulty").notNull(),
  servings: integer("servings").notNull(),
  image: text("image").notNull(),
  ingredients: json("ingredients").$type<Array<{ name: string; amount: string; category: string }>>().notNull().default([]),
  instructions: json("instructions").$type<Array<string>>().notNull().default([]),
  utensils: json("utensils").$type<Array<string>>().notNull().default([]),
});

export const mealPlans = pgTable("meal_plans", {
  id: varchar("id").primaryKey().notNull(),
  weekStartDate: text("week_start_date").notNull(),
  meals: json("meals").$type<Array<{ day: string; mealId: string | null }>>().notNull().default([]),
});

export const cookedMeals = pgTable("cooked_meals", {
  id: varchar("id").primaryKey().notNull(),
  weekStartDate: text("week_start_date").notNull(),
  day: text("day").notNull(),
  mealId: text("meal_id").notNull(),
  cookedAt: text("cooked_at").notNull(),
});

export const insertMealSchema = createInsertSchema(meals, {
  ingredients: z.array(z.object({ name: z.string(), amount: z.string(), category: z.string() })).optional().default([]),
  instructions: z.array(z.string()).optional().default([]),
  utensils: z.array(z.string()).optional().default([]),
}).omit({
  id: true,
});

export const insertMealPlanSchema = createInsertSchema(mealPlans, {
  meals: z.array(z.object({ day: z.string(), mealId: z.string().nullable() })).optional().default([]),
}).omit({
  id: true,
});

export const insertCookedMealSchema = createInsertSchema(cookedMeals).omit({
  id: true,
});

export type InsertMeal = z.infer<typeof insertMealSchema>;
export type Meal = typeof meals.$inferSelect;

export type InsertMealPlan = z.infer<typeof insertMealPlanSchema>;
export type MealPlan = typeof mealPlans.$inferSelect;

export type InsertCookedMeal = z.infer<typeof insertCookedMealSchema>;
export type CookedMeal = typeof cookedMeals.$inferSelect;
