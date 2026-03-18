import { generateJSON } from '../services/gemini.js';
import { outfitGenerationPrompt, dailyOutfitPrompt } from './prompts.js';
import type { WardrobeItem } from '../types/index.js';

// ─── Public Interfaces ──────────────────────────────────────────────────────

export interface OutfitSuggestion {
  itemIds: string[];
  reasoning: string;
  styleTips: string[];
  score: number;
  vibe: string;
}

// ─── Internal Gemini Response Shapes ────────────────────────────────────────

interface GeminiOutfitResponse {
  items: string[];
  reasoning: string;
  style_tips: string[];
  score: number;
  vibe: string;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function mapResponse(raw: GeminiOutfitResponse): OutfitSuggestion {
  return {
    itemIds: Array.isArray(raw.items) ? raw.items : [],
    reasoning: raw.reasoning ?? '',
    styleTips: Array.isArray(raw.style_tips) ? raw.style_tips : [],
    score: typeof raw.score === 'number' ? Math.max(0, Math.min(100, Math.round(raw.score))) : 0,
    vibe: raw.vibe ?? '',
  };
}

/**
 * Validate that all returned item IDs actually exist in the provided wardrobe.
 * Returns only the valid IDs.
 */
function validateItemIds(returnedIds: string[], wardrobeItems: WardrobeItem[]): string[] {
  const validIds = new Set(wardrobeItems.map((item) => item.id));
  return returnedIds.filter((id) => validIds.has(id));
}

/**
 * Ensure the outfit has a reasonable structure:
 * at least one top/dress + one bottom/dress + ideally shoes.
 */
function hasMinimalStructure(itemIds: string[], wardrobeItems: WardrobeItem[]): boolean {
  const selectedItems = wardrobeItems.filter((item) => itemIds.includes(item.id));
  const categories = new Set(selectedItems.map((item) => item.category));

  // A dress/formal alone can serve as top+bottom
  const hasDressOrFormal = categories.has('dresses') || categories.has('formal');
  const hasTop = categories.has('tops') || categories.has('outerwear') || categories.has('activewear');
  const hasBottom = categories.has('bottoms') || categories.has('activewear');

  return hasDressOrFormal || (hasTop && hasBottom);
}

// ─── Main Functions ─────────────────────────────────────────────────────────

/**
 * Generate a single outfit suggestion from the user's wardrobe.
 *
 * @param wardrobeItems - Full list of the user's wardrobe items
 * @param occasion - The occasion to dress for (casual, work, formal, etc.)
 * @param options - Optional weather, mood, and item IDs to exclude
 * @returns A validated outfit suggestion
 * @throws If fewer than 2 items available or AI cannot produce a valid outfit
 */
export async function generateOutfit(
  wardrobeItems: WardrobeItem[],
  occasion: string,
  options?: { weather?: string; mood?: string; exclude?: string[] },
): Promise<OutfitSuggestion> {
  // Filter out excluded items
  const availableItems = options?.exclude
    ? wardrobeItems.filter((item) => !options.exclude!.includes(item.id))
    : wardrobeItems;

  if (availableItems.length < 2) {
    throw new Error(
      'Se necesitan al menos 2 prendas en el armario para generar un outfit.',
    );
  }

  const prompt = outfitGenerationPrompt(
    availableItems,
    occasion,
    options?.weather,
    options?.mood,
  );

  const raw = await generateJSON<GeminiOutfitResponse>(prompt);

  // Validate IDs
  const validatedIds = validateItemIds(raw.items, availableItems);

  if (validatedIds.length < 2) {
    throw new Error(
      'La IA no pudo generar un outfit válido con las prendas disponibles. Intenta añadir más prendas a tu armario.',
    );
  }

  // Check structural integrity — warn but don't fail
  if (!hasMinimalStructure(validatedIds, availableItems)) {
    // Attempt a second generation with explicit instruction
    const retryPrompt =
      outfitGenerationPrompt(availableItems, occasion, options?.weather, options?.mood) +
      '\n\nIMPORTANTE: El outfit DEBE incluir al menos una prenda superior (tops/outerwear) y una inferior (bottoms), o un vestido/mono. También incluye calzado si hay disponible.';

    const retryRaw = await generateJSON<GeminiOutfitResponse>(retryPrompt);
    const retryIds = validateItemIds(retryRaw.items, availableItems);

    if (retryIds.length >= 2) {
      return mapResponse({ ...retryRaw, items: retryIds });
    }
  }

  return mapResponse({ ...raw, items: validatedIds });
}

/**
 * Generate multiple distinct outfit options for the same occasion.
 * Each outfit is generated with a different mood/vibe to ensure variety.
 *
 * @param wardrobeItems - Full list of the user's wardrobe items
 * @param occasion - The occasion to dress for
 * @param count - Number of outfit options to generate (default: 3)
 * @returns Array of distinct outfit suggestions
 * @throws If no outfits could be generated at all
 */
export async function generateOutfitOptions(
  wardrobeItems: WardrobeItem[],
  occasion: string,
  count: number = 3,
): Promise<OutfitSuggestion[]> {
  // Clamp count to reasonable range
  const targetCount = Math.max(1, Math.min(5, count));

  // Different moods to generate variety
  const moods = [
    'clásico y seguro — un look que siempre funciona',
    'trendy y arriesgado — algo más atrevido y actual',
    'relajado y cómodo — prioriza comodidad sin perder estilo',
    'elegante y sofisticado — el look más pulido posible',
    'creativo y único — una combinación inesperada pero acertada',
  ];

  const results: OutfitSuggestion[] = [];
  const usedCombinations = new Set<string>();

  for (let i = 0; i < targetCount; i++) {
    try {
      const suggestion = await generateOutfit(wardrobeItems, occasion, {
        mood: moods[i % moods.length],
      });

      // Avoid duplicate combinations
      const comboKey = [...suggestion.itemIds].sort().join('|');
      if (!usedCombinations.has(comboKey)) {
        usedCombinations.add(comboKey);
        results.push(suggestion);
      }
    } catch {
      // If one generation fails, continue with the others
      continue;
    }
  }

  if (results.length === 0) {
    throw new Error(
      'No se pudieron generar opciones de outfit. Asegúrate de tener suficientes prendas en tu armario.',
    );
  }

  // Sort by score descending so the best option is first
  results.sort((a, b) => b.score - a.score);

  return results;
}

/**
 * Generate the "Outfit of the Day" based on weather, agenda, and mood.
 * This is the daily personalized suggestion shown on the home screen.
 *
 * @param wardrobeItems - Full list of the user's wardrobe items
 * @param weather - Current weather description (e.g., "Soleado, 22°C")
 * @param agenda - List of today's events/activities
 * @param mood - User's current mood
 * @returns A personalized daily outfit suggestion
 * @throws If fewer than 2 items available
 */
export async function generateDailyOutfit(
  wardrobeItems: WardrobeItem[],
  weather: string,
  agenda: string[],
  mood: string,
): Promise<OutfitSuggestion> {
  if (wardrobeItems.length < 2) {
    throw new Error(
      'Se necesitan al menos 2 prendas para generar el outfit del día.',
    );
  }

  const prompt = dailyOutfitPrompt(wardrobeItems, weather, agenda, mood);
  const raw = await generateJSON<GeminiOutfitResponse>(prompt);

  const validatedIds = validateItemIds(raw.items, wardrobeItems);

  if (validatedIds.length < 2) {
    throw new Error(
      'La IA no pudo generar un outfit del día válido. Intenta añadir más prendas variadas a tu armario.',
    );
  }

  return mapResponse({ ...raw, items: validatedIds });
}
