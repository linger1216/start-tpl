CREATE TABLE `todos` (
	`id` int AUTO_INCREMENT NOT NULL,
	`title` text NOT NULL,
	`created_at` timestamp DEFAULT (now()),
	CONSTRAINT `todos_id` PRIMARY KEY(`id`)
);
