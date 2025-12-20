CREATE TABLE `exams` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` text NOT NULL,
	`title` text NOT NULL,
	`subject` text NOT NULL,
	`difficulty` text NOT NULL,
	`num_questions` integer NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `questions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`exam_id` integer NOT NULL,
	`question_text` text NOT NULL,
	`question_type` text NOT NULL,
	`correct_answer` text NOT NULL,
	`option_a` text,
	`option_b` text,
	`option_c` text,
	`option_d` text,
	`points` integer DEFAULT 1 NOT NULL,
	`order_index` integer NOT NULL,
	FOREIGN KEY (`exam_id`) REFERENCES `exams`(`id`) ON UPDATE no action ON DELETE no action
);
