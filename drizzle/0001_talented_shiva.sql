CREATE TABLE `devices` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name` varchar(120) NOT NULL,
	`owner_email` varchar(320) NOT NULL,
	`color` varchar(16) NOT NULL DEFAULT '#48e0c1',
	`tracking_code` varchar(6) NOT NULL,
	`last_lat` double,
	`last_lng` double,
	`last_accuracy` double,
	`last_seen` timestamp,
	`battery` int,
	`status` enum('active','idle','offline') NOT NULL DEFAULT 'offline',
	`sharing_enabled` boolean NOT NULL DEFAULT true,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `devices_id` PRIMARY KEY(`id`),
	CONSTRAINT `devices_tracking_code_idx` UNIQUE(`tracking_code`)
);
--> statement-breakpoint
CREATE TABLE `geofence_events` (
	`id` int AUTO_INCREMENT NOT NULL,
	`geofence_id` int NOT NULL,
	`device_id` int NOT NULL,
	`event_type` enum('enter','exit') NOT NULL,
	`recorded_at` timestamp NOT NULL,
	CONSTRAINT `geofence_events_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `geofences` (
	`id` int AUTO_INCREMENT NOT NULL,
	`owner_email` varchar(320) NOT NULL,
	`name` varchar(120) NOT NULL,
	`lat` double NOT NULL,
	`lng` double NOT NULL,
	`radius_m` double NOT NULL,
	`device_id` int,
	`notify_on` enum('enter','exit','both') NOT NULL DEFAULT 'both',
	`last_inside` boolean,
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `geofences_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `location_pings` (
	`id` int AUTO_INCREMENT NOT NULL,
	`device_id` int NOT NULL,
	`lat` double NOT NULL,
	`lng` double NOT NULL,
	`accuracy` double NOT NULL,
	`speed` double,
	`heading` double,
	`source` enum('gps','owntracks','network') NOT NULL DEFAULT 'gps',
	`recorded_at` timestamp NOT NULL,
	`flagged` boolean NOT NULL DEFAULT false,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `location_pings_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `share_links` (
	`token` varchar(64) NOT NULL,
	`device_id` int NOT NULL,
	`expires_at` timestamp NOT NULL,
	`revoked` boolean NOT NULL DEFAULT false,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `share_links_token` PRIMARY KEY(`token`)
);
--> statement-breakpoint
ALTER TABLE `users` MODIFY COLUMN `name` varchar(255);--> statement-breakpoint
ALTER TABLE `geofence_events` ADD CONSTRAINT `geofence_events_geofence_id_geofences_id_fk` FOREIGN KEY (`geofence_id`) REFERENCES `geofences`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `geofence_events` ADD CONSTRAINT `geofence_events_device_id_devices_id_fk` FOREIGN KEY (`device_id`) REFERENCES `devices`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `geofences` ADD CONSTRAINT `geofences_device_id_devices_id_fk` FOREIGN KEY (`device_id`) REFERENCES `devices`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `location_pings` ADD CONSTRAINT `location_pings_device_id_devices_id_fk` FOREIGN KEY (`device_id`) REFERENCES `devices`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `share_links` ADD CONSTRAINT `share_links_device_id_devices_id_fk` FOREIGN KEY (`device_id`) REFERENCES `devices`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `devices_owner_seen_idx` ON `devices` (`owner_email`,`last_seen`);--> statement-breakpoint
CREATE INDEX `geofence_events_device_time_idx` ON `geofence_events` (`device_id`,`recorded_at`);--> statement-breakpoint
CREATE INDEX `geofences_owner_idx` ON `geofences` (`owner_email`);--> statement-breakpoint
CREATE INDEX `pings_device_recorded_idx` ON `location_pings` (`device_id`,`recorded_at`);--> statement-breakpoint
CREATE INDEX `share_device_idx` ON `share_links` (`device_id`);