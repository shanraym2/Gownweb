-- Seed gowns
-- Run after schema.sql

INSERT INTO gowns (sku, name, sale_price, description, color, silhouette, is_active) VALUES
('SKU-001', 'The Isabella',   65000.00, 'A romantic lace gown with a softly structured bodice and flowing skirt, designed for effortless movement down the aisle.',          'Ivory',     'A-line',        TRUE),
('SKU-002', 'The Victoria',  102000.00, 'A modern ball gown in liquid satin, featuring a clean neckline and dramatic train for a royal-inspired entrance.',                   'Blush',     'Ballgown',      TRUE),
('SKU-003', 'The Sophia',     80000.00, 'A floral-embroidered gown with a fitted silhouette and soft flare hem, perfect for garden and outdoor celebrations.',               'Floral',    'Fit-and-flare', TRUE),
('SKU-004', 'The Camille Suit',75000.00,'A tailored bridal suit in champagne satin, created for brides who prefer a sharp, minimalist look over a traditional dress.',       'Champagne', 'Suit',          TRUE),
('SKU-005', 'The Aria',       88000.00, 'A minimalist crepe sheath gown with a low back and clean lines, ideal for modern city ceremonies.',                                  'Ivory',     'Sheath',        TRUE),
('SKU-006', 'The Elena',      95000.00, 'Soft layers of blush tulle and hand-applied floral appliqués create a dreamy, romantic silhouette.',                                 'Blush',     'A-line',        TRUE),
('SKU-007', 'The Margaux',   110000.00, 'An intricately beaded mermaid gown that hugs the figure before flaring into a soft, layered train.',                                'Ivory',     'Mermaid',       TRUE),
('SKU-009', 'Bluegown',      129000.00, NULL,                                                                                                                                 NULL,        NULL,            TRUE);

-- Seed gown images
INSERT INTO gown_images (gown_id, image_url, alt, is_primary, sort_order)
SELECT id, '/images/image1.png', 'Lace Detail Gown',   TRUE, 0 FROM gowns WHERE sku = 'SKU-001';

INSERT INTO gown_images (gown_id, image_url, alt, is_primary, sort_order)
SELECT id, '/images/image2.png', 'Royal Satin Gown',   TRUE, 0 FROM gowns WHERE sku = 'SKU-002';

INSERT INTO gown_images (gown_id, image_url, alt, is_primary, sort_order)
SELECT id, '/images/image1.png', 'Floral Garden Gown', TRUE, 0 FROM gowns WHERE sku = 'SKU-003';

INSERT INTO gown_images (gown_id, image_url, alt, is_primary, sort_order)
SELECT id, '/images/image2.png', 'Bridal Suit',        TRUE, 0 FROM gowns WHERE sku = 'SKU-004';

INSERT INTO gown_images (gown_id, image_url, alt, is_primary, sort_order)
SELECT id, '/images/image1.png', 'Ivory Crepe Gown',   TRUE, 0 FROM gowns WHERE sku = 'SKU-005';

INSERT INTO gown_images (gown_id, image_url, alt, is_primary, sort_order)
SELECT id, '/images/image2.png', 'Blush Tulle Gown',   TRUE, 0 FROM gowns WHERE sku = 'SKU-006';

INSERT INTO gown_images (gown_id, image_url, alt, is_primary, sort_order)
SELECT id, '/images/image1.png', 'Ivory Beaded Gown',  TRUE, 0 FROM gowns WHERE sku = 'SKU-007';

INSERT INTO gown_images (gown_id, image_url, alt, is_primary, sort_order)
SELECT id, 'https://img.kwcdn.com/product/fancy/2231a0cd-e470-40d7-b4da-d0c85a39a735.jpg?imageMogr2/auto-orient%7CimageView2/2/w/800/q/70/format/webp', 'Bluegown', TRUE, 0 FROM gowns WHERE sku = 'SKU-009';