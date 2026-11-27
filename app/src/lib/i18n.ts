import { getLocales } from "expo-localization";
import { createContext, useContext } from "react";

export type Lang = "el" | "en";

const el = {
  explore: "Εξερεύνηση", map: "Χάρτης", scan: "Σάρωση", passport: "Διαβατήριο", wallet: "Πορτοφόλι", profile: "Προφίλ",
  routes: "Διαδρομές", pois: "Σημεία ενδιαφέροντος", businesses: "Επιχειρήσεις", packages: "Πακέτα εμπειριών",
  search: "Αναζήτηση", nearby: "Κοντά", allRegions: "Όλες οι περιοχές",
  contact: "Επικοινωνία", website: "Ιστοσελίδα", call: "Κλήση", directions: "Οδηγίες", bookExternal: "Κράτηση (εξωτερικός σύνδεσμος)",
  duration: "Διάρκεια", length: "Μήκος", impactScore: "Rural Impact Score",
  points: "πόντοι", balance: "Υπόλοιπο", history: "Ιστορικό", rewards: "Ανταμοιβές", redeem: "Εξαργύρωση",
  showCode: "Δείξτε αυτόν τον κωδικό στην επιχείρηση", expiresIn: "Λήγει σε",
  loginTitle: "Συνδεθείτε με email", loginHelp: "Θα σας στείλουμε έναν 6ψήφιο κωδικό. Δεν χρειάζεται κωδικός πρόσβασης.",
  email: "Email", sendCode: "Αποστολή κωδικού", code: "Κωδικός", verify: "Σύνδεση", logout: "Αποσύνδεση",
  scanHelp: "Σαρώστε τον κωδικό QR της επιχείρησης ή του σημείου", cameraPermission: "Χρειαζόμαστε την κάμερα για να σαρώσετε τον κωδικό QR.",
  allow: "Να επιτραπεί", imHere: "Είμαι εδώ", imHereHelp: "Δεν υπάρχει QR; Μείνετε λίγα λεπτά κοντά στο σημείο και πατήστε «Είμαι εδώ».",
  checkinOk: "Η επίσκεψη καταγράφηκε!", checkinDuplicate: "Έχετε ήδη κάνει check-in εδώ σήμερα.", checkinQueued: "Χωρίς σύνδεση: θα σταλεί μόλις συνδεθείτε.",
  checkinRejected: "Δεν ήταν δυνατή η καταγραφή", checking: "Έλεγχος…", notOurQr: "Αυτός ο κωδικός QR δεν ανήκει στο δίκτυο Rural Greece.", checkinError: "Κάτι πήγε στραβά. Δοκιμάστε ξανά.", referralCode: "Κωδικός σύστασης (προαιρετικό)",
  noPassport: "Δεν έχετε ακόμα επαληθευμένες εμπειρίες. Σαρώστε έναν κωδικό QR για να ξεκινήσετε.",
  progress: "Πρόοδος", completed: "Ολοκληρώθηκε",
  member: "Περιοχή μελών", memberLogin: "Σύνδεση μέλους", dashboard: "Πίνακας", myQr: "Οι κωδικοί QR μου", referrals: "Συστάσεις",
  partners: "Συνεργάτες", suggestions: "Προτάσεις συνεργασίας", analytics: "Στατιστικά", confirmRedemption: "Επιβεβαίωση εξαργύρωσης",
  visits30: "Επισκέψεις (30 ημέρες)", uniqueVisitors: "Μοναδικοί επισκέπτες", newReferral: "Νέα σύσταση προς", create: "Δημιουργία",
  request: "Αίτημα συνεργασίας", accept: "Αποδοχή", decline: "Απόρριψη", pending: "Σε αναμονή", active: "Ενεργή",
  alsoVisited: "Οι επισκέπτες σας πήγαν επίσης", confirm: "Επιβεβαίωση", language: "Γλώσσα", retry: "Ξανά", loading: "Φόρτωση…",
  error: "Κάτι πήγε στραβά", offlineQueue: "Σε αναμονή αποστολής",
};
const en: typeof el = {
  explore: "Explore", map: "Map", scan: "Scan", passport: "Passport", wallet: "Wallet", profile: "Profile",
  routes: "Routes", pois: "Points of interest", businesses: "Businesses", packages: "Experience packages",
  search: "Search", nearby: "Nearby", allRegions: "All regions",
  contact: "Contact", website: "Website", call: "Call", directions: "Directions", bookExternal: "Book (external link)",
  duration: "Duration", length: "Length", impactScore: "Rural Impact Score",
  points: "points", balance: "Balance", history: "History", rewards: "Rewards", redeem: "Redeem",
  showCode: "Show this code at the business", expiresIn: "Expires in",
  loginTitle: "Sign in with email", loginHelp: "We'll send you a 6-digit code. No password needed.",
  email: "Email", sendCode: "Send code", code: "Code", verify: "Sign in", logout: "Sign out",
  scanHelp: "Scan the business or place's QR code", cameraPermission: "We need the camera to scan the QR code.",
  allow: "Allow", imHere: "I'm here", imHereHelp: "No QR code? Stay near the place for a couple of minutes and tap “I'm here”.",
  checkinOk: "Visit recorded!", checkinDuplicate: "You've already checked in here today.", checkinQueued: "Offline: it will be sent when you're back online.",
  checkinRejected: "Couldn't record the visit", checking: "Checking…", notOurQr: "This QR code isn't part of the Rural Greece network.", checkinError: "Something went wrong. Please try again.", referralCode: "Referral code (optional)",
  noPassport: "No verified experiences yet. Scan a QR code to start.",
  progress: "Progress", completed: "Completed",
  member: "Member area", memberLogin: "Member sign-in", dashboard: "Dashboard", myQr: "My QR codes", referrals: "Referrals",
  partners: "Partners", suggestions: "Suggested partners", analytics: "Analytics", confirmRedemption: "Confirm a redemption",
  visits30: "Visits (30 days)", uniqueVisitors: "Unique visitors", newReferral: "New referral to", create: "Create",
  request: "Request partnership", accept: "Accept", decline: "Decline", pending: "Pending", active: "Active",
  alsoVisited: "Your visitors also visited", confirm: "Confirm", language: "Language", retry: "Retry", loading: "Loading…",
  error: "Something went wrong", offlineQueue: "Waiting to send",
};

