// ─── Public Interfaces ──────────────────────────────────────────────────────

export interface StyleScore {
  overall: number; // 0-100
  breakdown: {
    colorHarmony: number; // 0-20
    styleCoherence: number; // 0-20
    occasionFit: number; // 0-15
    trendAlignment: number; // 0-15
    personalStyle: number; // 0-30 (consistency, streak, wardrobe)
  };
  tier: 'Bronce' | 'Plata' | 'Oro' | 'Platino' | 'Diamante';
  feedback: string;
  nextMilestone: string;
}

interface OutfitRecord {
  score?: number;
  date?: string;
  occasion?: string;
}

// ─── Tier System ────────────────────────────────────────────────────────────

const TIER_THRESHOLDS: Array<{ min: number; tier: StyleScore['tier'] }> = [
  { min: 90, tier: 'Diamante' },
  { min: 75, tier: 'Platino' },
  { min: 60, tier: 'Oro' },
  { min: 40, tier: 'Plata' },
  { min: 0, tier: 'Bronce' },
];

const TIER_FEEDBACK: Record<StyleScore['tier'], string> = {
  Bronce:
    '¡Estás empezando tu viaje de estilo! Cada outfit que registras te acerca a descubrir tu estilo personal. Sigue experimentando y no tengas miedo de probar cosas nuevas.',
  Plata:
    '¡Tu ojo para la moda se está afinando! Ya tienes buena intuición para combinar prendas. Ahora es momento de pulir los detalles y encontrar tu firma personal.',
  Oro:
    '¡Tienes un gran sentido del estilo! Tus outfits son consistentes y bien pensados. Estás en un punto donde pequeños ajustes pueden marcar una gran diferencia.',
  Platino:
    '¡Eres una referencia de estilo! Tu consistencia es admirable y cada outfit demuestra intención y gusto. Sigue experimentando para alcanzar el nivel máximo.',
  Diamante:
    '¡Eres un icono de estilo! Tu armario, tus combinaciones y tu constancia son impecables. Inspiras a otros con cada look que compartes. ¡Mantén esa energía!',
};

// ─── Public Functions ───────────────────────────────────────────────────────

/**
 * Get the tier name for a given score.
 */
export function getTierFromScore(score: number): StyleScore['tier'] {
  const clamped = Math.max(0, Math.min(100, Math.round(score)));
  for (const { min, tier } of TIER_THRESHOLDS) {
    if (clamped >= min) return tier;
  }
  return 'Bronce';
}

/**
 * Get a motivational description of the next milestone to reach.
 */
export function getNextMilestone(currentScore: number): string {
  const clamped = Math.max(0, Math.min(100, Math.round(currentScore)));

  if (clamped >= 90) {
    return '¡Ya eres Diamante! Tu siguiente reto: mantener la racha y experimentar con estilos nuevos sin bajar de 90. Eres la inspiración.';
  }
  if (clamped >= 75) {
    const remaining = 90 - clamped;
    return `Te faltan ${remaining} puntos para Diamante. Mantén la consistencia, experimenta con tendencias actuales y asegura que cada outfit tenga un detalle memorable.`;
  }
  if (clamped >= 60) {
    const remaining = 75 - clamped;
    return `Te faltan ${remaining} puntos para Platino. Enfócate en la armonía de colores, incluye accesorios intencionales y registra outfits diariamente para subir tu racha.`;
  }
  if (clamped >= 40) {
    const remaining = 60 - clamped;
    return `Te faltan ${remaining} puntos para Oro. Prioriza combinaciones que ya sabes que funcionan, añade variedad a tu armario y mantén una racha de al menos 7 días.`;
  }
  const remaining = 40 - clamped;
  return `Te faltan ${remaining} puntos para Plata. Empieza registrando un outfit diario, prueba las sugerencias de Mirror y poco a poco irás descubriendo tu estilo.`;
}

/**
 * Calculate the comprehensive style score based on multiple factors.
 *
 * The score is built from 5 components:
 * 1. Color Harmony (0-20): Based on average outfit ratings, weighted toward color.
 * 2. Style Coherence (0-20): Based on average outfit ratings, weighted toward coherence.
 * 3. Occasion Fit (0-15): Based on average outfit ratings, weighted toward occasion.
 * 4. Trend Alignment (0-15): Based on improvement trend over time.
 * 5. Personal Style (0-30): Based on consistency (streak), wardrobe size, and engagement.
 *
 * @param outfitHistory - Array of past outfit records with optional scores and dates
 * @param streakCount - Current consecutive-day streak of logging outfits
 * @param wardrobeSize - Total number of items in the user's wardrobe
 * @param avgRating - Average rating of outfit scores (0-10 scale from AI analysis)
 * @returns Complete StyleScore with breakdown, tier, feedback, and next milestone
 */
