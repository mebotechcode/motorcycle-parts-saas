import type { Metadata } from 'next'
import Link from 'next/link'
import Icon from '@/components/landing/Icon'
import SiteHeader from '@/components/landing/SiteHeader'
import SiteFooter from '@/components/landing/SiteFooter'
import DashboardMock from '@/components/landing/DashboardMock'

export const metadata: Metadata = {
  title: 'NafPOS — Motor Spares POS for Kenya | Sell Fast, Even Offline',
  description:
    'Stock, sales, credit (deni), M-Pesa and staff in one simple system, built for boda boda spare parts shops in Kenya. Slang search, eTIMS receipts, EN/Kiswahili. Free 14-day trial.',
  alternates: { canonical: '/' },
}

// ---------------------------------------------------------------------
// Support email shown on the public site; set NEXT_PUBLIC_SUPPORT_EMAIL in production.
const PLANS = [
  {
    name: 'Starter',
    price: '1,000',
    blurb: 'One shop, getting organised.',
    items: ['1 branch', '3 staff accounts', 'Up to 2,000 products', 'Stock, sales and debtors'],
    popular: false,
  },
  {
    name: 'Growth',
    price: '2,500',
    blurb: 'A busy shop with a team.',
    items: ['Up to 3 branches', '10 staff accounts', 'Up to 20,000 products', 'SMS debt reminders', 'KRA eTIMS receipts'],
    popular: true,
  },
  {
    name: 'Chain',
    price: '6,000',
    blurb: 'Several branches, one view.',
    items: ['Up to 10 branches', '50 staff accounts', 'Unlimited products', 'Stock transfers between branches', 'Priority support'],
    popular: false,
  },
]

const FEATURES = [
  { icon: 'store', title: 'Many branches, one owner', text: 'Add branches and staff. Owner, manager, cashier and storekeeper each see only what they should.', live: true },
  { icon: 'shield', title: 'Private and secure', text: "Every shop's data is fully separated. Staff invitations are sent straight to their email.", live: true },
  { icon: 'box', title: 'Parts by bike model', text: 'Record which parts fit Boxer, TVS, Honda, Yamaha and more. Genuine, OEM and aftermarket versions side by side.', live: true },
  { icon: 'cart', title: 'Fast point of sale', text: 'Search by slang (kenda, coil, piston ring), add, take payment, print or share the receipt. Retail and wholesale prices with a price floor you control.', live: true },
  { icon: 'book', title: 'Credit and debtors (deni)', text: 'Know who owes you, how much and since when. Credit limits, 7/14/30-day terms, debt aging and WhatsApp reminders with itemized invoices.', live: true },
  { icon: 'phone', title: 'M-Pesa payments', text: 'Send an STK Push to the customer’s phone and see it matched to the sale automatically. Manual codes are checked for duplicates and verified at close.', live: true },
  { icon: 'offline', title: 'Keeps working offline', text: 'No internet? Keep selling. Everything syncs when you are back online — stock, credit and M-Pesa codes stay safe.', live: true },
  { icon: 'chart', title: 'Profit and reports', text: 'Best sellers, slow stock, low-stock alerts, blind cash-up and profit per item.', live: true },
  { icon: 'receipt', title: 'KRA eTIMS ready', text: 'VAT, HS codes and an offline eTIMS queue with CU numbers and QR codes on every receipt. Live signing with KRA starts after they onboard your device.', live: true },
  { icon: 'box', title: 'Bin & rack locations', text: 'Aisle, rack and box on every part so new storekeepers find small parts in seconds.', live: true },
  { icon: 'store', title: 'Fundi commissions', text: 'Track which mechanic brought the rider and what you owe them — settle payouts transparently.', live: true },
  { icon: 'phone', title: 'English & Swahili', text: 'Switch the whole till between English and Kiswahili. Receipts follow your language too.', live: true },
]

const PAIN = [
  ['Stock that never matches the shelf', 'Every sale, delivery and transfer updates stock by itself.'],
  ['Debts in a notebook', 'A proper ledger for every customer, with limits and reminders.'],
  ['Prices changed when you were not looking', 'A record of every price change, discount, void and stock adjustment.'],
  ['“Does this part fit that bike?”', 'Look up parts by bike model and answer the customer in seconds.'],
]

const FAQ = [
  ['Do I need to install anything?', 'No. It runs in your web browser on a phone, tablet or computer. You just sign in.'],
  ['Can my staff use their own phones?', 'Yes. The system works on phones, tablets and computers. Each person signs in with their own account and sees only what their role allows.'],
  ['What if the internet goes down?', 'Keep selling. The app works offline and everything syncs when you are back online — stock, credit balances and M-Pesa codes stay safe.'],
  ['Is my shop’s information safe?', 'Each shop’s data is kept separate and protected by strict access rules. Cashiers cannot see other staff’s sales, and every sensitive change is recorded.'],
  ['How much does it cost?', 'Every new shop gets a 14-day free trial with no card needed. After that, plans start at KES 1,000 per month.'],
  ['Can I have more than one branch?', 'Yes. Starter has one branch; Growth and Chain support several, each with its own stock and staff access.'],
]

