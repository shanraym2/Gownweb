-- Seed gowns from data/gowns.json
-- Run after schema.sql: mysql -u your_user -p your_database < database/seed-gowns.sql

INSERT INTO `gowns` (`id`, `name`, `price_amount`, `price_display`, `image`, `alt`, `type`, `color`, `silhouette`, `description`, `style`) VALUES
(1, 'The Isabella', 65000.00, '₱65,000', '/images/image1.png', 'Lace Detail Gown', 'Gowns', 'Ivory', 'A-line', 'A romantic lace gown with a softly structured bodice and flowing skirt, designed for effortless movement down the aisle.', NULL),
(2, 'The Victoria', 102000.00, '₱102,000', '/images/image2.png', 'Royal Satin Gown', 'Gowns', 'Blush', 'Ballgown', 'A modern ball gown in liquid satin, featuring a clean neckline and dramatic train for a royal-inspired entrance.', NULL),
(3, 'The Sophia', 80000.00, '₱80,000', '/images/image1.png', 'Floral Garden Gown', 'Dresses', 'Floral', 'Fit-and-flare', 'A floral-embroidered gown with a fitted silhouette and soft flare hem, perfect for garden and outdoor celebrations.', '{"filter":"brightness(0.9)"}'),
(4, 'The Camille Suit', 75000.00, '₱75,000', '/images/image2.png', 'Bridal Suit', 'Suit', 'Champagne', 'Suit', 'A tailored bridal suit in champagne satin, created for brides who prefer a sharp, minimalist look over a traditional dress.', NULL),
(5, 'The Aria', 88000.00, '₱88,000', '/images/image1.png', 'Ivory Crepe Gown', 'Gowns', 'Ivory', 'Sheath', 'A minimalist crepe sheath gown with a low back and clean lines, ideal for modern city ceremonies.', NULL),
(6, 'The Elena', 95000.00, '₱95,000', '/images/image2.png', 'Blush Tulle Gown', 'Gowns', 'Blush', 'A-line', 'Soft layers of blush tulle and hand-applied floral appliqués create a dreamy, romantic silhouette.', NULL),
(7, 'The Margaux', 110000.00, '₱110,000', '/images/image1.png', 'Ivory Beaded Gown', 'Gowns', 'Ivory', 'Mermaid', 'An intricately beaded mermaid gown that hugs the figure before flaring into a soft, layered train.', NULL),
(9, 'Bluegown', 129000.00, '₱129,000', 'https://img.kwcdn.com/product/fancy/2231a0cd-e470-40d7-b4da-d0c85a39a735.jpg?imageMogr2/auto-orient%7CimageView2/2/w/800/q/70/format/webp', 'Bluegown', 'Gowns', '', '', '', NULL);
