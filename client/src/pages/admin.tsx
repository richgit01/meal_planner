import { useState, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Plus, Edit, Trash2, Upload, Save, Download, FileUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { insertMealSchema, type Meal, type InsertMeal } from "@shared/schema";
import { z } from "zod";
import type { RecipeImportPreview } from "@shared/recipe-import";
import { RecipeImagePreview } from "@/components/recipe-image-preview";

const mealFormSchema = insertMealSchema.extend({
  name: z.string().trim().min(1, "Name is required"),
  description: z.string().trim().min(1, "Description is required"),
  cookTime: z.string().trim().min(1, "Cook time is required"),
  servings: z.number().int().positive("Servings must be positive"),
  ingredientsText: z.string().trim().min(1, "Ingredients are required"),
  instructionsText: z.string().trim().min(1, "Instructions are required"),
  utensilsText: z.string().optional(),
});

type MealFormData = z.infer<typeof mealFormSchema>;

export default function Admin() {
  const { toast } = useToast();
  const [editingMeal, setEditingMeal] = useState<Meal | null>(null);
  const [showMealDialog, setShowMealDialog] = useState(false);
  const [bulkImportText, setBulkImportText] = useState("");
  const [showUrlDialog, setShowUrlDialog] = useState(false);
  const [recipeUrl, setRecipeUrl] = useState("");
  const [importPreview, setImportPreview] = useState<RecipeImportPreview | null>(null);
  const csvFileInputRef = useRef<HTMLInputElement>(null);

  const { data: meals = [], isLoading } = useQuery<Meal[]>({
    queryKey: ["/api/meals"],
  });

  const form = useForm<MealFormData>({
    resolver: zodResolver(mealFormSchema),
    defaultValues: {
      name: "",
      description: "",
      cookTime: "",
      difficulty: "Easy",
      servings: 4,
      image: "",
      ingredientsText: "",
      instructionsText: "",
      utensilsText: "",
    },
  });

  const handleCloseDialog = () => {
    console.log("Closing dialog...");
    setShowMealDialog(false);
    setEditingMeal(null);
    setImportPreview(null);

    form.reset({
      name: "",
      description: "",
      cookTime: "",
      difficulty: "Easy",
      servings: 4,
      image: "",
      ingredientsText: "",
      instructionsText: "",
      utensilsText: "",
    });
  };

  const createMealMutation = useMutation({
    mutationFn: async (mealData: InsertMeal) => {
      const result = await apiRequest("POST", "/api/meals", mealData);
      return result;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/meals"] });
      toast({ title: "Meal created successfully!" });
      handleCloseDialog();
    },
    onError: (error: any) => {
      console.error("Create meal error:", error);
      toast({ title: "Failed to create meal", variant: "destructive" });
    },
  });

  const updateMealMutation = useMutation({
    mutationFn: async ({ id, ...mealData }: { id: string } & Partial<InsertMeal>) => {
      const result = await apiRequest("PUT", `/api/meals/${id}`, mealData);
      return result;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/meals"] });
      toast({ title: "Meal updated successfully!" });
      handleCloseDialog();
    },
    onError: (error: any) => {
      console.error("Update meal error:", error);
      toast({ 
        title: "Failed to update meal", 
        description: error?.message || "Please try again",
        variant: "destructive" 
      });
    },
  });

  const deleteMealMutation = useMutation({
    mutationFn: async (id: string) => {
      console.log("Deleting meal with ID:", id);
      return await apiRequest("DELETE", `/api/meals/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/meals"] });
      toast({ title: "Meal deleted successfully!" });
    },
    onError: (error: any) => {
      console.error("Delete meal failed:", error);
      toast({ 
        title: "Failed to delete meal", 
        description: error?.message || "Please try again",
        variant: "destructive" 
      });
    },
  });

  const bulkImportMutation = useMutation({
    mutationFn: async (meals: InsertMeal[]) => {
      return await apiRequest("POST", "/api/meals/bulk-import", { meals });
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/meals"] });
      toast({ title: `Successfully imported ${data.imported} out of ${data.total} meals!` });
      setBulkImportText("");
    },
    onError: () => {
      toast({ title: "Failed to import meals", variant: "destructive" });
    },
  });

  const parseIngredientsText = (text: string) => {
    return text.split('\n').filter(line => line.trim()).map(line => {
      const parts = line.split('|').map(p => p.trim());
      return {
        name: parts[0] || line,
        amount: parts[1] || "1 unit",
        category: parts[2] || "fresh"
      };
    });
  };

  const parseInstructionsText = (text: string) => {
    return text.split('\n').filter(line => line.trim());
  };

  const parseUtensilsText = (text: string) => {
    return text ? text.split('\n').filter(line => line.trim()) : [];
  };

  const formatIngredientsText = (ingredients: Array<{ name: string; amount: string; category: string }>) => {
    return ingredients.map(ing => `${ing.name} | ${ing.amount} | ${ing.category}`).join('\n');
  };

  const formatInstructionsText = (instructions: string[]) => {
    return instructions.join('\n');
  };

  const formatUtensilsText = (utensils: string[]) => {
    return utensils ? utensils.join('\n') : '';
  };

  const urlImportMutation = useMutation({
    mutationFn: async (url: string): Promise<RecipeImportPreview> => {
      try {
        const response = await apiRequest("POST", "/api/recipes/import-preview", { url });
        return response.json();
      } catch (error) {
        const message = error instanceof Error ? error.message : "Could not import this recipe.";
        let detail = "Could not import this recipe. Check the URL or try another website.";
        try { detail = JSON.parse(message.slice(message.indexOf("{"))).message || detail; } catch { /* Network failure. */ }
        throw new Error(detail);
      }
    },
    onSuccess: (preview) => {
      setEditingMeal(null);
      setImportPreview(preview);
      form.reset({
        ...preview.draft,
        ingredientsText: formatIngredientsText(preview.draft.ingredients),
        instructionsText: formatInstructionsText(preview.draft.instructions),
        utensilsText: formatUtensilsText(preview.draft.utensils),
      });
      setShowUrlDialog(false);
      setShowMealDialog(true);
    },
  });

  const onSubmit = (data: MealFormData) => {
    console.log("Form submitted with data:", data);

    const ingredients = parseIngredientsText(data.ingredientsText);
    const instructions = parseInstructionsText(data.instructionsText);
    const utensils = parseUtensilsText(data.utensilsText || "");

    const mealData: InsertMeal = {
      name: data.name,
      description: data.description,
      cookTime: data.cookTime,
      difficulty: data.difficulty,
      servings: data.servings,
      image: data.image,
      ingredients,
      instructions,
      utensils,
    };

    console.log("Submitting meal data:", mealData);

    if (editingMeal) {
      console.log("Updating meal with ID:", editingMeal.id);
      updateMealMutation.mutate({ id: editingMeal.id, ...mealData });
    } else {
      console.log("Creating new meal");
      createMealMutation.mutate(mealData);
    }
  };

  const handleEdit = (meal: Meal) => {
    setImportPreview(null);
    setEditingMeal(meal);
    form.reset({
      name: meal.name,
      description: meal.description,
      cookTime: meal.cookTime,
      difficulty: meal.difficulty,
      servings: meal.servings,
      image: meal.image,
      ingredientsText: formatIngredientsText(meal.ingredients),
      instructionsText: formatInstructionsText(meal.instructions),
      utensilsText: formatUtensilsText(meal.utensils || []),
    });
    setShowMealDialog(true);
  };

  const handleBulkImport = () => {
    try {
      const mealsData = JSON.parse(bulkImportText);
      if (Array.isArray(mealsData)) {
        bulkImportMutation.mutate(mealsData);
      } else {
        toast({ title: "Invalid format. Expected JSON array of meals.", variant: "destructive" });
      }
    } catch (error) {
      toast({ title: "Invalid JSON format", variant: "destructive" });
    }
  };

  const totalMeals = meals?.length ?? 0;

  // Function to determine protein type from meal name and ingredients (same as meal selection modal)
  const getProteinType = (meal: Meal): string => {
    const name = meal.name.toLowerCase();
    const ingredientsText = meal.ingredients?.map(ing => ing.name.toLowerCase()).join(' ') || '';

    // Check meal name first (more reliable)
    if (name.includes('beef') || name.includes('steak') || name.includes('mince') || name.includes('ground beef')) {
      return 'Beef';
    }
    if (name.includes('chicken') || name.includes('chook')) {
      return 'Chicken';
    }
    if (name.includes('pork') || name.includes('ham') || name.includes('bacon') || name.includes('sausage')) {
      return 'Pork';
    }
    if (name.includes('salmon') || name.includes('fish') || name.includes('cod') || name.includes('tuna') || 
        name.includes('seafood') || name.includes('prawn') || name.includes('barramundi')) {
      return 'Fish';
    }
    if (name.includes('turkey')) {
      return 'Turkey';
    }
    if (name.includes('lamb') || name.includes('mutton')) {
      return 'Lamb';
    }
    if (name.includes('vegetable') || name.includes('vegan') || name.includes('veggie') || 
        name.includes('mushroom') || name.includes('tofu') || name.includes('lentil') || name.includes('bean')) {
      return 'Vegetarian';
    }

    // Fall back to ingredients only if name doesn't give clear indication
    if (ingredientsText.includes('beef') || ingredientsText.includes('steak') || ingredientsText.includes('mince')) {
      return 'Beef';
    }
    if (ingredientsText.includes('chicken')) {
      return 'Chicken';
    }
    if (ingredientsText.includes('pork') || ingredientsText.includes('ham') || ingredientsText.includes('bacon')) {
      return 'Pork';
    }
    if (ingredientsText.includes('salmon') || ingredientsText.includes('fish') || ingredientsText.includes('cod') || 
        ingredientsText.includes('tuna') || ingredientsText.includes('seafood')) {
      return 'Fish';
    }
    if (ingredientsText.includes('turkey')) {
      return 'Turkey';
    }
    if (ingredientsText.includes('lamb')) {
      return 'Lamb';
    }

    return 'Other';
  };

  // Group meals by protein type
  const groupedMeals = meals.reduce((groups, meal) => {
    const proteinType = getProteinType(meal);
    if (!groups[proteinType]) {
      groups[proteinType] = [];
    }
    groups[proteinType].push(meal);
    return groups;
  }, {} as Record<string, Meal[]>);

  // Combine Other into Vegetarian category and define the order of protein types
  if (groupedMeals['Other']) {
    if (!groupedMeals['Vegetarian']) {
      groupedMeals['Vegetarian'] = [];
    }
    groupedMeals['Vegetarian'].push(...groupedMeals['Other']);
    delete groupedMeals['Other'];
  }

  const proteinOrder = ['Beef', 'Chicken', 'Pork', 'Lamb', 'Fish', 'Vegetarian'];
  const sortedGroups = proteinOrder.filter(type => groupedMeals[type]);

  const downloadCSVTemplate = () => {
    const csvContent = [
      // CSV Header
      'name,description,cookTime,difficulty,servings,image,ingredients,instructions,utensils',
      // Example row to show format
      'Example Chicken Parmesan,"Crispy breaded chicken with marinara and cheese","45 mins",Medium,4,"https://images.unsplash.com/photo-1551183053-bf91a1d81141","Chicken breast|2 lbs|fresh;Breadcrumbs|2 cups|pantry;Marinara sauce|2 cups|pantry;Mozzarella cheese|2 cups|fresh","Pound chicken to even thickness;Bread chicken with breadcrumbs;Fry until golden brown;Top with sauce and cheese;Bake at 375°F for 20 minutes","Large skillet;Meat mallet;Baking dish"'
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', 'meal-template.csv');
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    toast({ title: "CSV template downloaded successfully!" });
  };

  const handleCSVImport = () => {
    csvFileInputRef.current?.click();
  };

  const processCsvFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const csvText = e.target?.result as string;
        const lines = csvText.split('\n').filter(line => line.trim());

        if (lines.length < 2) {
          toast({ title: "Invalid CSV: No data rows found", variant: "destructive" });
          return;
        }

        // Parse CSV (skip header row)
        const meals = lines.slice(1).map((line, index) => {
          try {
            // Simple CSV parsing - handle quoted fields
            const fields = [];
            let current = '';
            let inQuotes = false;

            for (let i = 0; i < line.length; i++) {
              const char = line[i];
              if (char === '"') {
                inQuotes = !inQuotes;
              } else if (char === ',' && !inQuotes) {
                fields.push(current);
                current = '';
              } else {
                current += char;
              }
            }
            fields.push(current); // Add last field

            if (fields.length !== 9) {
              throw new Error(`Row ${index + 2} has ${fields.length} fields, expected 9`);
            }

            const [name, description, cookTime, difficulty, servings, image, ingredientsText, instructionsText, utensilsText] = fields;

            // Parse ingredients (format: "item|amount|category;item2|amount2|category2")
            const ingredients = ingredientsText.split(';').map(ing => {
              const parts = ing.split('|');
              return {
                name: parts[0]?.trim() || '',
                amount: parts[1]?.trim() || '1 unit',
                category: parts[2]?.trim() || 'fresh'
              };
            }).filter(ing => ing.name);

            // Parse instructions (format: "step1;step2;step3")
            const instructions = instructionsText.split(';').map(step => step.trim()).filter(step => step);

            // Parse utensils (format: "utensil1;utensil2;utensil3")
            const utensils = utensilsText ? utensilsText.split(';').map(utensil => utensil.trim()).filter(utensil => utensil) : [];

            return {
              name: name.trim(),
              description: description.trim(),
              cookTime: cookTime.trim(),
              difficulty: difficulty.trim(),
              servings: parseInt(servings) || 4,
              image: image.trim(),
              ingredients,
              instructions,
              utensils
            };
          } catch (error) {
            console.error(`Error parsing CSV row ${index + 2}:`, error);
            throw new Error(`Error parsing row ${index + 2}: ${error.message}`);
          }
        });

        // Import the parsed meals
        bulkImportMutation.mutate(meals);

      } catch (error) {
        console.error('CSV parsing error:', error);
        toast({ 
          title: "CSV Import Failed", 
          description: error.message || "Invalid CSV format",
          variant: "destructive" 
        });
      }
    };

    reader.onerror = () => {
      toast({ title: "Failed to read CSV file", variant: "destructive" });
    };

    reader.readAsText(file);
  };

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      if (!file.name.toLowerCase().endsWith('.csv')) {
        toast({ title: "Please select a CSV file", variant: "destructive" });
        return;
      }
      processCsvFile(file);
    }
    // Reset the input
    if (csvFileInputRef.current) {
      csvFileInputRef.current.value = '';
    }
  };





  if (isLoading) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div>Loading meals...</div>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 sm:py-8">
      <div className="mb-6 sm:mb-8">
        {/* Header Text */}
        <div className="mb-4 sm:mb-6">
          <h2 className="text-xl sm:text-2xl font-bold text-slate-800">Meal Administration</h2>
          <p className="text-sm sm:text-base text-slate-600 mt-1">Manage your meal collection</p>
        </div>

        {/* Action Buttons */}
        <div className="space-y-3 sm:space-y-0 sm:flex sm:flex-wrap sm:gap-2">
          <Dialog open={showUrlDialog} onOpenChange={(open) => {
            if (!urlImportMutation.isPending) setShowUrlDialog(open);
          }}>
            <DialogTrigger asChild>
              <Button variant="outline" className="w-full sm:w-auto" onClick={() => {
                setRecipeUrl("");
                urlImportMutation.reset();
              }}>Import Recipe from URL</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>Import Recipe from URL</DialogTitle></DialogHeader>
              <DialogDescription>Extract a draft, then review it in the meal form. Nothing is saved until you click Save Meal.</DialogDescription>
              <form className="space-y-4" onSubmit={(event) => {
                event.preventDefault();
                if (!urlImportMutation.isPending) urlImportMutation.mutate(recipeUrl.trim());
              }}>
                <Label htmlFor="recipe-url">Recipe URL</Label>
                <Input id="recipe-url" type="url" required maxLength={2048} placeholder="https://..." value={recipeUrl}
                  disabled={urlImportMutation.isPending} onChange={(event) => setRecipeUrl(event.target.value)} />
                {urlImportMutation.error && <p role="alert" className="text-sm text-red-600">{urlImportMutation.error.message}</p>}
                <Button type="submit" disabled={urlImportMutation.isPending || !recipeUrl.trim()}>
                  {urlImportMutation.isPending ? "Extracting recipe..." : "Preview Recipe"}
                </Button>
              </form>
            </DialogContent>
          </Dialog>
          {/* Primary Action - Add Meal */}
          <Dialog open={showMealDialog} onOpenChange={(open) => { if (open) setShowMealDialog(true); else handleCloseDialog(); }}>
            <DialogTrigger asChild>
              <Button 
                onClick={() => { setEditingMeal(null); setImportPreview(null); form.reset(); }}
                className="w-full sm:w-auto"
              >
                <Plus className="h-4 w-4 mr-2" />
                Add New Meal
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>{editingMeal ? "Edit Meal" : "Add New Meal"}</DialogTitle>
              </DialogHeader>
              {importPreview && <div className="rounded-md bg-blue-50 p-4 text-sm space-y-2">
                <p className="font-medium">Imported draft — nothing has been saved.</p>
                <a href={importPreview.sourceUrl} target="_blank" rel="noopener noreferrer" className="text-blue-700 underline break-all">View original recipe</a>
                <ul className="list-disc pl-5 space-y-1">{importPreview.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul>
              </div>}
              <Form {...form}>
                <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FormField
                      control={form.control}
                      name="name"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Name</FormLabel>
                          <FormControl>
                            <Input {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="cookTime"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Cook Time</FormLabel>
                          <FormControl>
                            <Input placeholder="e.g., 30 mins" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>

                  <FormField
                    control={form.control}
                    name="description"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Description</FormLabel>
                        <FormControl>
                          <Textarea {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <FormField
                      control={form.control}
                      name="difficulty"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Difficulty</FormLabel>
                          <Select onValueChange={field.onChange} value={field.value}>
                            <FormControl>
                              <SelectTrigger>
                                <SelectValue placeholder="Select difficulty" />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              <SelectItem value="Easy">Easy</SelectItem>
                              <SelectItem value="Medium">Medium</SelectItem>
                              <SelectItem value="Hard">Hard</SelectItem>
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="servings"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Servings</FormLabel>
                          <FormControl>
                            <Input type="number" {...field} onChange={e => field.onChange(parseInt(e.target.value))} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="image"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Image URL</FormLabel>
                          <FormControl>
                            <Input placeholder="https://..." {...field} />
                          </FormControl>
                          <FormMessage />
                          {importPreview && <RecipeImagePreview key={field.value} url={field.value} />}
                        </FormItem>
                      )}
                    />
                  </div>

                  <FormField
                    control={form.control}
                    name="ingredientsText"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Ingredients (one per line: "name | amount | category")</FormLabel>
                        <FormControl>
                          <Textarea 
                            placeholder="Chicken breast | 2 lbs | fresh&#10;Tomatoes | 4 medium | vegetables&#10;Salt | 1 tsp | pantry&#10;Apples | 3 large | fruit"
                            className="min-h-[100px]"
                            {...field} 
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="instructionsText"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Instructions (one per line)</FormLabel>
                        <FormControl>
                          <Textarea 
                            placeholder="Preheat oven to 350°F&#10;Season chicken with salt and pepper&#10;Bake for 25 minutes"
                            className="min-h-[100px]"
                            {...field} 
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="utensilsText"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Utensils (one per line, optional)</FormLabel>
                        <FormControl>
                          <Textarea 
                            placeholder="Large saucepan&#10;Frying pan&#10;Wooden spoon"
                            className="min-h-[80px]"
                            {...field} 
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <div className="flex justify-end space-x-4">
                    <Button type="button" variant="outline" onClick={handleCloseDialog}>
                      Cancel
                    </Button>
                    <Button 
                      type="submit"
                      disabled={createMealMutation.isPending || updateMealMutation.isPending}
                    >
                      <Save className="h-4 w-4 mr-2" />
                      {createMealMutation.isPending || updateMealMutation.isPending 
                        ? "Saving..." 
                        : editingMeal ? "Save Changes" : "Save Meal"}
                    </Button>
                  </div>
                </form>
              </Form>
            </DialogContent>
          </Dialog>
        </div>

        {/* Secondary Actions - Mobile: Stack, Desktop: Row */}
        <div className="grid grid-cols-1 sm:flex sm:flex-wrap gap-2 mt-3 sm:mt-2">
          <Button 
            onClick={downloadCSVTemplate} 
            variant="outline"
            className="w-full sm:w-auto text-sm"
          >
            <Download className="h-4 w-4 mr-2" />
            <span className="hidden sm:inline">Download CSV Template</span>
            <span className="sm:hidden">Download Template</span>
          </Button>

          <Button 
            onClick={handleCSVImport} 
            variant="outline"
            className="w-full sm:w-auto text-sm"
          >
            <FileUp className="h-4 w-4 mr-2" />
            <span className="hidden sm:inline">Import CSV</span>
            <span className="sm:hidden">Import CSV</span>
          </Button>

          <input
            ref={csvFileInputRef}
            type="file"
            accept=".csv"
            onChange={handleFileChange}
            style={{ display: 'none' }}
          />


        </div>
      </div>

      <div className="space-y-8">
        {sortedGroups.map((proteinType) => (
          <div key={proteinType}>
            <h3 className="text-xl font-semibold text-slate-700 mb-4 border-b border-slate-200 pb-2">
              {proteinType} ({groupedMeals[proteinType].length})
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {groupedMeals[proteinType].map((meal) => (
                <Card key={meal.id}>
                  <CardHeader className="pb-2">
                    <img
                      src={meal.image}
                      alt={meal.name}
                      className="w-full h-48 object-cover rounded-lg mb-2"
                    />
                    <div className="flex justify-between items-start">
                      <CardTitle className="text-lg">{meal.name}</CardTitle>
                      <div className="flex space-x-2">
                        <Button size="sm" variant="outline" onClick={() => handleEdit(meal)}>
                          <Edit className="h-4 w-4" />
                        </Button>
                        <Button 
                          size="sm" 
                          variant="destructive" 
                          onClick={() => {
                            if (window.confirm(`Are you sure you want to delete "${meal.name}"? This action cannot be undone.`)) {
                              deleteMealMutation.mutate(meal.id);
                            }
                          }}
                          disabled={deleteMealMutation.isPending}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <p className="text-sm text-slate-600 mb-3">{meal.description}</p>
                    <div className="flex justify-between items-center mb-3">
                      <Badge variant="outline">{meal.difficulty}</Badge>
                      <span className="text-sm text-slate-500">{meal.cookTime}</span>
                    </div>
                    <div className="text-sm text-slate-600">
                      <strong>Servings:</strong> {meal.servings}<br />
                      <strong>Ingredients:</strong> {meal.ingredients?.length || 0}<br />
                      <strong>Steps:</strong> {meal.instructions?.length || 0}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        ))}
      </div>


    </div>
  );
}
