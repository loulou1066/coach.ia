// Calcul de macros : estimation indicative (Mifflin-St Jeor), pas un avis médical.
export type Goal = 'hypertrophie' | 'force' | 'perte_de_gras' | 'remise_en_forme';
export type MacroInput = { sex: 'homme' | 'femme'; age: number; height: number; weight: number; goal: Goal; sessionsPerWeek: number };
export type Macros = { kcal: number; protein: number; fat: number; carbs: number };

const activity = (n: number) => (n <= 1 ? 1.2 : n <= 3 ? 1.375 : n <= 5 ? 1.55 : 1.725);
const GOALS: Record<Goal, { kcal: number; protein: number }> = {
  perte_de_gras: { kcal: -0.15, protein: 2.0 },   // déficit modéré, plafonné
  hypertrophie: { kcal: 0.08, protein: 1.8 },
  force: { kcal: 0.05, protein: 1.8 },
  remise_en_forme: { kcal: 0, protein: 1.6 },
};

export function computeMacros(i: MacroInput) {
  if (i.age < 18 || i.age > 70) return { error: "Calcul disponible de 18 à 70 ans. En dehors, demande l'avis d'un professionnel de santé." };
  if (i.weight < 35 || i.weight > 250 || i.height < 130 || i.height > 230) return { error: 'Valeurs hors limites, vérifie ta saisie.' };

  const bmr = 10 * i.weight + 6.25 * i.height - 5 * i.age + (i.sex === 'homme' ? 5 : -161);
  const tdee = bmr * activity(i.sessionsPerWeek);
  const g = GOALS[i.goal];
  const floor = Math.max(bmr, i.sex === 'homme' ? 1500 : 1200); // jamais en dessous
  const wanted = tdee * (1 + g.kcal);
  const target = Math.max(wanted, floor);

  const protein = Math.round(g.protein * i.weight);
  const fat = Math.round(0.8 * i.weight);
  const make = (kcal: number): Macros => ({
    kcal: Math.round(kcal), protein, fat, carbs: Math.max(0, Math.round((kcal - 4 * protein - 9 * fat) / 4)),
  });

  // Jours d'entraînement : +150 kcal en glucides, compensés les jours de repos (moyenne hebdo = cible)
  const n = Math.min(7, Math.max(0, i.sessionsPerWeek));
  const delta = n > 0 && n < 7 ? 150 : 0;
  const training = make(target + delta);
  const rest = make(n > 0 && n < 7 ? target - (delta * n) / (7 - n) : target);

  const notes = [`Basé sur ${n} séance(s) par semaine.`,
    'Ajuste après 2 à 3 semaines selon l\'évolution de ton poids moyen hebdomadaire.',
    'Estimation indicative, pas un avis médical. Si ton rapport à la nourriture ou au poids te pèse, parles-en à un professionnel.'];
  if (wanted < floor) notes.unshift('La cible a été relevée à un minimum de sécurité : on ne descend pas plus bas.');
  return { bmr: Math.round(bmr), tdee: Math.round(tdee), training, rest, notes };
}
