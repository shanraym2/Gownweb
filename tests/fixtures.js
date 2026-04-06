/**
 * Test Fixtures
 * ──────────────
 * Shared data used across all test suites.
 * Designed to be realistic enough to validate algorithm behaviour.
 */

// ── Gown catalog ───────────────────────────────────────────────────────────

export const TEST_GOWNS = [
  {
    id: 1,
    name: 'Celestine',
    type: 'Ball Gown',
    color: 'Ivory',
    silhouette: 'Ball Gown',
    description: 'An ivory ball gown with sweetheart neckline and cathedral train. Features intricate lace appliqués and a corseted bodice.',
    price: '₱45,000',
    image: '/images/gown1.jpg',
    alt: 'Celestine ball gown',
  },
  {
    id: 2,
    name: 'Seraphina',
    type: 'Ball Gown',
    color: 'White',
    silhouette: 'Ball Gown',
    description: 'A white princess ball gown with full skirt and lace bodice. Sweetheart neckline with tulle overlay.',
    price: '₱52,000',
    image: '/images/gown2.jpg',
    alt: 'Seraphina ball gown',
  },
  {
    id: 3,
    name: 'Lunara',
    type: 'A-Line',
    color: 'Ivory',
    silhouette: 'A-Line',
    description: 'Flowing ivory A-line gown with chiffon fabric and V-neckline. Elegant draped back with satin buttons.',
    price: '₱38,000',
    image: '/images/gown3.jpg',
    alt: 'Lunara A-line gown',
  },
  {
    id: 4,
    name: 'Aurelia',
    type: 'A-Line',
    color: 'Champagne',
    silhouette: 'A-Line',
    description: 'Champagne A-line with organza skirt and beaded bodice. Off-shoulder sleeves with floral embroidery.',
    price: '₱41,000',
    image: '/images/gown4.jpg',
    alt: 'Aurelia A-line gown',
  },
  {
    id: 5,
    name: 'Vivienne',
    type: 'Mermaid',
    color: 'White',
    silhouette: 'Mermaid',
    description: 'Fitted white mermaid gown with trumpet flare at knee. Satin fabric with beaded waistband.',
    price: '₱55,000',
    image: '/images/gown5.jpg',
    alt: 'Vivienne mermaid gown',
  },
  {
    id: 6,
    name: 'Isadora',
    type: 'Mermaid',
    color: 'Ivory',
    silhouette: 'Mermaid',
    description: 'Ivory mermaid silhouette with lace overlay from bodice to hip. Deep V-back and sweep train.',
    price: '₱58,000',
    image: '/images/gown6.jpg',
    alt: 'Isadora mermaid gown',
  },
  {
    id: 7,
    name: 'Colette',
    type: 'Sheath',
    color: 'Blush',
    silhouette: 'Sheath',
    description: 'Minimalist blush sheath gown in crepe fabric. Square neckline and low open back with covered buttons.',
    price: '₱33,000',
    image: '/images/gown7.jpg',
    alt: 'Colette sheath gown',
  },
  {
    id: 8,
    name: 'Margaux',
    type: 'Sheath',
    color: 'White',
    silhouette: 'Sheath',
    description: 'Modern white sheath with illusion lace neckline. Sleek silhouette with chapel train.',
    price: '₱36,000',
    image: '/images/gown8.jpg',
    alt: 'Margaux sheath gown',
  },
  {
    id: 9,
    name: 'Teodora',
    type: 'Tea Length',
    color: 'Ivory',
    silhouette: 'A-Line',
    description: 'Vintage-inspired ivory tea length gown with lace overlay and sweetheart neckline. Full crinoline skirt.',
    price: '₱28,000',
    image: '/images/gown9.jpg',
    alt: 'Teodora tea length gown',
  },
  {
    id: 10,
    name: 'Elara',
    type: 'Ball Gown',
    color: 'Champagne',
    silhouette: 'Ball Gown',
    description: 'Champagne ball gown with jewelled bodice and dramatic skirt. Strapless sweetheart neckline with cathedral train.',
    price: '₱62,000',
    image: '/images/gown10.jpg',
    alt: 'Elara ball gown',
  },
]

