/**
 * Physics/biology stays in code, not behind the DecisionMaker port: aging,
 * birth and death probabilities from simple actuarial-ish curves. These are
 * deliberately crude approximations of real mortality curves — good enough
 * for a legends-mode toy simulator, not for anything else.
 */

/** Annual probability of death at a given age. A U-shaped-ish curve: some infant risk, a long low plateau, a rising tail. */
export function deathProbabilityAtAge(age: number): number {
  if (age < 1) return 0.03;
  if (age < 5) return 0.01;
  if (age < 40) return 0.002;
  if (age < 60) return 0.006;
  if (age < 75) return 0.03;
  if (age < 90) return 0.12;
  return 0.35;
}

/** Whether a person of this age and sex could plausibly have a child this year, biologically. */
export function isFertileAge(age: number, sex: "f" | "m"): boolean {
  return sex === "f" ? age >= 16 && age <= 45 : age >= 16 && age <= 65;
}

export function isAdult(age: number): boolean {
  return age >= 16;
}

export function isSchoolAge(age: number): boolean {
  return age >= 6 && age <= 15;
}

export function isWorkingAge(age: number): boolean {
  return age >= 16 && age <= 70;
}

export function ageInYear(birthYear: number, year: number): number {
  return year - birthYear;
}
