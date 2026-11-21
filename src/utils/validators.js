export function validateTagNumber(tagNumber) {
  if (!tagNumber || typeof tagNumber !== "string") return false;
  const trimmed = tagNumber.trim();
  return trimmed.length >= 1 && trimmed.length <= 25;
}

export function validateWeight(weight) {
  if (weight === null || weight === undefined || weight === "") return true;
  const num = Number(weight);
  return !Number.isNaN(num) && num > 0 && num <= 5000;
}

export function validateBirthDate(birthDate) {
  if (!birthDate) return true;
  const date = new Date(birthDate);
  const today = new Date();
  return !Number.isNaN(date.getTime()) && date <= today;
}