export function calculateStyleScore(
  outfitHistory: OutfitRecord[],
  streakCount: number,
  wardrobeSize: number,
  avgRating: number,
): StyleScore {
  // Clamp inputs to valid ranges
  const safeStreak = Math.max(0, streakCount);
  const safeWardrobeSize = Math.max(0, wardrobeSize);
  const safeAvgRating = Math.max(0, Math.min(10, avgRating));

  // ── Component 1: Color Harmony (0-20) ──
  // Derived from average outfit rating — color is ~30% of a good outfit
  const colorHarmony = Math.round(Math.min(20, (safeAvgRating / 10) * 20));

  // ── Component 2: Style Coherence (0-20) ──
  // Derived from average outfit rating — coherence is another ~30%
  // Slight bonus for consistency (low variance in scores)
  let styleCoherence = Math.round(Math.min(20, (safeAvgRating / 10) * 20));
  if (outfitHistory.length >= 5) {
    const scores = outfitHistory
      .filter((o) => typeof o.score === 'number')
      .map((o) => o.score!);
    if (scores.length >= 5) {
      const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
      const variance =
        scores.reduce((sum, s) => sum + Math.pow(s - mean, 2), 0) / scores.length;
      // Low variance = bonus (up to +3 points)
      const consistencyBonus = Math.max(0, 3 - Math.sqrt(variance) * 0.5);
      styleCoherence = Math.round(Math.min(20, styleCoherence + consistencyBonus));
    }
  }

  // ── Component 3: Occasion Fit (0-15) ──
  // Based on rating + diversity of occasions in history
  let occasionFit = Math.round(Math.min(12, (safeAvgRating / 10) * 12));
  const uniqueOccasions = new Set(
    outfitHistory.filter((o) => o.occasion).map((o) => o.occasion),
  );
  // Bonus for versatility — dressing well for multiple occasions
  const occasionDiversityBonus = Math.min(3, uniqueOccasions.size * 0.5);
  occasionFit = Math.round(Math.min(15, occasionFit + occasionDiversityBonus));

  // ── Component 4: Trend Alignment (0-15) ──
  // Based on improvement trajectory over time
  let trendAlignment = 7; // Neutral starting point
  const scoredHistory = outfitHistory.filter(
    (o) => typeof o.score === 'number',
  );
  if (scoredHistory.length >= 6) {
    const half = Math.floor(scoredHistory.length / 2);
    const olderHalf = scoredHistory.slice(0, half);
    const recentHalf = scoredHistory.slice(half);

    const olderAvg =
      olderHalf.reduce((s, o) => s + (o.score ?? 0), 0) / olderHalf.length;
    const recentAvg =
      recentHalf.reduce((s, o) => s + (o.score ?? 0), 0) / recentHalf.length;

    // Scale the difference: +5 points max for improvement, -5 for decline
    const diff = recentAvg - olderAvg;
    trendAlignment = Math.round(Math.min(15, Math.max(0, 7 + diff * 1.5)));
  }

  // ── Component 5: Personal Style (0-30) ──
  // Composite of streak, wardrobe curation, and engagement

  // Streak contribution (0-12): Rewards daily logging consistency
  // Sqrt curve so early streaks are rewarded more, diminishing returns after
  const streakPoints = Math.min(12, Math.round(Math.sqrt(safeStreak) * 3));

  // Wardrobe size contribution (0-10): Rewards having a well-stocked wardrobe
  // Sqrt curve: 10 items=~9pts, 25 items=~10pts. Not about hoarding.
  const wardrobePoints = Math.min(10, Math.round(Math.sqrt(safeWardrobeSize) * 2));

  // Engagement contribution (0-8): Rewards regularly logging outfits
  const engagementPoints = Math.min(
    8,
    Math.round(Math.sqrt(outfitHistory.length) * 1.5),
  );

  const personalStyle = Math.min(30, streakPoints + wardrobePoints + engagementPoints);

  // ── Final Score ──
  const rawOverall =
    colorHarmony + styleCoherence + occasionFit + trendAlignment + personalStyle;
  const overall = Math.max(0, Math.min(100, rawOverall));

  const tier = getTierFromScore(overall);

  return {
    overall,
    breakdown: {
      colorHarmony,
      styleCoherence,
      occasionFit,
      trendAlignment,
      personalStyle,
    },
    tier,
    feedback: TIER_FEEDBACK[tier],
    nextMilestone: getNextMilestone(overall),
  };
}
