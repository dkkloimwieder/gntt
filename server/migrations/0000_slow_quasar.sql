CREATE TABLE `blocked_time` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`resource_id` text NOT NULL,
	`start` text NOT NULL,
	`end` text NOT NULL,
	`reason` text,
	FOREIGN KEY (`resource_id`) REFERENCES `resources`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `blocked_time_resource_idx` ON `blocked_time` (`resource_id`);--> statement-breakpoint
CREATE TABLE `dependencies` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`from_task_id` text NOT NULL,
	`to_task_id` text NOT NULL,
	`type` text DEFAULT 'FS' NOT NULL,
	`lag` integer DEFAULT 0 NOT NULL,
	`max_gap` integer,
	FOREIGN KEY (`from_task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`to_task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `dependencies_from_idx` ON `dependencies` (`from_task_id`);--> statement-breakpoint
CREATE INDEX `dependencies_to_idx` ON `dependencies` (`to_task_id`);--> statement-breakpoint
CREATE TABLE `resources` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`group_name` text,
	`sort_order` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`start` text NOT NULL,
	`end` text NOT NULL,
	`progress` integer DEFAULT 0 NOT NULL,
	`resource_id` text,
	`parent_id` text,
	`type` text,
	`color` text,
	`color_progress` text,
	`baseline_start` text,
	`baseline_end` text,
	`constraints` text,
	`updated_at` text DEFAULT 'CURRENT_TIMESTAMP' NOT NULL,
	FOREIGN KEY (`resource_id`) REFERENCES `resources`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `tasks_resource_idx` ON `tasks` (`resource_id`);--> statement-breakpoint
CREATE INDEX `tasks_parent_idx` ON `tasks` (`parent_id`);