-- Gown web – MySQL schema
-- Run with: mysql -u your_user -p your_database < database/schema.sql

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

-- --------------------------------------------------------
-- Gowns (products)
-- --------------------------------------------------------
DROP TABLE IF EXISTS `order_items`;
DROP TABLE IF EXISTS `orders`;
DROP TABLE IF EXISTS `gowns`;
DROP TABLE IF EXISTS `users`;

CREATE TABLE `gowns` (
  `id` int unsigned NOT NULL AUTO_INCREMENT,
  `name` varchar(255) NOT NULL,
  `price_amount` decimal(12, 2) NOT NULL COMMENT 'Numeric price in PHP',
  `price_display` varchar(32) DEFAULT NULL COMMENT 'Display string e.g. ₱65,000',
  `image` varchar(512) DEFAULT NULL,
  `alt` varchar(255) DEFAULT NULL,
  `type` varchar(64) DEFAULT NULL,
  `color` varchar(64) DEFAULT NULL,
  `silhouette` varchar(64) DEFAULT NULL,
  `description` text,
  `style` json DEFAULT NULL COMMENT 'Flexible metadata e.g. {"filter":"brightness(0.9)"}',
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_type` (`type`),
  KEY `idx_color` (`color`),
  KEY `idx_silhouette` (`silhouette`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------
-- Users
-- --------------------------------------------------------
CREATE TABLE `users` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `name` varchar(255) NOT NULL,
  `email` varchar(255) NOT NULL,
  `password_hash` varchar(255) NOT NULL COMMENT 'Use bcrypt/argon2 in production',
  `role` varchar(32) NOT NULL DEFAULT 'customer',
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_users_email` (`email`),
  KEY `idx_role` (`role`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------
-- Orders
-- --------------------------------------------------------
CREATE TABLE `orders` (
  `id` varchar(64) NOT NULL COMMENT 'e.g. timestamp-based ID',
  `user_id` bigint unsigned DEFAULT NULL,
  `contact_email` varchar(255) NOT NULL,
  `contact_first_name` varchar(128) NOT NULL,
  `contact_last_name` varchar(128) NOT NULL,
  `contact_phone` varchar(32) NOT NULL,
  `delivery_address` varchar(512) NOT NULL,
  `delivery_city` varchar(128) NOT NULL,
  `delivery_province` varchar(128) DEFAULT NULL,
  `delivery_zip` varchar(16) DEFAULT NULL,
  `payment_method` varchar(32) NOT NULL,
  `note` text,
  `subtotal` decimal(14, 2) NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_orders_user` (`user_id`),
  KEY `idx_orders_created` (`created_at`),
  CONSTRAINT `fk_orders_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------
-- Order line items
-- --------------------------------------------------------
CREATE TABLE `order_items` (
  `id` int unsigned NOT NULL AUTO_INCREMENT,
  `order_id` varchar(64) NOT NULL,
  `gown_id` int unsigned NOT NULL,
  `name` varchar(255) NOT NULL,
  `qty` int unsigned NOT NULL DEFAULT 1,
  `price` varchar(64) NOT NULL COMMENT 'Display price at time of order',
  `subtotal` decimal(14, 2) NOT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_order_items_order` (`order_id`),
  KEY `idx_order_items_gown` (`gown_id`),
  CONSTRAINT `fk_order_items_order` FOREIGN KEY (`order_id`) REFERENCES `orders` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `fk_order_items_gown` FOREIGN KEY (`gown_id`) REFERENCES `gowns` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET FOREIGN_KEY_CHECKS = 1;
