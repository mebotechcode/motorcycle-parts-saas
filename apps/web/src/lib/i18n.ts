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
  adminShops: { en: 'Shops', sw: 'Maduka' },
  adminHealth: { en: 'Health', sw: 'Afya' },
  adminActivity: { en: 'Activity', sw: 'Shughuli' },
  inventory: { en: 'Inventory', sw: 'Bidhaa' },
  purchases: { en: 'Purchases', sw: 'Manunuzi' },
  reports: { en: 'Reports', sw: 'Ripoti' },
  branches: { en: 'Branches', sw: 'Matawi' },
  staff: { en: 'Staff', sw: 'Wafanyakazi' },
  dashboard: { en: 'Dashboard', sw: 'Dashibodi' },
  navGroupSell: { en: 'Sell', sw: 'Kaunta' },
  navGroupStock: { en: 'Stock', sw: 'Stoo' },
  navGroupMoney: { en: 'Money', sw: 'Pesa' },
  navGroupShop: { en: 'Shop', sw: 'Duka' },
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
  restMpesa: { en: 'Balance on M-Pesa', sw: 'Baki M-Pesa' },
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
  graceEnds: { en: 'Access until', sw: 'Muda wa ziada unaisha' },
  language: { en: 'Language', sw: 'Lugha' },
  english: { en: 'English', sw: 'Kiingereza' },
  swahili: { en: 'Swahili', sw: 'Kiswahili' },
  thankYou: { en: 'Thank you for shopping with us!', sw: 'Asante kwa kununua nasi!' },
  role_owner: { en: 'Owner', sw: 'Mmiliki' },
  role_manager: { en: 'Manager', sw: 'Meneja' },
  role_cashier: { en: 'Cashier', sw: 'Muuzaji' },
  role_storekeeper: { en: 'Storekeeper', sw: 'Mhudumu wa stoo' },
  role_staff: { en: 'Staff', sw: 'Mfanyakazi' },
  hello: { en: 'Hello', sw: 'Habari' },
  signedInAs: { en: 'You are signed in as', sw: 'Umeingia kama' },
  freeTrial: { en: 'Free trial · open billing to subscribe', sw: 'Jaribio la bure · fungua malipo kujisajili' },
  shopLocked: {
    en: 'This shop is read-only. The free trial or subscription has ended — tap here to open Billing.',
    sw: 'Duka hili ni la kusoma tu. Jaribio au usajili umeisha — gusa hapa kufungua Malipo.',
  },
  dayLeft: { en: 'day left', sw: 'siku imebaki' },
  daysLeft: { en: 'days left', sw: 'siku zimebaki' },
  planPayMpesa: { en: 'pay with M-Pesa on the billing page', sw: 'lipa kwa M-Pesa kwenye ukurasa wa malipo' },
  etimsWaiting: { en: 'waiting to be sent', sw: 'zinasubiri kutumwa' },
  alreadySentKra: { en: 'already sent to KRA', sw: 'tayari zimetumwa KRA' },
  sending: { en: 'Sending…', sw: 'Inatuma…' },
  profitToday: { en: 'Profit today (after expenses)', sw: 'Faida leo (baada ya gharama)' },
  grossProfit: { en: 'Gross profit', sw: 'Faida ghafi' },
  expenses: { en: 'Expenses', sw: 'Gharama' },
  viewReports: { en: 'view reports', sw: 'ona ripoti' },
  salesToday: { en: 'Sales today', sw: 'Mauzo ya leo' },
  yourSalesToday: { en: 'Your sales today', sw: 'Mauzo yako ya leo' },
  saleOne: { en: 'sale', sw: 'mauzo' },
  saleMany: { en: 'sales', sw: 'mauzo' },
  youOweSuppliers: { en: 'You owe suppliers', sw: 'Una deni kwa wasambazaji' },
  supplierOne: { en: 'supplier', sw: 'msambazaji' },
  supplierMany: { en: 'suppliers', sw: 'wasambazaji' },
  customersOweYou: { en: 'Customers owe you', sw: 'Wateja wanakudai' },
  customerOne: { en: 'customer', sw: 'mteja' },
  customerMany: { en: 'customers', sw: 'wateja' },
  sendReminders: { en: 'send reminders', sw: 'tuma vikumbusho' },
  productsCount: { en: 'Products', sw: 'Bidhaa' },
  runningLow: { en: 'Running low', sw: 'Zinakaribia kuisha' },
  etimsIntro: {
    en: 'Receipts are queued automatically and transmit when this device is online. Live signing with KRA begins after they onboard your OSCU/VSCU. Until then, NafPOS still issues a control-unit number so staff can complete the receipt flow.',
    sw: 'Risiti hupangwa kiotomatiki na kutumwa kifaa hiki kikiwa mtandaoni. Sahihi hai ya KRA inaanza baada ya kuunganisha OSCU/VSCU. Hadi hapo, NafPOS bado hutoa nambari ya control unit ili timu ikamilishe risiti.',
  },
  loading: { en: 'Loading...', sw: 'Inapakia...' },
  addCustomer: { en: '+ Add customer', sw: '+ Ongeza mteja' },
  remindDebtors: { en: 'Remind debtors', sw: 'Kumbusha wenye deni' },
  searchNamePhone: { en: 'Search by name or phone', sw: 'Tafuta kwa jina au simu' },
  allCustomers: { en: 'All customers', sw: 'Wateja wote' },
  owingMoney: { en: 'Owing money', sw: 'Wanaodaiwa' },
  overCreditLimit: { en: 'Over credit limit', sw: 'Wamezidi kikomo' },
  sortByName: { en: 'Sort by name', sw: 'Panga kwa jina' },
  biggestDebtFirst: { en: 'Biggest debt first', sw: 'Deni kubwa kwanza' },
  searchInventory: { en: 'Search by name, code, part number or barcode', sw: 'Tafuta kwa jina, kodi, namba ya sehemu au baakodi' },
  addProduct: { en: '+ Add product', sw: '+ Ongeza bidhaa' },
  transfers: { en: 'Transfers', sw: 'Uhamisho' },
  importExcel: { en: 'Import from Excel', sw: 'Leta kutoka Excel' },
  yourSales: { en: 'Your sales', sw: 'Mauzo yako' },
  allSalesAccess: { en: 'All sales you can access', sw: 'Mauzo yote unayoweza kuona' },
  tillCashup: { en: 'Till / cash-up', sw: 'Kibandari / kufunga' },
  newSale: { en: '+ New sale', sw: '+ Mauzo mapya' },
  findReceipt: { en: 'Find a receipt number', sw: 'Tafuta namba ya risiti' },
  today: { en: 'Today', sw: 'Leo' },
  yesterday: { en: 'Yesterday', sw: 'Jana' },
  last7days: { en: 'Last 7 days', sw: 'Siku 7 zilizopita' },
  thisMonth: { en: 'This month', sw: 'Mwezi huu' },
  allTime: { en: 'All time', sw: 'Muda wote' },
  plan: { en: 'Plan', sw: 'Mpango' },
  suppliers: { en: 'Suppliers', sw: 'Wasambazaji' },
  purchasesSub: { en: 'Order from suppliers and receive the goods.', sw: 'Agiza kwa wasambazaji na pokea bidhaa.' },
  newOrder: { en: '+ New order', sw: '+ Oda mpya' },
  receiveGoods: { en: 'Receive goods', sw: 'Pokea bidhaa' },
  ordersTab: { en: 'Orders', sw: 'Oda' },
  receivedTab: { en: 'Received', sw: 'Zilizopokelewa' },
  onlyPurchases: { en: 'Only the owner, managers and storekeepers can see purchases.', sw: 'Mmiliki, meneja na mhudumu wa stoo tu wanaweza kuona manunuzi.' },
  expensesSub: { en: 'Rent, transport, airtime, salaries... money the shop spends that is not stock.', sw: 'Kodi, usafiri, airtime, mishahara... pesa duka linatumia ambazo si hisa.' },
  addExpense: { en: 'Add an expense', sw: 'Ongeza gharama' },
  backSales: { en: '← Sales', sw: '← Mauzo' },
  onlyExpenses: { en: 'Only the owner, managers and cashiers record expenses.', sw: 'Mmiliki, meneja na muuzaji tu wanaweza kurekodi gharama.' },
  teamMembers: { en: 'Team members', sw: 'Wafanyakazi wa timu' },
  addBranch: { en: 'Add a branch', sw: 'Ongeza tawi' },
  active: { en: 'Active', sw: 'Linafanya kazi' },
  closed: { en: 'Closed', sw: 'Limefungwa' },
  transfersSub: { en: 'Move stock from one branch to another.', sw: 'Hamisha hisa kutoka tawi moja hadi jingine.' },
  newTransfer: { en: '+ New transfer', sw: '+ Uhamisho mpya' },
  allTransfers: { en: 'All transfers', sw: 'Uhamisho wote' },
  onItsWay: { en: 'On its way', sw: 'Njiani' },
  receivedStatus: { en: 'Received', sw: 'Umepokelewa' },
  cancelled: { en: 'Cancelled', sw: 'Umeghairiwa' },
  noTransfers: { en: 'No transfers yet.', sw: 'Bado hakuna uhamisho.' },
  onlyTransfers: { en: 'Only the owner, managers and storekeepers can see transfers.', sw: 'Mmiliki, meneja na mhudumu wa stoo tu wanaweza kuona uhamisho.' },
  addSupplier: { en: '+ Add supplier', sw: '+ Ongeza msambazaji' },
  suppliersOwed: { en: 'Suppliers owed', sw: 'Wasambazaji unaowadaiwa' },
  backPurchases: { en: '← Purchases', sw: '← Manunuzi' },
  onlySuppliers: { en: 'Only the owner, managers and storekeepers can see suppliers.', sw: 'Mmiliki, meneja na mhudumu wa stoo tu wanaweza kuona wasambazaji.' },
  newTransferTitle: { en: 'New transfer', sw: 'Uhamisho mpya' },
  lastMonth: { en: 'Last month', sw: 'Mwezi uliopita' },
  commissionsSub: { en: 'Commissions owed to mechanics who bring customers to the shop.', sw: 'Kamisheni zinazodaiwa na mafundi wanaoleta wateja dukani.' },
  totalOwed: { en: 'Total owed', sw: 'Jumla inayodaiwa' },
  backCustomers: { en: '← All customers', sw: '← Wateja wote' },


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
