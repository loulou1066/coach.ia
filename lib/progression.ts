// Moteur de règles du coach : déterministe, testable, sans IA.
// L'IA conversationnelle explique et adapte autour de ces sorties, elle ne calcule pas les charges.

export type SetLog = { reps: number; weightKg: number; rir?: number };
export type Target = { repMin: number; repMax: number; targetRir: number; incrementKg: number; targetSets: number };
export type Checkin = { sleepHours: number; fatigue: number; soreness: number };

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

// --- Récupération : score 0 à 100 ---
export function readiness(c: Checkin): number {
  const sleep = clamp((c.sleepHours - 5) / 3, 0, 1) * 40;      // 5h = 0, 8h = max
  const fatigue = ((5 - c.fatigue) / 4) * 35;
  const soreness = ((5 - c.soreness) / 4) * 25;
  return Math.round(sleep + fatigue + soreness);
}

export type Recommendation = {
  weightKg: number;
  repGoal: number;
  sets: number;
  reason: 'progression' | 'maintien' | 'allegement' | 'deload';
};

// --- Double progression : on monte les reps, puis la charge ---
export function nextRecommendation(
  lastSessions: SetLog[][],            // séances récentes pour cet exo, la plus récente en premier
  t: Target,
  readinessScore: number,
): Recommendation {
  const last = lastSessions[0];
  if (!last || last.length === 0) {
    return { weightKg: 0, repGoal: t.repMin, sets: t.targetSets, reason: 'maintien' };
  }

  const weight = Math.max(...last.map((s) => s.weightKg));
  const allAtTop = last.every((s) => s.reps >= t.repMax && (s.rir ?? t.targetRir) >= t.targetRir - 1);
  const underMin = (sess: SetLog[]) => sess.some((s) => s.reps < t.repMin);

  // Deload : deux séances de suite sous le bas de la fourchette
  if (lastSessions.length >= 2 && underMin(lastSessions[0]) && underMin(lastSessions[1])) {
    return { weightKg: round(weight * 0.9), repGoal: t.repMin, sets: t.targetSets, reason: 'deload' };
  }

  // Récupération faible : même charge, un set de moins
  if (readinessScore < 40) {
    return { weightKg: weight, repGoal: t.repMin, sets: Math.max(2, t.targetSets - 1), reason: 'allegement' };
  }

  // Tout en haut de la fourchette : on monte la charge, reps repartent en bas
  if (allAtTop) {
    return { weightKg: round(weight + t.incrementKg), repGoal: t.repMin, sets: t.targetSets, reason: 'progression' };
  }

  // Sinon : même charge, objectif +1 rep sur la série la plus faible
  const weakest = Math.min(...last.map((s) => s.reps));
  return { weightKg: weight, repGoal: Math.min(weakest + 1, t.repMax), sets: t.targetSets, reason: 'maintien' };
}

const round = (n: number) => Math.round(n * 2) / 2; // pas de 0,5 kg

// --- Jauge hebdomadaire ---
export function gauge(done: number, target: number) {
  return { done, target, pct: Math.min(100, Math.round((done / Math.max(1, target)) * 100)) };
}

// Montée progressive de l'objectif : on ne monte que si la semaine précédente est tenue
export function nextWeekTarget(current: number, finalTarget: number, lastWeekDone: number): number {
  if (lastWeekDone >= current) return Math.min(finalTarget, current + 1);
  if (lastWeekDone < current - 1) return Math.max(2, current - 1); // semaine ratée : on allège
  return current;
}

// --- Points et rank ---
export type Tier = 'bronze' | 'argent' | 'or' | 'platine' | 'diamant';
const TIERS: [Tier, number][] = [['diamant', 3000], ['platine', 1800], ['or', 900], ['argent', 350], ['bronze', 0]];

export function pointsForSession(opts: { prs: number; streakWeeks: number }): number {
  const base = 10 + opts.prs * 5;
  const streakBonus = Math.min(opts.streakWeeks, 8); // plafonné pour rester raisonnable
  return base + streakBonus;
}

export const weekCompletedBonus = 25;

export function tierFor(points: number): Tier {
  return TIERS.find(([, min]) => points >= min)![0];
}

// =====================================================================
// RANGS : niveau mondial + classement communauté
// =====================================================================

// 1RM estimé (Epley). Fiable jusqu'à ~12 reps.
export function e1rm(weightKg: number, reps: number): number {
  return weightKg * (1 + reps / 30);
}

export type Level = 'debutant' | 'novice' | 'intermediaire' | 'avance' | 'elite';
const LEVELS: Level[] = ['debutant', 'novice', 'intermediaire', 'avance', 'elite'];

// thresholds : ratio minimal pour chaque niveau, dans l'ordre debutant -> elite (issu de strength_standards)
export function worldLevel(ratio: number, thresholds: Record<Level, number>) {
  let idx = 0;
  LEVELS.forEach((l, i) => { if (ratio >= thresholds[l]) idx = i; });
  const next = LEVELS[idx + 1];
  const nextRatio = next ? thresholds[next] : null;
  const progressToNext = nextRatio
    ? clamp((ratio - thresholds[LEVELS[idx]]) / (nextRatio - thresholds[LEVELS[idx]]), 0, 1)
    : 1;
  return { level: LEVELS[idx], next: next ?? null, progressToNext, ratioMissing: nextRatio ? Math.max(0, nextRatio - ratio) : 0 };
}

export type CohortPercentiles = { n: number; p10: number; p25: number; p50: number; p75: number; p90: number };

// Percentile approximé par interpolation linéaire entre les quantiles connus
export function communityPercentile(ratio: number, c: CohortPercentiles): number {
  const pts: [number, number][] = [[c.p10, 10], [c.p25, 25], [c.p50, 50], [c.p75, 75], [c.p90, 90]];
  if (ratio <= pts[0][0]) return clamp(Math.round((ratio / pts[0][0]) * 10), 1, 10);
  for (let i = 1; i < pts.length; i++) {
    const [x0, y0] = pts[i - 1];
    const [x1, y1] = pts[i];
    if (ratio <= x1) return Math.round(y0 + ((ratio - x0) / (x1 - x0)) * (y1 - y0));
  }
  return clamp(Math.round(90 + ((ratio - pts[4][0]) / pts[4][0]) * 10), 90, 99);
}

// Message affiché selon le mode choisi par l'utilisateur
export function rankMessage(
  mode: 'defi' | 'confiance',
  world: ReturnType<typeof worldLevel>,
  percentile: number | null, // null tant que la cohorte n'a pas atteint le seuil
): string {
  if (mode === 'defi') {
    return world.next
      ? `Niveau ${world.level} : tu es à ${Math.round(world.progressToNext * 100)} % du niveau ${world.next}.`
      : `Niveau ${world.level} : tu es au sommet des standards.`;
  }
  return percentile !== null
    ? `Tu fais mieux que ${percentile} % des pratiquants de ton profil.`
    : `Niveau ${world.level}. Les stats de la communauté s'afficheront dès que ton profil aura assez de monde.`;
}
