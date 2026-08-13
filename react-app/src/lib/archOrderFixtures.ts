/**
 * Sales-order reference data for CWP ARCH — customers, addresses, terms, teams,
 * and a set of open orders to append to.
 *
 * DEMO DATA. Real values come from NetSuite: customers and their addresses,
 * currencies and payment terms from the customer record; sales teams from the
 * subsidiary; open orders from a saved search. None of that can be wired yet —
 * subsidiary 9 has no customers and no transactions. Kept in one module so the
 * swap is mechanical.
 */

import { seededRandom } from '@/lib/archLots';
import { getArchFixtureRows } from '@/lib/archFixtures';
import type { ArchCartLine, ArchOpenOrder } from '@/types/archOrder';

export const CUSTOMERS = [
  'Atlas Millwork',
  'Heritage Cabinetry',
  'Summit Builders Supply',
  'Coastal Hardwoods',
  'Lakeside Interiors',
  'Vanguard Doors & Trim',
  'Ironwood Construction',
  'Meridian Flooring',
  'Northstar Furniture',
  'Pinnacle Architectural',
];

export const INCOTERMS = ['Delivered', 'Customer Pick Up', 'FOB Reload'];

const PAYMENT_TERMS = [
  '0.5% 10 Net 30 days',
  'Net 30 days',
  '2% 10 Net 45 days',
  '1% 15 Net 30 days',
  'Net 60 days',
];

export const SALES_TEAMS: Record<string, { name: string; pct: number }[]> = {
  'Hardwood — East': [
    { name: 'Christopher Pajot', pct: 60 },
    { name: 'Melissa De Castro', pct: 40 },
  ],
  'Hardwood — West': [
    { name: 'Alec Wolf', pct: 50 },
    { name: 'Tom Gorelle', pct: 50 },
  ],
  'Architectural Specialties': [
    { name: 'Léo Dupuis', pct: 70 },
    { name: 'Antoine Quimper', pct: 30 },
  ],
};

export const SALES_TEAM_NAMES = Object.keys(SALES_TEAMS);

const CITIES = [
  'Montréal QC',
  'Laval QC',
  'Québec QC',
  'Sherbrooke QC',
  'Gatineau QC',
  'Trois-Rivières QC',
];
const STREETS = [
  '1200 Industrial Blvd',
  '45 Rue du Commerce',
  '800 Chemin du Port',
  '3300 Boul. Industriel',
  '77 Rue des Pins',
];

/** Ship-to addresses on file for a customer. */
export const addressesFor = (customer: string): string[] => {
  if (!customer) return [];
  const i = CUSTOMERS.indexOf(customer);
  if (i < 0) return [];
  return [
    `Main Yard — ${STREETS[i % STREETS.length]}, ${CITIES[i % CITIES.length]}`,
    `Distribution Centre — ${STREETS[(i + 2) % STREETS.length]}, ${CITIES[(i + 3) % CITIES.length]}`,
  ];
};

/** Currencies a customer can be billed in. Some carry both. */
export const currenciesFor = (customer: string): string[] => {
  if (!customer) return ['USD'];
  const rng = seededRandom(`${customer}|currency`);
  return rng() > 0.6 ? ['USD', 'CAD'] : ['USD'];
};

export const paymentTermsFor = (customer: string): string => {
  if (!customer) return '';
  const rng = seededRandom(`${customer}|terms`);
  return PAYMENT_TERMS[Math.floor(rng() * PAYMENT_TERMS.length)];
};

export const salesTeamFor = (customer: string): string => {
  if (!customer) return '';
  const rng = seededRandom(`${customer}|team`);
  return SALES_TEAM_NAMES[Math.floor(rng() * SALES_TEAM_NAMES.length)];
};

/* ── Open orders ────────────────────────────────────────────────────────────*/

let cachedOrders: ArchOpenOrder[] | null = null;

/**
 * Open sales orders the trader can append to.
 *
 * Lines are drawn from real fixture lots so that editing an order and adding a
 * lot from the grid behave consistently — same shape, same keys.
 */
export const getOpenOrders = (): ArchOpenOrder[] => {
  if (cachedOrders) return cachedOrders;
  const rows = getArchFixtureRows();

  cachedOrders = CUSTOMERS.slice(0, 6).map((customer, i) => {
    const rng = seededRandom(`arch-open-so|${i}`);
    const randInt = (a: number, b: number) => a + Math.floor(rng() * (b - a + 1));
    const lineCount = randInt(1, 3);

    const soNo = `SO-${40000 + i * 137 + randInt(0, 99)}`;
    const lines: ArchCartLine[] = [];
    for (let n = 0; n < lineCount; n++) {
      const row = rows[(i * 5 + n * 3) % rows.length];
      const lot = row.lots[0];
      if (!lot) continue;
      lines.push({
        // Namespaced by SO. Existing order lines must never share a key shape
        // with grid-picked cart lines, or a lot already on the order collides
        // with the same lot added from the grid — duplicate rows, a React key
        // warning, and visibly doubled BF.
        key: `so:${soNo}|${lot.lotNo}`,
        internalId: row.internalId,
        itemCode: row.itemCode,
        description: row.description,
        thickness: row.thickness,
        locationName: row.locationName,
        lotNo: lot.lotNo,
        containerNo: lot.containerNo,
        bf: Math.max(50, Math.round((lot.onHand || row.onHand || 500) / 50) * 50),
        costPerBF: row.avgCostBF,
        bucket: 'onHand',
        existing: true,
        // Already-sold stock has an agreed price. Seeded a little above lot cost
        // so the margin readout is plausible rather than zero.
        pricePerBF: Math.round((row.avgCostBF * (1.18 + rng() * 0.35)) * 100) / 100,
      });
    }

    const created = new Date();
    created.setDate(created.getDate() - randInt(1, 25));
    const ship = new Date();
    ship.setDate(ship.getDate() + randInt(5, 40));

    return {
      soNo,
      customer,
      shipTo: addressesFor(customer)[0] || '',
      currency: currenciesFor(customer)[0],
      incoterms: INCOTERMS[randInt(0, INCOTERMS.length - 1)],
      created: created.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
      shipDate: ship.toISOString().slice(0, 10),
      salesTeam: salesTeamFor(customer),
      // "Ready to Build" is MGSL's internal status meaning the warehouse can start
      // preparing it — and the point at which the order stops being editable.
      status: rng() > 0.65 ? 'Ready to Build' : 'Reserved',
      lines,
    };
  });

  return cachedOrders;
};