export const strings = { el, en };
export type Strings = typeof el;

export function deviceLang(): Lang {
  const code = getLocales()[0]?.languageCode;
  return code === "el" ? "el" : code ? "en" : "el";
}

export const LangContext = createContext<{ lang: Lang; t: Strings; setLang: (l: Lang) => void }>({
  lang: "el",
  t: el,
  setLang: () => {},
});
export const useI18n = () => useContext(LangContext);

/** Rejection reasons from the engine, in plain words. */
export function reasonText(reason: string | undefined, lang: Lang): string {
  const m: Record<string, [string, string]> = {
    qr_bad_signature: ["Μη έγκυρος κωδικός QR.", "This QR code isn't valid."],
    qr_malformed: ["Αυτός δεν είναι κωδικός Rural Greece.", "That's not a Rural Greece code."],
    qr_unknown_target: ["Ο κωδικός δεν είναι πλέον ενεργός.", "This code is no longer active."],
    qr_rotated: ["Ο κωδικός έχει αντικατασταθεί. Ζητήστε τον νέο.", "This code has been replaced. Ask for the new one."],
    geo_too_far: ["Βρίσκεστε πολύ μακριά από το σημείο.", "You're too far from the place."],
    geo_inaccurate: ["Το GPS δεν είναι αρκετά ακριβές. Δοκιμάστε σε ανοιχτό χώρο.", "GPS isn't accurate enough. Try in the open."],
    dwell_too_short: ["Μείνετε λίγο ακόμα κοντά στο σημείο.", "Stay near the place a little longer."],
    time_in_future: ["Ελέγξτε την ώρα του τηλεφώνου σας.", "Check your phone's clock."],
    too_old: ["Η σάρωση είναι πολύ παλιά.", "This scan is too old."],
  };
  const v = reason ? m[reason] : undefined;
  return v ? v[lang === "el" ? 0 : 1] : reason ?? "";
}
