export function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test((value || '').trim());
}

export function isNonEmpty(value) {
  return Boolean((value || '').trim());
}

export function validateName(value) {
  const trimmed = (value || '').trim();
  if (!trimmed) return 'Name is required.';
  if (trimmed.length < 3) return 'Name must be at least 3 characters.';
  if (trimmed.length > 100) return 'Name must not exceed 100 characters.';
  return '';
}

export function validateEmail(value) {
  const trimmed = (value || '').trim();
  if (!trimmed) return 'Email is required.';
  if (!isValidEmail(trimmed)) return 'Please enter a valid email address.';
  return '';
}

export function validatePassword(value) {
  if (!value) return 'Password is required.';
  if (value.length < 8) return 'Password must be at least 8 characters.';
  if (!/[A-Z]/.test(value)) return 'Password must contain at least one uppercase letter.';
  if (!/[a-z]/.test(value)) return 'Password must contain at least one lowercase letter.';
  if (!/[0-9]/.test(value)) return 'Password must contain at least one number.';
  if (!/[!@#$%^&*(),.?":{}|<>]/.test(value)) {
    return 'Password must contain at least one special character.';
  }
  return '';
}

export function validateConfirmPassword(password, confirmPassword) {
  if (!confirmPassword) return 'Please confirm your password.';
  if (password !== confirmPassword) return 'Passwords do not match.';
  return '';
}

export function validateLoginPassword(value) {
  if (!value) return 'Password is required.';
  return '';
}

export function validateCurrentPassword(value) {
  if (!value) return 'Current password is required.';
  return '';
}

export function hasValidationErrors(errors) {
  return Object.values(errors).some(Boolean);
}
