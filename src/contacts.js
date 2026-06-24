// Native iPhone / Android address-book import.
//
// Uses @capacitor-community/contacts when running inside the native shell
// (Capacitor). On the web fallback we let the caller know it's unavailable so
// the UI can show a graceful message ("Open the iPhone app to use this").

import { Contacts } from '@capacitor-community/contacts';

function isNative() {
  if (typeof window === 'undefined') return false;
  return !!window.Capacitor?.isNativePlatform?.();
}

/** Returns true when the Contacts API is usable (native build). */
export function canImportContacts() {
  return isNative();
}

/** Request permission to read contacts. Returns true on grant. */
export async function requestContactsPermission() {
  if (!isNative()) return false;
  try {
    const res = await Contacts.requestPermissions();
    return res?.contacts === 'granted';
  } catch (e) {
    console.warn('contacts permission failed', e);
    return false;
  }
}

/**
 * Open the native picker (iPhone returns a single contact) and return a
 * normalized client-shaped object the app can save directly:
 *   { name, email, email2, phone, address1, address2, address3 }
 * Returns null if the user cancels.
 */
export async function pickContact() {
  if (!isNative()) return null;
  const granted = await requestContactsPermission();
  if (!granted) throw new Error('Contacts permission denied');

  // pickContact opens the native UI on iOS / Android
  const result = await Contacts.pickContact({
    projection: { name: true, phones: true, emails: true, postalAddresses: true },
  });
  if (!result?.contact) return null;
  return normalizeContact(result.contact);
}

/**
 * Fall-back path: list all contacts (we filter / search in our own UI).
 * Used when the native picker isn't desirable.
 */
export async function listContacts() {
  if (!isNative()) return [];
  const granted = await requestContactsPermission();
  if (!granted) throw new Error('Contacts permission denied');
  const result = await Contacts.getContacts({
    projection: { name: true, phones: true, emails: true, postalAddresses: true },
  });
  return (result?.contacts || []).map(normalizeContact);
}

function normalizeContact(c) {
  const name = c.name?.display || [c.name?.given, c.name?.family].filter(Boolean).join(' ') || '';
  const phones = (c.phones || []).map(p => p.number).filter(Boolean);
  const emails = (c.emails || []).map(e => e.address).filter(Boolean);
  const addr = (c.postalAddresses && c.postalAddresses[0]) || null;

  const address1 = addr?.street || '';
  const city = addr?.city || '';
  const state = addr?.region || '';
  const zip = addr?.postcode || '';

  return {
    name,
    phone: phones[0] || '',
    email: emails[0] || '',
    email2: emails[1] || '',
    address1,
    city,
    state,
    zip,
  };
}
