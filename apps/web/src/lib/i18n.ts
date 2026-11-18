// English / Swahili toggle. Stored per-user in profiles.language and
// per-device in localStorage so it works offline. Keys are UI strings
// for the most-used screens (nav, Sell, Till, Customers, Dashboard).
// Receipts and reports fall back to English for legal text, with
// Swahili labels where it helps the customer.
import { useSyncExternalStore } from 'react'

export type Lang = 'en' | 'sw'

const LANG_KEY = 'pos_lang_v1'
const LANG_EVENT = 'nafpos-lang-change'

export function getLang(): Lang {
  try {
    const v = localStorage.getItem(LANG_KEY)
    if (v === 'sw' || v === 'en') return v
  } catch {}
  return 'en'
}

function subscribeLang(cb: () => void): () => void {
  window.addEventListener(LANG_EVENT, cb)
  window.addEventListener('storage', cb)
  return () => {
    window.removeEventListener(LANG_EVENT, cb)
    window.removeEventListener('storage', cb)
  }
}

// Reactive language hook — every screen using this re-renders instantly
// when the user toggles EN/SW (localStorage alone can't trigger a re-render).
export function useLang(): Lang {
  return useSyncExternalStore(subscribeLang, getLang, () => 'en' as Lang)
}

export function setLang(l: Lang) {
  try {
    localStorage.setItem(LANG_KEY, l)
  } catch {}
  try {
    window.dispatchEvent(new Event(LANG_EVENT))
  } catch {}
}