export default function Landing() {
  const jsonLd = [
    {
      '@context': 'https://schema.org',
      '@type': 'SoftwareApplication',
      name: 'NafPOS',
      applicationCategory: 'BusinessApplication',
      operatingSystem: 'Web, Android',
      description:
        'Offline-first point of sale, inventory, credit ledger (deni) and M-Pesa integration for Kenyan motorcycle spare parts shops.',
      offers: { '@type': 'AggregateOffer', lowPrice: '1000', highPrice: '6000', priceCurrency: 'KES', offerCount: 3 },
    },
    {
      '@context': 'https://schema.org',
      '@type': 'FAQPage',
      mainEntity: FAQ.map(([question, answer]) => ({ '@type': 'Question', name: question, acceptedAnswer: { '@type': 'Answer', text: answer } })),
    },
    {
      '@context': 'https://schema.org',
      '@type': 'Organization',
      name: 'NafPOS',
      url: process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000',
      logo: '/nafpos-logo.png',
      areaServed: 'KE',
    },
  ]
  return (
    <div>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <SiteHeader />

      {/* ---------------- Hero ---------------- */}
      <section
        className="relative overflow-hidden"
        style={{ background: 'radial-gradient(60rem 28rem at 80% -10%, rgba(255,91,20,0.18), transparent 60%)' }}
      >
        <div className="mx-auto grid max-w-6xl items-center gap-10 px-4 py-12 md:grid-cols-2 md:py-20">
          <div>
            <span className="inline-block rounded-full border border-brand/40 bg-brand/10 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-brand">
              Made for Kenyan spare parts shops
            </span>
            <h1 className="mt-4 text-5xl font-bold leading-[0.95] sm:text-6xl lg:text-7xl">
              <span className="text-brand">NafPOS</span> — run your motorcycle spare parts shop with confidence
            </h1>
            <p className="mt-5 max-w-xl text-lg text-muted">
              Stock, sales, credit (deni), M-Pesa and staff in one simple system, built for boda boda parts shops in
              Kenya. Works on your phone, offline when the internet goes down.
            </p>
            <div className="mt-7 flex flex-wrap gap-3">
              <Link href="/signup" className="rounded-lg bg-brand px-6 py-3 text-base font-semibold text-charcoal hover:bg-brand-hover">
                Start 14-day free trial
              </Link>
              <Link href="/login" className="rounded-lg border border-charcoal-3 px-6 py-3 text-base font-semibold hover:bg-charcoal-3">
                Sign in
              </Link>
            </div>
            <p className="mt-3 text-sm text-muted">No card needed. Set up in minutes.</p>
            <p className="mt-8 text-xs uppercase tracking-widest text-muted">
              Boxer · TVS · Honda · Yamaha · Bajaj · Haojue
            </p>
          </div>
          <DashboardMock />
        </div>
      </section>

      {/* ---------------- Pain points ---------------- */}
      <section className="border-y border-charcoal-3 bg-charcoal-2/50">
        <div className="mx-auto max-w-6xl px-4 py-14">
          <h2 className="text-3xl font-bold sm:text-4xl">Sound familiar?</h2>
          <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {PAIN.map(([problem, fix]) => (
              <div key={problem} className="rounded-2xl border border-charcoal-3 bg-charcoal p-5">
                <div className="font-semibold">{problem}</div>
                <div className="mt-2 flex gap-2 text-sm text-muted">
                  <Icon name="check" className="mt-0.5 h-4 w-4 shrink-0 text-brand" />
                  <span>{fix}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ---------------- Features ---------------- */}
      <section id="features" className="mx-auto max-w-6xl px-4 py-16">
        <h2 className="text-3xl font-bold sm:text-4xl">Everything your shop needs</h2>
        <p className="mt-2 max-w-2xl text-muted">
          Point of sale, stock, credit, M-Pesa and KRA eTIMS — built for motorcycle spare parts shops in Kenya.
        </p>
        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f) => (
            <div key={f.title} className="rounded-2xl border border-charcoal-3 bg-charcoal-2 p-5">
              <div className="rounded-xl bg-brand/15 p-2.5 text-brand w-fit">
                <Icon name={f.icon} />
              </div>
              <h3 className="mt-4 text-xl font-bold">{f.title}</h3>
              <p className="mt-1 text-sm text-muted">{f.text}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ---------------- How it works ---------------- */}
      <section id="how" className="border-y border-charcoal-3 bg-charcoal-2/50">
        <div className="mx-auto max-w-6xl px-4 py-16">
          <h2 className="text-3xl font-bold sm:text-4xl">Up and running in three steps</h2>
          <div className="mt-8 grid gap-5 md:grid-cols-3">
            {[
              ['1', 'Create your shop', 'Sign up, name your shop and your first branch. Your free trial starts straight away.'],
              ['2', 'Add your team', 'Invite your manager, cashiers and storekeeper by email and choose which branches each can use.'],
              ['3', 'Start selling', 'Add your parts, then record sales, track stock and take M-Pesa or cash.'],
            ].map(([n, t, d]) => (
              <div key={n} className="rounded-2xl border border-charcoal-3 bg-charcoal p-6">
                <div className="font-display text-5xl font-bold text-brand">{n}</div>
                <h3 className="mt-2 text-xl font-bold">{t}</h3>
                <p className="mt-1 text-sm text-muted">{d}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ---------------- Built for Kenya ---------------- */}
      <section className="mx-auto max-w-6xl px-4 py-16">
        <div className="grid items-center gap-8 md:grid-cols-2">
          <div>
            <h2 className="text-3xl font-bold sm:text-4xl">Built for how Kenyan shops really work</h2>
            <p className="mt-3 text-muted">
              Customers buy on credit. Prices get negotiated. The internet comes and goes. M-Pesa is how people pay. The
              system is designed around all of that.
            </p>
          </div>
          <ul className="space-y-3">
            {[
              'Prices and reports in Kenya shillings (KES)',
              'M-Pesa Till and Paybill payments, matched to sales',
              'Boda boda riders, mechanics and wholesale buyers each get the right price',
              'KRA eTIMS and VAT in mind from day one',
              'English and Swahili',
            ].map((t) => (
              <li key={t} className="flex items-start gap-3 rounded-xl border border-charcoal-3 bg-charcoal-2 p-3">
                <Icon name="check" className="mt-0.5 h-5 w-5 shrink-0 text-brand" />
                <span>{t}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* ---------------- Pricing ---------------- */}
      <section id="pricing" className="border-y border-charcoal-3 bg-charcoal-2/50">
        <div className="mx-auto max-w-6xl px-4 py-16">
          <h2 className="text-3xl font-bold sm:text-4xl">Simple pricing</h2>
          <p className="mt-2 text-muted">Every shop starts with a 14-day free trial. Prices are per month in KES.</p>
          <div className="mt-8 grid gap-5 md:grid-cols-3">
            {PLANS.map((p) => (
              <div
                key={p.name}
                className={`relative rounded-2xl border bg-charcoal p-6 ${p.popular ? 'border-brand' : 'border-charcoal-3'}`}
              >
                {p.popular && (
                  <span className="absolute -top-3 left-6 rounded-full bg-brand px-3 py-0.5 text-xs font-bold uppercase text-charcoal">
                    Most popular
                  </span>
                )}
                <h3 className="text-2xl font-bold">{p.name}</h3>
                <p className="text-sm text-muted">{p.blurb}</p>
                <div className="mt-4 flex items-baseline gap-1">
                  <span className="text-sm text-muted">KES</span>
                  <span className="font-display text-5xl font-bold">{p.price}</span>
                  <span className="text-sm text-muted">/month</span>
                </div>
                <ul className="mt-5 space-y-2 text-sm">
                  {p.items.map((i) => (
                    <li key={i} className="flex gap-2">
                      <Icon name="check" className="mt-0.5 h-4 w-4 shrink-0 text-brand" />
                      {i}
                    </li>
                  ))}
                </ul>
                <Link
                  href="/signup"
                  className={`mt-6 block rounded-lg px-4 py-2.5 text-center text-sm font-semibold ${
                    p.popular ? 'bg-brand text-charcoal hover:bg-brand-hover' : 'border border-charcoal-3 hover:bg-charcoal-3'
                  }`}
                >
                  Start free trial
                </Link>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ---------------- FAQ ---------------- */}
      <section id="faq" className="mx-auto max-w-3xl px-4 py-16">
        <h2 className="text-3xl font-bold sm:text-4xl">Questions</h2>
        <div className="mt-6 space-y-3">
          {FAQ.map(([q, a]) => (
            <details key={q} className="group rounded-xl border border-charcoal-3 bg-charcoal-2 p-4">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-3 font-semibold">
                {q}
                <span className="text-brand transition group-open:rotate-45">+</span>
              </summary>
              <p className="mt-2 text-sm text-muted">{a}</p>
            </details>
          ))}
        </div>
      </section>

      {/* ---------------- Final call to action ---------------- */}
      <section className="mx-auto max-w-6xl px-4 pb-16">
        <div className="rounded-3xl border border-brand/40 bg-gradient-to-br from-brand/20 to-transparent p-8 text-center sm:p-12">
          <h2 className="text-4xl font-bold sm:text-5xl">Ready to take control of your shop?</h2>
          <p className="mx-auto mt-3 max-w-xl text-muted">Start your free 14-day trial today. No card, no commitment.</p>
          <Link href="/signup" className="mt-6 inline-block rounded-lg bg-brand px-7 py-3 text-base font-semibold text-charcoal hover:bg-brand-hover">
            Create my shop
          </Link>
        </div>
      </section>

      <SiteFooter />
    </div>
  )
}
