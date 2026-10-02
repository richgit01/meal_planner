import { useState } from "react";

export function RecipeImagePreview({ url }: { url: string }) {
  const [failed, setFailed] = useState(false);
  if (!url) return null;
  return failed ? (
    <p className="text-sm text-amber-700" role="status">This image could not be loaded. You can replace the Image URL with one from your usual image repository.</p>
  ) : (
    <img src={url} alt="Imported recipe preview" referrerPolicy="no-referrer"
      className="mt-2 h-40 w-full rounded-md object-contain" onError={() => setFailed(true)} />
  );
}