const DICT: Record<string, Record<Lang, string>> = {
  sell: { en: 'Sell', sw: 'Uza' },
  sales: { en: 'Sales', sw: 'Mauzo' },
  customers: { en: 'Customers', sw: 'Wateja' },
  deni: { en: 'Deni', sw: 'Deni' },
  commissions: { en: 'Fundi commissions', sw: 'Kamisheni za fundi' },
  admin: { en: 'Super admin', sw: 'Meneja Mkuu' },
  inventory: { en: 'Inventory', sw: 'Bidhaa' },
  purchases: { en: 'Purchases', sw: 'Manunuzi' },
  reports: { en: 'Reports', sw: 'Ripoti' },
  branches: { en: 'Branches', sw: 'Matawi' },
  staff: { en: 'Staff', sw: 'Wafanyakazi' },
  dashboard: { en: 'Dashboard', sw: 'Dashibodi' },
  till: { en: 'Till', sw: 'Kibandari' },
  billing: { en: 'Billing', sw: 'Malipo' },
  signOut: { en: 'Sign out', sw: 'Toka' },
  searchPart: { en: 'Search a part: name, code or scan a barcode', sw: 'Tafuta sehemu: jina, kodi au skana baakodi' },
  currentSale: { en: 'Current sale', sw: 'Mauzo ya sasa' },
  total: { en: 'TOTAL', sw: 'JUMLA' },
  subtotal: { en: 'Subtotal', sw: 'Jumla ndogo' },
  payment: { en: 'Payment', sw: 'Malipo' },
  cashReceived: { en: 'Cash received', sw: 'Pesa taslimu' },
  mpesaAmount: { en: 'M-Pesa amount', sw: 'Kiasi cha M-Pesa' },
  mpesaCode: { en: 'M-Pesa code', sw: 'Kodi ya M-Pesa' },
  completeSale: { en: 'Complete sale', sw: 'Kamilisha mauzo' },
  saveSale: { en: 'Save sale', sw: 'Hifadhi mauzo' },
  customer: { en: 'Customer (optional)', sw: 'Mteja (si lazima)' },
  retail: { en: 'Retail', sw: 'Rejareja' },
  wholesale: { en: 'Wholesale', sw: 'Jumla' },
  inStock: { en: 'in stock', sw: 'ziko dukani' },
  outOfStock: { en: 'Out of stock here', sw: 'Zimeisha hapa' },
  tapToAdd: { en: 'Tap to add', sw: 'Gusa kuongeza' },
  billDiscount: { en: 'Bill discount (KES)', sw: 'Punguzo (KES)' },
  paid: { en: 'Paid', sw: 'Imelipwa' },
  change: { en: 'Change to give', sw: 'Chenji ya kutoa' },
  onCredit: { en: 'On credit', sw: 'Kwa deni' },
  stillToPay: { en: 'Still to pay', sw: 'Bado kulipa' },
  allCash: { en: 'All cash', sw: 'Pesa yote' },
  restMpesa: { en: 'Rest M-Pesa', sw: 'Baki M-Pesa' },
  openTill: { en: 'Open your till', sw: 'Fungua kibandari chako' },
  closeTill: { en: 'Close this till', sw: 'Funga kibandari hiki' },
  countedCash: { en: 'Cash you counted in the drawer (KES)', sw: 'Pesa uliyohesabu (KES)' },
  countedMpesa: { en: 'M-Pesa Till total you counted (KES)', sw: 'Jumla ya M-Pesa uliyohesabu (KES)' },
  blindNote: { en: 'Blind count: the system total is hidden until you enter your counts.', sw: 'Hesabu bila kuona: jumla ya mfumo imefichwa hadi uingize hesabu zako.' },
  owesYou: { en: 'Owes you', sw: 'Anakudai' },
  creditLimit: { en: 'Credit limit', sw: 'Kikomo cha deni' },
  receivePayment: { en: 'Receive a payment', sw: 'Pokea malipo' },
  amount: { en: 'Amount (KES)', sw: 'Kiasi (KES)' },
  sendStk: { en: 'Send M-Pesa request (STK Push)', sw: 'Tuma ombi la M-Pesa (STK Push)' },
  stkSent: { en: 'STK Push sent. Ask the customer to enter their M-Pesa PIN on their phone.', sw: 'Ombi limetumwa. Mwambie mteja aingize PIN yake ya M-Pesa kwenye simu.' },
  verifyMpesa: { en: 'Verify M-Pesa codes', sw: 'Thibitisha kodi za M-Pesa' },
  unverified: { en: 'Unverified', sw: 'Haijathibitishwa' },
  verified: { en: 'Verified', sw: 'Imethibitishwa' },
  bin: { en: 'Bin', sw: 'Kisanduku' },
  rack: { en: 'Rack', sw: 'Rafu' },
  aisle: { en: 'Aisle', sw: 'Njia' },
  mechanic: { en: 'Mechanic / fundi', sw: 'Fundi' },
  commission: { en: 'Commission (KES)', sw: 'Kamisheni (KES)' },
  referredBy: { en: 'Referred by (fundi)', sw: 'Alimleta (fundi)' },
  paymentTerms: { en: 'Payment terms', sw: 'Masharti ya malipo' },
  days: { en: 'days', sw: 'siku' },
  payNow: { en: 'Pay now', sw: 'Lipa sasa' },
  etimsQueue: { en: 'eTIMS queue', sw: 'Foleni ya eTIMS' },
  transmitNow: { en: 'Transmit now', sw: 'Tuma sasa' },
  queued: { en: 'Queued', sw: 'Inasubiri' },
  failed: { en: 'Failed', sw: 'Imeshindwa' },
  submitted: { en: 'Submitted', sw: 'Imetumwa' },
  subscription: { en: 'Subscription', sw: 'Usajili' },
  currentPlan: { en: 'Current plan', sw: 'Mpango wa sasa' },
  payWithMpesa: { en: 'Pay with M-Pesa', sw: 'Lipa na M-Pesa' },
  trialEnds: { en: 'Trial ends', sw: 'Jaribio linaisha' },
  graceEnds: { en: 'Grace ends', sw: 'Neema inaisha' },
  language: { en: 'Language', sw: 'Lugha' },
  english: { en: 'English', sw: 'Kiingereza' },
  swahili: { en: 'Swahili', sw: 'Kiswahili' },
  thankYou: { en: 'Thank you for shopping with us!', sw: 'Asante kwa kununua nasi!' },
  reportsTitle: { en: 'Reports', sw: 'Ripoti' },
  reportsSub: { en: 'How the shop is doing. Profit uses the buying price recorded at the time of each sale.', sw: 'Jinsi duka linavyoendelea. Faida inatumia bei ya kununua iliyorekodiwa wakati wa kila mauzo.' },
  tabOverview: { en: 'Overview', sw: 'Muhtasari' },
  tabProducts: { en: 'Products', sw: 'Bidhaa' },
  tabStock: { en: 'Stock', sw: 'Hisa' },
  tabTeam: { en: 'Team & branches', sw: 'Timu & matawi' },
  downloadCsv: { en: 'Download CSV', sw: 'Pakua CSV' },
  receipt: { en: 'Receipt', sw: 'Risiti' },
  balanceOnAccount: { en: 'Balance on account', sw: 'Salio kwenye akaunti' },
}

export function t(key: string, lang: Lang = getLang()): string {
  return DICT[key]?.[lang] ?? DICT[key]?.en ?? key
}

export const LANG_LABEL: Record<Lang, string> = { en: 'English', sw: 'Kiswahili' }
