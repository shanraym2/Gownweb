'use client'

export const GOWNS = [
  {
    id: 1,
    name: 'The Isabella',
    price: '₱65,000',
    image: '/images/image1.png',
    alt: 'Lace Detail Gown',
    type: 'Gowns',
    color: 'Ivory',
    silhouette: 'A-line',
    description:
      'A romantic lace gown with a softly structured bodice and flowing skirt, designed for effortless movement down the aisle.',
  },
  {
    id: 2,
    name: 'The Victoria',
    price: '₱102,000',
    image: '/images/image2.png',
    alt: 'Royal Satin Gown',
    type: 'Gowns',
    color: 'Blush',
    silhouette: 'Ballgown',
    description:
      'A modern ball gown in liquid satin, featuring a clean neckline and dramatic train for a royal-inspired entrance.',
  },
  {
    id: 3,
    name: 'The Sophia',
    price: '₱80,000',
    image: '/images/image1.png',
    alt: 'Floral Garden Gown',
    type: 'Dresses',
    color: 'Floral',
    silhouette: 'Fit-and-flare',
    style: { filter: 'brightness(0.9)' },
    description:
      'A floral-embroidered gown with a fitted silhouette and soft flare hem, perfect for garden and outdoor celebrations.',
  },
  {
    id: 4,
    name: 'The Camille Suit',
    price: '₱75,000',
    image: '/images/image2.png',
    alt: 'Bridal Suit',
    type: 'Suit',
    color: 'Champagne',
    silhouette: 'Suit',
    description:
      'A tailored bridal suit in champagne satin, created for brides who prefer a sharp, minimalist look over a traditional dress.',
  },
  {
    id: 5,
    name: 'The Aria',
    price: '₱88,000',
    image: '/images/image1.png',
    alt: 'Ivory Crepe Gown',
    type: 'Gowns',
    color: 'Ivory',
    silhouette: 'Sheath',
    description:
      'A minimalist crepe sheath gown with a low back and clean lines, ideal for modern city ceremonies.',
  },
  {
    id: 6,
    name: 'The Elena',
    price: '₱95,000',
    image: '/images/image2.png',
    alt: 'Blush Tulle Gown',
    type: 'Gowns',
    color: 'Blush',
    silhouette: 'A-line',
    description:
      'Soft layers of blush tulle and hand-applied floral appliqués create a dreamy, romantic silhouette.',
  },
  {
    id: 7,
    name: 'The Margaux',
    price: '₱110,000',
    image: '/images/image1.png',
    alt: 'Ivory Beaded Gown',
    type: 'Gowns',
    color: 'Ivory',
    silhouette: 'Mermaid',
    description:
      'An intricately beaded mermaid gown that hugs the figure before flaring into a soft, layered train.',
  },
  {
    id: 8,
    name: 'The Sienna',
    price: '₱72,000',
    image: '/images/image2.png',
    alt: 'Champagne Slip Dress',
    type: 'Dresses',
    color: 'Champagne',
    silhouette: 'Slip',
    description:
      'A bias-cut champagne slip dress that drapes effortlessly, perfect for destination and civil weddings.',
  },
]

export function getGownById(id) {
  return GOWNS.find((gown) => gown.id === id)
}