// ── User interaction matrix ────────────────────────────────────────────────
// Simulates a realistic set of users with different tastes:
//   user_ballgown_lover   → loves ball gowns (gowns 1,2,10)
//   user_mermaid_fan      → loves mermaid (gowns 5,6) + some aline
//   user_minimal_bride    → prefers sheath/minimalist (gowns 7,8)
//   user_aline_classic    → classic A-lines (gowns 3,4)
//   user_mixed            → diverse tastes

export const TEST_INTERACTIONS = {
  user_ballgown_lover: {
    '1': 8,   // cart_add + inquiry
    '2': 6,   // cart_add
    '10': 7,  // cart_add + favorite
    '3': 1,   // just viewed
  },
  user_mermaid_fan: {
    '5': 9,   // cart_add + inquiry
    '6': 7,   // cart_add + favorite
    '3': 3,   // favorite
    '4': 1,   // viewed
  },
  user_minimal_bride: {
    '7': 8,   // cart_add + inquiry
    '8': 6,   // cart_add
    '3': 2,   // viewed twice
    '9': 1,   // viewed
  },
  user_aline_classic: {
    '3': 8,   // cart_add + inquiry
    '4': 7,   // cart_add + favorite
    '9': 5,   // cart_add
    '1': 1,   // viewed
  },
  user_mixed: {
    '1': 3,   // favorite
    '5': 3,   // favorite
    '7': 3,   // favorite
    '3': 5,   // cart_add
  },
  user_ballgown_lover_2: {
    '1': 6,
    '2': 8,
    '10': 9,
    '4': 2,
  },
  user_mermaid_fan_2: {
    '5': 7,
    '6': 8,
    '8': 3,
  },
  user_aline_2: {
    '3': 7,
    '4': 8,
    '9': 6,
    '7': 1,
  },
}

// ── Session baskets ────────────────────────────────────────────────────────
// Realistic co-view patterns for Apriori mining

export const TEST_BASKETS = [
  // Ball gown shoppers often compare 1, 2, 10
  ['1', '2'],
  ['1', '2', '10'],
  ['2', '10'],
  ['1', '10'],
  ['1', '2'],
  ['2', '10'],
  ['1', '2', '10'],
  // Mermaid shoppers compare 5 and 6
  ['5', '6'],
  ['5', '6'],
  ['5', '6', '3'],
  ['5', '6'],
  // A-line shoppers compare 3, 4, 9
  ['3', '4'],
  ['3', '4', '9'],
  ['3', '9'],
  ['4', '9'],
  ['3', '4'],
  // Sheath shoppers compare 7 and 8
  ['7', '8'],
  ['7', '8'],
  ['7', '8'],
  // Cross-category
  ['1', '3'],
  ['5', '7'],
  ['3', '5'],
]

// ── Expected behaviour reference ───────────────────────────────────────────

export const EXPECTED = {
  // CBF: gown 1 (Ball Gown, Ivory) should be most similar to gown 2 (Ball Gown, White)
  // and gown 10 (Ball Gown, Champagne), not to gown 5 (Mermaid)
  cbf_gown1_top_types: ['Ball Gown'],

  // KNN: a new user who viewed gown 1 (Ball Gown) should get recommendations
  // similar to what user_ballgown_lover and user_ballgown_lover_2 liked
  knn_ballgown_similar_users: ['user_ballgown_lover', 'user_ballgown_lover_2'],

  // Apriori: {1,2} should have high support (appears 5/22 baskets ≈ 22%)
  apriori_12_min_support: 0.05,

  // Weight profile thresholds
  weight_profiles: {
    cold_start_max_users: 0,
    sparse_max_users: 4,
    balanced_max_users: 14,
  },
}
