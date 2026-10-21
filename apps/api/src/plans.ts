/**
 * Plans and their limits. Billing is out of scope for this service: a user's
 * plan is a database field that an operator or a billing integration sets.
 */
export const PLANS = {
  free: { label: 'Free', cloudRecipes: 100, ownedTeams: 1, teamMembers: 5, aiSuggestionsPerDay: 10 },
  pro: { label: 'Pro', cloudRecipes: 2000, ownedTeams: 3, teamMembers: 10, aiSuggestionsPerDay: 100 },
  studio: { label: 'Studio', cloudRecipes: 10_000, ownedTeams: 10, teamMembers: 50, aiSuggestionsPerDay: 300 },
} as const;

export type PlanId = keyof typeof PLANS;

/** Recipes one team library may hold, whatever the owner's plan. */
export const TEAM_RECIPE_LIMIT = 5000;

export function planFor(id: string): (typeof PLANS)[PlanId] {
  return Object.prototype.hasOwnProperty.call(PLANS, id) ? PLANS[id as PlanId] : PLANS.free;
}
