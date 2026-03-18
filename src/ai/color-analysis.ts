import { analyzeImageJSON, generateJSON } from '../services/gemini.js';
import { colorAnalysisPrompt } from './prompts.js';

// ─── Public Interfaces ──────────────────────────────────────────────────────

export interface ColorAnalysis {
  season: string;
  undertone: string;
  bestColors: string[];
  avoidColors: string[];
  description: string;
  paletteHex: string[];
  contrastLevel: string;
  bestNeutrals: string[];
  bestMetals: string;
  styleTip: string;
}

export interface ColorHarmonyResult {
  score: number;
  explanation: string;
  harmonyType: string;
  suggestion: string;
}

// ─── Internal Gemini Response Shapes ────────────────────────────────────────

interface GeminiColorResponse {
  season: string;
  undertone: string;
  best_colors: string[];
  avoid_colors: string[];
  description: string;
  palette_hex: string[];
  contrast_level: string;
  best_neutrals: string[];
  best_metals: string;
  style_tip: string;
}

interface GeminiHarmonyResponse {
  score: number;
  explanation: string;
  harmony_type: string;
  suggestion: string;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Validate that a string looks like a hex color code.
 */
function isValidHex(hex: string): boolean {
  return /^#[0-9A-Fa-f]{6}$/.test(hex);
}

/**
 * Clamp a score to the valid 1-10 range.
 */
function clampScore(score: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(score)));
}

// ─── Main Functions ─────────────────────────────────────────────────────────

/**
 * Analyze the user's color season from a selfie photo.
 * Uses Gemini Vision to determine the user's seasonal color palette
 * based on skin tone, hair color, eye color, and overall contrast.
 *
 * @param selfieBase64 - Base64-encoded JPEG image of the user's face
 * @returns Complete color analysis with season, palette, and recommendations
 */
export async function analyzeColorSeason(selfieBase64: string): Promise<ColorAnalysis> {
  if (!selfieBase64 || selfieBase64.length === 0) {
    throw new Error('Se requiere una imagen para el análisis de color.');
  }

  const prompt = colorAnalysisPrompt();
  const result = await analyzeImageJSON<GeminiColorResponse>(selfieBase64, prompt);

  // Validate and sanitize hex codes
  const paletteHex = Array.isArray(result.palette_hex)
    ? result.palette_hex.filter(isValidHex)
    : [];

  return {
    season: result.season || 'No determinado',
    undertone: result.undertone || 'neutro',
    bestColors: Array.isArray(result.best_colors) ? result.best_colors : [],
    avoidColors: Array.isArray(result.avoid_colors) ? result.avoid_colors : [],
    description: result.description || 'No se pudo generar una descripción detallada.',
    paletteHex,
    contrastLevel: result.contrast_level || 'medio',
    bestNeutrals: Array.isArray(result.best_neutrals) ? result.best_neutrals : [],
    bestMetals: result.best_metals || 'mixto',
    styleTip: result.style_tip || '',
  };
}

/**
 * Evaluate the color harmony of a set of colors in an outfit context.
 * Uses color theory (complementary, analogous, triadic, monochromatic)
 * to determine how well the colors work together.
 *
 * @param colors - Array of color names or hex codes to evaluate
 * @returns Harmony score (1-10), explanation, type, and improvement suggestion
 */
export async function getColorHarmony(
  colors: string[],
): Promise<ColorHarmonyResult> {
  // Edge cases
  if (!colors || colors.length === 0) {
    return {
      score: 10,
      explanation: 'No hay colores para evaluar.',
      harmonyType: 'N/A',
      suggestion: 'Añade prendas a tu outfit para evaluar la armonía.',
    };
  }

  if (colors.length === 1) {
    return {
      score: 10,
      explanation: 'Un solo color siempre es armónico consigo mismo. Look monocromático perfecto.',
      harmonyType: 'monocromático',
      suggestion: 'Prueba añadir un segundo color para crear más interés visual — un neutro o un color de acento.',
    };
  }

  const uniqueColors = Array.from(new Set(colors.map((c) => c.toLowerCase().trim())));

  const prompt = `Eres una experta en teoría del color aplicada a la moda. Evalúa la armonía de esta combinación de colores en un outfit.

COLORES A EVALUAR: ${uniqueColors.join(', ')}

TIPOS DE ARMONÍA DE COLOR:
- Monocromático: Variaciones de un mismo tono (ej: azul claro + azul marino). Elegante y sofisticado.
- Análogo: Colores vecinos en la rueda cromática (ej: azul + verde azulado). Natural y agradable.
- Complementario: Colores opuestos en la rueda (ej: azul + naranja). Alto contraste, impactante.
- Triádico: Tres colores equidistantes en la rueda (ej: rojo + amarillo + azul). Vibrante.
- Split-complementario: Un color + los dos adyacentes a su complementario. Equilibrado con tensión.
- Neutro + Acento: Base de neutros (negro, blanco, beige, gris) con un toque de color. Clásico y seguro.
- Tierra: Colores terrosos (marrón, beige, verde oliva, terracota). Natural y cálido.

CRITERIOS DE EVALUACIÓN:
1. ¿Los colores pertenecen a un esquema de armonía reconocible?
2. ¿Hay balance entre colores saturados y neutros?
3. ¿Los tonos son coherentes (todos cálidos, todos fríos, o contraste intencional)?
4. ¿El balance de proporciones tiene sentido para un outfit?

Responde ÚNICAMENTE con un objeto JSON válido:
{
  "score": 8,
  "explanation": "Explicación detallada en español de por qué estos colores funcionan (o no) juntos, mencionando el tipo de armonía y la teoría del color aplicada",
  "harmony_type": "Tipo de armonía detectada (monocromático, análogo, complementario, triádico, neutro + acento, tierra, discordante)",
  "suggestion": "Sugerencia específica en español de cómo mejorar la combinación o potenciarla (ej: 'Añade un toque de blanco para equilibrar', 'Cambia el amarillo por mostaza para suavizar el contraste')"
}

Puntuación: 1-3 = discordante, 4-5 = funcional pero mejorable, 6-7 = buena armonía, 8-9 = excelente armonía, 10 = armonía perfecta.`;

  const result = await generateJSON<GeminiHarmonyResponse>(prompt);

  return {
    score: clampScore(result.score ?? 5, 1, 10),
    explanation: result.explanation || 'No se pudo analizar la armonía de colores.',
    harmonyType: result.harmony_type || 'no determinado',
    suggestion: result.suggestion || '',
  };
}
