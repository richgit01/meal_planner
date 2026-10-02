import type { Express } from "express";
import { randomUUID } from "crypto";

import { db } from "./db";
import { meals, mealPlans, cookedMeals } from "@shared/schema";
import { insertMealPlanSchema, insertMealSchema, insertCookedMealSchema } from "@shared/schema";
import { eq, and } from "drizzle-orm";
import { registerRecipeImportRoute } from "./recipe-import";

// Validate YYYY-MM-DD strings for weekStartDate
const YMD = /^\d{4}-\d{2}-\d{2}$/;

export async function registerRoutes(app: Express): Promise<void> {
  registerRecipeImportRoute(app);
  /* ============================= MEALS ============================= */

  app.get("/api/meals", async (_req, res) => {
    try {
      const mealsData = await db.select().from(meals);
      res.json(mealsData);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch meals" });
    }
  });

  app.get("/api/meals/:id", async (req, res) => {
    try {
      const meal = await db.select().from(meals).where(eq(meals.id, req.params.id));
      if (meal.length === 0) {
        return res.status(404).json({ message: "Meal not found" });
      }
      res.json(meal[0]);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch meal" });
    }
  });

  app.post("/api/meals", async (req, res) => {
    try {
      const validated = insertMealSchema.parse(req.body);
      const mealWithId = { ...validated, id: randomUUID() };
      const [meal] = await db.insert(meals).values(mealWithId).returning();
      res.status(201).json(meal);
    } catch (error: any) {
      res.status(400).json({ message: "Invalid meal data", error: error.message });
    }
  });

  app.put("/api/meals/:id", async (req, res) => {
    try {
      console.log(`🔄 PUT /api/meals/${req.params.id} called`);
      console.log(`📤 Request body:`, req.body);

      const validated = insertMealSchema.partial().parse(req.body);
      console.log(`✅ Validated data:`, validated);

      const existingMeal = await db.select().from(meals).where(eq(meals.id, req.params.id));
      if (existingMeal.length === 0) {
        console.log(`❌ Meal not found with ID: ${req.params.id}`);
        return res.status(404).json({ message: "Meal not found" });
      }

      const [updatedMeal] = await db
        .update(meals)
        .set(validated)
        .where(eq(meals.id, req.params.id))
        .returning();

      console.log(`📊 Database update result:`, updatedMeal);
      console.log(`✅ Successfully updated meal:`, updatedMeal);
      res.json(updatedMeal);
    } catch (error: any) {
      console.error(`❌ Error updating meal:`, error);
      if (error.name === "ZodError") {
        res.status(400).json({ message: "Invalid meal data format", errors: error.errors });
      } else {
        res.status(500).json({ message: "Failed to update meal", error: error.message });
      }
    }
  });

  app.delete("/api/meals/:id", async (req, res) => {
    try {
      console.log(`🗑️ DELETE /api/meals/${req.params.id} called`);

      const existingMeal = await db.select().from(meals).where(eq(meals.id, req.params.id));
      if (existingMeal.length === 0) {
        console.log(`❌ Meal not found with ID: ${req.params.id}`);
        return res.status(404).json({ message: "Meal not found" });
      }

      await db.delete(meals).where(eq(meals.id, req.params.id)).returning();

      console.log(`✅ Successfully deleted meal: ${req.params.id}`);
      res.status(204).send();
    } catch (error: any) {
      console.error(`❌ Error deleting meal:`, error);
      res.status(500).json({ message: "Failed to delete meal", error: error.message });
    }
  });

  // Bulk import meals
  app.post("/api/meals/bulk-import", async (req, res) => {
    try {
      let mealsToImport: any[];

      if (Array.isArray(req.body)) {
        mealsToImport = req.body;
      } else if (req.body.meals && Array.isArray(req.body.meals)) {
        mealsToImport = req.body.meals;
      } else {
        return res.status(400).json({ message: "Expected array of meals or object with meals property" });
      }

      const createdMeals: any[] = [];
      const errors: Array<{ index: number; meal: string; error: string }> = [];

      for (let i = 0; i < mealsToImport.length; i++) {
        const mealData = mealsToImport[i];
        try {
          console.log(`Processing meal ${i + 1}:`, mealData);
          const validated = insertMealSchema.parse(mealData);
          const mealWithId = { ...validated, id: randomUUID() };
          const [meal] = await db.insert(meals).values(mealWithId).returning();
          createdMeals.push(meal);
          console.log(`✅ Successfully imported meal: ${meal.name}`);
        } catch (error: any) {
          console.error(`❌ Failed to import meal ${i + 1}:`, mealData, error);
          errors.push({
            index: i + 1,
            meal: mealData?.name || `Row ${i + 1}`,
            error: error.message,
          });
        }
      }

      res.json({
        message: `Successfully imported ${createdMeals.length} out of ${mealsToImport.length} meals`,
        imported: createdMeals.length,
        total: mealsToImport.length,
        errors: errors.length > 0 ? errors : undefined,
      });
    } catch (error: any) {
      console.error("Bulk import error:", error);
      res.status(500).json({ message: "Failed to import meals", error: error.message });
    }
  });

  /* =========================== MEAL PLANS =========================== */

  app.get("/api/meal-plans", async (_req, res) => {
    try {
      const mealPlansData = await db.select().from(mealPlans);
      res.json(mealPlansData);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch meal plans" });
    }
  });

  // Returns the meal plan for a given weekStartDate (YYYY-MM-DD)
  app.get("/api/meal-plans/:weekStartDate", async (req, res) => {
    try {
      const { weekStartDate } = req.params;
      if (!YMD.test(weekStartDate)) {
        return res.status(400).json({ message: "weekStartDate must be YYYY-MM-DD" });
      }

      const result = await db
        .select()
        .from(mealPlans)
        .where(eq(mealPlans.weekStartDate, weekStartDate))
        .limit(1);

      if (result.length === 0) {
        return res.status(404).json({ message: "Meal plan not found" });
      }
      return res.json(result[0]);
    } catch (error) {
      return res.status(500).json({ message: "Failed to fetch meal plan" });
    }
  });

  app.post("/api/meal-plans", async (req, res) => {
    try {
      console.log("Creating meal plan with data:", req.body);
      const validated = insertMealPlanSchema.parse(req.body);
      if (!YMD.test(validated.weekStartDate)) {
        return res.status(400).json({ message: "weekStartDate must be YYYY-MM-DD" });
      }

      const mealPlanWithId = { ...validated, id: randomUUID() };
      const [mealPlan] = await db.insert(mealPlans).values(mealPlanWithId).returning();
      res.status(201).json(mealPlan);
    } catch (error: any) {
      console.error("Meal plan creation error:", error);
      res.status(400).json({ message: "Invalid meal plan data", error: error.message });
    }
  });

  app.put("/api/meal-plans/:id", async (req, res) => {
    try {
      console.log("Updating meal plan with data:", req.body);
      const validated = insertMealPlanSchema.partial().parse(req.body);
      const [mealPlan] = await db
        .update(mealPlans)
        .set(validated)
        .where(eq(mealPlans.id, req.params.id))
        .returning();
      if (!mealPlan) {
        return res.status(404).json({ message: "Meal plan not found" });
      }
      res.json(mealPlan);
    } catch (error: any) {
      console.error("Meal plan update error:", error);
      res.status(400).json({ message: "Invalid meal plan data", error: error.message });
    }
  });

  /* =========================== COOKED MEALS =========================== */

  app.get("/api/cooked-meals/:weekStartDate", async (req, res) => {
    try {
      console.log("🔍 Fetching cooked meals for week:", req.params.weekStartDate);
      const cookedMealsData = await db
        .select()
        .from(cookedMeals)
        .where(eq(cookedMeals.weekStartDate, req.params.weekStartDate));
      console.log("📊 Found cooked meals:", cookedMealsData.length, "records:", cookedMealsData);
      res.json(cookedMealsData);
    } catch (error) {
      console.error("❌ Failed to fetch cooked meals:", error);
      res.status(500).json({ message: "Failed to fetch cooked meals" });
    }
  });

  app.post("/api/cooked-meals", async (req, res) => {
    try {
      console.log("📥 Received cooked meal data:", JSON.stringify(req.body, null, 2));
      const validated = insertCookedMealSchema.parse(req.body);
      console.log("✅ Parsed cooked meal:", JSON.stringify(validated, null, 2));
      const cookedMealWithId = { ...validated, id: randomUUID() };
      console.log("🆔 Adding ID to cooked meal:", JSON.stringify(cookedMealWithId, null, 2));

      // Idempotent insert: skip if already exists
      const existing = await db
        .select()
        .from(cookedMeals)
        .where(
          and(
            eq(cookedMeals.weekStartDate, cookedMealWithId.weekStartDate),
            eq(cookedMeals.day, cookedMealWithId.day),
            eq(cookedMeals.mealId, cookedMealWithId.mealId)
          )
        );
      console.log("🔍 Existing records check:", existing.length, "found");

      if (existing.length > 0) {
        console.log("⚠️ Record already exists, returning existing:", existing[0]);
        return res.status(200).json(existing[0]);
      }

      const [cookedMeal] = await db.insert(cookedMeals).values(cookedMealWithId).returning();
      console.log("💾 Database insert result:", JSON.stringify(cookedMeal, null, 2));

      // Optional verification
      // const verification = await db.select().from(cookedMeals).where(eq(cookedMeals.id, cookedMeal.id));
      // console.log("🔍 Verification query result:", verification.length, "records");

      res.status(201).json(cookedMeal);
    } catch (error: any) {
      console.error("❌ Failed to insert cooked meal:", error);
      console.error("🔍 Error details:", JSON.stringify(error, null, 2));
      res.status(400).json({ message: "Invalid cooked meal data", error: error.message });
    }
  });

  app.delete("/api/cooked-meals/:weekStartDate/:day/:mealId", async (req, res) => {
    try {
      const { weekStartDate, day, mealId } = req.params;
      await db
        .delete(cookedMeals)
        .where(
          and(
            eq(cookedMeals.weekStartDate, weekStartDate),
            eq(cookedMeals.day, day),
            eq(cookedMeals.mealId, mealId)
          )
        )
        .returning();
      res.status(204).send();
    } catch (error) {
      res.status(500).json({ message: "Failed to delete cooked meal" });
    }
  });

  /* ===================== SHOPPING LIST (PANTRY-FREE) ===================== */
  // Generates a shopping list for the given weekStartDate (YYYY-MM-DD)
  // based on saved meal plans, grouped by category, with a summary.
  app.get("/api/shopping-list/:weekStartDate", async (req, res) => {
    try {
      const { weekStartDate } = req.params;
      if (!YMD.test(weekStartDate)) {
        return res.status(400).json({ error: "weekStartDate must be YYYY-MM-DD" });
      }

      // 1) Load the meal plan (TEXT equality)
      const planRows = await db
        .select()
        .from(mealPlans)
        .where(eq(mealPlans.weekStartDate, weekStartDate))
        .limit(1);

      if (planRows.length === 0) {
        return res.status(404).json({ message: "Meal plan not found" });
      }
      const plan = planRows[0];

      // 2) Load meals catalog (resolve mealId -> ingredients)
      const mealsRows = await db.select().from(meals);

      // 3) Resolve selected meals for the week
      const selectedMeals = (plan.meals as Array<{ day: string; mealId: string | null }>)
        .filter(d => d.mealId)
        .map(d => mealsRows.find((m: any) => m.id === d.mealId))
        .filter((m: any) => m && m.ingredients);

      // 4) Aggregate ingredients by name (merge quantities as strings)
      type IngIn = { name?: string; quantity?: string; amount?: string; category?: string };
      const ingredientMap = new Map<string, { quantity: string; category: string }>();

      for (const meal of selectedMeals) {
        const ings = (meal.ingredients as IngIn[]) || [];
        for (const ing of ings) {
          if (!ing || !ing.name) continue;
          const name = ing.name.trim();
          const qty = (ing.quantity ?? ing.amount ?? "").trim();
          const category = (ing.category ?? "other").toLowerCase();

          if (ingredientMap.has(name)) {
            const existing = ingredientMap.get(name)!;
            ingredientMap.set(name, {
              quantity: existing.quantity && qty ? `${existing.quantity} + ${qty}` : (existing.quantity || qty),
              category: existing.category, // keep first category seen
            });
          } else {
            ingredientMap.set(name, { quantity: qty, category });
          }
        }
      }

      // 5) Group by category
      const categoryMap = new Map<string, Array<{ name: string; quantity: string; checked: boolean }>>();
      for (const [name, data] of ingredientMap.entries()) {
        const item = { name, quantity: data.quantity, checked: false };
        if (!categoryMap.has(data.category)) categoryMap.set(data.category, []);
        categoryMap.get(data.category)!.push(item);
      }

      // 6) Order categories (preferred order first)
      const categoryOrder = [
        "fresh", "vegetables", "fruit", "meat", "fish", "dairy", "grains",
        "pantry", "seasonings", "spices", "condiments", "other"
      ];

      const response: Record<string, any> = {};
      let totalItems = 0;

      // Add preferred categories first if present
      for (const cat of categoryOrder) {
        if (categoryMap.has(cat)) {
          const items = categoryMap.get(cat)!;
          response[cat] = items;
          totalItems += items.length;
          categoryMap.delete(cat);
        }
      }
      // Then add remaining categories
      for (const [cat, items] of categoryMap.entries()) {
        response[cat] = items;
        totalItems += items.length;
      }

      response.summary = { totalItems };
      return res.json(response);
    } catch (error: any) {
      console.error("GET /api/shopping-list error:", error);
      return res.status(500).json({ error: "Failed to build shopping list" });
    }
  });
}
