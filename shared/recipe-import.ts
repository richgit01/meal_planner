import type { InsertMeal } from "./schema";

export interface RecipeImportPreview {
  draft: InsertMeal;
  sourceUrl: string;
  warnings: string[];
}
